const { EventEmitter } = require('events');

// ---- dbus-next mock ----
// Provides an in-memory BlueZ object tree we can mutate per-test.

class Variant {
  constructor (signature, value) {
    this.signature = signature;
    this.value = value;
  }
}

const mockState = {
  managedObjects: {},
  ifaceCalls: [],
  proxies: new Map(), // path -> proxy
  rootProxy: null,
  systemBusListeners: []
};
const state = mockState;

function v (signature, value) {
  return new Variant(signature, value);
}

// Wrap a plain props dict to look like dbus-next's variant-wrapped output
function wrapDict (obj) {
  const out = {};
  for (const [k, val] of Object.entries(obj)) {
    out[k] = val instanceof Variant ? val : v('v', val);
  }
  return out;
}

function makeIfaceEmitter (extras = {}) {
  const e = new EventEmitter();
  Object.assign(e, extras);
  return e;
}

function makeProxy (path) {
  if (state.proxies.has(path)) return state.proxies.get(path);

  const propsIface = makeIfaceEmitter();
  const interfaces = { 'org.freedesktop.DBus.Properties': propsIface };

  const ifacesAt = state.managedObjects[path] || {};
  for (const ifaceName of Object.keys(ifacesAt)) {
    if (interfaces[ifaceName]) continue;
    interfaces[ifaceName] = makeIfaceEmitter();
  }

  const recordedCall = (ifaceName, method) => (...args) => {
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
        const out = {};
        for (const [p, ifs] of Object.entries(state.managedObjects)) {
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
    getInterface: name => {
      if (!interfaces[name]) interfaces[name] = makeIfaceEmitter();
      return interfaces[name];
    }
  };
  state.proxies.set(path, proxy);
  if (path === '/') state.rootProxy = proxy;
  return proxy;
}

const mockBus = {
  getProxyObject: jest.fn().mockImplementation(async (_service, path) => makeProxy(path)),
  disconnect: jest.fn()
};

const mockDbus = {
  systemBus: jest.fn().mockReturnValue(mockBus),
  Variant
};

jest.mock('dbus-next', () => mockDbus, { virtual: true });

// ---- Tests ----

const DbusBindings = require('../../../lib/dbus/bindings');

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

async function flush () {
  // Allow microtasks (init promise chain) to settle.
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}

describe('dbus/bindings', () => {
  beforeEach(() => {
    resetState(adapterTree());
  });

  test('start() emits stateChange("poweredOn") and addressChange', async () => {
    const bindings = new DbusBindings();
    const states = [];
    const addresses = [];
    bindings.on('stateChange', s => states.push(s));
    bindings.on('addressChange', a => addresses.push(a));

    bindings.start();
    await flush();

    expect(states).toContain('poweredOn');
    expect(addresses).toContain('00:11:22:33:44:55');
  });

  test('emits stateChange("poweredOff") when adapter is unpowered', async () => {
    resetState(adapterTree({
      '/org/bluez/hci0': {
        'org.bluez.Adapter1': { Address: 'AA:BB:CC:DD:EE:FF', Powered: false }
      }
    }));
    const bindings = new DbusBindings();
    const states = [];
    bindings.on('stateChange', s => states.push(s));

    bindings.start();
    await flush();

    expect(states).toContain('poweredOff');
  });

  test('emits unsupported when no adapter is found', async () => {
    resetState({ '/org/bluez': { 'org.freedesktop.DBus.ObjectManager': {} } });
    const bindings = new DbusBindings();
    const states = [];
    const warnings = [];
    bindings.on('stateChange', s => states.push(s));
    bindings.on('warning', w => warnings.push(w));

    bindings.start();
    await flush();

    expect(states).toContain('unsupported');
    expect(warnings.some(w => /No BlueZ adapter/.test(w))).toBe(true);
  });

  test('startScanning calls SetDiscoveryFilter + StartDiscovery and emits scanStart', async () => {
    const bindings = new DbusBindings();
    const scanStarts = [];
    bindings.on('scanStart', () => scanStarts.push(true));

    bindings.start();
    await flush();

    bindings.startScanning(['180d'], false);
    await flush();

    const calls = state.ifaceCalls.filter(c => c.path === '/org/bluez/hci0');
    expect(calls.map(c => c.method)).toEqual(
      expect.arrayContaining(['SetDiscoveryFilter', 'StartDiscovery'])
    );
    expect(scanStarts.length).toBe(1);
  });

  test('stopScanning calls StopDiscovery and emits scanStop', async () => {
    const bindings = new DbusBindings();
    const scanStops = [];
    bindings.on('scanStop', () => scanStops.push(true));

    bindings.start();
    await flush();
    bindings.startScanning([], false);
    await flush();
    bindings.stopScanning();
    await flush();

    const stopCall = state.ifaceCalls.find(c => c.method === 'StopDiscovery');
    expect(stopCall).toBeDefined();
    expect(scanStops.length).toBe(1);
  });

  test('InterfacesAdded for a Device1 emits discover with parsed advertisement', async () => {
    const bindings = new DbusBindings();
    const discoveries = [];
    bindings.on('discover', (...args) => discoveries.push(args));

    bindings.start();
    await flush();

    const om = state.rootProxy.getInterface('org.freedesktop.DBus.ObjectManager');
    om.emit('InterfacesAdded', '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF', {
      'org.bluez.Device1': wrapDict({
        Address: 'AA:BB:CC:DD:EE:FF',
        AddressType: 'public',
        Name: 'Test Device',
        RSSI: -42,
        UUIDs: ['0000180d-0000-1000-8000-00805f9b34fb']
      })
    });
    await flush();

    expect(discoveries.length).toBe(1);
    const [id, address, addressType, connectable, advertisement, rssi] = discoveries[0];
    expect(id).toBe('aabbccddeeff');
    expect(address).toBe('AA:BB:CC:DD:EE:FF');
    expect(addressType).toBe('public');
    expect(connectable).toBe(true);
    expect(rssi).toBe(-42);
    expect(advertisement.localName).toBe('Test Device');
    expect(advertisement.serviceUuids).toEqual(['180d']);
  });

  test('InterfacesAdded unwraps Variant-wrapped ManufacturerData and ServiceData payloads', async () => {
    const bindings = new DbusBindings();
    const discoveries = [];
    bindings.on('discover', (...args) => discoveries.push(args));

    bindings.start();
    await flush();

    // BlueZ exposes ManufacturerData as a{qv} and ServiceData as a{sv}; dbus-next
    // surfaces each inner value as a Variant, not the raw bytes.
    const mfgPayload = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const svcPayload = Buffer.from([0x01, 0x02, 0x03]);

    const om = state.rootProxy.getInterface('org.freedesktop.DBus.ObjectManager');
    om.emit('InterfacesAdded', '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF', {
      'org.bluez.Device1': wrapDict({
        Address: 'AA:BB:CC:DD:EE:FF',
        AddressType: 'public',
        ManufacturerData: { 0x004c: v('ay', mfgPayload) },
        ServiceData: { '0000180d-0000-1000-8000-00805f9b34fb': v('ay', svcPayload) }
      })
    });
    await flush();

    expect(discoveries.length).toBe(1);
    const advertisement = discoveries[0][4];

    // Manufacturer: 2-byte little-endian company id (0x004c => Apple) + payload
    expect(Buffer.isBuffer(advertisement.manufacturerData)).toBe(true);
    expect(advertisement.manufacturerData.equals(
      Buffer.concat([Buffer.from([0x4c, 0x00]), mfgPayload])
    )).toBe(true);

    expect(advertisement.serviceData).toEqual([
      { uuid: '180d', data: svcPayload }
    ]);
  });

  test('discoverServices/Characteristics/Descriptors walk the cached object tree', async () => {
    const tree = adapterTree({
      '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF': {
        'org.bluez.Device1': { Address: 'AA:BB:CC:DD:EE:FF', AddressType: 'public', Connected: false }
      },
      '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF/service0001': {
        'org.bluez.GattService1': { UUID: '0000180d-0000-1000-8000-00805f9b34fb', Primary: true }
      },
      '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF/service0001/char0002': {
        'org.bluez.GattCharacteristic1': {
          UUID: '00002a37-0000-1000-8000-00805f9b34fb',
          Flags: ['read', 'notify']
        }
      },
      '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF/service0001/char0002/desc0003': {
        'org.bluez.GattDescriptor1': { UUID: '00002902-0000-1000-8000-00805f9b34fb' }
      }
    });
    resetState(tree);

    const bindings = new DbusBindings();
    bindings.start();
    await flush();

    const services = [];
    const chars = [];
    const descs = [];
    bindings.on('servicesDiscover', (...a) => services.push(a));
    bindings.on('characteristicsDiscover', (...a) => chars.push(a));
    bindings.on('descriptorsDiscover', (...a) => descs.push(a));

    bindings.discoverServices('aabbccddeeff', []);
    bindings.discoverCharacteristics('aabbccddeeff', '180d', []);
    bindings.discoverDescriptors('aabbccddeeff', '180d', '2a37');

    expect(services[0]).toEqual(['aabbccddeeff', ['180d']]);
    expect(chars[0][0]).toBe('aabbccddeeff');
    expect(chars[0][1]).toBe('180d');
    expect(chars[0][2]).toEqual([{ uuid: '2a37', properties: ['read', 'notify'] }]);
    expect(descs[0][0]).toBe('aabbccddeeff');
    expect(descs[0][3]).toEqual(['2902']);
  });

  test('read emits "read" with the characteristic value', async () => {
    const tree = adapterTree({
      '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF': {
        'org.bluez.Device1': { Address: 'AA:BB:CC:DD:EE:FF', AddressType: 'public' }
      },
      '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF/service0001': {
        'org.bluez.GattService1': { UUID: '0000180d-0000-1000-8000-00805f9b34fb' }
      },
      '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF/service0001/char0002': {
        'org.bluez.GattCharacteristic1': {
          UUID: '00002a37-0000-1000-8000-00805f9b34fb',
          Flags: ['read']
        }
      }
    });
    resetState(tree);

    const bindings = new DbusBindings();
    bindings.start();
    await flush();

    const reads = [];
    bindings.on('read', (...a) => reads.push(a));

    bindings.read('aabbccddeeff', '180d', '2a37');
    await flush();

    expect(reads.length).toBe(1);
    expect(reads[0][0]).toBe('aabbccddeeff');
    expect(reads[0][1]).toBe('180d');
    expect(reads[0][2]).toBe('2a37');
    expect(Buffer.isBuffer(reads[0][3])).toBe(true);
    expect(reads[0][4]).toBe(false); // not a notification
  });

  test('notify(true) calls StartNotify and forwards value updates as notifications', async () => {
    const charPath = '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF/service0001/char0002';
    const tree = adapterTree({
      '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF': {
        'org.bluez.Device1': { Address: 'AA:BB:CC:DD:EE:FF', AddressType: 'public' }
      },
      '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF/service0001': {
        'org.bluez.GattService1': { UUID: '0000180d-0000-1000-8000-00805f9b34fb' }
      },
      [charPath]: {
        'org.bluez.GattCharacteristic1': {
          UUID: '00002a37-0000-1000-8000-00805f9b34fb',
          Flags: ['notify']
        }
      }
    });
    resetState(tree);

    const bindings = new DbusBindings();
    bindings.start();
    await flush();

    const notifies = [];
    const reads = [];
    bindings.on('notify', (...a) => notifies.push(a));
    bindings.on('read', (...a) => reads.push(a));

    bindings.notify('aabbccddeeff', '180d', '2a37', true);
    await flush();

    const proxy = state.proxies.get(charPath);
    expect(proxy.interfaces['org.bluez.GattCharacteristic1'].StartNotify).toHaveBeenCalled();
    expect(notifies[0]).toEqual(['aabbccddeeff', '180d', '2a37', true]);

    // Simulate BlueZ pushing a notification
    proxy.interfaces['org.freedesktop.DBus.Properties'].emit(
      'PropertiesChanged',
      'org.bluez.GattCharacteristic1',
      wrapDict({ Value: Buffer.from([0xaa]) }),
      []
    );

    expect(reads.length).toBe(1);
    expect(reads[0][4]).toBe(true); // isNotification
    expect(reads[0][3].equals(Buffer.from([0xaa]))).toBe(true);
  });

  test('readHandle is unsupported and emits an error', () => {
    const bindings = new DbusBindings();
    const events = [];
    bindings.on('handleRead', (...a) => events.push(a));
    bindings.readHandle('aabbccddeeff', 0x42);
    expect(events.length).toBe(1);
    expect(events[0][3]).toBeInstanceOf(Error);
    expect(events[0][3].message).toMatch(/not supported/);
  });

  test('addressToId normalizes a MAC into a noble peripheral id', () => {
    const bindings = new DbusBindings();
    expect(bindings.addressToId('AA:BB:CC:DD:EE:FF')).toBe('aabbccddeeff');
  });

  describe('peripheral id normalization on public methods', () => {
    const tree = () => adapterTree({
      '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF': {
        'org.bluez.Device1': { Address: 'AA:BB:CC:DD:EE:FF', AddressType: 'public', Connected: false }
      },
      '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF/service0001': {
        'org.bluez.GattService1': { UUID: '0000180d-0000-1000-8000-00805f9b34fb', Primary: true }
      },
      '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF/service0001/char0002': {
        'org.bluez.GattCharacteristic1': {
          UUID: '00002a37-0000-1000-8000-00805f9b34fb',
          Flags: ['read', 'notify']
        }
      }
    });

    const variants = [
      ['canonical id', 'aabbccddeeff'],
      ['uppercase id', 'AABBCCDDEEFF'],
      ['mixed-case id', 'AaBbCcDdEeFf'],
      ['colon MAC uppercase', 'AA:BB:CC:DD:EE:FF'],
      ['colon MAC lowercase', 'aa:bb:cc:dd:ee:ff'],
      ['colon MAC mixed', 'Aa:Bb:Cc:Dd:Ee:Ff']
    ];

    test.each(variants)('discoverServices accepts %s and emits canonical id', async (_label, input) => {
      resetState(tree());
      const bindings = new DbusBindings();
      bindings.start();
      await flush();

      const services = [];
      bindings.on('servicesDiscover', (...a) => services.push(a));

      bindings.discoverServices(input, []);

      expect(services[0]).toEqual(['aabbccddeeff', ['180d']]);
    });

    test.each(variants)('read accepts %s and emits canonical id', async (_label, input) => {
      resetState(tree());
      const bindings = new DbusBindings();
      bindings.start();
      await flush();

      const reads = [];
      bindings.on('read', (...a) => reads.push(a));

      bindings.read(input, '180d', '2a37');
      await flush();

      expect(reads.length).toBe(1);
      expect(reads[0][0]).toBe('aabbccddeeff');
    });

    test.each(variants)('readHandle (unsupported) emits canonical id for %s', (_label, input) => {
      resetState(tree());
      const bindings = new DbusBindings();
      const events = [];
      bindings.on('handleRead', (...a) => events.push(a));
      bindings.readHandle(input, 0x42);
      expect(events[0][0]).toBe('aabbccddeeff');
    });

    test('null/undefined peripheralUuid does not throw', () => {
      const bindings = new DbusBindings();
      expect(() => bindings.discoverServices(undefined, [])).not.toThrow();
      expect(() => bindings.discoverServices(null, [])).not.toThrow();
    });
  });

  describe('scan service-uuid filtering (software-side)', () => {
    function emitDevice (deviceProps) {
      const om = state.rootProxy.getInterface('org.freedesktop.DBus.ObjectManager');
      om.emit('InterfacesAdded', '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF', {
        'org.bluez.Device1': wrapDict({ Address: 'AA:BB:CC:DD:EE:FF', AddressType: 'public', ...deviceProps })
      });
    }

    test('does not push a UUIDs filter to BlueZ SetDiscoveryFilter', async () => {
      const bindings = new DbusBindings();
      bindings.start();
      await flush();

      bindings.startScanning(['180d'], false);
      await flush();

      const setFilter = state.ifaceCalls.find(c => c.method === 'SetDiscoveryFilter');
      expect(setFilter).toBeDefined();
      expect('UUIDs' in setFilter.args[0]).toBe(false);
    });

    test('discovers a device that advertises the UUID only in service data', async () => {
      const bindings = new DbusBindings();
      const discoveries = [];
      bindings.on('discover', (...args) => discoveries.push(args));

      bindings.start();
      await flush();
      bindings.startScanning(['180d'], false);
      await flush();

      emitDevice({
        ServiceData: { '0000180d-0000-1000-8000-00805f9b34fb': v('ay', Buffer.from([0x01])) }
      });
      await flush();

      expect(discoveries.length).toBe(1);
      expect(discoveries[0][0]).toBe('aabbccddeeff');
    });

    test('filters out a device that matches neither service UUIDs nor service data', async () => {
      const bindings = new DbusBindings();
      const discoveries = [];
      bindings.on('discover', (...args) => discoveries.push(args));

      bindings.start();
      await flush();
      bindings.startScanning(['180d'], false);
      await flush();

      emitDevice({
        UUIDs: ['0000feaa-0000-1000-8000-00805f9b34fb'],
        ServiceData: { '0000feaa-0000-1000-8000-00805f9b34fb': v('ay', Buffer.from([0x01])) }
      });
      await flush();

      expect(discoveries.length).toBe(0);
    });

    test('empty scan filter discovers everything', async () => {
      const bindings = new DbusBindings();
      const discoveries = [];
      bindings.on('discover', (...args) => discoveries.push(args));

      bindings.start();
      await flush();
      bindings.startScanning([], false);
      await flush();

      emitDevice({ UUIDs: ['0000feaa-0000-1000-8000-00805f9b34fb'] });
      await flush();

      expect(discoveries.length).toBe(1);
    });
  });

  describe('connect failure recovery', () => {
    const devicePath = '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF';

    function seedDevice () {
      resetState(adapterTree({
        [devicePath]: {
          'org.bluez.Device1': { Address: 'AA:BB:CC:DD:EE:FF', AddressType: 'public', Connected: false }
        }
      }));
    }

    test('failed Connect emits connect(error), no disconnect, and clears the proxy', async () => {
      seedDevice();
      const proxy = makeProxy(devicePath);
      proxy.getInterface('org.bluez.Device1').Connect = () => Promise.reject(new Error('le-connection-abort-by-local'));

      const bindings = new DbusBindings();
      const connects = [];
      const disconnects = [];
      bindings.on('connect', (id, err) => connects.push([id, err]));
      bindings.on('disconnect', (id, reason) => disconnects.push([id, reason]));

      bindings.start();
      await flush();
      bindings.connect('aabbccddeeff');
      await flush();

      expect(connects.length).toBe(1);
      expect(connects[0][0]).toBe('aabbccddeeff');
      expect(connects[0][1]).toBeInstanceOf(Error);

      // Matches hci-socket: a failed attempt emits no 'disconnect'.
      expect(disconnects.length).toBe(0);

      // Proxy/listener released so a retry starts clean.
      expect(bindings._devices.get('aabbccddeeff').proxy).toBeNull();
    });

    test('a remote drop mid-connect surfaces as connect(error), not disconnect', async () => {
      seedDevice();
      const proxy = makeProxy(devicePath);

      const bindings = new DbusBindings();
      const events = [];
      bindings.on('connect', (id, err) => events.push(['connect', id, err]));
      bindings.on('disconnect', (id, reason) => events.push(['disconnect', id, reason]));

      bindings.start();
      await flush();
      bindings.connect('aabbccddeeff');
      await flush();

      const props = proxy.getInterface('org.freedesktop.DBus.Properties');
      props.emit('PropertiesChanged', 'org.bluez.Device1', wrapDict({ Connected: false }));
      await flush();

      expect(events.length).toBe(1);
      expect(events[0][0]).toBe('connect');
      expect(events[0][2]).toBeInstanceOf(Error);
    });

    test('remote drop while Connect() is in flight surfaces as connect(err), not an unhandled rejection (#91)', async () => {
      seedDevice();
      const proxy = makeProxy(devicePath);
      // Keep Connect() pending so the drop lands while _connect is still
      // awaiting the D-Bus call — the unhandled-rejection window from #91.
      const device1 = proxy.getInterface('org.bluez.Device1');
      device1.Connect = jest.fn().mockReturnValue(new Promise(() => {}));

      const unhandled = [];
      const onUnhandled = err => unhandled.push(err);
      process.on('unhandledRejection', onUnhandled);
      try {
        const bindings = new DbusBindings();
        const connects = [];
        bindings.on('connect', (...a) => connects.push(a));

        bindings.start();
        await flush();
        bindings.connect('aabbccddeeff');
        await flush();
        expect(device1.Connect).toHaveBeenCalled();

        const props = proxy.getInterface('org.freedesktop.DBus.Properties');
        props.emit('PropertiesChanged', 'org.bluez.Device1', wrapDict({ Connected: false }));
        await flush();

        expect(connects.length).toBe(1);
        expect(connects[0][0]).toBe('aabbccddeeff');
        expect(connects[0][1]).toBeInstanceOf(Error);
        expect(connects[0][1].message).toMatch(/disconnected: remote/);
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });

    test('an established connection that drops emits a single disconnect', async () => {
      resetState(adapterTree({
        [devicePath]: {
          'org.bluez.Device1': {
            Address: 'AA:BB:CC:DD:EE:FF', AddressType: 'public', Connected: true, ServicesResolved: true
          }
        }
      }));
      const proxy = makeProxy(devicePath);

      const bindings = new DbusBindings();
      const connects = [];
      const disconnects = [];
      bindings.on('connect', (id, err) => connects.push([id, err]));
      bindings.on('disconnect', (id, reason) => disconnects.push([id, reason]));

      bindings.start();
      await flush();
      bindings.connect('aabbccddeeff');
      await flush();
      expect(connects.length).toBe(1);
      expect(connects[0][1]).toBeNull();

      const props = proxy.getInterface('org.freedesktop.DBus.Properties');
      props.emit('PropertiesChanged', 'org.bluez.Device1', wrapDict({ Connected: false }));
      await flush();

      expect(disconnects.length).toBe(1);
      expect(disconnects[0][0]).toBe('aabbccddeeff');
    });
  });

  describe('discovery is paused while connecting', () => {
    const devicePath = '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF';
    const otherPath = '/org/bluez/hci0/dev_11_22_33_44_55_66';

    function seedDevices () {
      resetState(adapterTree({
        [devicePath]: {
          'org.bluez.Device1': { Address: 'AA:BB:CC:DD:EE:FF', AddressType: 'public', Connected: false }
        },
        [otherPath]: {
          'org.bluez.Device1': { Address: '11:22:33:44:55:66', AddressType: 'public', Connected: false }
        }
      }));
    }

    const adapterMethods = () => state.ifaceCalls
      .filter(c => c.iface === 'org.bluez.Adapter1')
      .map(c => c.method);

    async function startScanning (bindings) {
      bindings.start();
      await flush();
      bindings.startScanning([], false);
      await flush();
      state.ifaceCalls.length = 0;
    }

    // Resolves the connect the way BlueZ does: Connected + ServicesResolved.
    function completeConnect (path) {
      makeProxy(path)
        .getInterface('org.freedesktop.DBus.Properties')
        .emit('PropertiesChanged', 'org.bluez.Device1', wrapDict({ Connected: true, ServicesResolved: true }));
    }

    test('stops discovery before Connect and restarts it once the attempt succeeds', async () => {
      seedDevices();
      const bindings = new DbusBindings();
      await startScanning(bindings);

      bindings.connect('aabbccddeeff');
      await flush();

      expect(adapterMethods()).toEqual(['StopDiscovery']);

      completeConnect(devicePath);
      await flush();

      expect(adapterMethods()).toEqual(['StopDiscovery', 'StartDiscovery']);
      expect(bindings._isScanning).toBe(true);
    });

    test('restarts discovery when the attempt fails', async () => {
      seedDevices();
      makeProxy(devicePath).getInterface('org.bluez.Device1').Connect =
        () => Promise.reject(new Error('le-connection-abort-by-local'));

      const bindings = new DbusBindings();
      const connects = [];
      bindings.on('connect', (id, err) => connects.push([id, err]));
      await startScanning(bindings);

      bindings.connect('aabbccddeeff');
      await flush();

      expect(connects[0][1]).toBeInstanceOf(Error);
      expect(adapterMethods()).toEqual(['StopDiscovery', 'StartDiscovery']);
    });

    test('does not touch discovery when no scan is running', async () => {
      seedDevices();
      const bindings = new DbusBindings();
      bindings.start();
      await flush();
      state.ifaceCalls.length = 0;

      bindings.connect('aabbccddeeff');
      await flush();
      completeConnect(devicePath);
      await flush();

      expect(adapterMethods()).toEqual([]);
    });

    test('parallel connects stop discovery once and restart it after the last one', async () => {
      seedDevices();
      const bindings = new DbusBindings();
      await startScanning(bindings);

      bindings.connect('aabbccddeeff');
      bindings.connect('112233445566');
      await flush();

      expect(adapterMethods()).toEqual(['StopDiscovery']);

      completeConnect(devicePath);
      await flush();
      expect(adapterMethods()).toEqual(['StopDiscovery']);

      completeConnect(otherPath);
      await flush();
      expect(adapterMethods()).toEqual(['StopDiscovery', 'StartDiscovery']);
    });

    test('an explicit stopScanning during a connect wins over the resume', async () => {
      seedDevices();
      const bindings = new DbusBindings();
      await startScanning(bindings);

      bindings.connect('aabbccddeeff');
      await flush();
      expect(adapterMethods()).toEqual(['StopDiscovery']);

      bindings.stopScanning();
      await flush();
      completeConnect(devicePath);
      await flush();

      // No second StopDiscovery (already paused) and no resume of a scan the caller ended.
      expect(adapterMethods()).toEqual(['StopDiscovery']);
      expect(bindings._isScanning).toBe(false);
    });

    test('a first scan started during a connect still reaches BlueZ once the connect ends', async () => {
      seedDevices();
      const bindings = new DbusBindings();
      bindings.start();
      await flush();
      state.ifaceCalls.length = 0;

      // Connect while no scan is running, so nothing is paused.
      bindings.connect('aabbccddeeff');
      await flush();
      expect(adapterMethods()).toEqual([]);

      bindings.startScanning([], false);
      await flush();
      expect(adapterMethods()).toEqual(['SetDiscoveryFilter']);
      expect(bindings._isScanning).toBe(true);

      completeConnect(devicePath);
      await flush();

      // Without the deferral the scan would be reported as running but never started.
      expect(adapterMethods()).toEqual(['SetDiscoveryFilter', 'StartDiscovery']);
    });

    test('a startScanning during a connect defers StartDiscovery to the resume', async () => {
      seedDevices();
      const bindings = new DbusBindings();
      await startScanning(bindings);

      bindings.connect('aabbccddeeff');
      await flush();
      bindings.stopScanning();
      await flush();
      bindings.startScanning([], false);
      await flush();

      expect(adapterMethods()).toEqual(['StopDiscovery', 'SetDiscoveryFilter']);
      expect(bindings._isScanning).toBe(true);

      completeConnect(devicePath);
      await flush();

      expect(adapterMethods()).toEqual(['StopDiscovery', 'SetDiscoveryFilter', 'StartDiscovery']);
    });
  });

  describe('late-arriving advertisement data during scan', () => {
    const devicePath = '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF';

    test('a UUID that arrives in a later PropertiesChanged still triggers discover', async () => {
      const bindings = new DbusBindings();
      const discoveries = [];
      bindings.on('discover', (...args) => discoveries.push(args));

      bindings.start();
      await flush();
      bindings.startScanning(['180d'], false);
      await flush();

      // First sighting has no matching UUID -> tracked, not discovered.
      const om = state.rootProxy.getInterface('org.freedesktop.DBus.ObjectManager');
      om.emit('InterfacesAdded', devicePath, {
        'org.bluez.Device1': wrapDict({ Address: 'AA:BB:CC:DD:EE:FF', AddressType: 'public', RSSI: -50 })
      });
      await flush();
      expect(discoveries.length).toBe(0);

      // BlueZ later aggregates the matching service data -> now discovered.
      const props = makeProxy(devicePath).getInterface('org.freedesktop.DBus.Properties');
      props.emit('PropertiesChanged', 'org.bluez.Device1', wrapDict({
        ServiceData: { '0000180d-0000-1000-8000-00805f9b34fb': v('ay', Buffer.from([0x01])) }
      }));
      await flush();

      expect(discoveries.length).toBe(1);
      expect(discoveries[0][0]).toBe('aabbccddeeff');
    });

    test('a watcher suspended on getProxyObject across stopScanning does not re-attach', async () => {
      const bindings = new DbusBindings();
      bindings.start();
      await flush();
      bindings.startScanning([], false);
      await flush();

      // Park the watcher on getProxyObject, and keep _stopScanning suspended on
      // StopDiscovery, so the watcher resumes mid-stop — the F1 race window.
      let releaseWatch;
      const watchGate = new Promise(resolve => { releaseWatch = resolve; });
      mockBus.getProxyObject.mockImplementationOnce(async (_svc, path) => {
        await watchGate;
        return makeProxy(path);
      });
      let releaseStop;
      const stopGate = new Promise(resolve => { releaseStop = resolve; });
      makeProxy('/org/bluez/hci0').getInterface('org.bluez.Adapter1').StopDiscovery = () => stopGate;

      const om = state.rootProxy.getInterface('org.freedesktop.DBus.ObjectManager');
      om.emit('InterfacesAdded', devicePath, {
        'org.bluez.Device1': wrapDict({ Address: 'AA:BB:CC:DD:EE:FF', AddressType: 'public' })
      });
      await flush(); // _watchDeviceProps parked on watchGate

      bindings.stopScanning(); // _stopScanning parked on StopDiscovery
      await flush();

      releaseWatch(); // watcher resumes while stop is still in flight
      await flush();

      releaseStop();
      await flush();

      expect(bindings._scanPropsListeners.size).toBe(0);
    });

    test('scan-time watchers are detached on stopScanning', async () => {
      const bindings = new DbusBindings();
      bindings.start();
      await flush();
      bindings.startScanning([], false);
      await flush();

      const om = state.rootProxy.getInterface('org.freedesktop.DBus.ObjectManager');
      om.emit('InterfacesAdded', devicePath, {
        'org.bluez.Device1': wrapDict({ Address: 'AA:BB:CC:DD:EE:FF', AddressType: 'public' })
      });
      await flush();
      expect(bindings._scanPropsListeners.size).toBe(1);

      bindings.stopScanning();
      await flush();
      expect(bindings._scanPropsListeners.size).toBe(0);
    });
  });
});
