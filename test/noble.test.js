const Noble = require('../lib/noble');
const Peripheral = require('../lib/peripheral');
const Service = require('../lib/service');
const Characteristic = require('../lib/characteristic');
const Descriptor = require('../lib/descriptor');

describe('noble', () => {
  /**
   * @type {Noble & import('events').EventEmitter}
   */
  let noble;
  let mockBindings;

  beforeEach(() => {
    mockBindings = {
      start: jest.fn(),
      on: jest.fn(),
      startScanning: jest.fn(),
      stopScanning: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      updateRssi: jest.fn(),
      discoverServices: jest.fn(),
      discoverIncludedServices: jest.fn(),
      discoverCharacteristics: jest.fn(),
      read: jest.fn(),
      write: jest.fn(),
      broadcast: jest.fn(),
      notify: jest.fn(),
      discoverDescriptors: jest.fn(),
      readValue: jest.fn(),
      writeValue: jest.fn(),
      readHandle: jest.fn(),
      writeHandle: jest.fn(),
      reset: jest.fn(),
      setScanParameters: jest.fn(),
      cancelConnect: jest.fn(),
      addressToId: jest.fn()
    };

    noble = new Noble(mockBindings);
    noble.removeAllListeners('warning');
    noble._peripherals = new Map();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('startScanning', () => {
  
    test('should delegate to binding', () => {
      const expectedServiceUuids = [1, 2, 3];
      const expectedAllowDuplicates = true;

      noble.startScanning(expectedServiceUuids, expectedAllowDuplicates);
      noble.emit('stateChange', 'poweredOn');
      // Check for single callback
      noble.emit('stateChange', 'poweredOn');
      noble.emit('scanStart');
      // Check for single callback
      noble.emit('scanStart');

      expect(mockBindings.startScanning).toHaveBeenCalledWith(
        expectedServiceUuids,
        expectedAllowDuplicates
      );
      expect(mockBindings.startScanning).toHaveBeenCalledTimes(1);
    });

    test('should delegate to callback', async () => {
      const expectedServiceUuids = [1, 2, 3];
      const expectedAllowDuplicates = true;
      const callback = jest.fn();

      noble.startScanning(
        expectedServiceUuids,
        expectedAllowDuplicates,
        callback
      );
      noble.emit('stateChange', 'poweredOn');
      // Check for single callback
      noble.emit('stateChange', 'poweredOn');
      noble.emit('scanStart');
      // Check for single callback
      noble.emit('scanStart');

      expect(callback).toHaveBeenCalledWith(null, undefined);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockBindings.startScanning).toHaveBeenCalledWith(
        expectedServiceUuids,
        expectedAllowDuplicates
      );
      expect(mockBindings.startScanning).toHaveBeenCalledTimes(1);
    });

    test('should delegate to callback, already initialized', async () => {
      noble._initialized = true;
      noble._state = 'poweredOn';

      noble.startScanning();

      expect(mockBindings.startScanning).toHaveBeenCalledWith(
        undefined,
        undefined
      );
      expect(mockBindings.startScanning).toHaveBeenCalledTimes(1);
    });

    test('should delegate to callback with filter', async () => {
      const expectedServiceUuids = [1, 2, 3];
      const expectedAllowDuplicates = true;
      const callback = jest.fn();

      noble.startScanning(
        expectedServiceUuids,
        expectedAllowDuplicates,
        callback
      );
      noble.emit('stateChange', 'poweredOn');
      // Check for single callback
      noble.emit('stateChange', 'poweredOn');
      noble.emit('scanStart', 'filter');

      expect(callback).toHaveBeenCalledWith(null, 'filter');
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockBindings.startScanning).toHaveBeenCalledWith(
        expectedServiceUuids,
        expectedAllowDuplicates
      );
      expect(mockBindings.startScanning).toHaveBeenCalledTimes(1);
    });

    test('should throw an error if not powered on', async () => {
      expect(() => {
        noble.startScanning();
        noble.emit('stateChange', 'poweredOff');
        // Check for single callback
        noble.emit('stateChange', 'poweredOff');
        noble.emit('scanStart');
        // Check for single callback
        noble.emit('scanStart');
      }).toThrow('Could not start scanning, state is poweredOff (not poweredOn)');
      
      expect(mockBindings.startScanning).not.toHaveBeenCalled();
    });
  });

  describe('startScanningAsync', () => {
    test('should delegate to binding', async () => {
      const expectedServiceUuids = [1, 2, 3];
      const expectedAllowDuplicates = true;

      const promise = noble.startScanningAsync(
        expectedServiceUuids,
        expectedAllowDuplicates
      );
      noble.emit('stateChange', 'poweredOn');
      // Check for single callback
      noble.emit('stateChange', 'poweredOn');
      noble.emit('scanStart');
      // Check for single callback
      noble.emit('scanStart');

      await expect(promise).resolves.toBeUndefined();
      expect(mockBindings.startScanning).toHaveBeenCalledWith(
        expectedServiceUuids,
        expectedAllowDuplicates
      );
      expect(mockBindings.startScanning).toHaveBeenCalledTimes(1);
    });

    test('should throw an error if not powered on', async () => {
      const promise = noble.startScanningAsync();
      noble.emit('stateChange', 'poweredOff');
      // Check for single callback
      noble.emit('stateChange', 'poweredOff');
      noble.emit('scanStart');
      // Check for single callback
      noble.emit('scanStart');

      await expect(promise).rejects.toThrow(
        'Could not start scanning, state is poweredOff (not poweredOn)'
      );
      expect(mockBindings.startScanning).not.toHaveBeenCalled();
    });
  });

  describe('stopScanning', () => {
    test('should no callback', async () => {
      noble._initialized = true;
      noble.stopScanning();
      expect(mockBindings.stopScanning).toHaveBeenCalled();
      expect(mockBindings.stopScanning).toHaveBeenCalledTimes(1);
    });
  });

  describe('stopScanningAsync', () => {
    test('should not delegate to binding (not initialized)', async () => {
      const promise = noble.stopScanningAsync();
      noble.emit('scanStop');

      await expect(promise).rejects.toThrow('Bindings are not initialized');
      expect(mockBindings.stopScanning).not.toHaveBeenCalled();
    });

    test('should delegate to binding (initilazed)', async () => {
      noble._initialized = true;
      const promise = noble.stopScanningAsync();
      noble.emit('scanStop');

      await expect(promise).resolves.toBeUndefined();
      expect(mockBindings.stopScanning).toHaveBeenCalled();
      expect(mockBindings.stopScanning).toHaveBeenCalledTimes(1);
    });
  });

  describe('connect', () => {
    test('should delegate to binding', () => {
      const peripheralUuid = 'peripheral-uuid';
      const parameters = {};

      mockBindings.addressToId = jest.fn().mockReturnValue(peripheralUuid);
      noble.connect(peripheralUuid, parameters);
      
      expect(mockBindings.connect).toHaveBeenCalledWith(
        peripheralUuid,
        parameters
      );
      expect(mockBindings.connect).toHaveBeenCalledTimes(1);
    });
  });

  describe('onConnect', () => {
    test('should emit connected on existing peripheral', () => {
      const emit = jest.fn();
      noble._peripherals.set('uuid', { emit });

      const warningCallback = jest.fn();

      noble.on('warning', warningCallback);
      noble._onConnect('uuid', false);

      expect(emit).toHaveBeenCalledWith('connect', false);
      expect(emit).toHaveBeenCalledTimes(1);
      expect(warningCallback).not.toHaveBeenCalled();

      const peripheral = noble._peripherals.get('uuid');
      expect(peripheral).toHaveProperty('emit', emit);
      expect(peripheral).toHaveProperty('state', 'connected');
    });

    test('should emit error on existing peripheral', () => {
      const emit = jest.fn();
      noble._peripherals.set('uuid', { emit });

      const warningCallback = jest.fn();

      noble.on('warning', warningCallback);
      noble._onConnect('uuid', true);

      expect(emit).toHaveBeenCalledWith('connect', true);
      expect(emit).toHaveBeenCalledTimes(1);
      expect(warningCallback).not.toHaveBeenCalled();

      const peripheral = noble._peripherals.get('uuid');
      expect(peripheral).toHaveProperty('emit', emit);
      expect(peripheral).toHaveProperty('state', 'error');
    });

    test('should emit warning on missing peripheral', () => {
      const warningCallback = jest.fn();

      noble.on('warning', warningCallback);
      noble._onConnect('uuid', true);

      expect(warningCallback).toHaveBeenCalledWith('unknown peripheral uuid connected!');
      expect(warningCallback).toHaveBeenCalledTimes(1);
      expect(noble._peripherals.size).toBe(0);
    });
  });

  describe('setScanParameters', () => {
    test('should delegate to binding', async () => {
      const interval = 'interval';
      const window = 'window';

      noble.setScanParameters(interval, window);
      noble.emit('scanParametersSet');

      expect(mockBindings.setScanParameters).toHaveBeenCalledWith(
        interval,
        window
      );
      expect(mockBindings.setScanParameters).toHaveBeenCalledTimes(1);
    });

    test('should delegate to callback too', async () => {
      const interval = 'interval';
      const window = 'window';
      const callback = jest.fn();

      noble.setScanParameters(interval, window, callback);
      noble.emit('scanParametersSet');
      // Check for single callback
      noble.emit('scanParametersSet');

      expect(mockBindings.setScanParameters).toHaveBeenCalledWith(
        interval,
        window
      );
      expect(mockBindings.setScanParameters).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancelConnect', () => {
    test('should delegate to binding', () => {
      const peripheralUuid = 'peripheral-uuid';
      const parameters = {};

      mockBindings.addressToId = jest.fn().mockReturnValue(peripheralUuid);
      noble.cancelConnect(peripheralUuid, parameters);

      expect(mockBindings.cancelConnect).toHaveBeenCalledWith(
        peripheralUuid,
        parameters
      );
      expect(mockBindings.cancelConnect).toHaveBeenCalledTimes(1);
    });
  });

  test('should emit state', () => {
    const callback = jest.fn();
    noble.on('stateChange', callback);

    const state = 'newState';
    noble._onStateChange(state);

    expect(noble.state).toBe(state);
    expect(callback).toHaveBeenCalledWith(state);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  test('should change address', () => {
    const address = 'newAddress';
    noble._onAddressChange(address);

    expect(noble.address).toBe(address);
  });

  test('should emit scanParametersSet event', () => {
    const callback = jest.fn();
    noble.on('scanParametersSet', callback);

    noble._onScanParametersSet();

    expect(callback).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  test('should emit scanStart event', () => {
    const callback = jest.fn();
    noble.on('scanStart', callback);

    noble._onScanStart('filterDuplicates');

    expect(callback).toHaveBeenCalledWith('filterDuplicates');
    expect(callback).toHaveBeenCalledTimes(1);
  });

  test('should emit scanStop event', () => {
    const callback = jest.fn();
    noble.on('scanStop', callback);

    noble._onScanStop();

    expect(callback).toHaveBeenCalled();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  describe('reset', () => {
    test('should reset', () => {
      noble.reset();
      expect(mockBindings.reset).toHaveBeenCalled();
      expect(mockBindings.reset).toHaveBeenCalledTimes(1);
    });
  });

  describe('disconnect', () => {
    test('should disconnect', () => {
      noble.disconnect('peripheralUuid');
      expect(mockBindings.disconnect).toHaveBeenCalledWith('peripheralUuid');
      expect(mockBindings.disconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('onDisconnect', () => {
    test('should emit disconnect on existing peripheral', () => {
      const emit = jest.fn();
      noble._peripherals.set('uuid', { emit });

      const warningCallback = jest.fn();

      noble.on('warning', warningCallback);
      noble._onDisconnect('uuid', false);

      expect(emit).toHaveBeenCalledWith('disconnect', false);
      expect(emit).toHaveBeenCalledTimes(1);
      expect(warningCallback).not.toHaveBeenCalled();

      const peripheral = noble._peripherals.get('uuid');
      expect(peripheral).toHaveProperty('emit', emit);
      expect(peripheral).toHaveProperty('state', 'disconnected');
    });

    test('should emit warning on missing peripheral', () => {
      const warningCallback = jest.fn();

      noble.on('warning', warningCallback);
      noble._onDisconnect('uuid', true);

      expect(warningCallback).toHaveBeenCalledWith('unknown peripheral uuid disconnected!');
      expect(warningCallback).toHaveBeenCalledTimes(1);
      expect(noble._peripherals.size).toBe(0);
    });
  });

  describe('onDiscover', () => {
    test('should add new peripheral', () => {
      const uuid = 'uuid';
      const address = 'address';
      const addressType = 'addressType';
      const connectable = 'connectable';
      const advertisement = [];
      const rssi = 'rssi';

      const eventCallback = jest.fn();
      noble.on('discover', eventCallback);

      noble._onDiscover(
        uuid,
        address,
        addressType,
        connectable,
        advertisement,
        rssi
      );

      // Check new peripheral
      expect(noble._peripherals.has(uuid)).toBe(true);
      expect(noble._discoveredPeripherals.has(uuid)).toBe(true);

      const peripheral = noble._peripherals.get(uuid);
      expect(peripheral._noble).toBe(noble);
      expect(peripheral.id).toBe(uuid);
      expect(peripheral.address).toBe(address);
      expect(peripheral.addressType).toBe(addressType);
      expect(peripheral.connectable).toBe(connectable);
      expect(peripheral.advertisement).toBe(advertisement);
      expect(peripheral.rssi).toBe(rssi);

      expect(noble._services[uuid]).toEqual({});
      expect(noble._characteristics[uuid]).toEqual({});
      expect(noble._descriptors[uuid]).toEqual({});

      expect(eventCallback).toHaveBeenCalledWith(peripheral);
      expect(eventCallback).toHaveBeenCalledTimes(1);
    });

    test('should update existing peripheral', () => {
      const uuid = 'uuid';
      const address = 'address';
      const addressType = 'addressType';
      const connectable = 'connectable';
      const advertisement = [undefined, 'adv2', 'adv3'];
      const rssi = 'rssi';

      // init peripheral
      noble._peripherals.set(uuid, new Peripheral(
        noble,
        uuid,
        'originalAddress',
        'originalAddressType',
        'originalConnectable',
        ['adv1'],
        'originalRssi'
      ));

      const eventCallback = jest.fn();
      noble.on('discover', eventCallback);

      noble._onDiscover(
        uuid,
        address,
        addressType,
        connectable,
        advertisement,
        rssi
      );

      // Check updated peripheral
      expect(noble._peripherals.has(uuid)).toBe(true);
      expect(noble._discoveredPeripherals.has(uuid)).toBe(true);

      const peripheral = noble._peripherals.get(uuid);
      expect(peripheral._noble).toBe(noble);
      expect(peripheral.id).toBe(uuid);
      expect(peripheral.address).toBe('originalAddress');
      expect(peripheral.addressType).toBe('originalAddressType');
      expect(peripheral.connectable).toBe(connectable);
      expect(peripheral.advertisement).toEqual(['adv1', 'adv2', 'adv3']);
      expect(peripheral.rssi).toBe(rssi);

      expect(Object.keys(noble._services)).toHaveLength(0);
      expect(Object.keys(noble._characteristics)).toHaveLength(0);
      expect(Object.keys(noble._descriptors)).toHaveLength(0);

      expect(eventCallback).toHaveBeenCalledWith(peripheral);
      expect(eventCallback).toHaveBeenCalledTimes(1);
    });

    test('should emit on duplicate', () => {
      const uuid = 'uuid';
      const address = 'address';
      const addressType = 'addressType';
      const connectable = 'connectable';
      const advertisement = ['adv1', 'adv2', 'adv3'];
      const rssi = 'rssi';

      // register peripheral
      noble._discoveredPeripherals.add(uuid);
      noble._allowDuplicates = true;

      const eventCallback = jest.fn();
      noble.on('discover', eventCallback);

      noble._onDiscover(
        uuid,
        address,
        addressType,
        connectable,
        advertisement,
        rssi
      );

      expect(eventCallback).toHaveBeenCalledWith(noble._peripherals.get(uuid));
      expect(eventCallback).toHaveBeenCalledTimes(1);
    });

    test('should not emit on duplicate', () => {
      const uuid = 'uuid';
      const address = 'address';
      const addressType = 'addressType';
      const connectable = 'connectable';
      const advertisement = ['adv1', 'adv2', 'adv3'];
      const rssi = 'rssi';

      // register peripheral
      noble._discoveredPeripherals.add(uuid);
      noble._allowDuplicates = false;

      const eventCallback = jest.fn();
      noble.on('discover', eventCallback);

      noble._onDiscover(
        uuid,
        address,
        addressType,
        connectable,
        advertisement,
        rssi
      );

      expect(eventCallback).not.toHaveBeenCalled();
    });

    test('should emit on new peripheral (even if duplicates are disallowed)', () => {
      const uuid = 'uuid';
      const address = 'address';
      const addressType = 'addressType';
      const connectable = 'connectable';
      const advertisement = ['adv1', 'adv2', 'adv3'];
      const rssi = 'rssi';

      const eventCallback = jest.fn();
      noble.on('discover', eventCallback);

      noble._onDiscover(
        uuid,
        address,
        addressType,
        connectable,
        advertisement,
        rssi
      );

      expect(eventCallback).toHaveBeenCalledWith(noble._peripherals.get(uuid));
      expect(eventCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateRssi', () => {
    test('should updateRssi', () => {
      noble.updateRssi('peripheralUuid');
      expect(mockBindings.updateRssi).toHaveBeenCalledWith('peripheralUuid');
      expect(mockBindings.updateRssi).toHaveBeenCalledTimes(1);
    });
  });

  describe('onRssiUpdate', () => {
    test('should emit rssiUpdate on existing peripheral', () => {
      const emit = jest.fn();
      noble._peripherals.set('uuid', { emit });

      noble._onRssiUpdate('uuid', 3);

      expect(emit).toHaveBeenCalledWith('rssiUpdate', 3, undefined);
      expect(emit).toHaveBeenCalledTimes(1);

      const peripheral = noble._peripherals.get('uuid');
      expect(peripheral).toHaveProperty('emit', emit);
      expect(peripheral).toHaveProperty('rssi', 3);
    });

    test('should emit warning on missing peripheral', () => {
      const warningCallback = jest.fn();

      noble.on('warning', warningCallback);
      noble._onRssiUpdate('uuid', 4);

      expect(warningCallback).toHaveBeenCalledWith('unknown peripheral uuid RSSI update!');
      expect(warningCallback).toHaveBeenCalledTimes(1);
      expect(noble._peripherals.size).toBe(0);
    });
  });

  test('should add multiple services', () => {
    noble.addService = jest.fn().mockImplementation((peripheralUuid, service) => service);

    const peripheralUuid = 'peripheralUuid';
    const services = ['service1', 'service2'];
    const result = noble.addServices(peripheralUuid, services);

    expect(noble.addService).toHaveBeenCalledTimes(2);
    expect(noble.addService).toHaveBeenNthCalledWith(1, peripheralUuid, 'service1');
    expect(noble.addService).toHaveBeenNthCalledWith(2, peripheralUuid, 'service2');
    expect(result).toEqual(services);
  });

  describe('addService', () => {
    const peripheralUuid = 'peripheralUuid';
    const service = {
      uuid: 'serviceUuid'
    };
    const peripheral = {};

    beforeEach(() => {
      noble._peripherals.set(peripheralUuid, peripheral);
      noble._services = { [peripheralUuid]: {} };
      noble._characteristics = { [peripheralUuid]: {} };
      noble._descriptors = { [peripheralUuid]: {} };
    });

    test('should add service to lower layer', () => {
      noble._bindings.addService = jest.fn();

      const result = noble.addService(peripheralUuid, service);

      expect(noble._bindings.addService).toHaveBeenCalledWith(peripheralUuid, service);
      expect(noble._bindings.addService).toHaveBeenCalledTimes(1);

      const expectedService = new Service(noble, peripheralUuid, service.uuid);
      expect(result).toEqual(expectedService);
      expect(peripheral.services).toEqual([expectedService]);
      expect(noble._services).toEqual({
        [peripheralUuid]: {
          [service.uuid]: expectedService
        }
      });
      expect(noble._characteristics).toEqual({
        [peripheralUuid]: {
          [service.uuid]: {}
        }
      });
      expect(noble._descriptors).toEqual({
        [peripheralUuid]: {
          [service.uuid]: {}
        }
      });
    });

    test('should add service only to noble', () => {
      peripheral.services = [];

      const result = noble.addService(peripheralUuid, service);

      const expectedService = new Service(noble, peripheralUuid, service.uuid);
      expect(result).toEqual(expectedService);
      expect(peripheral.services).toEqual([expectedService]);
      expect(noble._services).toEqual({
        [peripheralUuid]: {
          [service.uuid]: expectedService
        }
      });
      expect(noble._characteristics).toEqual({
        [peripheralUuid]: {
          [service.uuid]: {}
        }
      });
      expect(noble._descriptors).toEqual({
        [peripheralUuid]: {
          [service.uuid]: {}
        }
      });
    });
  });

  describe('onServicesDiscovered', () => {
    const peripheralUuid = 'peripheralUuid';
    const services = ['service1', 'service2'];

    test('should not emit servicesDiscovered', () => {
      const callback = jest.fn();
      noble.on('servicesDiscovered', callback);

      noble._onServicesDiscovered(peripheralUuid, services);

      expect(callback).not.toHaveBeenCalled();
    });

    test('should emit servicesDiscovered', () => {
      const emit = jest.fn();
      noble._peripherals.set(peripheralUuid, { uuid: 'peripheral', emit });

      noble._onServicesDiscovered(peripheralUuid, services);

      expect(emit).toHaveBeenCalledWith('servicesDiscovered', { uuid: 'peripheral', emit }, services);
      expect(emit).toHaveBeenCalledTimes(1);
    });
  });

  test('discoverServices - should delegate to bindings', () => {
    noble._bindings.discoverServices = jest.fn();
    noble.discoverServices('peripheral', 'uuids');
    expect(noble._bindings.discoverServices).toHaveBeenCalledWith('peripheral', 'uuids');
    expect(noble._bindings.discoverServices).toHaveBeenCalledTimes(1);
  });

  describe('onMtu', () => {
    test('should update peripheral mtu when set before already', () => {
      const peripheral = {
        mtu: 234,
        emit: jest.fn()
      };

      noble._peripherals.set('uuid', peripheral);
      noble._onMtu('uuid', 123);

      expect(peripheral.mtu).toBe(123);
      expect(peripheral.emit).toHaveBeenCalledWith('mtu', 123);
      expect(peripheral.emit).toHaveBeenCalledTimes(1);
    });

    test('should update peripheral mtu too when empty', () => {
      const peripheral = {
        mtu: null,
        emit: jest.fn()
      };

      noble._peripherals.set('uuid', peripheral);
      noble._onMtu('uuid', 123);

      expect(peripheral.mtu).toBe(123);
      expect(peripheral.emit).toHaveBeenCalledWith('mtu', 123);
      expect(peripheral.emit).toHaveBeenCalledTimes(1);
    });
  });
});