const { EventEmitter } = require('events');
const debug = require('debug')('noble-dbus');

const {
  normalizeUuid,
  expandUuid,
  addressToId,
  devicePathToAddress,
  deviceIdFromPath,
  devicePathFromAddress
} = require('./uuid');

const BLUEZ_SERVICE = 'org.bluez';
const ROOT_PATH = '/';
const ADAPTER_IFACE = 'org.bluez.Adapter1';
const DEVICE_IFACE = 'org.bluez.Device1';
const GATT_SERVICE_IFACE = 'org.bluez.GattService1';
const GATT_CHAR_IFACE = 'org.bluez.GattCharacteristic1';
const GATT_DESC_IFACE = 'org.bluez.GattDescriptor1';
const PROPS_IFACE = 'org.freedesktop.DBus.Properties';
const OBJECT_MANAGER_IFACE = 'org.freedesktop.DBus.ObjectManager';

const FLAG_TO_PROPERTY = {
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

function loadDbus () {
  try {
    // dbus-next is an optional peer of this Linux-only backend; the host
    // project installs it explicitly. eslint-plugin-node would otherwise
    // flag the missing module on platforms where it is not present.
    // eslint-disable-next-line node/no-missing-require
    return require('dbus-next');
  } catch (err) {
    const wrapped = new Error(
      'noble dbus backend requires the "dbus-next" package. ' +
      'Install it with: npm install dbus-next'
    );
    wrapped.cause = err;
    throw wrapped;
  }
}

function normalizeId (id) {
  // BlueZ emits MACs uppercase; noble's id form is colon-stripped lowercase.
  // Accept either, plus mixed case, so external callers don't have to care.
  if (id == null) return id;
  return String(id).replace(/:/g, '').toLowerCase();
}

function unwrapVariant (variant) {
  if (variant && typeof variant === 'object' && 'value' in variant && 'signature' in variant) {
    return variant.value;
  }
  return variant;
}

function unwrapDict (dict) {
  const out = {};
  if (!dict) return out;
  for (const key of Object.keys(dict)) {
    out[key] = unwrapVariant(dict[key]);
  }
  return out;
}

function flagsToProperties (flags) {
  const set = new Set();
  for (const flag of flags || []) {
    const mapped = FLAG_TO_PROPERTY[flag];
    if (mapped) set.add(mapped);
  }
  return Array.from(set);
}

function buildAdvertisement (deviceProps) {
  const advertisement = {
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
    advertisement.serviceUuids = deviceProps.UUIDs.map(normalizeUuid);
  }

  if (deviceProps.ManufacturerData && typeof deviceProps.ManufacturerData === 'object') {
    const entries = Object.entries(deviceProps.ManufacturerData);
    if (entries.length > 0) {
      const buffers = [];
      for (const [companyId, rawPayload] of entries) {
        const payload = unwrapVariant(rawPayload);
        const id = Number(companyId) & 0xffff;
        const header = Buffer.from([id & 0xff, (id >> 8) & 0xff]);
        const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
        buffers.push(Buffer.concat([header, data]));
      }
      advertisement.manufacturerData = buffers.length === 1 ? buffers[0] : Buffer.concat(buffers);
    }
  }

  if (deviceProps.ServiceData && typeof deviceProps.ServiceData === 'object') {
    for (const [uuid, rawPayload] of Object.entries(deviceProps.ServiceData)) {
      const payload = unwrapVariant(rawPayload);
      advertisement.serviceData.push({
        uuid: normalizeUuid(uuid),
        data: Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
      });
    }
  }

  return advertisement;
}

class DbusBindings extends EventEmitter {
  constructor (options = {}) {
    super();
    this._options = options || {};
    this._dbus = null;
    this._bus = null;
    this._rootProxy = null;
    this._objectManager = null;

    this._adapterPath = null;
    this._adapterProxy = null;
    this._adapterIface = null;
    this._adapterProps = null;
    this._adapterAddress = 'unknown';
    this._state = 'unknown';
    this._isScanning = false;

    // Object tree mirror: path -> { iface: props }
    this._objects = new Map();

    // Discovery filter for service uuid filtering
    this._scanServiceUuids = [];

    // Per-device live state
    // id -> { path, address, addressType, connectable, scannable, rssi, advertisement, proxy, propsListener, connectPromise, servicesResolved }
    this._devices = new Map();

    // Per-characteristic notify listener: path -> { iface, listener }
    this._charPropsListeners = new Map();

    this._onInterfacesAddedBound = this._onInterfacesAdded.bind(this);
    this._onInterfacesRemovedBound = this._onInterfacesRemoved.bind(this);
    this._onAdapterPropsBound = this._onAdapterProperties.bind(this);
  }

  start () {
    this._dbus = loadDbus();
    this._bus = this._dbus.systemBus();
    this._init().catch(err => {
      debug('init failed: %s', err && err.stack);
      this.emit('warning', `dbus init failed: ${err.message}`);
      this._state = 'unsupported';
      this.emit('stateChange', 'unsupported');
    });
  }

  async _init () {
    this._rootProxy = await this._bus.getProxyObject(BLUEZ_SERVICE, ROOT_PATH);
    this._objectManager = this._rootProxy.getInterface(OBJECT_MANAGER_IFACE);
    this._objectManager.on('InterfacesAdded', this._onInterfacesAddedBound);
    this._objectManager.on('InterfacesRemoved', this._onInterfacesRemovedBound);

    const managed = await this._objectManager.GetManagedObjects();
    for (const [path, ifaces] of Object.entries(managed)) {
      const unwrapped = {};
      for (const [iface, props] of Object.entries(ifaces)) {
        unwrapped[iface] = unwrapDict(props);
      }
      this._objects.set(path, unwrapped);
    }

    const adapterPath = this._pickAdapterPath();
    if (!adapterPath) {
      throw new Error('No BlueZ adapter found (is bluetoothd running?)');
    }
    this._adapterPath = adapterPath;

    const adapterProxy = await this._bus.getProxyObject(BLUEZ_SERVICE, adapterPath);
    this._adapterProxy = adapterProxy;
    this._adapterIface = adapterProxy.getInterface(ADAPTER_IFACE);
    this._adapterProps = adapterProxy.getInterface(PROPS_IFACE);
    this._adapterProps.on('PropertiesChanged', this._onAdapterPropsBound);

    const adapterProps = this._objects.get(adapterPath)[ADAPTER_IFACE] || {};
    if (typeof adapterProps.Address === 'string') {
      this._adapterAddress = adapterProps.Address;
      this.emit('addressChange', adapterProps.Address);
    }

    const powered = !!adapterProps.Powered;
    this._setState(powered ? 'poweredOn' : 'poweredOff');

    // Surface devices that already exist in BlueZ's cache as discovery events.
    for (const [path, ifaces] of this._objects) {
      if (ifaces[DEVICE_IFACE] && this._isUnderAdapter(path)) {
        this._handleDeviceProps(path, ifaces[DEVICE_IFACE]);
      }
    }
  }

  _pickAdapterPath () {
    const requested = this._options.adapterId
      || (this._options.hciDeviceId != null ? `hci${this._options.hciDeviceId}` : null);
    let firstMatch = null;
    for (const [path, ifaces] of this._objects) {
      if (!ifaces[ADAPTER_IFACE]) continue;
      if (!firstMatch) firstMatch = path;
      if (requested && path.endsWith(`/${requested}`)) return path;
    }
    return firstMatch;
  }

  _isUnderAdapter (path) {
    return this._adapterPath && path.startsWith(`${this._adapterPath}/`);
  }

  _setState (state) {
    if (this._state === state) return;
    this._state = state;
    this.emit('stateChange', state);
  }

  stop () {
    if (this._objectManager) {
      this._objectManager.off('InterfacesAdded', this._onInterfacesAddedBound);
      this._objectManager.off('InterfacesRemoved', this._onInterfacesRemovedBound);
    }
    if (this._adapterProps) {
      this._adapterProps.off('PropertiesChanged', this._onAdapterPropsBound);
    }
    for (const device of this._devices.values()) {
      if (device.proxy && device.propsListener) {
        const props = device.proxy.getInterface(PROPS_IFACE);
        props.off('PropertiesChanged', device.propsListener);
      }
    }
    for (const entry of this._charPropsListeners.values()) {
      entry.props.off('PropertiesChanged', entry.listener);
    }
    this._charPropsListeners.clear();
    if (this._isScanning && this._adapterIface) {
      this._adapterIface.StopDiscovery().catch(() => {});
    }
    if (this._bus && typeof this._bus.disconnect === 'function') {
      try { this._bus.disconnect(); } catch (_) { /* ignore */ }
    }
  }

  setScanParameters (_interval, _window) {
    this.emit('warning', 'setScanParameters is not supported on the dbus backend (BlueZ controls scan parameters)');
    this.emit('scanParametersSet');
  }

  setAddress (_address) {
    this.emit('warning', 'setAddress is not supported on the dbus backend');
  }

  startScanning (serviceUuids, allowDuplicates) {
    this._scanServiceUuids = (serviceUuids || []).map(normalizeUuid);
    this._startScanning(allowDuplicates).catch(err => {
      this.emit('warning', `startScanning failed: ${err.message}`);
    });
  }

  async _startScanning (allowDuplicates) {
    if (!this._adapterIface) {
      throw new Error('adapter not initialized');
    }
    const { Variant } = this._dbus;
    const filter = {
      Transport: new Variant('s', 'le'),
      DuplicateData: new Variant('b', !!allowDuplicates)
    };
    if (this._scanServiceUuids.length > 0) {
      filter.UUIDs = new Variant('as', this._scanServiceUuids.map(expandUuid));
    }
    try {
      await this._adapterIface.SetDiscoveryFilter(filter);
    } catch (err) {
      debug('SetDiscoveryFilter failed: %s', err.message);
    }
    if (!this._isScanning) {
      await this._adapterIface.StartDiscovery();
      this._isScanning = true;
    }

    // Re-read BlueZ's object tree and surface cached devices.
    // BlueZ won't emit InterfacesAdded for devices already in its cache,
    // so without this refresh a new scan would miss them entirely.
    try {
      const managed = await this._objectManager.GetManagedObjects();
      for (const [path, ifaces] of Object.entries(managed)) {
        const unwrapped = {};
        for (const [iface, props] of Object.entries(ifaces)) {
          unwrapped[iface] = unwrapDict(props);
        }
        this._objects.set(path, Object.assign(this._objects.get(path) || {}, unwrapped));
        if (unwrapped[DEVICE_IFACE] && this._isUnderAdapter(path)) {
          const address = unwrapped[DEVICE_IFACE].Address || devicePathToAddress(path);
          if (address && this._devices.has(addressToId(address))) continue;
          this._handleDeviceProps(path, unwrapped[DEVICE_IFACE]);
        }
      }
    } catch (err) {
      debug('startScanning: cache refresh failed: %s', err.message);
    }

    this.emit('scanStart', !!allowDuplicates);
  }

  stopScanning () {
    this._stopScanning().catch(err => {
      this.emit('warning', `stopScanning failed: ${err.message}`);
      this.emit('scanStop');
    });
  }

  async _stopScanning () {
    if (this._isScanning && this._adapterIface) {
      try {
        await this._adapterIface.StopDiscovery();
      } catch (err) {
        debug('StopDiscovery failed: %s', err.message);
      }
      this._isScanning = false;
    }
    this.emit('scanStop');
  }

  // ---- ObjectManager + property change handlers ----

  _onInterfacesAdded (path, ifaces) {
    const unwrapped = {};
    for (const [iface, props] of Object.entries(ifaces)) {
      unwrapped[iface] = unwrapDict(props);
    }
    const existing = this._objects.get(path) || {};
    this._objects.set(path, Object.assign(existing, unwrapped));

    if (unwrapped[DEVICE_IFACE] && this._isUnderAdapter(path)) {
      this._handleDeviceProps(path, unwrapped[DEVICE_IFACE]);
    }
    // Trigger services-resolved processing if a device just gained ServicesResolved
    if (unwrapped[GATT_SERVICE_IFACE] || unwrapped[GATT_CHAR_IFACE] || unwrapped[GATT_DESC_IFACE]) {
      // No direct emit; clients call discoverServices/Characteristics/Descriptors.
    }
  }

  _onInterfacesRemoved (path, ifaces) {
    const stored = this._objects.get(path);
    if (stored) {
      for (const iface of ifaces) delete stored[iface];
      if (Object.keys(stored).length === 0) {
        this._objects.delete(path);
      }
    }
    if (ifaces.includes(DEVICE_IFACE)) {
      const id = deviceIdFromPath(path);
      if (id && this._devices.has(id)) {
        this._onDeviceDisconnected(id, 'removed');
      }
    }
  }

  _onAdapterProperties (iface, changed) {
    if (iface !== ADAPTER_IFACE) return;
    const props = unwrapDict(changed);
    if ('Powered' in props) {
      this._setState(props.Powered ? 'poweredOn' : 'poweredOff');
    }
    if (typeof props.Address === 'string') {
      this._adapterAddress = props.Address;
      this.emit('addressChange', props.Address);
    }
    const stored = this._objects.get(this._adapterPath) || {};
    stored[ADAPTER_IFACE] = Object.assign(stored[ADAPTER_IFACE] || {}, props);
    this._objects.set(this._adapterPath, stored);
  }

  _handleDeviceProps (path, props) {
    const address = props.Address || devicePathToAddress(path);
    if (!address) return;
    const id = addressToId(address);
    let device = this._devices.get(id);
    if (!device) {
      device = {
        path,
        address,
        addressType: props.AddressType || 'unknown',
        connectable: true,
        scannable: false,
        rssi: typeof props.RSSI === 'number' ? props.RSSI : 0,
        advertisement: buildAdvertisement(props),
        proxy: null,
        propsListener: null,
        servicesResolved: !!props.ServicesResolved,
        connectPromise: null
      };
      this._devices.set(id, device);
    } else {
      device.path = path;
      device.address = address;
      if (props.AddressType) device.addressType = props.AddressType;
      if (typeof props.RSSI === 'number') device.rssi = props.RSSI;
      Object.assign(device.advertisement, buildAdvertisement(props));
    }

    this.emit(
      'discover',
      id,
      device.address,
      device.addressType,
      device.connectable,
      device.advertisement,
      device.rssi,
      device.scannable
    );
  }

  // ---- Per-device proxy + property listening ----

  async _ensureDeviceProxy (id) {
    const device = this._devices.get(id);
    if (!device) throw new Error(`unknown peripheral ${id}`);
    if (device.proxy) return device;
    const path = device.path || devicePathFromAddress(this._adapterPath, device.address);
    device.path = path;
    device.proxy = await this._bus.getProxyObject(BLUEZ_SERVICE, path);
    const props = device.proxy.getInterface(PROPS_IFACE);
    device.propsListener = (iface, changed) => {
      if (iface !== DEVICE_IFACE) return;
      const c = unwrapDict(changed);
      if ('RSSI' in c) {
        device.rssi = c.RSSI;
        this.emit('rssiUpdate', id, c.RSSI);
      }
      if ('Connected' in c) {
        if (c.Connected) {
          // Wait for ServicesResolved to fire 'connect' with services available.
          // If ServicesResolved already true (cached device), fire now.
          if (device.servicesResolved && device.connectPromise) {
            device.connectPromise.resolve();
            device.connectPromise = null;
          }
        } else {
          this._onDeviceDisconnected(id, 'remote');
        }
      }
      if ('ServicesResolved' in c) {
        device.servicesResolved = !!c.ServicesResolved;
        if (c.ServicesResolved && device.connectPromise) {
          device.connectPromise.resolve();
          device.connectPromise = null;
        }
      }
    };
    props.on('PropertiesChanged', device.propsListener);
    return device;
  }

  _onDeviceDisconnected (id, reason) {
    const device = this._devices.get(id);
    if (!device) return;
    if (device.proxy && device.propsListener) {
      const props = device.proxy.getInterface(PROPS_IFACE);
      props.off('PropertiesChanged', device.propsListener);
    }
    device.proxy = null;
    device.propsListener = null;
    device.servicesResolved = false;
    if (device.connectPromise) {
      device.connectPromise.reject(new Error(`disconnected: ${reason}`));
      device.connectPromise = null;
    }
    this._removeDeviceCharListeners(id);
    this.emit('disconnect', id, reason);
  }

  _removeDeviceCharListeners (id) {
    const device = this._devices.get(id);
    if (!device || !device.path) return;
    const prefix = `${device.path}/`;
    for (const [path, entry] of this._charPropsListeners) {
      if (path.startsWith(prefix)) {
        entry.props.off('PropertiesChanged', entry.listener);
        this._charPropsListeners.delete(path);
      }
    }
  }

  // ---- Connect / disconnect ----

  connect (peripheralUuid, _parameters) {
    peripheralUuid = normalizeId(peripheralUuid);
    this._connect(peripheralUuid).catch(err => {
      this.emit('connect', peripheralUuid, err);
    });
  }

  async _connect (id) {
    const device = await this._ensureDeviceProxy(id);
    const iface = device.proxy.getInterface(DEVICE_IFACE);

    const cached = this._objects.get(device.path) || {};
    const deviceProps = cached[DEVICE_IFACE] || {};
    if (deviceProps.Connected && deviceProps.ServicesResolved) {
      device.servicesResolved = true;
      this.emit('connect', id, null);
      return;
    }

    const waitConnected = new Promise((resolve, reject) => {
      device.connectPromise = { resolve, reject };
    });

    try {
      await iface.Connect();
    } catch (err) {
      device.connectPromise = null;
      throw err;
    }

    await waitConnected;
    this.emit('connect', id, null);
  }

  cancelConnect (peripheralUuid, _parameters) {
    this.disconnect(normalizeId(peripheralUuid));
  }

  disconnect (peripheralUuid) {
    peripheralUuid = normalizeId(peripheralUuid);
    this._disconnect(peripheralUuid).catch(err => {
      this.emit('warning', `disconnect failed: ${err.message}`);
    });
  }

  async _disconnect (id) {
    const device = this._devices.get(id);
    if (!device) return;
    if (!device.proxy) return;
    const iface = device.proxy.getInterface(DEVICE_IFACE);
    try {
      await iface.Disconnect();
    } catch (err) {
      debug('Disconnect call failed: %s', err.message);
    }
  }

  updateRssi (peripheralUuid) {
    peripheralUuid = normalizeId(peripheralUuid);
    const device = this._devices.get(peripheralUuid);
    if (!device || !device.path) {
      this.emit('rssiUpdate', peripheralUuid, 0, new Error('unknown peripheral'));
      return;
    }
    const cached = this._objects.get(device.path) || {};
    const props = cached[DEVICE_IFACE] || {};
    const rssi = typeof props.RSSI === 'number' ? props.RSSI : (device.rssi || 0);
    this.emit('rssiUpdate', peripheralUuid, rssi);
  }

  // ---- Service / characteristic / descriptor discovery ----

  _findServicesForDevice (id) {
    const device = this._devices.get(id);
    if (!device || !device.path) return [];
    const prefix = `${device.path}/`;
    const services = [];
    for (const [path, ifaces] of this._objects) {
      if (!path.startsWith(prefix)) continue;
      const svc = ifaces[GATT_SERVICE_IFACE];
      if (!svc) continue;
      services.push({ path, uuid: normalizeUuid(svc.UUID), primary: !!svc.Primary });
    }
    return services;
  }

  _findCharacteristicsForService (servicePath) {
    const prefix = `${servicePath}/`;
    const result = [];
    for (const [path, ifaces] of this._objects) {
      if (!path.startsWith(prefix)) continue;
      const ch = ifaces[GATT_CHAR_IFACE];
      if (!ch) continue;
      result.push({
        path,
        uuid: normalizeUuid(ch.UUID),
        properties: flagsToProperties(ch.Flags)
      });
    }
    return result;
  }

  _findDescriptorsForCharacteristic (charPath) {
    const prefix = `${charPath}/`;
    const result = [];
    for (const [path, ifaces] of this._objects) {
      if (!path.startsWith(prefix)) continue;
      const d = ifaces[GATT_DESC_IFACE];
      if (!d) continue;
      result.push({ path, uuid: normalizeUuid(d.UUID) });
    }
    return result;
  }

  discoverServices (peripheralUuid, uuids) {
    peripheralUuid = normalizeId(peripheralUuid);
    const wanted = (uuids || []).map(normalizeUuid);
    const found = this._findServicesForDevice(peripheralUuid);
    const filtered = wanted.length === 0 ? found : found.filter(s => wanted.includes(s.uuid));
    const serviceUuids = filtered.map(s => s.uuid);
    this.emit('servicesDiscover', peripheralUuid, serviceUuids);
    this.emit('servicesDiscovered', peripheralUuid, serviceUuids);
  }

  discoverIncludedServices (peripheralUuid, serviceUuid, _serviceUuids) {
    peripheralUuid = normalizeId(peripheralUuid);
    // BlueZ does not expose included services directly via D-Bus.
    this.emit('includedServicesDiscover', peripheralUuid, serviceUuid, []);
  }

  discoverCharacteristics (peripheralUuid, serviceUuid, characteristicUuids) {
    peripheralUuid = normalizeId(peripheralUuid);
    const services = this._findServicesForDevice(peripheralUuid);
    const service = services.find(s => s.uuid === normalizeUuid(serviceUuid));
    if (!service) {
      this.emit('characteristicsDiscover', peripheralUuid, serviceUuid, [], new Error('service not found'));
      return;
    }
    const wanted = (characteristicUuids || []).map(normalizeUuid);
    const all = this._findCharacteristicsForService(service.path);
    const filtered = wanted.length === 0 ? all : all.filter(c => wanted.includes(c.uuid));
    const result = filtered.map(c => ({ uuid: c.uuid, properties: c.properties }));
    this.emit('characteristicsDiscover', peripheralUuid, serviceUuid, result);
    this.emit('characteristicsDiscovered', peripheralUuid, serviceUuid, result);
  }

  _findCharacteristicPath (peripheralUuid, serviceUuid, characteristicUuid) {
    const services = this._findServicesForDevice(peripheralUuid);
    const service = services.find(s => s.uuid === normalizeUuid(serviceUuid));
    if (!service) return null;
    const chars = this._findCharacteristicsForService(service.path);
    const ch = chars.find(c => c.uuid === normalizeUuid(characteristicUuid));
    return ch ? ch.path : null;
  }

  _findDescriptorPath (peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid) {
    const charPath = this._findCharacteristicPath(peripheralUuid, serviceUuid, characteristicUuid);
    if (!charPath) return null;
    const descs = this._findDescriptorsForCharacteristic(charPath);
    const d = descs.find(x => x.uuid === normalizeUuid(descriptorUuid));
    return d ? d.path : null;
  }

  read (peripheralUuid, serviceUuid, characteristicUuid) {
    peripheralUuid = normalizeId(peripheralUuid);
    this._readChar(peripheralUuid, serviceUuid, characteristicUuid).catch(err => {
      this.emit('read', peripheralUuid, serviceUuid, characteristicUuid, null, false, err);
    });
  }

  async _readChar (peripheralUuid, serviceUuid, characteristicUuid) {
    const path = this._findCharacteristicPath(peripheralUuid, serviceUuid, characteristicUuid);
    if (!path) throw new Error('characteristic not found');
    const proxy = await this._bus.getProxyObject(BLUEZ_SERVICE, path);
    const iface = proxy.getInterface(GATT_CHAR_IFACE);
    const value = await iface.ReadValue({});
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
    this.emit('read', peripheralUuid, serviceUuid, characteristicUuid, buf, false);
  }

  write (peripheralUuid, serviceUuid, characteristicUuid, data, withoutResponse) {
    peripheralUuid = normalizeId(peripheralUuid);
    this._writeChar(peripheralUuid, serviceUuid, characteristicUuid, data, withoutResponse).catch(err => {
      this.emit('write', peripheralUuid, serviceUuid, characteristicUuid, err);
    });
  }

  async _writeChar (peripheralUuid, serviceUuid, characteristicUuid, data, withoutResponse) {
    const path = this._findCharacteristicPath(peripheralUuid, serviceUuid, characteristicUuid);
    if (!path) throw new Error('characteristic not found');
    const proxy = await this._bus.getProxyObject(BLUEZ_SERVICE, path);
    const iface = proxy.getInterface(GATT_CHAR_IFACE);
    const { Variant } = this._dbus;
    const options = { type: new Variant('s', withoutResponse ? 'command' : 'request') };
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    await iface.WriteValue(buf, options);
    this.emit('write', peripheralUuid, serviceUuid, characteristicUuid);
  }

  broadcast (peripheralUuid, serviceUuid, characteristicUuid, _broadcast) {
    peripheralUuid = normalizeId(peripheralUuid);
    this.emit('warning', 'broadcast is not supported on the dbus backend');
    this.emit('broadcast', peripheralUuid, serviceUuid, characteristicUuid, false);
  }

  notify (peripheralUuid, serviceUuid, characteristicUuid, notify) {
    peripheralUuid = normalizeId(peripheralUuid);
    this._setNotify(peripheralUuid, serviceUuid, characteristicUuid, notify).catch(err => {
      this.emit('notify', peripheralUuid, serviceUuid, characteristicUuid, false, err);
    });
  }

  async _setNotify (peripheralUuid, serviceUuid, characteristicUuid, notify) {
    const path = this._findCharacteristicPath(peripheralUuid, serviceUuid, characteristicUuid);
    if (!path) throw new Error('characteristic not found');
    const proxy = await this._bus.getProxyObject(BLUEZ_SERVICE, path);
    const iface = proxy.getInterface(GATT_CHAR_IFACE);
    const props = proxy.getInterface(PROPS_IFACE);

    if (notify) {
      if (!this._charPropsListeners.has(path)) {
        const listener = (ifaceName, changed) => {
          if (ifaceName !== GATT_CHAR_IFACE) return;
          const c = unwrapDict(changed);
          if ('Value' in c) {
            const buf = Buffer.isBuffer(c.Value) ? c.Value : Buffer.from(c.Value);
            this.emit('read', peripheralUuid, serviceUuid, characteristicUuid, buf, true);
          }
        };
        props.on('PropertiesChanged', listener);
        this._charPropsListeners.set(path, { props, listener });
      }
      await iface.StartNotify();
      this.emit('notify', peripheralUuid, serviceUuid, characteristicUuid, true);
    } else {
      try {
        await iface.StopNotify();
      } catch (err) {
        debug('StopNotify failed: %s', err.message);
      }
      const entry = this._charPropsListeners.get(path);
      if (entry) {
        entry.props.off('PropertiesChanged', entry.listener);
        this._charPropsListeners.delete(path);
      }
      this.emit('notify', peripheralUuid, serviceUuid, characteristicUuid, false);
    }
  }

  discoverDescriptors (peripheralUuid, serviceUuid, characteristicUuid) {
    peripheralUuid = normalizeId(peripheralUuid);
    const charPath = this._findCharacteristicPath(peripheralUuid, serviceUuid, characteristicUuid);
    if (!charPath) {
      this.emit('descriptorsDiscover', peripheralUuid, serviceUuid, characteristicUuid, [], new Error('characteristic not found'));
      return;
    }
    const descs = this._findDescriptorsForCharacteristic(charPath).map(d => d.uuid);
    this.emit('descriptorsDiscover', peripheralUuid, serviceUuid, characteristicUuid, descs);
  }

  readValue (peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid) {
    peripheralUuid = normalizeId(peripheralUuid);
    this._readDesc(peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid).catch(err => {
      this.emit('valueRead', peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid, null, err);
    });
  }

  async _readDesc (peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid) {
    const path = this._findDescriptorPath(peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid);
    if (!path) throw new Error('descriptor not found');
    const proxy = await this._bus.getProxyObject(BLUEZ_SERVICE, path);
    const iface = proxy.getInterface(GATT_DESC_IFACE);
    const value = await iface.ReadValue({});
    const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
    this.emit('valueRead', peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid, buf);
  }

  writeValue (peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid, data) {
    peripheralUuid = normalizeId(peripheralUuid);
    this._writeDesc(peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid, data).catch(err => {
      this.emit('valueWrite', peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid, err);
    });
  }

  async _writeDesc (peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid, data) {
    const path = this._findDescriptorPath(peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid);
    if (!path) throw new Error('descriptor not found');
    const proxy = await this._bus.getProxyObject(BLUEZ_SERVICE, path);
    const iface = proxy.getInterface(GATT_DESC_IFACE);
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    await iface.WriteValue(buf, {});
    this.emit('valueWrite', peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid);
  }

  readHandle (peripheralUuid, handle) {
    peripheralUuid = normalizeId(peripheralUuid);
    const err = new Error('readHandle is not supported on the dbus backend (BlueZ exposes UUIDs only)');
    this.emit('handleRead', peripheralUuid, handle, null, err);
  }

  writeHandle (peripheralUuid, handle, _data, _withoutResponse) {
    peripheralUuid = normalizeId(peripheralUuid);
    const err = new Error('writeHandle is not supported on the dbus backend (BlueZ exposes UUIDs only)');
    this.emit('handleWrite', peripheralUuid, handle, err);
  }

  addressToId (address) {
    return addressToId(address);
  }
}

module.exports = DbusBindings;
