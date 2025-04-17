const Descriptor = require('../../lib/descriptor');

describe('descriptor', () => {
  let mockNoble = null;
  const mockPeripheralId = 'mock-peripheral-id';
  const mockServiceUuid = 'mock-service-uuid';
  const mockCharacteristicUuid = 'mock-characteristic-uuid';
  const mockUuid = 'mock-uuid';

  let descriptor = null;

  beforeEach(() => {
    mockNoble = {
      readValue: jest.fn(),
      writeValue: jest.fn()
    };

    descriptor = new Descriptor(
      mockNoble,
      mockPeripheralId,
      mockServiceUuid,
      mockCharacteristicUuid,
      mockUuid
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should have a uuid', () => {
    expect(descriptor.uuid).toEqual(mockUuid);
  });

  test('should lookup name and type by uuid', () => {
    descriptor = new Descriptor(
      mockNoble,
      mockPeripheralId,
      mockServiceUuid,
      mockCharacteristicUuid,
      '2900'
    );

    expect(descriptor.name).toEqual('Characteristic Extended Properties');
    expect(descriptor.type).toEqual(
      'org.bluetooth.descriptor.gatt.characteristic_extended_properties'
    );
  });

  describe('toString', () => {
    test('should be uuid, name, type', () => {
      expect(descriptor.toString()).toEqual(
        '{"uuid":"mock-uuid","name":null,"type":null}'
      );
    });
  });

  describe('readValue', () => {
    test('should delegate to noble', () => {
      descriptor.readValue();

      expect(mockNoble.readValue).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockCharacteristicUuid,
        mockUuid
      );
      expect(mockNoble.readValue).toHaveBeenCalledTimes(1);
    });

    test('should callback', () => {
      const callback = jest.fn();

      descriptor.readValue(callback);
      descriptor.emit('valueRead');
      // Check for single callback
      descriptor.emit('valueRead');

      expect(callback).toHaveBeenCalledWith(undefined, undefined);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockNoble.readValue).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockCharacteristicUuid,
        mockUuid
      );
      expect(mockNoble.readValue).toHaveBeenCalledTimes(1);
    });

    test('should callback with error, data', () => {
      const mockData = Buffer.alloc(0);
      const callback = jest.fn();

      descriptor.readValue(callback);
      descriptor.emit('valueRead', mockData);
      // Check for single callback
      descriptor.emit('valueRead', mockData);

      expect(callback).toHaveBeenCalledWith(undefined, mockData);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockNoble.readValue).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockCharacteristicUuid,
        mockUuid
      );
      expect(mockNoble.readValue).toHaveBeenCalledTimes(1);
    });
  });

  describe('readValueAsync', () => {
    test('should delegate to noble', async () => {
      const promise = descriptor.readValueAsync();
      descriptor.emit('valueRead');
      
      await expect(promise).resolves.toBeUndefined();
      expect(mockNoble.readValue).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockCharacteristicUuid,
        mockUuid
      );
      expect(mockNoble.readValue).toHaveBeenCalledTimes(1);
    });

    test('should resolve with data', async () => {
      const mockData = Buffer.alloc(0);

      const promise = descriptor.readValueAsync();
      descriptor.emit('valueRead', mockData);
      
      await expect(promise).resolves.toEqual(mockData);
      expect(mockNoble.readValue).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockCharacteristicUuid,
        mockUuid
      );
      expect(mockNoble.readValue).toHaveBeenCalledTimes(1);
    });
  });

  describe('writeValue', () => {
    test('should only accept data as a buffer', () => {
      const mockData = {};

      expect(() => descriptor.writeValue(mockData)).toThrow(
        'data must be a Buffer'
      );

      expect(mockNoble.writeValue).not.toHaveBeenCalled();
    });

    test('should delegate to noble', () => {
      const mockData = Buffer.alloc(0);
      descriptor.writeValue(mockData);

      expect(mockNoble.writeValue).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockCharacteristicUuid,
        mockUuid,
        mockData
      );
      expect(mockNoble.writeValue).toHaveBeenCalledTimes(1);
    });

    test('should callback', () => {
      const mockData = Buffer.alloc(0);
      const callback = jest.fn();

      descriptor.writeValue(mockData, callback);
      descriptor.emit('valueWrite');
      // Check for single callback
      descriptor.emit('valueWrite');

      expect(callback).toHaveBeenCalledWith(undefined);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockNoble.writeValue).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockCharacteristicUuid,
        mockUuid,
        mockData
      );
      expect(mockNoble.writeValue).toHaveBeenCalledTimes(1);
    });
  });

  describe('writeValueAsync', () => {
    test('should only accept data as a buffer', async () => {
      const mockData = {};

      await expect(descriptor.writeValueAsync(mockData)).rejects.toThrow(
        'data must be a Buffer'
      );
    });

    test('should delegate to noble', async () => {
      const mockData = Buffer.alloc(0);

      const promise = descriptor.writeValueAsync(mockData);
      descriptor.emit('valueWrite');
      
      await expect(promise).resolves.toBeUndefined();
      expect(mockNoble.writeValue).toHaveBeenCalledWith(
        mockPeripheralId,
        mockServiceUuid,
        mockCharacteristicUuid,
        mockUuid,
        mockData
      );
      expect(mockNoble.writeValue).toHaveBeenCalledTimes(1);
    });
  });
});