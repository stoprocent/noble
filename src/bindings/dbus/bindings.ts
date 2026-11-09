import createDebug from 'debug';
import type { ClientInterface, MessageBus, ProxyObject } from 'dbus-next';

import { Deferred } from '../../common/deferred';
import {
  ConnectionCancelledError,
  DisconnectedError,
  NobleError,
  NotSupportedError
} from '../../common/errors';
import type {
  AdapterState,
  AddressType,
  Advertisement,
  CharacteristicProperty,
  ConnectOptions,
  DisconnectReason
} from '../../types';
import type { Bindings, BindingsDelegate, CharacteristicInfo } from '../bindings';
import {
  addressToId,
  deviceIdFromPath,
  devicePathFromAddress,
  devicePathToAddress,
  normalizeUuid
} from './uuid';

const debug = createDebug('noble-dbus');

const BLUEZ_SERVICE = 'org.bluez';
const ROOT_PATH = '/';
const ADAPTER_IFACE = 'org.bluez.Adapter1';
const DEVICE_IFACE = 'org.bluez.Device1';
const GATT_SERVICE_IFACE = 'org.bluez.GattService1';
const GATT_CHAR_IFACE = 'org.bluez.GattCharacteristic1';
const GATT_DESC_IFACE = 'org.bluez.GattDescriptor1';
const PROPS_IFACE = 'org.freedesktop.DBus.Properties';
const OBJECT_MANAGER_IFACE = 'org.freedesktop.DBus.ObjectManager';

const FLAG_TO_PROPERTY: Readonly<Record<string, CharacteristicProperty>> = {
  broadcast: 'broadcast',
  read: 'read',
  'write-without-response': 'writeWithoutResponse',
  write: 'write',
  notify: 'notify',
  indicate: 'indicate',
  'authenticated-signed-writes': 'authenticatedSignedWrites',
  'reliable-write': 'extendedProperties',
  'writable-auxiliaries': 'extendedProperties'
};

export interface DbusBindingsOptions {
  /** BlueZ adapter name, e.g. `'hci1'`. Takes precedence over {@link hciDeviceId}. */
  adapterId?: string;
  /**
   * Adapter index; `1` selects `hci1`. Defaults to `NOBLE_HCI_DEVICE_ID`. The
   * first adapter is used (with a warning) when the requested one does not exist.
   */
  hciDeviceId?: number | string;
}

// ---- The slice of dbus-next / BlueZ this backend talks to ----
// dbus-next builds its proxy interfaces at runtime from introspection data, so
// they are typed as bags of functions. These describe the members used here.

type DbusModule = typeof import('dbus-next');

/** Unwrapped property dictionary of one D-Bus interface. */
type Props = Record<string, unknown>;
/** Interface name -> properties, for one object path. */
type InterfaceMap = Record<string, Props>;
type ManagedObjects = Record<string, Record<string, Record<string, unknown>>>;

type PropertiesChangedListener = (iface: string, changed: Record<string, unknown>, invalidated?: string[]) => void;

interface PropertiesIface extends ClientInterface {
  on (event: 'PropertiesChanged', listener: PropertiesChangedListener): this;
  off (event: 'PropertiesChanged', listener: PropertiesChangedListener): this;
}

interface ObjectManagerIface extends ClientInterface {
  GetManagedObjects (): Promise<ManagedObjects>;
}

interface AdapterIface extends ClientInterface {
  SetDiscoveryFilter (filter: Record<string, unknown>): Promise<void>;
  StartDiscovery (): Promise<void>;
  StopDiscovery (): Promise<void>;
}

interface DeviceIface extends ClientInterface {
  Connect (): Promise<void>;
  Disconnect (): Promise<void>;
}

interface GattCharacteristicIface extends ClientInterface {
  ReadValue (options: Record<string, unknown>): Promise<unknown>;
  WriteValue (value: Buffer, options: Record<string, unknown>): Promise<void>;
  StartNotify (): Promise<void>;
  StopNotify (): Promise<void>;
}

interface GattDescriptorIface extends ClientInterface {
  ReadValue (options: Record<string, unknown>): Promise<unknown>;
  WriteValue (value: Buffer, options: Record<string, unknown>): Promise<void>;
}

interface PropsSubscription {
  props: PropertiesIface;
  listener: PropertiesChangedListener;
}

interface DeviceState {
  path: string;
  address: string;
  addressType: AddressType;
  connectable: boolean;
  scannable: boolean;
  rssi: number;
  advertisement: Advertisement;
  /** Set while a connection is being set up or is established. */
  proxy: ProxyObject | null;
  propsListener: PropertiesChangedListener | null;
  servicesResolved: boolean;
  /** The in-flight `connect()` promise, shared by concurrent callers. */
  connecting: Promise<void> | null;
  /** Settled by the device's property listener once services are resolved (or the link drops). */
  pendingConnect: Deferred<void> | null;
  cancelRequested: boolean;
}

interface LocatedService { path: string; uuid: string; primary: boolean; }
interface LocatedCharacteristic { path: string; uuid: string; properties: CharacteristicProperty[]; }
interface LocatedDescriptor { path: string; uuid: string; }

function loadDbus (): DbusModule {
  try {
    // dbus-next is an optional peer of this Linux-only backend; the host
    // project installs it explicitly, so it is only loaded when the backend
    // is actually started.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('dbus-next') as DbusModule;
  } catch (err) {
    const wrapped = new NobleError(
      'noble dbus backend requires the "dbus-next" package. ' +
      'Install it with: npm install dbus-next'
    );
    throw Object.assign(wrapped, { cause: err });
  }
}

function normalizeId (id: string): string {
  // BlueZ emits MACs uppercase; noble's id form is colon-stripped lowercase.
  // Accept either, plus mixed case, so external callers don't have to care.
  return String(id ?? '').replace(/:/g, '').toLowerCase();
}

function toError (err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

function errorMessage (err: unknown): string {
  return toError(err).message;
}

function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function unwrapVariant (variant: unknown): unknown {
  if (isRecord(variant) && 'value' in variant && 'signature' in variant) {
    return variant.value;
  }
  return variant;
}

function unwrapDict (dict: Record<string, unknown> | null | undefined): Props {
  const out: Props = {};
  if (!dict) return out;
  for (const key of Object.keys(dict)) {
    out[key] = unwrapVariant(dict[key]);
  }
  return out;
}

function unwrapInterfaces (ifaces: Record<string, Record<string, unknown>>): InterfaceMap {
  const out: InterfaceMap = {};
  for (const [iface, props] of Object.entries(ifaces)) {
    out[iface] = unwrapDict(props);
  }
  return out;
}

function toBuffer (value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (Array.isArray(value)) return Buffer.from(value as number[]);
  return Buffer.alloc(0);
}

function uuidOf (value: unknown): string {
  return typeof value === 'string' ? normalizeUuid(value) : '';
}

function toAddressType (value: unknown): AddressType | undefined {
  return value === 'public' || value === 'random' ? value : undefined;
}

function flagsToProperties (flags: unknown): CharacteristicProperty[] {
  const set = new Set<CharacteristicProperty>();
  if (Array.isArray(flags)) {
    for (const flag of flags) {
      const mapped = FLAG_TO_PROPERTY[String(flag)];
      if (mapped) set.add(mapped);
    }
  }
  return Array.from(set);
}

function buildAdvertisement (deviceProps: Props): Advertisement {
  const advertisement: Advertisement = {
    localName: undefined,
    txPowerLevel: undefined,
    manufacturerData: undefined,
    serviceData: [],
    serviceUuids: [],
    serviceSolicitationUuids: []
  };

  if (typeof deviceProps.Name === 'string') {
    advertisement.localName = deviceProps.Name;
  } else if (typeof deviceProps.Alias === 'string') {
    advertisement.localName = deviceProps.Alias;
  }

  if (typeof deviceProps.TxPower === 'number') {
    advertisement.txPowerLevel = deviceProps.TxPower;
  }

  if (Array.isArray(deviceProps.UUIDs)) {
    advertisement.serviceUuids = deviceProps.UUIDs.map(uuidOf);
  }

  if (isRecord(deviceProps.ManufacturerData)) {
    const buffers: Buffer[] = [];
    for (const [companyId, rawPayload] of Object.entries(deviceProps.ManufacturerData)) {
      const id = Number(companyId) & 0xffff;
      const header = Buffer.from([id & 0xff, (id >> 8) & 0xff]);
      buffers.push(Buffer.concat([header, toBuffer(unwrapVariant(rawPayload))]));
    }
    if (buffers.length > 0) {
      advertisement.manufacturerData = buffers.length === 1 ? buffers[0] : Buffer.concat(buffers);
    }
  }

  if (isRecord(deviceProps.ServiceData)) {
    for (const [uuid, rawPayload] of Object.entries(deviceProps.ServiceData)) {
      advertisement.serviceData.push({
        uuid: normalizeUuid(uuid),
        data: toBuffer(unwrapVariant(rawPayload))
      });
    }
  }

  return advertisement;
}

/**
 * Backend that drives BlueZ over D-Bus (`org.bluez`). BlueZ owns the
 * controller, so scanning, connecting and GATT all go through its object
 * tree, which is mirrored here and kept current via ObjectManager signals.
 */
export class DbusBindings implements Bindings {
  private readonly options: DbusBindingsOptions;
  private delegate: BindingsDelegate | null = null;
  private dbus: DbusModule | null = null;
  private bus: MessageBus | null = null;
  private objectManager: ObjectManagerIface | null = null;

  private adapterPath: string | null = null;
  private adapterIface: AdapterIface | null = null;
  private adapterProps: PropertiesIface | null = null;
  private state: AdapterState = 'unknown';
  /** The scan the application asked for. BlueZ may be paused underneath it, see {@link pauseDiscoveryForConnect}. */
  private isScanning = false;
  /** Connect attempts that currently own the adapter. */
  private connectsInFlight = 0;
  /** A scan is owed to BlueZ once the last connect attempt finishes. */
  private discoveryDeferredByConnect = false;
  /** The `StopDiscovery` of the current pause, so later attempts wait for it too. */
  private discoveryPause: Promise<void> | null = null;

  /** Mirror of BlueZ's object tree: path -> interface -> properties. */
  private readonly objects = new Map<string, InterfaceMap>();
  /** Software-side service UUID filter of the current scan. */
  private scanServiceUuids: string[] = [];
  /** Per-device live state, keyed by peripheral id. */
  private readonly devices = new Map<string, DeviceState>();
  /** Notification listeners, keyed by characteristic path. */
  private readonly charPropsListeners = new Map<string, PropsSubscription>();
  /** Advertisement watchers that live for the duration of a scan, keyed by device path. */
  private readonly scanPropsListeners = new Map<string, PropsSubscription>();

  constructor (options: DbusBindingsOptions = {}) {
    this.options = options ?? {};
  }

  /** Throws when the optional `dbus-next` package is not installed. */
  start (delegate: BindingsDelegate): void {
    this.delegate = delegate;
    this.dbus = loadDbus();
    this.bus = this.dbus.systemBus();
    this.init().catch((err: unknown) => {
      debug('init failed: %s', err instanceof Error ? err.stack : err);
      this.delegate?.onWarning(`dbus init failed: ${errorMessage(err)}`);
      this.state = 'unsupported';
      this.delegate?.onStateChange('unsupported');
    });
  }

  stop (): void {
    if (this.objectManager) {
      this.objectManager.off('InterfacesAdded', this.onInterfacesAdded);
      this.objectManager.off('InterfacesRemoved', this.onInterfacesRemoved);
    }
    if (this.adapterProps) {
      this.adapterProps.off('PropertiesChanged', this.onAdapterProperties);
    }
    for (const device of this.devices.values()) {
      // Nothing will settle an in-flight connect once the listeners are gone.
      device.pendingConnect?.reject(new DisconnectedError('stopped'));
      device.pendingConnect = null;
      if (device.proxy && device.propsListener) {
        propsOf(device.proxy).off('PropertiesChanged', device.propsListener);
      }
    }
    for (const entry of this.charPropsListeners.values()) {
      entry.props.off('PropertiesChanged', entry.listener);
    }
    this.charPropsListeners.clear();
    const wasScanning = this.isScanning;
    this.isScanning = false;
    this.unwatchAllDeviceProps();
    // A scan paused for a connect is already stopped in BlueZ.
    if (wasScanning && this.adapterIface && !this.discoveryDeferredByConnect) {
      this.adapterIface.StopDiscovery().catch(() => {});
    }
    // Attempts still unwinding must not restart discovery behind stop().
    this.connectsInFlight = 0;
    this.discoveryDeferredByConnect = false;
    this.discoveryPause = null;
    if (this.bus && typeof this.bus.disconnect === 'function') {
      try { this.bus.disconnect(); } catch { /* ignore */ }
    }
  }

  setAddress (_address: string): void {
    this.delegate?.onWarning('setAddress is not supported on the dbus backend');
  }

  async setScanParameters (_interval?: number, _window?: number): Promise<void> {
    this.delegate?.onWarning('setScanParameters is not supported on the dbus backend (BlueZ controls scan parameters)');
  }

  async startScanning (serviceUuids: string[], allowDuplicates: boolean): Promise<void> {
    this.scanServiceUuids = (serviceUuids ?? []).map(uuid => normalizeUuid(uuid));
    if (!this.adapterIface || !this.objectManager || !this.dbus) {
      throw new NobleError('adapter not initialized');
    }
    const { Variant } = this.dbus;
    // No UUIDs filter: BlueZ matches it against advertised UUIDs only (AD
    // 0x02/0x03), hiding service-data-only devices. Filtered in software instead.
    const filter = {
      Transport: new Variant('s', 'le'),
      DuplicateData: new Variant('b', !!allowDuplicates)
    };
    try {
      await this.adapterIface.SetDiscoveryFilter(filter);
    } catch (err) {
      debug('SetDiscoveryFilter failed: %s', errorMessage(err));
    }
    if (!this.isScanning) {
      if (this.connectsInFlight === 0) {
        await this.adapterIface.StartDiscovery();
      } else {
        // A connect attempt owns the adapter: record the intent and let its
        // resume issue the real command. Without this the scan would count as
        // running while BlueZ was never told to start it.
        this.discoveryDeferredByConnect = true;
      }
      this.isScanning = true;
    }

    // Re-read BlueZ's object tree and surface cached devices.
    // BlueZ won't emit InterfacesAdded for devices already in its cache,
    // so without this refresh a new scan would miss them entirely.
    try {
      const managed = await this.objectManager.GetManagedObjects();
      for (const [path, ifaces] of Object.entries(managed)) {
        const unwrapped = unwrapInterfaces(ifaces);
        const merged = Object.assign(this.objects.get(path) ?? {}, unwrapped);
        this.objects.set(path, merged);
        if (unwrapped[DEVICE_IFACE] && this.isUnderAdapter(path)) {
          this.handleDeviceProps(path, merged[DEVICE_IFACE]);
          void this.watchDeviceProps(path);
        }
      }
    } catch (err) {
      debug('startScanning: cache refresh failed: %s', errorMessage(err));
    }

    this.delegate?.onScanStart(!allowDuplicates);
  }

  async stopScanning (): Promise<void> {
    const wasScanning = this.isScanning;
    // Clear isScanning before releasing watchers so a watchDeviceProps still
    // suspended on getProxyObject fails its post-await guard instead of
    // re-attaching a listener that would outlive the scan.
    this.isScanning = false;
    this.unwatchAllDeviceProps();
    // While a connect attempt has discovery paused there is nothing to stop in
    // BlueZ; clearing isScanning is what keeps the resume from restarting it.
    if (wasScanning && this.adapterIface && !this.discoveryDeferredByConnect) {
      try {
        await this.adapterIface.StopDiscovery();
      } catch (err) {
        // Reported as stopped regardless: nothing here listens for advertisements any more.
        debug('StopDiscovery failed: %s', errorMessage(err));
      }
    }
    this.delegate?.onScanStop();
  }

  // BlueZ resumes its own scan as soon as the controller reports the
  // connection, which is still inside the link layer establishment window. Keep
  // the radio free until the attempt settles, the way the hci backend
  // serialises scanning against connecting. This talks to BlueZ directly: the
  // application's scan stays logically running, so no onScanStop/onScanStart,
  // and the advertisement watchers stay attached.
  // discoveryDeferredByConnect means a scan is owed once the last attempt
  // finishes, whether this stopped a running one or startScanning skipped
  // starting it.
  private async pauseDiscoveryForConnect (): Promise<void> {
    this.connectsInFlight += 1;
    if (this.connectsInFlight !== 1) {
      // Another attempt already paused discovery; wait for its StopDiscovery.
      if (this.discoveryPause) await this.discoveryPause;
      return;
    }
    const adapter = this.adapterIface;
    if (!this.isScanning || !adapter) return;

    this.discoveryDeferredByConnect = true;
    const pause = adapter.StopDiscovery().catch((err: unknown) => {
      debug('StopDiscovery for connect failed: %s', errorMessage(err));
    });
    this.discoveryPause = pause;
    try {
      await pause;
    } finally {
      if (this.discoveryPause === pause) this.discoveryPause = null;
    }
  }

  private async resumeDiscoveryAfterConnect (): Promise<void> {
    this.connectsInFlight = Math.max(0, this.connectsInFlight - 1);
    if (this.connectsInFlight !== 0 || !this.discoveryDeferredByConnect) return;

    this.discoveryDeferredByConnect = false;
    // An explicit stopScanning() during the attempt cleared isScanning and must still win.
    if (!this.isScanning || !this.adapterIface) return;

    try {
      await this.adapterIface.StartDiscovery();
    } catch (err) {
      debug('StartDiscovery after connect failed: %s', errorMessage(err));
      this.delegate?.onWarning(`could not resume discovery after connect: ${errorMessage(err)}`);
    }
  }

  addressToId (address: string): string {
    return addressToId(address);
  }

  // ---- Connect / disconnect ----

  connect (peripheralId: string, options?: ConnectOptions): Promise<void> {
    const id = normalizeId(peripheralId);
    if (options?.mtu !== undefined) {
      this.delegate?.onWarning('the mtu connect option is not supported on the dbus backend (BlueZ negotiates the ATT MTU)');
    }
    const device = this.devices.get(id);
    if (!device) {
      return Promise.reject(new NobleError(`unknown peripheral ${id}`));
    }
    if (device.connecting) return device.connecting;

    device.cancelRequested = false;
    const attempt = this.connectDevice(id, device).then(
      () => {
        device.connecting = null;
      },
      (err: unknown) => {
        device.connecting = null;
        device.pendingConnect = null;
        // Release the half-open proxy/listener so a retry starts clean. No
        // onDisconnect: a failed attempt never was a link, matching the other
        // backends.
        this.teardownConnection(device);
        throw device.cancelRequested ? new ConnectionCancelledError() : toError(err);
      }
    );
    device.connecting = attempt;
    return attempt;
  }

  /** Aborts a pending `connect()`, which then rejects with `ConnectionCancelledError`. */
  cancelConnect (peripheralId: string): void {
    const id = normalizeId(peripheralId);
    const device = this.devices.get(id);
    if (device?.connecting) device.cancelRequested = true;
    // Issues Device1.Disconnect synchronously, while the proxy is still held.
    this.disconnect(id);
    if (device?.pendingConnect) {
      const pending = device.pendingConnect;
      device.pendingConnect = null;
      pending.reject(new ConnectionCancelledError());
    }
  }

  disconnect (peripheralId: string): void {
    const id = normalizeId(peripheralId);
    this.disconnectDevice(id).catch((err: unknown) => {
      this.delegate?.onWarning(`disconnect failed: ${errorMessage(err)}`);
    });
  }

  async updateRssi (peripheralId: string): Promise<number> {
    const id = normalizeId(peripheralId);
    const device = this.devices.get(id);
    if (!device || !device.path) {
      throw new NobleError('unknown peripheral');
    }
    const props = this.objects.get(device.path)?.[DEVICE_IFACE] ?? {};
    return typeof props.RSSI === 'number' ? props.RSSI : (device.rssi || 0);
  }

  // ---- Service / characteristic / descriptor discovery ----

  async discoverServices (peripheralId: string, serviceUuids: string[]): Promise<string[]> {
    const id = normalizeId(peripheralId);
    const wanted = (serviceUuids ?? []).map(uuid => normalizeUuid(uuid));
    const found = this.findServicesForDevice(id);
    const filtered = wanted.length === 0 ? found : found.filter(s => wanted.includes(s.uuid));
    return filtered.map(s => s.uuid);
  }

  async discoverIncludedServices (_peripheralId: string, _serviceUuid: string, _serviceUuids: string[]): Promise<string[]> {
    // BlueZ does not expose included services directly via D-Bus.
    return [];
  }

  async discoverCharacteristics (peripheralId: string, serviceUuid: string, characteristicUuids: string[]): Promise<CharacteristicInfo[]> {
    const id = normalizeId(peripheralId);
    const service = this.findService(id, serviceUuid);
    if (!service) {
      throw new NobleError('service not found');
    }
    const wanted = (characteristicUuids ?? []).map(uuid => normalizeUuid(uuid));
    const all = this.findCharacteristicsForService(service.path);
    const filtered = wanted.length === 0 ? all : all.filter(c => wanted.includes(c.uuid));
    return filtered.map(c => ({ uuid: c.uuid, properties: c.properties }));
  }

  async read (peripheralId: string, serviceUuid: string, characteristicUuid: string): Promise<Buffer> {
    const path = this.requireCharacteristicPath(normalizeId(peripheralId), serviceUuid, characteristicUuid);
    const proxy = await this.getProxy(path);
    const iface = proxy.getInterface<GattCharacteristicIface>(GATT_CHAR_IFACE);
    return toBuffer(await iface.ReadValue({}));
  }

  async write (peripheralId: string, serviceUuid: string, characteristicUuid: string, data: Buffer, withoutResponse: boolean): Promise<void> {
    const path = this.requireCharacteristicPath(normalizeId(peripheralId), serviceUuid, characteristicUuid);
    const proxy = await this.getProxy(path);
    const iface = proxy.getInterface<GattCharacteristicIface>(GATT_CHAR_IFACE);
    const { Variant } = this.requireDbus();
    const options = { type: new Variant('s', withoutResponse ? 'command' : 'request') };
    await iface.WriteValue(toBuffer(data), options);
  }

  async notify (peripheralId: string, serviceUuid: string, characteristicUuid: string, notify: boolean): Promise<void> {
    const id = normalizeId(peripheralId);
    const path = this.requireCharacteristicPath(id, serviceUuid, characteristicUuid);
    const proxy = await this.getProxy(path);
    const iface = proxy.getInterface<GattCharacteristicIface>(GATT_CHAR_IFACE);

    if (notify) {
      let added: PropsSubscription | null = null;
      if (!this.charPropsListeners.has(path)) {
        const listener: PropertiesChangedListener = (ifaceName, changed) => {
          if (ifaceName !== GATT_CHAR_IFACE) return;
          const c = unwrapDict(changed);
          if ('Value' in c) {
            this.delegate?.onNotification(id, serviceUuid, characteristicUuid, toBuffer(c.Value));
          }
        };
        added = { props: propsOf(proxy), listener };
        added.props.on('PropertiesChanged', listener);
        this.charPropsListeners.set(path, added);
      }
      try {
        await iface.StartNotify();
      } catch (err) {
        // Don't leave a listener behind for a subscription that never started.
        if (added && this.charPropsListeners.get(path) === added) {
          added.props.off('PropertiesChanged', added.listener);
          this.charPropsListeners.delete(path);
        }
        throw err;
      }
    } else {
      try {
        await iface.StopNotify();
      } catch (err) {
        debug('StopNotify failed: %s', errorMessage(err));
      }
      const entry = this.charPropsListeners.get(path);
      if (entry) {
        entry.props.off('PropertiesChanged', entry.listener);
        this.charPropsListeners.delete(path);
      }
    }
  }

  async discoverDescriptors (peripheralId: string, serviceUuid: string, characteristicUuid: string): Promise<string[]> {
    const charPath = this.requireCharacteristicPath(normalizeId(peripheralId), serviceUuid, characteristicUuid);
    return this.findDescriptorsForCharacteristic(charPath).map(d => d.uuid);
  }

  async readValue (peripheralId: string, serviceUuid: string, characteristicUuid: string, descriptorUuid: string): Promise<Buffer> {
    const path = this.requireDescriptorPath(normalizeId(peripheralId), serviceUuid, characteristicUuid, descriptorUuid);
    const proxy = await this.getProxy(path);
    const iface = proxy.getInterface<GattDescriptorIface>(GATT_DESC_IFACE);
    return toBuffer(await iface.ReadValue({}));
  }

  async writeValue (peripheralId: string, serviceUuid: string, characteristicUuid: string, descriptorUuid: string, data: Buffer): Promise<void> {
    const path = this.requireDescriptorPath(normalizeId(peripheralId), serviceUuid, characteristicUuid, descriptorUuid);
    const proxy = await this.getProxy(path);
    const iface = proxy.getInterface<GattDescriptorIface>(GATT_DESC_IFACE);
    await iface.WriteValue(toBuffer(data), {});
  }

  async readHandle (_peripheralId: string, _handle: number): Promise<Buffer> {
    throw new NotSupportedError('readHandle is not supported on the dbus backend (BlueZ exposes UUIDs only)');
  }

  async writeHandle (_peripheralId: string, _handle: number, _data: Buffer, _withoutResponse: boolean): Promise<void> {
    throw new NotSupportedError('writeHandle is not supported on the dbus backend (BlueZ exposes UUIDs only)');
  }

  // ---- Initialisation ----

  private async init (): Promise<void> {
    const rootProxy = await this.getProxy(ROOT_PATH);
    const objectManager = rootProxy.getInterface<ObjectManagerIface>(OBJECT_MANAGER_IFACE);
    this.objectManager = objectManager;
    objectManager.on('InterfacesAdded', this.onInterfacesAdded);
    objectManager.on('InterfacesRemoved', this.onInterfacesRemoved);

    const managed = await objectManager.GetManagedObjects();
    for (const [path, ifaces] of Object.entries(managed)) {
      this.objects.set(path, unwrapInterfaces(ifaces));
    }

    const adapterPath = this.pickAdapterPath();
    if (!adapterPath) {
      throw new NobleError('No BlueZ adapter found (is bluetoothd running?)');
    }
    this.adapterPath = adapterPath;

    const adapterProxy = await this.getProxy(adapterPath);
    this.adapterIface = adapterProxy.getInterface<AdapterIface>(ADAPTER_IFACE);
    this.adapterProps = propsOf(adapterProxy);
    this.adapterProps.on('PropertiesChanged', this.onAdapterProperties);

    const adapterProps = this.objects.get(adapterPath)?.[ADAPTER_IFACE] ?? {};
    if (typeof adapterProps.Address === 'string') {
      this.delegate?.onAddressChange(adapterProps.Address);
    }

    this.setState(adapterProps.Powered ? 'poweredOn' : 'poweredOff');

    // Surface devices that already exist in BlueZ's cache as discovery events.
    for (const [path, ifaces] of this.objects) {
      if (ifaces[DEVICE_IFACE] && this.isUnderAdapter(path)) {
        this.handleDeviceProps(path, ifaces[DEVICE_IFACE]);
      }
    }
  }

  private requireDbus (): DbusModule {
    if (!this.dbus) throw new NobleError('dbus backend not started');
    return this.dbus;
  }

  private getProxy (path: string): Promise<ProxyObject> {
    if (!this.bus) return Promise.reject(new NobleError('dbus backend not started'));
    return this.bus.getProxyObject(BLUEZ_SERVICE, path);
  }

  private pickAdapterPath (): string | null {
    // Same source and parsing as the hci backend: the option wins, an unset or
    // empty NOBLE_HCI_DEVICE_ID means "no preference".
    const hciDeviceId = this.options.hciDeviceId != null
      ? parseInt(String(this.options.hciDeviceId), 10)
      : process.env.NOBLE_HCI_DEVICE_ID
        ? parseInt(process.env.NOBLE_HCI_DEVICE_ID, 10)
        : undefined;
    const requested = this.options.adapterId ||
      (hciDeviceId !== undefined ? `hci${hciDeviceId}` : null);
    let firstMatch: string | null = null;
    for (const [path, ifaces] of this.objects) {
      if (!ifaces[ADAPTER_IFACE]) continue;
      if (!firstMatch) firstMatch = path;
      if (requested && path.endsWith(`/${requested}`)) return path;
    }
    if (requested && firstMatch) {
      this.delegate?.onWarning(`BlueZ adapter ${requested} not found, using ${firstMatch}`);
    }
    return firstMatch;
  }

  private isUnderAdapter (path: string): boolean {
    return this.adapterPath !== null && path.startsWith(`${this.adapterPath}/`);
  }

  private setState (state: AdapterState): void {
    if (this.state === state) return;
    this.state = state;
    this.delegate?.onStateChange(state);
  }

  // ---- ObjectManager + property change handlers ----

  private readonly onInterfacesAdded = (path: string, ifaces: Record<string, Record<string, unknown>>): void => {
    const unwrapped = unwrapInterfaces(ifaces);
    const existing = this.objects.get(path) ?? {};
    this.objects.set(path, Object.assign(existing, unwrapped));

    if (unwrapped[DEVICE_IFACE] && this.isUnderAdapter(path)) {
      this.handleDeviceProps(path, existing[DEVICE_IFACE]);
      if (this.isScanning) void this.watchDeviceProps(path);
    }
    // GATT objects need no report of their own: clients ask through
    // discoverServices/Characteristics/Descriptors, which read the mirror.
  };

  private readonly onInterfacesRemoved = (path: string, ifaces: string[]): void => {
    const stored = this.objects.get(path);
    if (stored) {
      for (const iface of ifaces) delete stored[iface];
      if (Object.keys(stored).length === 0) {
        this.objects.delete(path);
      }
    }
    if (ifaces.includes(DEVICE_IFACE)) {
      this.unwatchDeviceProps(path);
      const id = deviceIdFromPath(path);
      if (id && this.devices.has(id)) {
        this.onDeviceDisconnected(id, 'removed');
      }
    }
  };

  private readonly onAdapterProperties: PropertiesChangedListener = (iface, changed) => {
    if (iface !== ADAPTER_IFACE || !this.adapterPath) return;
    const props = unwrapDict(changed);
    if ('Powered' in props) {
      this.setState(props.Powered ? 'poweredOn' : 'poweredOff');
    }
    if (typeof props.Address === 'string') {
      this.delegate?.onAddressChange(props.Address);
    }
    this.mergeProps(this.adapterPath, ADAPTER_IFACE, props);
  };

  /** Folds changed properties into the mirror and returns the merged dictionary. */
  private mergeProps (path: string, iface: string, changed: Props): Props {
    const stored = this.objects.get(path) ?? {};
    const merged = Object.assign(stored[iface] ?? {}, changed);
    stored[iface] = merged;
    this.objects.set(path, stored);
    return merged;
  }

  private handleDeviceProps (path: string, props: Props): void {
    const address = (typeof props.Address === 'string' && props.Address) || devicePathToAddress(path);
    if (!address) return;
    const id = addressToId(address);
    const addressType = toAddressType(props.AddressType);
    let device = this.devices.get(id);
    if (!device) {
      device = {
        path,
        address,
        addressType: addressType ?? 'unknown',
        connectable: true,
        scannable: false,
        rssi: typeof props.RSSI === 'number' ? props.RSSI : 0,
        advertisement: buildAdvertisement(props),
        proxy: null,
        propsListener: null,
        servicesResolved: !!props.ServicesResolved,
        connecting: null,
        pendingConnect: null,
        cancelRequested: false
      };
      this.devices.set(id, device);
    } else {
      device.path = path;
      device.address = address;
      if (addressType) device.addressType = addressType;
      if (typeof props.RSSI === 'number') device.rssi = props.RSSI;
      device.advertisement = buildAdvertisement(props);
    }

    if (!this.matchesScanFilter(device.advertisement)) return;

    this.delegate?.onDiscover({
      id,
      address: device.address,
      addressType: device.addressType,
      connectable: device.connectable,
      scannable: device.scannable,
      advertisement: device.advertisement,
      rssi: device.rssi
    });
  }

  private matchesScanFilter (advertisement: Advertisement): boolean {
    if (this.scanServiceUuids.length === 0) return true;
    const fromData = advertisement.serviceData.map(sd => sd.uuid);
    return advertisement.serviceUuids.concat(fromData).some(uuid => this.scanServiceUuids.includes(uuid));
  }

  // BlueZ often delivers ServiceData/UUIDs in a PropertiesChanged after the
  // initial InterfacesAdded, so re-run discovery on every advertisement update
  // — otherwise a device that only reveals a matching UUID later is missed.
  private async watchDeviceProps (path: string): Promise<void> {
    if (this.scanPropsListeners.has(path)) return;
    let proxy: ProxyObject;
    try {
      proxy = await this.getProxy(path);
    } catch (err) {
      debug('watchDeviceProps failed: %s', errorMessage(err));
      return;
    }
    if (!this.isScanning || this.scanPropsListeners.has(path)) return;
    const props = propsOf(proxy);
    const listener: PropertiesChangedListener = (iface, changed) => {
      if (iface !== DEVICE_IFACE) return;
      this.handleDeviceProps(path, this.mergeProps(path, DEVICE_IFACE, unwrapDict(changed)));
    };
    props.on('PropertiesChanged', listener);
    this.scanPropsListeners.set(path, { props, listener });
  }

  private unwatchDeviceProps (path: string): void {
    const entry = this.scanPropsListeners.get(path);
    if (!entry) return;
    entry.props.off('PropertiesChanged', entry.listener);
    this.scanPropsListeners.delete(path);
  }

  private unwatchAllDeviceProps (): void {
    for (const entry of this.scanPropsListeners.values()) {
      entry.props.off('PropertiesChanged', entry.listener);
    }
    this.scanPropsListeners.clear();
  }

  // ---- Per-device proxy + property listening ----

  private async ensureDeviceProxy (id: string, device: DeviceState): Promise<ProxyObject> {
    if (device.proxy) return device.proxy;
    if (!device.path && this.adapterPath) {
      device.path = devicePathFromAddress(this.adapterPath, device.address);
    }
    const proxy = await this.getProxy(device.path);
    const listener: PropertiesChangedListener = (iface, changed) => {
      if (iface !== DEVICE_IFACE) return;
      const c = unwrapDict(changed);
      // Keep the mirror current: connect() and updateRssi() read it.
      this.mergeProps(device.path, DEVICE_IFACE, c);
      if (typeof c.RSSI === 'number') {
        device.rssi = c.RSSI;
        this.delegate?.onRssi(id, c.RSSI);
      }
      if ('Connected' in c) {
        if (c.Connected) {
          // connect() resolves once services are resolved. For a cached
          // device they may already be, in which case this is the moment.
          if (device.servicesResolved) this.resolvePendingConnect(device);
        } else {
          this.onDeviceDisconnected(id, 'remote');
        }
      }
      if ('ServicesResolved' in c) {
        device.servicesResolved = !!c.ServicesResolved;
        if (c.ServicesResolved) this.resolvePendingConnect(device);
      }
    };
    propsOf(proxy).on('PropertiesChanged', listener);
    device.proxy = proxy;
    device.propsListener = listener;
    return proxy;
  }

  private resolvePendingConnect (device: DeviceState): void {
    const pending = device.pendingConnect;
    if (!pending) return;
    device.pendingConnect = null;
    pending.resolve();
  }

  private teardownConnection (device: DeviceState): void {
    if (device.proxy && device.propsListener) {
      propsOf(device.proxy).off('PropertiesChanged', device.propsListener);
    }
    device.proxy = null;
    device.propsListener = null;
    device.servicesResolved = false;
    this.removeDeviceCharListeners(device);
  }

  private onDeviceDisconnected (id: string, reason: DisconnectReason): void {
    const device = this.devices.get(id);
    if (!device) return;
    // A drop while connecting is a connect failure, not a disconnect: reject
    // so connect() tears down and rejects. Like hci-socket, a failed attempt
    // reports no onDisconnect (the peripheral stays retryable).
    if (device.pendingConnect) {
      const pending = device.pendingConnect;
      device.pendingConnect = null;
      pending.reject(new DisconnectedError(reason));
      return;
    }
    const wasConnected = !!device.proxy;
    this.teardownConnection(device);
    if (!wasConnected) return;
    this.delegate?.onDisconnect(id, reason);
  }

  private removeDeviceCharListeners (device: DeviceState): void {
    if (!device.path) return;
    const prefix = `${device.path}/`;
    for (const [path, entry] of this.charPropsListeners) {
      if (path.startsWith(prefix)) {
        entry.props.off('PropertiesChanged', entry.listener);
        this.charPropsListeners.delete(path);
      }
    }
  }

  private async connectDevice (id: string, device: DeviceState): Promise<void> {
    const proxy = await this.ensureDeviceProxy(id, device);
    if (device.cancelRequested) throw new ConnectionCancelledError();
    const iface = proxy.getInterface<DeviceIface>(DEVICE_IFACE);

    const deviceProps = this.objects.get(device.path)?.[DEVICE_IFACE] ?? {};
    if (deviceProps.Connected && deviceProps.ServicesResolved) {
      device.servicesResolved = true;
      return;
    }

    const pending = new Deferred<void>();
    // The pause below is awaited before anything awaits `pending`, and a drop,
    // cancelConnect() or stop() may reject it in that window. Mark it handled
    // so that can never surface as an unhandled rejection; the awaits below
    // still observe the outcome.
    pending.promise.catch(() => {});
    device.pendingConnect = pending;

    await this.pauseDiscoveryForConnect();
    try {
      if (device.pendingConnect !== pending) {
        // Settled while discovery was being paused: don't issue Connect().
        await pending.promise;
        return;
      }
      // Keep both in one await: awaited one after the other, a remote drop that
      // lands while Connect() is in flight would go unnoticed until it returns.
      await Promise.all([iface.Connect(), pending.promise]);
    } finally {
      await this.resumeDiscoveryAfterConnect();
    }
  }

  private async disconnectDevice (id: string): Promise<void> {
    const device = this.devices.get(id);
    if (!device || !device.proxy) return;
    const iface = device.proxy.getInterface<DeviceIface>(DEVICE_IFACE);
    try {
      await iface.Disconnect();
    } catch (err) {
      debug('Disconnect call failed: %s', errorMessage(err));
    }
  }

  // ---- Object tree lookups ----

  private findServicesForDevice (id: string): LocatedService[] {
    const device = this.devices.get(id);
    if (!device || !device.path) return [];
    const prefix = `${device.path}/`;
    const services: LocatedService[] = [];
    for (const [path, ifaces] of this.objects) {
      if (!path.startsWith(prefix)) continue;
      const svc = ifaces[GATT_SERVICE_IFACE];
      if (!svc) continue;
      services.push({ path, uuid: uuidOf(svc.UUID), primary: !!svc.Primary });
    }
    return services;
  }

  private findService (id: string, serviceUuid: string): LocatedService | undefined {
    const wanted = normalizeUuid(serviceUuid);
    return this.findServicesForDevice(id).find(s => s.uuid === wanted);
  }

  private findCharacteristicsForService (servicePath: string): LocatedCharacteristic[] {
    const prefix = `${servicePath}/`;
    const result: LocatedCharacteristic[] = [];
    for (const [path, ifaces] of this.objects) {
      if (!path.startsWith(prefix)) continue;
      const ch = ifaces[GATT_CHAR_IFACE];
      if (!ch) continue;
      result.push({ path, uuid: uuidOf(ch.UUID), properties: flagsToProperties(ch.Flags) });
    }
    return result;
  }

  private findDescriptorsForCharacteristic (charPath: string): LocatedDescriptor[] {
    const prefix = `${charPath}/`;
    const result: LocatedDescriptor[] = [];
    for (const [path, ifaces] of this.objects) {
      if (!path.startsWith(prefix)) continue;
      const d = ifaces[GATT_DESC_IFACE];
      if (!d) continue;
      result.push({ path, uuid: uuidOf(d.UUID) });
    }
    return result;
  }

  private requireCharacteristicPath (id: string, serviceUuid: string, characteristicUuid: string): string {
    const service = this.findService(id, serviceUuid);
    const wanted = normalizeUuid(characteristicUuid);
    const ch = service && this.findCharacteristicsForService(service.path).find(c => c.uuid === wanted);
    if (!ch) throw new NobleError('characteristic not found');
    return ch.path;
  }

  private requireDescriptorPath (id: string, serviceUuid: string, characteristicUuid: string, descriptorUuid: string): string {
    const service = this.findService(id, serviceUuid);
    const wantedChar = normalizeUuid(characteristicUuid);
    const ch = service && this.findCharacteristicsForService(service.path).find(c => c.uuid === wantedChar);
    const wanted = normalizeUuid(descriptorUuid);
    const desc = ch && this.findDescriptorsForCharacteristic(ch.path).find(d => d.uuid === wanted);
    if (!desc) throw new NobleError('descriptor not found');
    return desc.path;
  }
}

function propsOf (proxy: ProxyObject): PropertiesIface {
  return proxy.getInterface<PropertiesIface>(PROPS_IFACE);
}
