import { EventEmitter } from 'events';

import { DbusBindings } from '../../../src/bindings/dbus/bindings';
import {
  ConnectionCancelledError,
  DisconnectedError,
  NotSupportedError
} from '../../../src/common/errors';

// ---- dbus-next mock ----
// Provides an in-memory BlueZ object tree we can mutate per-test. The proxy
// interfaces are emitters because that is what dbus-next hands out.

class Variant {
  signature: string;
  value: any;

  constructor (signature: string, value: any) {
    this.signature = signature;
    this.value = value;
  }
}

const mockState: any = {
  managedObjects: {},
  ifaceCalls: [],
  proxies: new Map(), // path -> proxy
  rootProxy: null,
  missing: false // simulates dbus-next not being installed
};
const state = mockState;

function v (signature: string, value: any) {
  return new Variant(signature, value);
}

// Wrap a plain props dict to look like dbus-next's variant-wrapped output
function wrapDict (obj: any) {
  const out: any = {};
  for (const [k, val] of Object.entries(obj)) {
    out[k] = val instanceof Variant ? val : v('v', val);
  }
  return out;
}

function makeIfaceEmitter (extras = {}) {
  const e = new EventEmitter();
  Object.assign(e, extras);
  return e as any;
}

function makeProxy (path: string) {
  if (state.proxies.has(path)) return state.proxies.get(path);

  const propsIface = makeIfaceEmitter();
  const interfaces: any = { 'org.freedesktop.DBus.Properties': propsIface };

  const ifacesAt = state.managedObjects[path] || {};
  for (const ifaceName of Object.keys(ifacesAt)) {
    if (interfaces[ifaceName]) continue;
    interfaces[ifaceName] = makeIfaceEmitter();
  }

  const recordedCall = (ifaceName: string, method: string) => (...args: any[]) => {
    state.ifaceCalls.push({ path, iface: ifaceName, method, args });
    return Promise.resolve();
  };

  if (interfaces['org.bluez.Adapter1']) {
    Object.assign(interfaces['org.bluez.Adapter1'], {
      SetDiscoveryFilter: recordedCall('org.bluez.Adapter1', 'SetDiscoveryFilter'),
      StartDiscovery: recordedCall('org.bluez.Adapter1', 'StartDiscovery'),
      StopDiscovery: recordedCall('org.bluez.Adapter1', 'StopDiscovery')
    });
  }
  if (interfaces['org.bluez.Device1']) {
    Object.assign(interfaces['org.bluez.Device1'], {
      Connect: recordedCall('org.bluez.Device1', 'Connect'),
      Disconnect: recordedCall('org.bluez.Device1', 'Disconnect')
    });
  }
  if (interfaces['org.bluez.GattCharacteristic1']) {
    Object.assign(interfaces['org.bluez.GattCharacteristic1'], {
      ReadValue: jest.fn().mockResolvedValue(Buffer.from([0x01, 0x02])),
      WriteValue: jest.fn().mockResolvedValue(undefined),
      StartNotify: jest.fn().mockResolvedValue(undefined),
      StopNotify: jest.fn().mockResolvedValue(undefined)
    });
  }
  if (interfaces['org.bluez.GattDescriptor1']) {
    Object.assign(interfaces['org.bluez.GattDescriptor1'], {
      ReadValue: jest.fn().mockResolvedValue(Buffer.from([0x09])),
      WriteValue: jest.fn().mockResolvedValue(undefined)
    });
  }

  if (path === '/') {
    interfaces['org.freedesktop.DBus.ObjectManager'] = makeIfaceEmitter({
      GetManagedObjects: jest.fn().mockImplementation(async () => {
        const out: any = {};
        for (const [p, ifs] of Object.entries<any>(state.managedObjects)) {
          out[p] = {};
          for (const [iname, props] of Object.entries(ifs)) {
            out[p][iname] = wrapDict(props);
          }
        }
        return out;
      })
    });
  }

  const proxy = {
    path,
    interfaces,
    getInterface: (name: string) => {
      if (!interfaces[name]) interfaces[name] = makeIfaceEmitter();
      return interfaces[name];
    }
  };
  state.proxies.set(path, proxy);
  if (path === '/') state.rootProxy = proxy;
  return proxy;
}

const mockBus = {
  getProxyObject: jest.fn().mockImplementation(async (_service: string, path: string) => makeProxy(path)),
  disconnect: jest.fn()
};

const mockDbus = {
  systemBus: jest.fn().mockReturnValue(mockBus),
  Variant
};

jest.mock('dbus-next', () => {
  if (mockState.missing) throw new Error("Cannot find module 'dbus-next'");
  return mockDbus;
}, { virtual: true });

// ---- Helpers ----

const PROPS = 'org.freedesktop.DBus.Properties';
const OBJECT_MANAGER = 'org.freedesktop.DBus.ObjectManager';
const ADAPTER = 'org.bluez.Adapter1';
const DEVICE = 'org.bluez.Device1';
const GATT_CHAR = 'org.bluez.GattCharacteristic1';
const GATT_DESC = 'org.bluez.GattDescriptor1';

const ID = 'aabbccddeeff';
const devicePath = '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF';
const servicePath = `${devicePath}/service0001`;
const charPath = `${servicePath}/char0002`;
const descPath = `${charPath}/desc0003`;

function resetState (objects = {}) {
  state.managedObjects = objects;
  state.ifaceCalls = [];
  state.proxies.clear();
  state.rootProxy = null;
}

function adapterTree (extra = {}) {
  return {
    '/org/bluez': { 'org.freedesktop.DBus.ObjectManager': {} },
    '/org/bluez/hci0': {
      'org.bluez.Adapter1': {
        Address: '00:11:22:33:44:55',
        Powered: true,
        Discovering: false
      }
    },
    ...extra
  };
}

function deviceTree (deviceProps = {}) {
  return adapterTree({
    [devicePath]: {
      [DEVICE]: { Address: 'AA:BB:CC:DD:EE:FF', AddressType: 'public', Connected: false, ...deviceProps }
    }
  });
}

function gattTree (deviceProps = {}) {
  return {
    ...deviceTree(deviceProps),
    [servicePath]: {
      'org.bluez.GattService1': { UUID: '0000180d-0000-1000-8000-00805f9b34fb', Primary: true }
    },
    [charPath]: {
      [GATT_CHAR]: {
        UUID: '00002a37-0000-1000-8000-00805f9b34fb',
        Flags: ['read', 'notify']
      }
    },
    [descPath]: {
      [GATT_DESC]: { UUID: '00002902-0000-1000-8000-00805f9b34fb' }
    }
  };
}

function makeDelegate () {
  return {
    onStateChange: jest.fn(),
    onAddressChange: jest.fn(),
    onScanStart: jest.fn(),
    onScanStop: jest.fn(),
    onDiscover: jest.fn(),
    onDisconnect: jest.fn(),
    onMtu: jest.fn(),
    onRssi: jest.fn(),
    onNotification: jest.fn(),
    onHandleNotification: jest.fn(),
    onWarning: jest.fn()
  };
}

async function flush () {
  // Allow microtasks (init promise chain) to settle.
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

async function startBindings (options?: any) {
  const delegate = makeDelegate();
  const bindings = new DbusBindings(options);
  bindings.start(delegate);
  await flush();
  return { bindings, delegate };
}

/** Records how a promise settles without awaiting it. */
function track (promise: Promise<any>) {
  const outcome: any = { settled: false, value: undefined, error: undefined };
  promise.then(
    value => { outcome.settled = true; outcome.value = value; },
    error => { outcome.settled = true; outcome.error = error; }
  );
  return outcome;
}

function objectManager () {
  return state.rootProxy.getInterface(OBJECT_MANAGER);
}

function emitProps (path: string, iface: string, changed: any) {
  makeProxy(path).getInterface(PROPS).emit('PropertiesChanged', iface, wrapDict(changed), []);
}

function callsTo (method: string) {
  return state.ifaceCalls.filter((c: any) => c.method === method);
}

// ---- Tests ----

describe('dbus/bindings', () => {
  beforeEach(() => {
    resetState(adapterTree());
    mockBus.disconnect.mockClear();
  });

  describe('start / adapter state', () => {
    test('start() reports poweredOn and the adapter address', async () => {
      const { delegate } = await startBindings();

      expect(delegate.onStateChange).toHaveBeenCalledWith('poweredOn');
      expect(delegate.onAddressChange).toHaveBeenCalledWith('00:11:22:33:44:55');
      expect(delegate.onWarning).not.toHaveBeenCalled();
    });

    test('reports poweredOff when adapter is unpowered', async () => {
      resetState(adapterTree({
        '/org/bluez/hci0': {
          'org.bluez.Adapter1': { Address: 'AA:BB:CC:DD:EE:FF', Powered: false }
        }
      }));
      const { delegate } = await startBindings();

      expect(delegate.onStateChange).toHaveBeenCalledWith('poweredOff');
    });

    test('reports unsupported plus a warning when no adapter is found', async () => {
      resetState({ '/org/bluez': { 'org.freedesktop.DBus.ObjectManager': {} } });
      const { delegate } = await startBindings();

      expect(delegate.onStateChange).toHaveBeenCalledWith('unsupported');
      expect(delegate.onWarning).toHaveBeenCalledWith(expect.stringMatching(/dbus init failed: No BlueZ adapter/));
    });

    test('adapter PropertiesChanged reports power and address changes once per change', async () => {
      const { delegate } = await startBindings();
      delegate.onStateChange.mockClear();
      delegate.onAddressChange.mockClear();

      emitProps('/org/bluez/hci0', ADAPTER, { Powered: false });
      emitProps('/org/bluez/hci0', ADAPTER, { Powered: false });
      emitProps('/org/bluez/hci0', ADAPTER, { Address: '11:22:33:44:55:66' });
      emitProps('/org/bluez/hci0', 'org.example.Other', { Powered: true });

      expect(delegate.onStateChange.mock.calls).toEqual([['poweredOff']]);
      expect(delegate.onAddressChange.mock.calls).toEqual([['11:22:33:44:55:66']]);
    });

    test.each([
      ['adapterId', { adapterId: 'hci1' }],
      ['hciDeviceId', { hciDeviceId: 1 }]
    ])('selects the adapter requested through %s', async (_label, options) => {
      resetState(adapterTree({
        '/org/bluez/hci1': { 'org.bluez.Adapter1': { Address: '66:77:88:99:AA:BB', Powered: true } }
      }));
      const { delegate } = await startBindings(options);

      expect(delegate.onAddressChange).toHaveBeenCalledWith('66:77:88:99:AA:BB');
    });

    test('falls back to the first adapter when the requested one does not exist', async () => {
      const { delegate } = await startBindings({ adapterId: 'hci7' });

      expect(delegate.onAddressChange).toHaveBeenCalledWith('00:11:22:33:44:55');
    });

    test('devices already in the BlueZ cache are reported on start', async () => {
      resetState(deviceTree({ Name: 'Cached' }));
      const { delegate } = await startBindings();

      expect(delegate.onDiscover).toHaveBeenCalledTimes(1);
      expect(delegate.onDiscover.mock.calls[0][0]).toMatchObject({ id: ID, address: 'AA:BB:CC:DD:EE:FF' });
    });

    test('start() throws a helpful error when dbus-next is not installed', () => {
      mockState.missing = true;
      // A fresh module registry, so the mock factory above runs (and throws) again.
      jest.resetModules();
      try {
        const { DbusBindings: Fresh } = require('../../../src/bindings/dbus/bindings');
        let error: any;
        try {
          new Fresh().start(makeDelegate());
        } catch (err) {
          error = err;
        }
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toMatch(/requires the "dbus-next" package/);
        expect(error.message).toMatch(/npm install dbus-next/);
        expect(error.cause.message).toMatch(/Cannot find module/);
      } finally {
        mockState.missing = false;
        jest.resetModules();
      }
    });

    test('stop() detaches listeners and disconnects the bus', async () => {
      const { bindings, delegate } = await startBindings();
      await bindings.startScanning([], false);

      bindings.stop();
      await flush();

      expect(callsTo('StopDiscovery').length).toBe(1);
      expect(mockBus.disconnect).toHaveBeenCalled();
      expect(objectManager().listenerCount('InterfacesAdded')).toBe(0);
      expect(objectManager().listenerCount('InterfacesRemoved')).toBe(0);
      expect(makeProxy('/org/bluez/hci0').getInterface(PROPS).listenerCount('PropertiesChanged')).toBe(0);

      delegate.onStateChange.mockClear();
      emitProps('/org/bluez/hci0', ADAPTER, { Powered: false });
      expect(delegate.onStateChange).not.toHaveBeenCalled();
    });
  });

  describe('scanning', () => {
    test('startScanning calls SetDiscoveryFilter + StartDiscovery, resolves and reports scanStart', async () => {
      const { bindings, delegate } = await startBindings();

      await expect(bindings.startScanning(['180d'], false)).resolves.toBeUndefined();

      const calls = state.ifaceCalls.filter((c: any) => c.path === '/org/bluez/hci0');
      expect(calls.map((c: any) => c.method)).toEqual(['SetDiscoveryFilter', 'StartDiscovery']);
      expect(delegate.onScanStart).toHaveBeenCalledTimes(1);
    });

    test('onScanStart carries filterDuplicates (the inverse of allowDuplicates)', async () => {
      const { bindings, delegate } = await startBindings();

      await bindings.startScanning([], false);
      await bindings.startScanning([], true);

      expect(delegate.onScanStart.mock.calls).toEqual([[true], [false]]);
      const filters = callsTo('SetDiscoveryFilter').map((c: any) => c.args[0].DuplicateData.value);
      expect(filters).toEqual([false, true]);
      // Already discovering: the second call only updates the filter.
      expect(callsTo('StartDiscovery').length).toBe(1);
    });

    test('startScanning rejects before the adapter is initialized', async () => {
      const bindings = new DbusBindings();
      const delegate = makeDelegate();
      bindings.start(delegate);

      await expect(bindings.startScanning([], false)).rejects.toThrow('adapter not initialized');
      expect(delegate.onScanStart).not.toHaveBeenCalled();
    });

    test('startScanning rejects when StartDiscovery fails', async () => {
      const { bindings, delegate } = await startBindings();
      makeProxy('/org/bluez/hci0').getInterface(ADAPTER).StartDiscovery =
        () => Promise.reject(new Error('org.bluez.Error.NotReady'));

      await expect(bindings.startScanning([], false)).rejects.toThrow('org.bluez.Error.NotReady');
      expect(delegate.onScanStart).not.toHaveBeenCalled();
    });

    test('startScanning tolerates a failing SetDiscoveryFilter', async () => {
      const { bindings, delegate } = await startBindings();
      makeProxy('/org/bluez/hci0').getInterface(ADAPTER).SetDiscoveryFilter =
        () => Promise.reject(new Error('unsupported filter'));

      await expect(bindings.startScanning([], false)).resolves.toBeUndefined();
      expect(callsTo('StartDiscovery').length).toBe(1);
      expect(delegate.onScanStart).toHaveBeenCalledTimes(1);
    });

    test('startScanning re-reports devices already in the BlueZ cache', async () => {
      resetState(deviceTree());
      const { bindings, delegate } = await startBindings();
      delegate.onDiscover.mockClear();

      await bindings.startScanning([], false);

      expect(delegate.onDiscover).toHaveBeenCalledTimes(1);
      expect(delegate.onDiscover.mock.calls[0][0].id).toBe(ID);
    });

    test('stopScanning calls StopDiscovery, resolves and reports scanStop', async () => {
      const { bindings, delegate } = await startBindings();
      await bindings.startScanning([], false);

      await expect(bindings.stopScanning()).resolves.toBeUndefined();

      expect(callsTo('StopDiscovery').length).toBe(1);
      expect(delegate.onScanStop).toHaveBeenCalledTimes(1);
    });

    test('stopScanning still resolves and reports scanStop when StopDiscovery fails', async () => {
      const { bindings, delegate } = await startBindings();
      await bindings.startScanning([], false);
      makeProxy('/org/bluez/hci0').getInterface(ADAPTER).StopDiscovery =
        () => Promise.reject(new Error('org.bluez.Error.Failed'));

      await expect(bindings.stopScanning()).resolves.toBeUndefined();

      expect(delegate.onScanStop).toHaveBeenCalledTimes(1);
      expect(delegate.onWarning).not.toHaveBeenCalled();
    });

    test('stopScanning without a running scan does not call StopDiscovery', async () => {
      const { bindings, delegate } = await startBindings();

      await bindings.stopScanning();

      expect(callsTo('StopDiscovery').length).toBe(0);
      expect(delegate.onScanStop).toHaveBeenCalledTimes(1);
    });

    test('setScanParameters warns and resolves', async () => {
      const { bindings, delegate } = await startBindings();

      await expect(bindings.setScanParameters(0x10, 0x10)).resolves.toBeUndefined();

      expect(delegate.onWarning).toHaveBeenCalledWith(expect.stringMatching(/setScanParameters is not supported/));
    });

    test('setAddress warns', async () => {
      const { bindings, delegate } = await startBindings();

      bindings.setAddress('11:22:33:44:55:66');

      expect(delegate.onWarning).toHaveBeenCalledWith(expect.stringMatching(/setAddress is not supported/));
    });
  });

  describe('discovery', () => {
    test('InterfacesAdded for a Device1 reports onDiscover with parsed advertisement', async () => {
      const { delegate } = await startBindings();

      objectManager().emit('InterfacesAdded', devicePath, {
        [DEVICE]: wrapDict({
          Address: 'AA:BB:CC:DD:EE:FF',
          AddressType: 'public',
          Name: 'Test Device',
          TxPower: 4,
          RSSI: -42,
          UUIDs: ['0000180d-0000-1000-8000-00805f9b34fb']
        })
      });
      await flush();

      expect(delegate.onDiscover).toHaveBeenCalledTimes(1);
      expect(delegate.onDiscover.mock.calls[0][0]).toEqual({
        id: ID,
        address: 'AA:BB:CC:DD:EE:FF',
        addressType: 'public',
        connectable: true,
        scannable: false,
        rssi: -42,
        advertisement: {
          localName: 'Test Device',
          txPowerLevel: 4,
          manufacturerData: undefined,
          serviceData: [],
          serviceUuids: ['180d'],
          serviceSolicitationUuids: []
        }
      });
    });

    test('falls back to Alias, the path-derived address and an unknown address type', async () => {
      const { delegate } = await startBindings();

      objectManager().emit('InterfacesAdded', devicePath, {
        [DEVICE]: wrapDict({ Alias: 'Aliased' })
      });

      const peripheral = delegate.onDiscover.mock.calls[0][0];
      expect(peripheral.address).toBe('AA:BB:CC:DD:EE:FF');
      expect(peripheral.addressType).toBe('unknown');
      expect(peripheral.rssi).toBe(0);
      expect(peripheral.advertisement.localName).toBe('Aliased');
    });

    test('ignores devices that belong to another adapter', async () => {
      const { delegate } = await startBindings();

      objectManager().emit('InterfacesAdded', '/org/bluez/hci1/dev_AA_BB_CC_DD_EE_FF', {
        [DEVICE]: wrapDict({ Address: 'AA:BB:CC:DD:EE:FF' })
      });

      expect(delegate.onDiscover).not.toHaveBeenCalled();
    });

    test('InterfacesAdded unwraps Variant-wrapped ManufacturerData and ServiceData payloads', async () => {
      const { delegate } = await startBindings();

      // BlueZ exposes ManufacturerData as a{qv} and ServiceData as a{sv}; dbus-next
      // surfaces each inner value as a Variant, not the raw bytes.
      const mfgPayload = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
      const svcPayload = Buffer.from([0x01, 0x02, 0x03]);

      objectManager().emit('InterfacesAdded', devicePath, {
        [DEVICE]: wrapDict({
          Address: 'AA:BB:CC:DD:EE:FF',
          AddressType: 'public',
          ManufacturerData: { 0x004c: v('ay', mfgPayload) },
          ServiceData: { '0000180d-0000-1000-8000-00805f9b34fb': v('ay', svcPayload) }
        })
      });
      await flush();

      expect(delegate.onDiscover).toHaveBeenCalledTimes(1);
      const { advertisement } = delegate.onDiscover.mock.calls[0][0];

      // Manufacturer: 2-byte little-endian company id (0x004c => Apple) + payload
      expect(Buffer.isBuffer(advertisement.manufacturerData)).toBe(true);
      expect(advertisement.manufacturerData.equals(
        Buffer.concat([Buffer.from([0x4c, 0x00]), mfgPayload])
      )).toBe(true);

      expect(advertisement.serviceData).toEqual([
        { uuid: '180d', data: svcPayload }
      ]);
    });

    test('accepts advertisement payloads delivered as plain byte arrays', async () => {
      const { delegate } = await startBindings();

      objectManager().emit('InterfacesAdded', devicePath, {
        [DEVICE]: wrapDict({
          Address: 'AA:BB:CC:DD:EE:FF',
          ManufacturerData: { 0x004c: v('ay', [0x01, 0x02]) }
        })
      });

      const { advertisement } = delegate.onDiscover.mock.calls[0][0];
      expect(advertisement.manufacturerData).toEqual(Buffer.from([0x4c, 0x00, 0x01, 0x02]));
    });
  });

  describe('scan service-uuid filtering (software-side)', () => {
    function emitDevice (deviceProps: any) {
      objectManager().emit('InterfacesAdded', devicePath, {
        [DEVICE]: wrapDict({ Address: 'AA:BB:CC:DD:EE:FF', AddressType: 'public', ...deviceProps })
      });
    }

    test('does not push a UUIDs filter to BlueZ SetDiscoveryFilter', async () => {
      const { bindings } = await startBindings();

      await bindings.startScanning(['180d'], false);

      const setFilter = state.ifaceCalls.find((c: any) => c.method === 'SetDiscoveryFilter');
      expect(setFilter).toBeDefined();
      expect('UUIDs' in setFilter.args[0]).toBe(false);
      expect(setFilter.args[0].Transport).toEqual(v('s', 'le'));
    });

    test('discovers a device that advertises the UUID only in service data', async () => {
      const { bindings, delegate } = await startBindings();
      await bindings.startScanning(['180d'], false);

      emitDevice({
        ServiceData: { '0000180d-0000-1000-8000-00805f9b34fb': v('ay', Buffer.from([0x01])) }
      });
      await flush();

      expect(delegate.onDiscover).toHaveBeenCalledTimes(1);
      expect(delegate.onDiscover.mock.calls[0][0].id).toBe(ID);
    });

    test('accepts the scan filter in dashed 128-bit form', async () => {
      const { bindings, delegate } = await startBindings();
      await bindings.startScanning(['0000180D-0000-1000-8000-00805F9B34FB'], false);

      emitDevice({ UUIDs: ['0000180d-0000-1000-8000-00805f9b34fb'] });

      expect(delegate.onDiscover).toHaveBeenCalledTimes(1);
    });

    test('filters out a device that matches neither service UUIDs nor service data', async () => {
      const { bindings, delegate } = await startBindings();
      await bindings.startScanning(['180d'], false);

      emitDevice({
        UUIDs: ['0000feaa-0000-1000-8000-00805f9b34fb'],
        ServiceData: { '0000feaa-0000-1000-8000-00805f9b34fb': v('ay', Buffer.from([0x01])) }
      });
      await flush();

      expect(delegate.onDiscover).not.toHaveBeenCalled();
    });

    test('empty scan filter discovers everything', async () => {
      const { bindings, delegate } = await startBindings();
      await bindings.startScanning([], false);

      emitDevice({ UUIDs: ['0000feaa-0000-1000-8000-00805f9b34fb'] });
      await flush();

      expect(delegate.onDiscover).toHaveBeenCalledTimes(1);
    });
  });

  describe('late-arriving advertisement data during scan', () => {
    test('a UUID that arrives in a later PropertiesChanged still triggers onDiscover', async () => {
      const { bindings, delegate } = await startBindings();
      await bindings.startScanning(['180d'], false);

      // First sighting has no matching UUID -> tracked, not discovered.
      objectManager().emit('InterfacesAdded', devicePath, {
        [DEVICE]: wrapDict({ Address: 'AA:BB:CC:DD:EE:FF', AddressType: 'public', RSSI: -50 })
      });
      await flush();
      expect(delegate.onDiscover).not.toHaveBeenCalled();

      // BlueZ later aggregates the matching service data -> now discovered.
      emitProps(devicePath, DEVICE, {
        ServiceData: { '0000180d-0000-1000-8000-00805f9b34fb': v('ay', Buffer.from([0x01])) }
      });
      await flush();

      expect(delegate.onDiscover).toHaveBeenCalledTimes(1);
      expect(delegate.onDiscover.mock.calls[0][0]).toMatchObject({ id: ID, rssi: -50 });
    });

    test('a watcher suspended on getProxyObject across stopScanning does not re-attach', async () => {
      const { bindings } = await startBindings();
      await bindings.startScanning([], false);

      // Park the watcher on getProxyObject, and keep stopScanning suspended on
      // StopDiscovery, so the watcher resumes mid-stop — the F1 race window.
      let releaseWatch: any;
      const watchGate = new Promise(resolve => { releaseWatch = resolve; });
      mockBus.getProxyObject.mockImplementationOnce(async (_svc: string, path: string) => {
        await watchGate;
        return makeProxy(path);
      });
      let releaseStop: any;
      const stopGate = new Promise(resolve => { releaseStop = resolve; });
      makeProxy('/org/bluez/hci0').getInterface(ADAPTER).StopDiscovery = () => stopGate;

      objectManager().emit('InterfacesAdded', devicePath, {
        [DEVICE]: wrapDict({ Address: 'AA:BB:CC:DD:EE:FF', AddressType: 'public' })
      });
      await flush(); // watchDeviceProps parked on watchGate

      const stopped = bindings.stopScanning(); // parked on StopDiscovery
      await flush();

      releaseWatch(); // watcher resumes while stop is still in flight
      await flush();

      releaseStop();
      await stopped;

      expect((bindings as any).scanPropsListeners.size).toBe(0);
      expect(makeProxy(devicePath).getInterface(PROPS).listenerCount('PropertiesChanged')).toBe(0);
    });

    test('scan-time watchers are detached on stopScanning', async () => {
      const { bindings, delegate } = await startBindings();
      await bindings.startScanning([], false);

      objectManager().emit('InterfacesAdded', devicePath, {
        [DEVICE]: wrapDict({ Address: 'AA:BB:CC:DD:EE:FF', AddressType: 'public' })
      });
      await flush();
      expect((bindings as any).scanPropsListeners.size).toBe(1);

      await bindings.stopScanning();
      expect((bindings as any).scanPropsListeners.size).toBe(0);

      delegate.onDiscover.mockClear();
      emitProps(devicePath, DEVICE, { RSSI: -70 });
      expect(delegate.onDiscover).not.toHaveBeenCalled();
    });

    test('a scan-time watcher is detached when BlueZ removes the device', async () => {
      const { bindings } = await startBindings();
      await bindings.startScanning([], false);

      objectManager().emit('InterfacesAdded', devicePath, {
        [DEVICE]: wrapDict({ Address: 'AA:BB:CC:DD:EE:FF', AddressType: 'public' })
      });
      await flush();
      objectManager().emit('InterfacesRemoved', devicePath, [DEVICE]);

      expect((bindings as any).scanPropsListeners.size).toBe(0);
    });
  });

  describe('connect / disconnect', () => {
    test('connect calls Device1.Connect and resolves once services are resolved', async () => {
      resetState(deviceTree());
      const { bindings, delegate } = await startBindings();

      const outcome = track(bindings.connect(ID));
      await flush();
      expect(callsTo('Connect').length).toBe(1);
      expect(outcome.settled).toBe(false);

      emitProps(devicePath, DEVICE, { Connected: true });
      await flush();
      expect(outcome.settled).toBe(false);

      emitProps(devicePath, DEVICE, { ServicesResolved: true });
      await flush();
      expect(outcome).toEqual({ settled: true, value: undefined, error: undefined });
      expect(delegate.onDisconnect).not.toHaveBeenCalled();
    });

    test('connect resolves immediately for a device BlueZ already has connected', async () => {
      resetState(deviceTree({ Connected: true, ServicesResolved: true }));
      const { bindings } = await startBindings();

      await expect(bindings.connect('AA:BB:CC:DD:EE:FF')).resolves.toBeUndefined();
      expect(callsTo('Connect').length).toBe(0);
    });

    test('concurrent connect calls share one attempt', async () => {
      resetState(deviceTree());
      const { bindings } = await startBindings();

      const first = bindings.connect(ID);
      const second = bindings.connect(ID);
      await flush();
      emitProps(devicePath, DEVICE, { Connected: true, ServicesResolved: true });

      await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
      expect(callsTo('Connect').length).toBe(1);
    });

    test('connect rejects for an unknown peripheral', async () => {
      const { bindings } = await startBindings();

      await expect(bindings.connect('112233445566')).rejects.toThrow('unknown peripheral 112233445566');
    });

    test('failed Connect rejects, reports no disconnect, and clears the proxy', async () => {
      resetState(deviceTree());
      const proxy = makeProxy(devicePath);
      proxy.getInterface(DEVICE).Connect = () => Promise.reject(new Error('le-connection-abort-by-local'));
      const { bindings, delegate } = await startBindings();

      await expect(bindings.connect(ID)).rejects.toThrow('le-connection-abort-by-local');

      // Matches hci-socket: a failed attempt reports no disconnect.
      expect(delegate.onDisconnect).not.toHaveBeenCalled();

      // Proxy/listener released so a retry starts clean.
      expect((bindings as any).devices.get(ID).proxy).toBeNull();
      expect(proxy.getInterface(PROPS).listenerCount('PropertiesChanged')).toBe(0);
    });

    test('a failed attempt can be retried', async () => {
      resetState(deviceTree());
      const device1 = makeProxy(devicePath).getInterface(DEVICE);
      const connectOk = device1.Connect;
      device1.Connect = () => Promise.reject(new Error('le-connection-abort-by-local'));
      const { bindings } = await startBindings();

      await expect(bindings.connect(ID)).rejects.toThrow();

      device1.Connect = connectOk;
      const retry = bindings.connect(ID);
      await flush();
      emitProps(devicePath, DEVICE, { Connected: true, ServicesResolved: true });
      await expect(retry).resolves.toBeUndefined();
    });

    test('a remote drop mid-connect rejects connect and reports no disconnect', async () => {
      resetState(deviceTree());
      const { bindings, delegate } = await startBindings();

      const outcome = track(bindings.connect(ID));
      await flush();

      emitProps(devicePath, DEVICE, { Connected: false });
      await flush();

      expect(outcome.settled).toBe(true);
      expect(outcome.error).toBeInstanceOf(DisconnectedError);
      expect(outcome.error.reason).toBe('remote');
      expect(delegate.onDisconnect).not.toHaveBeenCalled();
    });

    test('remote drop while Connect() is in flight rejects connect, without an unhandled rejection (#91)', async () => {
      resetState(deviceTree());
      const proxy = makeProxy(devicePath);
      // Keep Connect() pending so the drop lands while the D-Bus call is
      // still awaited — the unhandled-rejection window from #91.
      const device1 = proxy.getInterface(DEVICE);
      device1.Connect = jest.fn().mockReturnValue(new Promise(() => {}));

      const unhandled: any[] = [];
      const onUnhandled = (err: any) => unhandled.push(err);
      process.on('unhandledRejection', onUnhandled);
      try {
        const { bindings, delegate } = await startBindings();

        const outcome = track(bindings.connect(ID));
        await flush();
        expect(device1.Connect).toHaveBeenCalled();

        emitProps(devicePath, DEVICE, { Connected: false });
        await flush();

        expect(outcome.settled).toBe(true);
        expect(outcome.error).toBeInstanceOf(DisconnectedError);
        expect(outcome.error.message).toMatch(/remote/);
        expect(delegate.onDisconnect).not.toHaveBeenCalled();
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });

    test('an established connection that drops reports a single disconnect', async () => {
      resetState(deviceTree({ Connected: true, ServicesResolved: true }));
      const { bindings, delegate } = await startBindings();

      await bindings.connect(ID);

      emitProps(devicePath, DEVICE, { Connected: false });
      emitProps(devicePath, DEVICE, { Connected: false });
      await flush();

      expect(delegate.onDisconnect.mock.calls).toEqual([[ID, 'remote']]);
    });

    test('after a drop, connect goes through Device1.Connect again instead of trusting stale state', async () => {
      resetState(deviceTree({ Connected: true, ServicesResolved: true }));
      const { bindings } = await startBindings();
      await bindings.connect(ID);
      emitProps(devicePath, DEVICE, { Connected: false, ServicesResolved: false });

      const outcome = track(bindings.connect(ID));
      await flush();

      expect(callsTo('Connect').length).toBe(1);
      expect(outcome.settled).toBe(false);

      emitProps(devicePath, DEVICE, { Connected: true, ServicesResolved: true });
      await flush();
      expect(outcome.settled).toBe(true);
      expect(outcome.error).toBeUndefined();
    });

    test('disconnect calls Device1.Disconnect; completion arrives through onDisconnect', async () => {
      resetState(deviceTree({ Connected: true, ServicesResolved: true }));
      const { bindings, delegate } = await startBindings();
      await bindings.connect(ID);

      expect(bindings.disconnect('AA:BB:CC:DD:EE:FF')).toBeUndefined();
      await flush();
      expect(callsTo('Disconnect').length).toBe(1);
      expect(delegate.onDisconnect).not.toHaveBeenCalled();

      emitProps(devicePath, DEVICE, { Connected: false });
      expect(delegate.onDisconnect.mock.calls).toEqual([[ID, 'remote']]);
    });

    test('disconnect is a no-op for unknown or unconnected peripherals', async () => {
      resetState(deviceTree());
      const { bindings, delegate } = await startBindings();

      bindings.disconnect('112233445566');
      bindings.disconnect(ID);
      await flush();

      expect(callsTo('Disconnect').length).toBe(0);
      expect(delegate.onDisconnect).not.toHaveBeenCalled();
      expect(delegate.onWarning).not.toHaveBeenCalled();
    });

    test('disconnect tolerates a failing Device1.Disconnect', async () => {
      resetState(deviceTree({ Connected: true, ServicesResolved: true }));
      makeProxy(devicePath).getInterface(DEVICE).Disconnect = () => Promise.reject(new Error('not connected'));
      const { bindings, delegate } = await startBindings();
      await bindings.connect(ID);

      bindings.disconnect(ID);
      await flush();

      expect(delegate.onWarning).not.toHaveBeenCalled();
    });

    test('a connected device removed by BlueZ reports disconnect("removed")', async () => {
      resetState(deviceTree({ Connected: true, ServicesResolved: true }));
      const { bindings, delegate } = await startBindings();
      await bindings.connect(ID);

      objectManager().emit('InterfacesRemoved', devicePath, [DEVICE]);

      expect(delegate.onDisconnect.mock.calls).toEqual([[ID, 'removed']]);
    });

    test('removal of a device that was never connected reports nothing', async () => {
      resetState(deviceTree());
      const { delegate } = await startBindings();

      objectManager().emit('InterfacesRemoved', devicePath, [DEVICE]);

      expect(delegate.onDisconnect).not.toHaveBeenCalled();
    });

    test('cancelConnect issues Disconnect and rejects the pending connect with ConnectionCancelledError', async () => {
      resetState(deviceTree());
      const proxy = makeProxy(devicePath);
      proxy.getInterface(DEVICE).Connect = jest.fn().mockReturnValue(new Promise(() => {}));
      const { bindings, delegate } = await startBindings();

      const outcome = track(bindings.connect(ID));
      await flush();

      bindings.cancelConnect(ID);
      await flush();

      expect(callsTo('Disconnect').length).toBe(1);
      expect(outcome.error).toBeInstanceOf(ConnectionCancelledError);
      expect(delegate.onDisconnect).not.toHaveBeenCalled();
      expect((bindings as any).devices.get(ID).proxy).toBeNull();
    });

    test('cancelConnect before the device proxy is ready still cancels the attempt', async () => {
      resetState(deviceTree());
      const { bindings } = await startBindings();

      const outcome = track(bindings.connect(ID));
      bindings.cancelConnect(ID); // connect is still waiting on getProxyObject
      await flush();

      expect(outcome.error).toBeInstanceOf(ConnectionCancelledError);
      expect(callsTo('Connect').length).toBe(0);
    });

    test('cancelConnect on an established connection behaves like disconnect', async () => {
      resetState(deviceTree({ Connected: true, ServicesResolved: true }));
      const { bindings, delegate } = await startBindings();
      await bindings.connect(ID);

      bindings.cancelConnect(ID);
      await flush();
      expect(callsTo('Disconnect').length).toBe(1);

      emitProps(devicePath, DEVICE, { Connected: false });
      expect(delegate.onDisconnect.mock.calls).toEqual([[ID, 'remote']]);
    });

    test('stop() rejects a connect that is still pending', async () => {
      resetState(deviceTree());
      const { bindings } = await startBindings();

      const outcome = track(bindings.connect(ID));
      await flush();
      bindings.stop();
      await flush();

      expect(outcome.error).toBeInstanceOf(DisconnectedError);
    });
  });

  describe('rssi', () => {
    test('updateRssi resolves with the last RSSI BlueZ reported', async () => {
      resetState(deviceTree({ RSSI: -61 }));
      const { bindings } = await startBindings();

      await expect(bindings.updateRssi('AA:BB:CC:DD:EE:FF')).resolves.toBe(-61);
    });

    test('updateRssi resolves 0 when BlueZ never reported one', async () => {
      resetState(deviceTree());
      const { bindings } = await startBindings();

      await expect(bindings.updateRssi(ID)).resolves.toBe(0);
    });

    test('updateRssi rejects for an unknown peripheral', async () => {
      const { bindings } = await startBindings();

      await expect(bindings.updateRssi('112233445566')).rejects.toThrow('unknown peripheral');
    });

    test('unsolicited RSSI changes on a connected device are reported through onRssi', async () => {
      resetState(deviceTree({ Connected: true, ServicesResolved: true, RSSI: -61 }));
      const { bindings, delegate } = await startBindings();
      await bindings.connect(ID);

      emitProps(devicePath, DEVICE, { RSSI: -48 });

      expect(delegate.onRssi.mock.calls).toEqual([[ID, -48]]);
      await expect(bindings.updateRssi(ID)).resolves.toBe(-48);
    });
  });

  describe('GATT discovery', () => {
    test('discoverServices/Characteristics/Descriptors walk the cached object tree', async () => {
      resetState(gattTree());
      const { bindings } = await startBindings();

      await expect(bindings.discoverServices(ID, [])).resolves.toEqual(['180d']);
      await expect(bindings.discoverCharacteristics(ID, '180d', [])).resolves.toEqual([
        { uuid: '2a37', properties: ['read', 'notify'] }
      ]);
      await expect(bindings.discoverDescriptors(ID, '180d', '2a37')).resolves.toEqual(['2902']);
    });

    test('discoverServices and discoverCharacteristics apply the requested uuid filter', async () => {
      resetState({
        ...gattTree(),
        [`${devicePath}/service0010`]: {
          'org.bluez.GattService1': { UUID: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', Primary: true }
        },
        [`${servicePath}/char0005`]: {
          [GATT_CHAR]: { UUID: '00002a38-0000-1000-8000-00805f9b34fb', Flags: ['read'] }
        }
      });
      const { bindings } = await startBindings();

      await expect(bindings.discoverServices(ID, [])).resolves.toEqual(['180d', '6e400001b5a3f393e0a9e50e24dcca9e']);
      await expect(bindings.discoverServices(ID, ['6E400001-B5A3-F393-E0A9-E50E24DCCA9E']))
        .resolves.toEqual(['6e400001b5a3f393e0a9e50e24dcca9e']);
      await expect(bindings.discoverServices(ID, ['1800'])).resolves.toEqual([]);
      await expect(bindings.discoverCharacteristics(ID, '180d', ['2a38'])).resolves.toEqual([
        { uuid: '2a38', properties: ['read'] }
      ]);
    });

    test('maps BlueZ flags to noble characteristic properties without duplicates', async () => {
      resetState({
        ...gattTree(),
        [charPath]: {
          [GATT_CHAR]: {
            UUID: '00002a37-0000-1000-8000-00805f9b34fb',
            Flags: [
              'broadcast', 'read', 'write-without-response', 'write', 'notify', 'indicate',
              'authenticated-signed-writes', 'reliable-write', 'writable-auxiliaries', 'encrypt-read'
            ]
          }
        }
      });
      const { bindings } = await startBindings();

      const [characteristic] = await bindings.discoverCharacteristics(ID, '180d', []);
      expect(characteristic.properties).toEqual([
        'broadcast', 'read', 'writeWithoutResponse', 'write', 'notify', 'indicate',
        'authenticatedSignedWrites', 'extendedProperties'
      ]);
    });

    test('GATT objects announced after start are picked up', async () => {
      resetState(deviceTree());
      const { bindings } = await startBindings();
      await expect(bindings.discoverServices(ID, [])).resolves.toEqual([]);

      objectManager().emit('InterfacesAdded', servicePath, {
        'org.bluez.GattService1': wrapDict({ UUID: '0000180d-0000-1000-8000-00805f9b34fb', Primary: true })
      });
      await expect(bindings.discoverServices(ID, [])).resolves.toEqual(['180d']);

      objectManager().emit('InterfacesRemoved', servicePath, ['org.bluez.GattService1']);
      await expect(bindings.discoverServices(ID, [])).resolves.toEqual([]);
    });

    test('discoverIncludedServices resolves an empty list', async () => {
      resetState(gattTree());
      const { bindings } = await startBindings();

      await expect(bindings.discoverIncludedServices(ID, '180d', [])).resolves.toEqual([]);
    });

    test('discoverCharacteristics rejects when the service is not found', async () => {
      resetState(gattTree());
      const { bindings } = await startBindings();

      await expect(bindings.discoverCharacteristics(ID, '1800', [])).rejects.toThrow('service not found');
    });

    test('discoverDescriptors rejects when the characteristic is not found', async () => {
      resetState(gattTree());
      const { bindings } = await startBindings();

      await expect(bindings.discoverDescriptors(ID, '180d', '2a00')).rejects.toThrow('characteristic not found');
    });
  });

  describe('GATT operations', () => {
    test('read resolves with the characteristic value', async () => {
      resetState(gattTree());
      const { bindings, delegate } = await startBindings();

      const value = await bindings.read(ID, '180d', '2a37');

      expect(Buffer.isBuffer(value)).toBe(true);
      expect(value).toEqual(Buffer.from([0x01, 0x02]));
      // A read answer is not a notification.
      expect(delegate.onNotification).not.toHaveBeenCalled();
    });

    test('read converts a plain byte array into a Buffer', async () => {
      resetState(gattTree());
      const { bindings } = await startBindings();
      makeProxy(charPath).getInterface(GATT_CHAR).ReadValue.mockResolvedValue([0x0a, 0x0b]);

      await expect(bindings.read(ID, '180d', '2a37')).resolves.toEqual(Buffer.from([0x0a, 0x0b]));
    });

    test('read rejects when the characteristic is not found', async () => {
      resetState(gattTree());
      const { bindings } = await startBindings();

      await expect(bindings.read(ID, '180d', '2a00')).rejects.toThrow('characteristic not found');
      await expect(bindings.read('112233445566', '180d', '2a37')).rejects.toThrow('characteristic not found');
    });

    test('read rejects with the error from ReadValue', async () => {
      resetState(gattTree());
      const { bindings } = await startBindings();
      makeProxy(charPath).getInterface(GATT_CHAR).ReadValue.mockRejectedValue(new Error('org.bluez.Error.NotPermitted'));

      await expect(bindings.read(ID, '180d', '2a37')).rejects.toThrow('org.bluez.Error.NotPermitted');
    });

    test.each([
      [false, 'request'],
      [true, 'command']
    ])('write (withoutResponse=%s) calls WriteValue with type "%s"', async (withoutResponse, type) => {
      resetState(gattTree());
      const { bindings } = await startBindings();
      const data = Buffer.from([0x05, 0x06]);

      await expect(bindings.write(ID, '180d', '2a37', data, withoutResponse)).resolves.toBeUndefined();

      const writeValue = makeProxy(charPath).getInterface(GATT_CHAR).WriteValue;
      expect(writeValue).toHaveBeenCalledWith(data, { type: v('s', type) });
    });

    test('write rejects on a missing characteristic or a failing WriteValue', async () => {
      resetState(gattTree());
      const { bindings } = await startBindings();

      await expect(bindings.write(ID, '180d', '2a00', Buffer.alloc(1), false)).rejects.toThrow('characteristic not found');

      makeProxy(charPath).getInterface(GATT_CHAR).WriteValue.mockRejectedValue(new Error('write failed'));
      await expect(bindings.write(ID, '180d', '2a37', Buffer.alloc(1), false)).rejects.toThrow('write failed');
    });

    test('notify(true) calls StartNotify, resolves, and forwards value updates as notifications', async () => {
      resetState(gattTree());
      const { bindings, delegate } = await startBindings();

      await expect(bindings.notify('AA:BB:CC:DD:EE:FF', '180d', '2a37', true)).resolves.toBeUndefined();

      const proxy = state.proxies.get(charPath);
      expect(proxy.interfaces[GATT_CHAR].StartNotify).toHaveBeenCalled();

      // Simulate BlueZ pushing a notification
      emitProps(charPath, GATT_CHAR, { Value: Buffer.from([0xaa]) });
      // Unrelated changes are not notifications.
      emitProps(charPath, GATT_CHAR, { Notifying: true });
      emitProps(charPath, 'org.example.Other', { Value: Buffer.from([0xbb]) });

      expect(delegate.onNotification.mock.calls).toEqual([[ID, '180d', '2a37', Buffer.from([0xaa])]]);
    });

    test('notify(true) twice attaches a single listener', async () => {
      resetState(gattTree());
      const { bindings, delegate } = await startBindings();

      await bindings.notify(ID, '180d', '2a37', true);
      await bindings.notify(ID, '180d', '2a37', true);
      emitProps(charPath, GATT_CHAR, { Value: Buffer.from([0xaa]) });

      expect(delegate.onNotification).toHaveBeenCalledTimes(1);
    });

    test('notify(false) calls StopNotify and stops forwarding notifications', async () => {
      resetState(gattTree());
      const { bindings, delegate } = await startBindings();
      await bindings.notify(ID, '180d', '2a37', true);

      await expect(bindings.notify(ID, '180d', '2a37', false)).resolves.toBeUndefined();

      expect(makeProxy(charPath).getInterface(GATT_CHAR).StopNotify).toHaveBeenCalled();
      emitProps(charPath, GATT_CHAR, { Value: Buffer.from([0xaa]) });
      expect(delegate.onNotification).not.toHaveBeenCalled();
    });

    test('notify(false) resolves even when StopNotify fails', async () => {
      resetState(gattTree());
      const { bindings } = await startBindings();
      makeProxy(charPath).getInterface(GATT_CHAR).StopNotify.mockRejectedValue(new Error('not notifying'));

      await expect(bindings.notify(ID, '180d', '2a37', false)).resolves.toBeUndefined();
    });

    test('notify(true) rejects when StartNotify fails and leaves no listener behind', async () => {
      resetState(gattTree());
      const { bindings, delegate } = await startBindings();
      makeProxy(charPath).getInterface(GATT_CHAR).StartNotify.mockRejectedValue(new Error('org.bluez.Error.NotSupported'));

      await expect(bindings.notify(ID, '180d', '2a37', true)).rejects.toThrow('org.bluez.Error.NotSupported');

      emitProps(charPath, GATT_CHAR, { Value: Buffer.from([0xaa]) });
      expect(delegate.onNotification).not.toHaveBeenCalled();
      expect(makeProxy(charPath).getInterface(PROPS).listenerCount('PropertiesChanged')).toBe(0);
    });

    test('notify rejects when the characteristic is not found', async () => {
      resetState(gattTree());
      const { bindings } = await startBindings();

      await expect(bindings.notify(ID, '180d', '2a00', true)).rejects.toThrow('characteristic not found');
    });

    test('notification listeners are released when the device disconnects', async () => {
      resetState(gattTree({ Connected: true, ServicesResolved: true }));
      const { bindings, delegate } = await startBindings();
      await bindings.connect(ID);
      await bindings.notify(ID, '180d', '2a37', true);

      emitProps(devicePath, DEVICE, { Connected: false });
      emitProps(charPath, GATT_CHAR, { Value: Buffer.from([0xaa]) });

      expect(delegate.onDisconnect).toHaveBeenCalledTimes(1);
      expect(delegate.onNotification).not.toHaveBeenCalled();
    });

    test('readValue resolves with the descriptor value', async () => {
      resetState(gattTree());
      const { bindings } = await startBindings();

      await expect(bindings.readValue(ID, '180d', '2a37', '2902')).resolves.toEqual(Buffer.from([0x09]));
    });

    test('writeValue calls the descriptor WriteValue', async () => {
      resetState(gattTree());
      const { bindings } = await startBindings();
      const data = Buffer.from([0x01, 0x00]);

      await expect(bindings.writeValue(ID, '180d', '2a37', '2902', data)).resolves.toBeUndefined();

      expect(makeProxy(descPath).getInterface(GATT_DESC).WriteValue).toHaveBeenCalledWith(data, {});
    });

    test('readValue/writeValue reject when the descriptor is not found or the call fails', async () => {
      resetState(gattTree());
      const { bindings } = await startBindings();

      await expect(bindings.readValue(ID, '180d', '2a37', '2901')).rejects.toThrow('descriptor not found');
      await expect(bindings.readValue(ID, '180d', '2a00', '2902')).rejects.toThrow('descriptor not found');
      await expect(bindings.writeValue(ID, '180d', '2a37', '2901', Buffer.alloc(1))).rejects.toThrow('descriptor not found');

      const desc = makeProxy(descPath).getInterface(GATT_DESC);
      desc.ReadValue.mockRejectedValue(new Error('read failed'));
      desc.WriteValue.mockRejectedValue(new Error('write failed'));
      await expect(bindings.readValue(ID, '180d', '2a37', '2902')).rejects.toThrow('read failed');
      await expect(bindings.writeValue(ID, '180d', '2a37', '2902', Buffer.alloc(1))).rejects.toThrow('write failed');
    });
  });

  describe('unsupported operations', () => {
    test('readHandle rejects with NotSupportedError', async () => {
      const bindings = new DbusBindings();

      const error = await bindings.readHandle(ID, 0x42).catch(err => err);

      expect(error).toBeInstanceOf(NotSupportedError);
      expect(error.message).toMatch(/not supported/);
    });

    test('writeHandle rejects with NotSupportedError', async () => {
      const bindings = new DbusBindings();

      const error = await bindings.writeHandle(ID, 0x42, Buffer.alloc(1), false).catch(err => err);

      expect(error).toBeInstanceOf(NotSupportedError);
      expect(error.message).toMatch(/not supported/);
    });

    test('broadcast is not implemented', () => {
      expect((new DbusBindings() as any).broadcast).toBeUndefined();
    });
  });

  test('addressToId normalizes a MAC into a noble peripheral id', () => {
    const bindings = new DbusBindings();
    expect(bindings.addressToId('AA:BB:CC:DD:EE:FF')).toBe(ID);
  });

  describe('peripheral id normalization on public methods', () => {
    const variants = [
      ['canonical id', 'aabbccddeeff'],
      ['uppercase id', 'AABBCCDDEEFF'],
      ['mixed-case id', 'AaBbCcDdEeFf'],
      ['colon MAC uppercase', 'AA:BB:CC:DD:EE:FF'],
      ['colon MAC lowercase', 'aa:bb:cc:dd:ee:ff'],
      ['colon MAC mixed', 'Aa:Bb:Cc:Dd:Ee:Ff']
    ];

    test.each(variants)('discoverServices accepts %s', async (_label, input) => {
      resetState(gattTree());
      const { bindings } = await startBindings();

      await expect(bindings.discoverServices(input, [])).resolves.toEqual(['180d']);
    });

    test.each(variants)('read accepts %s', async (_label, input) => {
      resetState(gattTree());
      const { bindings } = await startBindings();

      await expect(bindings.read(input, '180d', '2a37')).resolves.toEqual(Buffer.from([0x01, 0x02]));
    });

    test.each(variants)('notify accepts %s and reports notifications under the canonical id', async (_label, input) => {
      resetState(gattTree());
      const { bindings, delegate } = await startBindings();

      await bindings.notify(input, '180d', '2a37', true);
      emitProps(charPath, GATT_CHAR, { Value: Buffer.from([0xaa]) });

      expect(delegate.onNotification.mock.calls[0][0]).toBe(ID);
    });

    test('null/undefined peripheral id does not throw', async () => {
      const bindings = new DbusBindings();
      await expect(bindings.discoverServices(undefined as any, [])).resolves.toEqual([]);
      await expect(bindings.discoverServices(null as any, [])).resolves.toEqual([]);
    });
  });
});
