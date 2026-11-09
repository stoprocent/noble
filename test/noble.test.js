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
      stop: jest.fn(),
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

  it('forwards warnings from the bindings', () => {
    const received = [];
    noble.on('warning', message => received.push(message));

    void noble.state; // registering the bindings listeners is deferred until first use

    const registered = mockBindings.on.mock.calls.find(([event]) => event === 'warning');
    expect(registered).toBeDefined();
    registered[1]('the mtu connect option is not supported on the dbus backend');

    expect(received).toEqual(['the mtu connect option is not supported on the dbus backend']);
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

    test('should not cause MaxListenersExceededWarning warnings after repeated unauthorized errors', async () => {
      noble._state = 'unauthorized';

      const promise = noble.waitForPoweredOnAsync(0);

      for (let i = 0; i < 10; i++) {
        try {
          await noble.startScanningAsync([]);
        } catch (error) {
        }
      }

      const finalListenerCount = noble.listenerCount('stateChange');

      await expect(promise).rejects.toThrow('Timeout waiting for Noble to be powered on');
      expect(finalListenerCount).toBeLessThanOrEqual(1);
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

  describe('discoverAsync', () => {
    let iterator;

    beforeEach(() => {
      noble._initialized = true;
      noble._state = 'poweredOn';
      mockBindings.startScanning.mockImplementation(() => noble._onScanStart());
      mockBindings.stopScanning.mockImplementation(() => noble._onScanStop());
      iterator = noble.discoverAsync();
    });

    afterEach(async () => {
      await iterator.return();
    });

    test('yields discovered peripherals and stops scanning when returned', async () => {
      const peripheral = { id: 'first' };
      const nextPeripheral = iterator.next();

      noble.emit('discover', peripheral);

      await expect(nextPeripheral).resolves.toEqual({
        value: peripheral,
        done: false
      });

      await iterator.return();

      expect(mockBindings.startScanning).toHaveBeenCalledTimes(1);
      expect(mockBindings.stopScanning).toHaveBeenCalledTimes(1);
    });

    test('resumes after a binding-level scan pause with a transient scan start', async () => {
      const firstPeripheral = { id: 'first' };
      const secondPeripheral = { id: 'second' };
      const first = iterator.next();
      noble.emit('discover', firstPeripheral);
      await first;

      // The HCI binding stops scanning internally before connecting. This does
      // not pass through Noble.stopScanning(), so it must remain resumable.
      noble._onScanStop();

      // LE connection setup can briefly enable controller scanning and emit a
      // scanStart without a matching scanStop. It is not the discovery scan.
      noble._onScanStart();

      const second = iterator.next();
      await Promise.resolve();
      noble.emit('discover', secondPeripheral);

      await expect(second).resolves.toEqual({
        value: secondPeripheral,
        done: false
      });
      expect(mockBindings.startScanning).toHaveBeenCalledTimes(2);
    });

    test('ends after an explicit stopScanningAsync call', async () => {
      const first = iterator.next();
      noble.emit('discover', { id: 'first' });
      await first;

      await noble.stopScanningAsync();

      await expect(iterator.next()).resolves.toEqual({
        value: undefined,
        done: true
      });
      expect(mockBindings.startScanning).toHaveBeenCalledTimes(1);
      expect(mockBindings.stopScanning).toHaveBeenCalledTimes(1);
    });

    test('ends after Noble is stopped', async () => {
      const first = iterator.next();
      noble.emit('discover', { id: 'first' });
      await first;

      noble.stop();

      await expect(iterator.next()).resolves.toEqual({
        value: undefined,
        done: true
      });
      expect(mockBindings.startScanning).toHaveBeenCalledTimes(1);
      expect(mockBindings.stop).toHaveBeenCalledTimes(1);
    });

    test('ends instead of restarting when the adapter powers off', async () => {
      const first = iterator.next();
      noble.emit('discover', { id: 'first' });
      await first;

      noble._onScanStop();
      noble._onStateChange('poweredOff');

      await expect(iterator.next()).resolves.toEqual({
        value: undefined,
        done: true
      });
      expect(mockBindings.startScanning).toHaveBeenCalledTimes(1);
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

    test('rejects a direct connect for an already connected peripheral without changing its state', () => {
      const callback = jest.fn();
      const peripheral = { id: 'peripheral-uuid', state: 'connected', emit: jest.fn() };
      noble._peripherals.set(peripheral.id, peripheral);
      mockBindings.addressToId.mockReturnValue(peripheral.id);

      noble.connect(peripheral.id, {}, callback);

      expect(callback).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Peripheral already connected'
      }), peripheral);
      expect(mockBindings.connect).not.toHaveBeenCalled();
      expect(peripheral.state).toBe('connected');
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

    test('should update peripheral state when cancelConnect is called during connection', () => {
      // Setup a peripheral in connecting state
      const peripheral = {
        id: 'test-peripheral',
        state: 'connecting',
        emit: jest.fn()
      };

      noble._peripherals.set('test-peripheral', peripheral);
      
      // Mock addressToId to return the peripheral id
      mockBindings.addressToId = jest.fn().mockReturnValue('test-peripheral');
      
      // Spy on noble's emit method
      const emitSpy = jest.spyOn(noble, 'emit');
      
      // Call cancelConnect
      noble.cancelConnect('test-peripheral');
      
      // Verify cancelConnect was called with correct parameters
      expect(mockBindings.cancelConnect).toHaveBeenCalledWith(
        'test-peripheral', 
        undefined
      );
      
      // Verify peripheral state was updated to disconnected
      expect(peripheral.state).toBe('disconnected');
      
      // Verify connect event was emitted with error
      expect(emitSpy).toHaveBeenCalledWith(
        'connect:test-peripheral', 
        expect.objectContaining({
          message: 'connection canceled!'
        })
      );
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

  test.each(['poweredOff', 'unauthorized', 'unsupported'])('should clean up when leaving poweredOn for %s', (state) => {
    const cleanup = jest.spyOn(noble, '_cleanupPeriperals').mockImplementation(() => {});
    noble._state = 'poweredOn';

    noble._onStateChange(state);

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  describe('waitForPoweredOnAsync', () => {
    test('should resolve when state changes to poweredOn', async () => {
      // Set initial state to something other than poweredOn
      noble._state = 'poweredOff';
      
      // Create promise but don't await it yet
      const promise = noble.waitForPoweredOnAsync();
      
      // Emit state change event to poweredOn
      noble.emit('stateChange', 'poweredOn');
      
      // Now await the promise - it should resolve
      await expect(promise).resolves.toBeUndefined();
    });
    
    test('should resolve immediately if state is already poweredOn', async () => {
      // Set initial state to poweredOn
      noble._state = 'poweredOn';
      
      // Multiple concurrent calls should resolve immediately
      const promise1 = noble.waitForPoweredOnAsync();
      const promise2 = noble.waitForPoweredOnAsync();
      const promise3 = noble.waitForPoweredOnAsync();
      
      // Both promises should resolve
      await expect(promise1).resolves.toBeUndefined();
      await expect(promise2).resolves.toBeUndefined();
      await expect(promise3).resolves.toBeUndefined();
    });
    
    test('should reject if timeout occurs before state changes to poweredOn', async () => {
      // Set initial state to something other than poweredOn
      noble._state = 'poweredOff';
      
      // Set a very short timeout
      const promise = noble.waitForPoweredOnAsync(10);
      
      // Promise should reject after timeout
      await expect(promise).rejects.toThrow('Timeout waiting for Noble to be powered on');
    });

    test('should not cause MaxListenersExceededWarning warnings with multiple timeout calls', async () => {
      noble._state = 'poweredOff';

      const promises = [];
      for (let i = 0; i < 11; i++) {
        promises.push(noble.waitForPoweredOnAsync(0).catch(() => {}));
      }
      await Promise.all(promises);
      const finalListenerCount = noble.listenerCount('stateChange');

      expect(finalListenerCount).toBeLessThanOrEqual(1);
    });
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

  describe('pair', () => {
    // Mirror lib/pairing-kinds.js — kept in sync manually since these tests
    // exercise the JS layer (no WinRT binding in scope).
    const DevicePairingKinds = {
      None: 0,
      ConfirmOnly: 0x00000008,
      DisplayPin: 0x00000010,
      ProvidePin: 0x00000040,
    };
    const DevicePairingProtectionLevel = {
      None: 1,
      Encryption: 2,
      EncryptionAndAuthentication: 3,
    };

    // Use a hex id so `_getPeripheralId` accepts it without calling the
    // mocked addressToId (whose return value would otherwise become the
    // forwarded identifier).
    const peripheralUuidHex = '00112233445566778899aabbccddeeff';

    test('should default to ConfirmOnly when kind is omitted', () => {
      mockBindings.pair = jest.fn();
      noble.pair(peripheralUuidHex, () => {});
      expect(mockBindings.pair).toHaveBeenCalledWith(
        peripheralUuidHex,
        DevicePairingKinds.ConfirmOnly,
        DevicePairingProtectionLevel.Encryption
      );
    });

    test('should forward explicit kind to the binding', () => {
      mockBindings.pair = jest.fn();
      noble.pair(peripheralUuidHex, DevicePairingKinds.DisplayPin, () => {});
      expect(mockBindings.pair).toHaveBeenCalledWith(
        peripheralUuidHex,
        DevicePairingKinds.DisplayPin,
        DevicePairingProtectionLevel.Encryption
      );
    });

    test('should accept a bitmask kind (multiple OR-ed values)', () => {
      mockBindings.pair = jest.fn();
      const mask = DevicePairingKinds.ConfirmOnly | DevicePairingKinds.ProvidePin;
      noble.pair(peripheralUuidHex, mask, () => {});
      expect(mockBindings.pair).toHaveBeenCalledWith(
        peripheralUuidHex,
        mask,
        DevicePairingProtectionLevel.Encryption
      );
    });

    test('should forward explicit protection level to the binding', () => {
      mockBindings.pair = jest.fn();
      noble.pair(
        peripheralUuidHex,
        DevicePairingKinds.ConfirmOnly,
        DevicePairingProtectionLevel.EncryptionAndAuthentication,
        () => {}
      );
      expect(mockBindings.pair).toHaveBeenCalledWith(
        peripheralUuidHex,
        DevicePairingKinds.ConfirmOnly,
        DevicePairingProtectionLevel.EncryptionAndAuthentication
      );
    });

    test('should treat function in 2nd position as callback (legacy signature)', () => {
      mockBindings.pair = jest.fn();
      const cb = jest.fn();
      noble.pair(peripheralUuidHex, cb);
      expect(mockBindings.pair).toHaveBeenCalledWith(
        peripheralUuidHex,
        DevicePairingKinds.ConfirmOnly,
        DevicePairingProtectionLevel.Encryption
      );
    });

    test('should treat function in 3rd position as callback (legacy signature)', () => {
      mockBindings.pair = jest.fn();
      const cb = jest.fn();
      noble.pair(peripheralUuidHex, DevicePairingKinds.ConfirmOnly, cb);
      expect(mockBindings.pair).toHaveBeenCalledWith(
        peripheralUuidHex,
        DevicePairingKinds.ConfirmOnly,
        DevicePairingProtectionLevel.Encryption
      );
    });

    test('pairAsync should default to ConfirmOnly', async () => {
      mockBindings.pair = jest.fn();
      const promise = noble.pairAsync(peripheralUuidHex);
      // pairAsync awaits a `pair:${identifier}` event; emit success
      // (null error) to resolve the promise.
      noble.emit(`pair:${peripheralUuidHex}`, null);

      await promise;
      expect(mockBindings.pair).toHaveBeenCalledWith(
        peripheralUuidHex,
        DevicePairingKinds.ConfirmOnly,
        DevicePairingProtectionLevel.Encryption
      );
    });

    test('pairAsync should forward explicit kind', async () => {
      mockBindings.pair = jest.fn();
      const promise = noble.pairAsync(peripheralUuidHex, DevicePairingKinds.ProvidePin);
      noble.emit(`pair:${peripheralUuidHex}`, null);

      await promise;
      expect(mockBindings.pair).toHaveBeenCalledWith(
        peripheralUuidHex,
        DevicePairingKinds.ProvidePin,
        DevicePairingProtectionLevel.Encryption
      );
    });

    test('pairAsync should forward explicit protection level', async () => {
      mockBindings.pair = jest.fn();
      const promise = noble.pairAsync(
        peripheralUuidHex,
        DevicePairingKinds.ProvidePin,
        DevicePairingProtectionLevel.None
      );
      noble.emit(`pair:${peripheralUuidHex}`, null);

      await promise;
      expect(mockBindings.pair).toHaveBeenCalledWith(
        peripheralUuidHex,
        DevicePairingKinds.ProvidePin,
        DevicePairingProtectionLevel.None
      );
    });

    test('should reject invalid kind values', () => {
      mockBindings.pair = jest.fn();
      const cb = jest.fn();
      noble.pair(peripheralUuidHex, Number.NaN, cb);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith(expect.any(Error));
      expect(cb.mock.calls[0][0].message).toBe(
        'pair() kind must be a finite uint32 DevicePairingKinds bitmask'
      );
      expect(mockBindings.pair).not.toHaveBeenCalled();
    });

    test('should reject DevicePairingKinds.None (empty mask)', () => {
      mockBindings.pair = jest.fn();
      const cb = jest.fn();
      noble.pair(peripheralUuidHex, DevicePairingKinds.None, cb);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith(expect.any(Error));
      expect(cb.mock.calls[0][0].message).toBe(
        'pair() requires at least one DevicePairingKinds value; DevicePairingKinds.None matches no ceremony'
      );
      expect(mockBindings.pair).not.toHaveBeenCalled();
    });

    test('should reject invalid protection level type', () => {
      mockBindings.pair = jest.fn();
      const cb = jest.fn();
      noble.pair(peripheralUuidHex, DevicePairingKinds.ConfirmOnly, 1.5, cb);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith(expect.any(Error));
      expect(cb.mock.calls[0][0].message).toBe(
        'pair() protectionLevel must be a finite uint32 DevicePairingProtectionLevel'
      );
      expect(mockBindings.pair).not.toHaveBeenCalled();
    });

    test('should surface deterministic error when binding has no pair method', () => {
      mockBindings.pair = jest.fn();
      delete mockBindings.pair;
      const cb = jest.fn();
      noble.pair(peripheralUuidHex, DevicePairingKinds.DisplayPin, cb);
      expect(cb).toHaveBeenCalledTimes(1);
      const err = cb.mock.calls[0][0];
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe('Pairing is not supported on this platform');
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

  describe('pair', () => {
    // Mirror lib/pairing-kinds.js — used by these legacy tests for assertions
    // when the new pair() defaults to ConfirmOnly.
    const DevicePairingKinds = {
      None: 0,
      ConfirmOnly: 0x00000008,
    };
    const DevicePairingProtectionLevel = {
      Encryption: 2,
    };

    test('should delegate to binding with ConfirmOnly default', () => {
      const peripheralUuid = 'aabbccddeeff';

      mockBindings.pair = jest.fn();
      noble.pair(peripheralUuid);

      expect(mockBindings.pair).toHaveBeenCalledWith(
        peripheralUuid,
        DevicePairingKinds.ConfirmOnly,
        DevicePairingProtectionLevel.Encryption
      );
      expect(mockBindings.pair).toHaveBeenCalledTimes(1);
    });

    test('should fail synchronously when pairing is unsupported by the bindings', () => {
      const peripheralUuid = 'aabbccddeeff';
      // mockBindings deliberately has no pair() method (e.g. macOS/Linux).

      const callback = jest.fn();
      noble.pair(peripheralUuid, callback);

      expect(callback).toHaveBeenCalledWith(expect.any(Error));
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockBindings.pair).toBeUndefined();
    });

    test('should emit the public pair event on the unsupported-platform path', () => {
      const peripheralUuid = 'aabbccddeeff';
      const peripheral = { emit: jest.fn() };
      noble._peripherals.set(peripheralUuid, peripheral);
      // mockBindings deliberately has no pair() method.

      const pairListener = jest.fn();
      noble.on('pair', pairListener);
      noble.pair(peripheralUuid, () => {});

      expect(pairListener).toHaveBeenCalledWith(peripheral, expect.any(Error));
      expect(pairListener).toHaveBeenCalledTimes(1);
    });
  });

  describe('pairAsync', () => {
    const DevicePairingKinds = {
      ConfirmOnly: 0x00000008,
    };
    const DevicePairingProtectionLevel = {
      Encryption: 2,
    };

    test('should resolve on success', async () => {
      const peripheralUuid = 'aabbccddeeff';
      mockBindings.pair = jest.fn();
      noble._peripherals.set(peripheralUuid, { emit: jest.fn() });

      const promise = noble.pairAsync(peripheralUuid);
      noble._onPair(peripheralUuid, true);

      await expect(promise).resolves.toBeUndefined();
      expect(mockBindings.pair).toHaveBeenCalledWith(
        peripheralUuid,
        DevicePairingKinds.ConfirmOnly,
        DevicePairingProtectionLevel.Encryption
      );
    });

    test('should reject on failure', async () => {
      const peripheralUuid = 'aabbccddeeff';
      mockBindings.pair = jest.fn();
      noble._peripherals.set(peripheralUuid, { emit: jest.fn() });

      const promise = noble.pairAsync(peripheralUuid);
      noble._onPair(peripheralUuid, false, new Error('pairing failed'));

      await expect(promise).rejects.toThrow('pairing failed');
    });

    test('should reject when pairing is unsupported by the bindings', async () => {
      const peripheralUuid = 'aabbccddeeff';
      // mockBindings deliberately has no pair() method (e.g. macOS/Linux).

      const promise = noble.pairAsync(peripheralUuid);

      await expect(promise).rejects.toThrow('Pairing is not supported on this platform');
      expect(mockBindings.pair).toBeUndefined();
    });
  });

  describe('onPair', () => {
    test('should emit pair on existing peripheral (success)', () => {
      const emit = jest.fn();
      noble._peripherals.set('aabbccddeeff', { emit });

      const warningCallback = jest.fn();
      noble.on('warning', warningCallback);
      noble._onPair('aabbccddeeff', true);

      expect(emit).toHaveBeenCalledWith('pair', null);
      expect(warningCallback).not.toHaveBeenCalled();
    });

    test('should emit pair failure on existing peripheral', () => {
      const emit = jest.fn();
      noble._peripherals.set('aabbccddeeff', { emit });
      const error = new Error('pairing failed');

      const warningCallback = jest.fn();
      noble.on('warning', warningCallback);
      noble._onPair('aabbccddeeff', false, error);

      expect(emit).toHaveBeenCalledWith('pair', error);
      expect(warningCallback).not.toHaveBeenCalled();
    });

    test('should emit the public Noble pair event on success', () => {
      const peripheral = { emit: jest.fn() };
      noble._peripherals.set('aabbccddeeff', peripheral);

      const pairListener = jest.fn();
      noble.on('pair', pairListener);
      noble._onPair('aabbccddeeff', true);

      expect(pairListener).toHaveBeenCalledWith(peripheral, null);
      expect(pairListener).toHaveBeenCalledTimes(1);
    });

    test('should emit the public Noble pair event on failure', () => {
      const peripheral = { emit: jest.fn() };
      noble._peripherals.set('aabbccddeeff', peripheral);
      const error = new Error('pairing failed');

      const pairListener = jest.fn();
      noble.on('pair', pairListener);
      noble._onPair('aabbccddeeff', false, error);

      expect(pairListener).toHaveBeenCalledWith(peripheral, error);
      expect(pairListener).toHaveBeenCalledTimes(1);
    });

    test('should release the completion callback even for an untracked peripheral', () => {
      // Regression: Noble#pair registers pair:${id}; if the native side
      // completes pairing for an id that is not in _peripherals, the
      // completion callback must still fire rather than hang forever.
      const peripheralUuid = 'aabbccddeeff';
      const warningCallback = jest.fn();
      noble.on('warning', warningCallback);

      // Ensure Noble#pair takes the supported-bindings path so completion waits
      // for _onPair (mirrors native behavior on Windows).
      mockBindings.pair = jest.fn();

      const completionCallback = jest.fn();
      noble.pair(peripheralUuid, completionCallback);
      expect(completionCallback).not.toHaveBeenCalled();

      noble._onPair(peripheralUuid, false, new Error('device not connected'));

      expect(completionCallback).toHaveBeenCalledWith(expect.any(Error));
      expect(completionCallback).toHaveBeenCalledTimes(1);
      expect(warningCallback).toHaveBeenCalledWith(
        'unknown peripheral aabbccddeeff pair result received!'
      );
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

  describe('state change handling', () => {
    test('should disconnect peripherals when state changes to poweredOff', () => {
      // Setup a connected peripheral
      const peripheral = {
        id: 'test-peripheral',
        state: 'connected',
        emit: jest.fn()
      };
      noble._peripherals.set('test-peripheral', peripheral);
      noble._state = 'poweredOn';
      
      // Mock the _onDisconnect method to verify it's called
      const originalOnDisconnect = noble._onDisconnect;
      noble._onDisconnect = jest.fn();
      
      // Trigger state change to poweredOff
      noble._onStateChange('poweredOff');
      
      // Check if _onDisconnect was called for the peripheral
      expect(noble._onDisconnect).toHaveBeenCalledWith('test-peripheral', 'cleanup');
      
      // Restore original method
      noble._onDisconnect = originalOnDisconnect;
    });
    
    test('should update peripheral state when cleaned up during poweredOff', () => {
      // Setup a connected peripheral
      const peripheral = {
        id: 'test-peripheral',
        state: 'connected',
        emit: jest.fn()
      };
      noble._peripherals.set('test-peripheral', peripheral);
      
      // Call the cleanup method directly
      noble._cleanupPeriperals('test-peripheral');
      
      // Verify peripheral emitted disconnect event
      expect(peripheral.emit).toHaveBeenCalledWith('disconnect', 'cleanup');
      
      // Verify peripheral state was updated
      expect(peripheral.state).toBe('disconnected');
    });

    test('should not emit disconnect while cleaning up a failed connection', () => {
      const peripheral = {
        id: 'failed-peripheral',
        state: 'error',
        emit: jest.fn()
      };
      noble._peripherals.set(peripheral.id, peripheral);

      noble._cleanupPeriperals(peripheral.id);

      expect(peripheral.emit).not.toHaveBeenCalledWith('disconnect', expect.anything());
      expect(noble._peripherals.has(peripheral.id)).toBe(false);
    });
  });

  describe("_withDisconnectHandler", () => {
    test("resolves operation result", async () => {
      const promise = noble._withDisconnectHandler('peripheralUuid', () => Promise.resolve(1))
      await expect(promise).resolves.toBe(1)
    })

    test("throws disconnect error if disconnected before resolve", async () => {
      noble._peripherals.set('uuid', {emit: jest.fn()});
      const promise = noble._withDisconnectHandler('uuid', () => Promise.resolve(1))
      noble._onDisconnect('uuid')
      await expect(promise).rejects.toThrow('Disconnected unknown')
    })
  })
});
