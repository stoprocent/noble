const Characteristic = require('../../lib/characteristic');

describe('characteristic', () => {
  let mockNoble = null;
  const mockPeripheralId = 'mock-peripheral-id';
  const mockServiceUuid = 'mock-service-uuid';
  const mockUuid = 'mock-uuid';
  const mockProperties = ['mock-property-1', 'mock-property-2'];

  let characteristic = null;

  beforeEach(() => {
    mockNoble = {
      _withDisconnectHandler: (id, operation) => {
        return operation();
      },
      read: jest.fn(),
      write: jest.fn(),
      broadcast: jest.fn(),
      notify: jest.fn(),
      discoverDescriptors: jest.fn()
    };

    characteristic = new Characteristic(
      mockNoble,
      mockPeripheralId,
      mockServiceUuid,
      mockUuid,
      mockProperties
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should have a uuid', () => {
    expect(characteristic.uuid).toEqual(mockUuid);
  });

  test('should lookup name and type by uuid', () => {
    characteristic = new Characteristic(
      mockNoble,
      mockPeripheralId,
      mockServiceUuid,
      '2a00',
      mockProperties
    );

    expect(characteristic.name).toEqual('Device Name');
    expect(characteristic.type).toEqual(
      'org.bluetooth.characteristic.gap.device_name'
    );
  });

  test('should have properties', () => {
    expect(characteristic.properties).toEqual(mockProperties);
  });

  describe('toString', () => {
    test('should be uuid, name, type, properties', () => {
      expect(characteristic.toString()).toEqual(
        '{"uuid":"mock-uuid","name":null,"type":null,"properties":["mock-property-1","mock-property-2"]}'
      );
    });
  });

  describe('read', () => {
    test('should delegate to noble', () => {
      characteristic.read();
      expect(mockNoble.read).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid
      );
      expect(mockNoble.read).toHaveBeenCalledTimes(1);
    });

    test('should callback without data', () => {
      const callback = jest.fn();

      characteristic.read(callback);
      characteristic.emit('read');
      // Check for single callback
      characteristic.emit('read');

      expect(callback).toHaveBeenCalledWith(undefined, undefined);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockNoble.read).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid
      );
      expect(mockNoble.read).toHaveBeenCalledTimes(1);
    });

    test('should callback with data', () => {
      const callback = jest.fn();
      const data = 'data';

      characteristic.read(callback);
      characteristic.emit('read', data);
      // Check for single callback
      characteristic.emit('read', data);

      expect(callback).toHaveBeenCalledWith(undefined, data);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockNoble.read).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid
      );
      expect(mockNoble.read).toHaveBeenCalledTimes(1);
    });

    test('should not callback as it is notification', () => {
      const callback = jest.fn();
      const data = 'data';

      characteristic.read(callback);
      characteristic.emit('read', data, true);
      // Check for single callback
      characteristic.emit('read', data, true);

      expect(callback).not.toHaveBeenCalled();
      expect(mockNoble.read).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid
      );
      expect(mockNoble.read).toHaveBeenCalledTimes(1);
    });
  });

  describe('readAsync', () => {
    test('should delegate to noble', async () => {
      const promise = characteristic.readAsync();
      characteristic.emit('read');
      
      await expect(promise).resolves.toBeUndefined();
      expect(mockNoble.read).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid
      );
      expect(mockNoble.read).toHaveBeenCalledTimes(1);
    });

    test('should returns without data', async () => {
      const promise = characteristic.readAsync();
      characteristic.emit('read');
      
      await expect(promise).resolves.toBeUndefined();
      expect(mockNoble.read).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid
      );
      expect(mockNoble.read).toHaveBeenCalledTimes(1);
    });

    test('should callback with data', async () => {
      const data = 'data';

      const promise = characteristic.readAsync();
      characteristic.emit('read', data);
      
      await expect(promise).resolves.toEqual(data);
      expect(mockNoble.read).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid
      );
      expect(mockNoble.read).toHaveBeenCalledTimes(1);
    });

    // This shows that async notification never ends
    test.skip('should not callback as it is notification', async () => {
      const data = 'data';

      const promise = characteristic.readAsync();
      characteristic.emit('read', data, true);
      
      await expect(promise).resolves.toBeUndefined();
      expect(mockNoble.read).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid
      );
      expect(mockNoble.read).toHaveBeenCalledTimes(1);
    });
  });

  describe('write', () => {
    let processTitle = null;
    
    beforeEach(() => {
      processTitle = process.title;
    });

    afterEach(() => {
      process.title = processTitle;
    });

    test('should only accept data as a buffer', () => {
      expect(() => characteristic.write({})).toThrow(
        'data must be a Buffer or Uint8Array or Uint16Array or Uint32Array'
      );

      expect(mockNoble.write).not.toHaveBeenCalled();
    });

    test('should accept any kind of data as process is browser', () => {
      process.title = 'browser';

      const mockData = {};
      characteristic.write(mockData);

      expect(mockNoble.write).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid,
        mockData,
        undefined
      );
      expect(mockNoble.write).toHaveBeenCalledTimes(1);
    });

    test('should delegate to noble, withoutResponse false', () => {
      const mockData = Buffer.alloc(0);
      characteristic.write(mockData, false);

      expect(mockNoble.write).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid,
        mockData,
        false
      );
      expect(mockNoble.write).toHaveBeenCalledTimes(1);
    });

    test('should delegate to noble, withoutResponse true', () => {
      const mockData = Buffer.alloc(0);
      characteristic.write(mockData, true);

      expect(mockNoble.write).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid,
        mockData,
        true
      );
      expect(mockNoble.write).toHaveBeenCalledTimes(1);
    });

    test('should callback', () => {
      const mockData = Buffer.alloc(0);
      const callback = jest.fn();

      characteristic.write(mockData, true, callback);
      characteristic.emit('write');
      // Check for single callback
      characteristic.emit('write');

      expect(callback).toHaveBeenCalledWith(undefined);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockNoble.write).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid,
        mockData,
        true
      );
      expect(mockNoble.write).toHaveBeenCalledTimes(1);
    });
  });

  describe('writeAsync', () => {
    test('should only accept data as a buffer', async () => {
      await expect(characteristic.writeAsync({})).rejects.toThrow(
        'data must be a Buffer or Uint8Array or Uint16Array or Uint32Array'
      );

      expect(mockNoble.write).not.toHaveBeenCalled();
    });

    test('should delegate to noble, withoutResponse false', async () => {
      const mockData = Buffer.alloc(0);
      const promise = characteristic.writeAsync(mockData, false);
      characteristic.emit('write');
      
      await expect(promise).resolves.toBeUndefined();
      expect(mockNoble.write).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid,
        mockData,
        false
      );
      expect(mockNoble.write).toHaveBeenCalledTimes(1);
    });

    test('should delegate to noble, withoutResponse true', async () => {
      const mockData = Buffer.alloc(0);
      const promise = characteristic.writeAsync(mockData, true);
      characteristic.emit('write');
      
      await expect(promise).resolves.toBeUndefined();
      expect(mockNoble.write).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid,
        mockData,
        true
      );
      expect(mockNoble.write).toHaveBeenCalledTimes(1);
    });

    test('should resolve', async () => {
      const mockData = Buffer.alloc(0);
      const promise = characteristic.writeAsync(mockData, true);
      characteristic.emit('write');
      
      await expect(promise).resolves.toBeUndefined();
      expect(mockNoble.write).toHaveBeenCalledTimes(1);
    });
  });

  describe('broadcast', () => {
    test('should delegate to noble, true', () => {
      characteristic.broadcast(true);

      expect(mockNoble.broadcast).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid,
        true
      );
      expect(mockNoble.broadcast).toHaveBeenCalledTimes(1);
    });

    test('should delegate to noble, false', () => {
      characteristic.broadcast(false);

      expect(mockNoble.broadcast).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid,
        false
      );
      expect(mockNoble.broadcast).toHaveBeenCalledTimes(1);
    });

    test('should callback', () => {
      const callback = jest.fn();

      characteristic.broadcast(true, callback);
      characteristic.emit('broadcast');
      // Check for single callback
      characteristic.emit('broadcast');

      expect(callback).toHaveBeenCalledWith(undefined);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockNoble.broadcast).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid,
        true
      );
      expect(mockNoble.broadcast).toHaveBeenCalledTimes(1);
    });
  });

  describe('broadcastAsync', () => {
    test('should delegate to noble, true', async () => {
      const promise = characteristic.broadcastAsync(true);
      characteristic.emit('broadcast');
      
      await expect(promise).resolves.toBeUndefined();
      expect(mockNoble.broadcast).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid,
        true
      );
      expect(mockNoble.broadcast).toHaveBeenCalledTimes(1);
    });

    test('should delegate to noble, false', async () => {
      const promise = characteristic.broadcastAsync(false);
      characteristic.emit('broadcast');
      
      await expect(promise).resolves.toBeUndefined();
      expect(mockNoble.broadcast).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid,
        false
      );
      expect(mockNoble.broadcast).toHaveBeenCalledTimes(1);
    });

    test('should resolve', async () => {
      const promise = characteristic.broadcastAsync(true);
      characteristic.emit('broadcast');
      
      await expect(promise).resolves.toBeUndefined();
      expect(mockNoble.broadcast).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid,
        true
      );
      expect(mockNoble.broadcast).toHaveBeenCalledTimes(1);
    });
  });

  describe('notify', () => {
    test('should delegate to noble, true', () => {
      characteristic.notify(true);

      expect(mockNoble.notify).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid,
        true
      );
      expect(mockNoble.notify).toHaveBeenCalledTimes(1);
    });

    test('should delegate to noble, false', () => {
      characteristic.notify(false);

      expect(mockNoble.notify).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid,
        false
      );
      expect(mockNoble.notify).toHaveBeenCalledTimes(1);
    });

    test('should callback', () => {
      const callback = jest.fn();

      characteristic.notify(true, callback);
      characteristic.emit('notify');
      // Check for single callback
      characteristic.emit('notify');

      expect(callback).toHaveBeenCalledWith(undefined, undefined);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockNoble.notify).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid,
        true
      );
      expect(mockNoble.notify).toHaveBeenCalledTimes(1);
    });
  });

  describe('notifyAsync', () => {
    test('should delegate to noble, true', async () => {
      const promise = characteristic.notifyAsync(true);
      characteristic.emit('notify');
      
      await expect(promise).resolves.toBeUndefined();
      expect(mockNoble.notify).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid,
        true
      );
      expect(mockNoble.notify).toHaveBeenCalledTimes(1);
    });

    test('should delegate to noble, false', async () => {
      const promise = characteristic.notifyAsync(false);
      characteristic.emit('notify');
      
      await expect(promise).resolves.toBeUndefined();
      expect(mockNoble.notify).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid,
        false
      );
      expect(mockNoble.notify).toHaveBeenCalledTimes(1);
    });
  });

  describe('subscribe', () => {
    test('should delegate to noble notify, true', () => {
      characteristic.subscribe();

      expect(mockNoble.notify).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid,
        true
      );
      expect(mockNoble.notify).toHaveBeenCalledTimes(1);
    });

    test('should callback', () => {
      const callback = jest.fn();

      characteristic.subscribe(callback);
      characteristic.emit('notify');
      // Check for single callback
      characteristic.emit('notify');

      expect(callback).toHaveBeenCalledWith(undefined, undefined);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockNoble.notify).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid,
        true
      );
      expect(mockNoble.notify).toHaveBeenCalledTimes(1);
    });
  });

  describe('subscribeAsync', () => {
    test('should delegate to noble notify, true', async () => {
      const promise = characteristic.subscribeAsync();
      characteristic.emit('notify');
      
      await expect(promise).resolves.toBeUndefined();
      expect(mockNoble.notify).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid,
        true
      );
      expect(mockNoble.notify).toHaveBeenCalledTimes(1);
    });
  });

  describe('unsubscribe', () => {
    test('should delegate to noble notify, false', () => {
      characteristic.unsubscribe();

      expect(mockNoble.notify).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid,
        false
      );
      expect(mockNoble.notify).toHaveBeenCalledTimes(1);
    });

    test('should callback', () => {
      const callback = jest.fn();

      characteristic.unsubscribe(callback);
      characteristic.emit('notify');
      // Check for single callback
      characteristic.emit('notify');

      expect(callback).toHaveBeenCalledWith(undefined, undefined);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockNoble.notify).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid,
        false
      );
      expect(mockNoble.notify).toHaveBeenCalledTimes(1);
    });
  });

  describe('unsubscribeAsync', () => {
    test('should delegate to noble notify, false', async () => {
      const promise = characteristic.unsubscribeAsync();
      characteristic.emit('notify');
      
      await expect(promise).resolves.toBeUndefined();
      expect(mockNoble.notify).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid,
        false
      );
      expect(mockNoble.notify).toHaveBeenCalledTimes(1);
    });
  });

  describe('discoverDescriptors', () => {
    test('should delegate to noble', () => {
      characteristic.discoverDescriptors();

      expect(mockNoble.discoverDescriptors).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid
      );
      expect(mockNoble.discoverDescriptors).toHaveBeenCalledTimes(1);
    });

    test('should callback, undefined descriptors', () => {
      const callback = jest.fn();

      characteristic.discoverDescriptors(callback);
      characteristic.emit('descriptorsDiscover');
      // Check for single callback
      characteristic.emit('descriptorsDiscover');

      expect(callback).toHaveBeenCalledWith(undefined, undefined);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockNoble.discoverDescriptors).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid
      );
      expect(mockNoble.discoverDescriptors).toHaveBeenCalledTimes(1);
    });

    test('should callback with descriptors', () => {
      const callback = jest.fn();
      const descriptors = 'descriptors';

      characteristic.discoverDescriptors(callback);
      characteristic.emit('descriptorsDiscover', descriptors);
      // Check for single callback
      characteristic.emit('descriptorsDiscover', descriptors);

      expect(callback).toHaveBeenCalledWith(undefined, descriptors);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockNoble.discoverDescriptors).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid
      );
      expect(mockNoble.discoverDescriptors).toHaveBeenCalledTimes(1);
    });
  });

  describe('discoverDescriptorsAsync', () => {
    test('should delegate to noble', async () => {
      const promise = characteristic.discoverDescriptorsAsync();
      characteristic.emit('descriptorsDiscover');
      
      await expect(promise).resolves.toBeUndefined();
      expect(mockNoble.discoverDescriptors).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid
      );
      expect(mockNoble.discoverDescriptors).toHaveBeenCalledTimes(1);
    });

    test('should resolve with descriptors', async () => {
      const descriptors = 'descriptors';

      const promise = characteristic.discoverDescriptorsAsync();
      characteristic.emit('descriptorsDiscover', descriptors);
      
      await expect(promise).resolves.toEqual(descriptors);
      expect(mockNoble.discoverDescriptors).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockUuid
      );
      expect(mockNoble.discoverDescriptors).toHaveBeenCalledTimes(1);
    });
  });
});