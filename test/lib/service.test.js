const Service = require('../../lib/service');

describe('service', () => {
  let mockNoble = null;
  const mockPeripheralId = 'mock-peripheral-id';
  const mockUuid = 'mock-uuid';

  let service = null;

  beforeEach(() => {
    mockNoble = {
      discoverIncludedServices: jest.fn(),
      discoverCharacteristics: jest.fn(),
      _withDisconnectHandler: (id, operation) => {
        return operation();
      }
    };

    service = new Service(mockNoble, mockPeripheralId, mockUuid);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should have a uuid', () => {
    expect(service.uuid).toEqual(mockUuid);
  });

  test('should lookup name and type by uuid', () => {
    service = new Service(mockNoble, mockPeripheralId, '1800');

    expect(service.name).toEqual('Generic Access');
    expect(service.type).toEqual('org.bluetooth.service.generic_access');
  });

  describe('toString', () => {
    test('should be uuid, name, type, includedServiceUuids', () => {
      expect(service.toString()).toEqual('{"uuid":"mock-uuid","name":null,"type":null,"includedServiceUuids":null}');
    });
  });

  describe('discoverIncludedServices', () => {
    test('should delegate to noble', () => {
      service.discoverIncludedServices();
      expect(mockNoble.discoverIncludedServices).toHaveBeenCalledWith(mockPeripheralId, mockUuid, undefined);
      expect(mockNoble.discoverIncludedServices).toHaveBeenCalledTimes(1);
    });

    test('should delegate to noble, with uuids', () => {
      const mockUuids = [];
      service.discoverIncludedServices(mockUuids);
      expect(mockNoble.discoverIncludedServices).toHaveBeenCalledWith(mockPeripheralId, mockUuid, mockUuids);
      expect(mockNoble.discoverIncludedServices).toHaveBeenCalledTimes(1);
    });

    test('should callback', () => {
      const callback = jest.fn();

      service.discoverIncludedServices(null, callback);
      service.emit('includedServicesDiscover');

      expect(callback).toHaveBeenCalledWith(undefined, undefined);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockNoble.discoverIncludedServices).toHaveBeenCalledWith(mockPeripheralId, mockUuid, null);
      expect(mockNoble.discoverIncludedServices).toHaveBeenCalledTimes(1);
    });

    test('should callback with data', () => {
      const mockIncludedServiceUuids = ['service1'];
      const callback = jest.fn();

      service.discoverIncludedServices(null, callback);
      service.emit('includedServicesDiscover', mockIncludedServiceUuids);

      expect(callback).toHaveBeenCalledWith(undefined, mockIncludedServiceUuids);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockNoble.discoverIncludedServices).toHaveBeenCalledWith(mockPeripheralId, mockUuid, null);
      expect(mockNoble.discoverIncludedServices).toHaveBeenCalledTimes(1);
    });
  });

  describe('discoverIncludedServicesAsync', () => {
    test('should delegate to noble', async () => {
      const promise = service.discoverIncludedServicesAsync();
      service.emit('includedServicesDiscover');

      await expect(promise).resolves.toBeUndefined();
      expect(mockNoble.discoverIncludedServices).toHaveBeenCalledWith(mockPeripheralId, mockUuid, undefined);
      expect(mockNoble.discoverIncludedServices).toHaveBeenCalledTimes(1);
    });

    test('should delegate to noble, with uuids', async () => {
      const mockUuids = [];
      const promise = service.discoverIncludedServicesAsync(mockUuids);
      service.emit('includedServicesDiscover');

      await expect(promise).resolves.toBeUndefined();
      expect(mockNoble.discoverIncludedServices).toHaveBeenCalledWith(mockPeripheralId, mockUuid, mockUuids);
      expect(mockNoble.discoverIncludedServices).toHaveBeenCalledTimes(1);
    });

    test('should resolve with data', async () => {
      const mockIncludedServiceUuids = ['service1'];

      const promise = service.discoverIncludedServicesAsync();
      service.emit('includedServicesDiscover', mockIncludedServiceUuids);

      await expect(promise).resolves.toEqual(mockIncludedServiceUuids);
      expect(mockNoble.discoverIncludedServices).toHaveBeenCalledWith(mockPeripheralId, mockUuid, undefined);
      expect(mockNoble.discoverIncludedServices).toHaveBeenCalledTimes(1);
    });
  });

  describe('discoverCharacteristics', () => {
    test('should delegate to noble', () => {
      service.discoverCharacteristics();
      expect(mockNoble.discoverCharacteristics).toHaveBeenCalledWith(mockPeripheralId, mockUuid, undefined);
      expect(mockNoble.discoverCharacteristics).toHaveBeenCalledTimes(1);
    });

    test('should delegate to noble, with uuids', () => {
      const mockUuids = [];
      service.discoverCharacteristics(mockUuids);
      expect(mockNoble.discoverCharacteristics).toHaveBeenCalledWith(mockPeripheralId, mockUuid, mockUuids);
      expect(mockNoble.discoverCharacteristics).toHaveBeenCalledTimes(1);
    });

    test('should callback', () => {
      const callback = jest.fn();

      service.discoverCharacteristics(null, callback);
      service.emit('characteristicsDiscover');

      expect(callback).toHaveBeenCalledWith(undefined, undefined);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockNoble.discoverCharacteristics).toHaveBeenCalledWith(mockPeripheralId, mockUuid, null);
      expect(mockNoble.discoverCharacteristics).toHaveBeenCalledTimes(1);
    });

    test('should callback with data', () => {
      const mockCharacteristics = [];
      const callback = jest.fn();

      service.discoverCharacteristics(null, callback);
      service.emit('characteristicsDiscover', mockCharacteristics);

      expect(callback).toHaveBeenCalledWith(undefined, mockCharacteristics);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockNoble.discoverCharacteristics).toHaveBeenCalledWith(mockPeripheralId, mockUuid, null);
      expect(mockNoble.discoverCharacteristics).toHaveBeenCalledTimes(1);
    });
  });

  describe('discoverCharacteristicsAsync', () => {
    test('should delegate to noble', async () => {
      const promise = service.discoverCharacteristicsAsync();
      service.emit('characteristicsDiscover');

      await expect(promise).resolves.toBeUndefined();
      expect(mockNoble.discoverCharacteristics).toHaveBeenCalledWith(mockPeripheralId, mockUuid, undefined);
      expect(mockNoble.discoverCharacteristics).toHaveBeenCalledTimes(1);
    });

    test('should delegate to noble, with uuids', async () => {
      const mockUuids = [];
      const promise = service.discoverCharacteristicsAsync(mockUuids);
      service.emit('characteristicsDiscover');

      await expect(promise).resolves.toBeUndefined();
      expect(mockNoble.discoverCharacteristics).toHaveBeenCalledWith(mockPeripheralId, mockUuid, mockUuids);
      expect(mockNoble.discoverCharacteristics).toHaveBeenCalledTimes(1);
    });

    test('should resolve with data', async () => {
      const mockCharacteristics = [];

      const promise = service.discoverCharacteristicsAsync();
      service.emit('characteristicsDiscover', mockCharacteristics);

      await expect(promise).resolves.toEqual(mockCharacteristics);
      expect(mockNoble.discoverCharacteristics).toHaveBeenCalledWith(mockPeripheralId, mockUuid, undefined);
      expect(mockNoble.discoverCharacteristics).toHaveBeenCalledTimes(1);
    });
  });
});