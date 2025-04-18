const Peripheral = require('../../lib/peripheral');

describe('peripheral', () => {
  let mockNoble = null;
  const mockId = 'mock-id';
  const mockAddress = 'mock-address';
  const mockAddressType = 'mock-address-type';
  const mockConnectable = 'mock-connectable';
  const mockAdvertisement = 'mock-advertisement';
  const mockRssi = 'mock-rssi';
  const mockHandle = 'mock-handle';
  const mockData = 'mock-data';

  let peripheral = null;

  beforeEach(() => {
    mockNoble = {
      _withDisconnectHandler: (id, operation) => {
        return new Promise((resolve, reject) => {
          return Promise.resolve(operation())
            .then(result => {
              resolve(result);
            })
            .catch(error => {
              reject(error);
            });
        });
      },
      connect: jest.fn(),
      cancelConnect: jest.fn(),
      disconnect: jest.fn(),
      updateRssi: jest.fn(),
      discoverServices: jest.fn(),
      readHandle: jest.fn(),
      writeHandle: jest.fn()
    };
    
    peripheral = new Peripheral(
      mockNoble, 
      mockId, 
      mockAddress, 
      mockAddressType, 
      mockConnectable, 
      mockAdvertisement, 
      mockRssi
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should have a id', () => {
    expect(peripheral.id).toEqual(mockId);
  });

  test('should have an address', () => {
    expect(peripheral.address).toEqual(mockAddress);
  });

  test('should have an address type', () => {
    expect(peripheral.addressType).toEqual(mockAddressType);
  });

  test('should have connectable', () => {
    expect(peripheral.connectable).toEqual(mockConnectable);
  });

  test('should have advertisement', () => {
    expect(peripheral.advertisement).toEqual(mockAdvertisement);
  });

  test('should have rssi', () => {
    expect(peripheral.rssi).toEqual(mockRssi);
  });

  describe('toString', () => {
    test('should be id, address, address type, connectable, advertisement, rssi, state', () => {
      expect(peripheral.toString()).toEqual(
        '{"id":"mock-id","address":"mock-address","addressType":"mock-address-type","connectable":"mock-connectable","advertisement":"mock-advertisement","rssi":"mock-rssi","mtu":null,"state":"disconnected"}'
      );
    });
  });

  describe('connect', () => {
    test('should delegate to noble', () => {
      peripheral.connect();

      expect(mockNoble.connect).toHaveBeenCalledWith(mockId, undefined);
      expect(mockNoble.connect).toHaveBeenCalledTimes(1);
    });

    test('should callback', () => {
      const callback = jest.fn();

      peripheral.connect(callback);
      peripheral.emit('connect', 'error');

      expect(callback).toHaveBeenCalledWith('error');
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockNoble.connect).toHaveBeenCalledWith(mockId, undefined);
      expect(mockNoble.connect).toHaveBeenCalledTimes(1);
    });

    test('with options, no callback', () => {
      const options = { options: true };

      peripheral.connect(options);
      peripheral.emit('connect');

      expect(mockNoble.connect).toHaveBeenCalledWith(mockId, options);
      expect(mockNoble.connect).toHaveBeenCalledTimes(1);
    });

    test('both options and callback', () => {
      const options = { options: true };
      const callback = jest.fn();

      peripheral.connect(options, callback);
      peripheral.emit('connect');

      expect(callback).toHaveBeenCalledWith(undefined);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockNoble.connect).toHaveBeenCalledWith(mockId, options);
      expect(mockNoble.connect).toHaveBeenCalledTimes(1);
    });
  });

  describe('connectAsync', () => {
    test('should resolve', async () => {
      const promise = peripheral.connectAsync();
      peripheral.emit('connect');

      await expect(promise).resolves.toBeUndefined();
    });

    test('should reject on error', async () => {
      const promise = peripheral.connectAsync();
      peripheral.emit('connect', new Error('error'));
      
      await expect(promise).rejects.toThrow('error');
    });

    test('should delegate to noble', async () => {
      const promise = peripheral.connectAsync();
      peripheral.emit('connect');

      await expect(promise).resolves.toBeUndefined();
      expect(mockNoble.connect).toHaveBeenCalledWith(mockId, undefined);
      expect(mockNoble.connect).toHaveBeenCalledTimes(1);
    });

    test('with options', async () => {
      const options = { options: true };

      const promise = peripheral.connectAsync(options);
      peripheral.emit('connect');

      await expect(promise).resolves.toBeUndefined();
      expect(mockNoble.connect).toHaveBeenCalledWith(mockId, options);
      expect(mockNoble.connect).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancelConnect', () => {
    test('not connecting, should resolve', async () => {
      await peripheral.cancelConnect();

      expect(mockNoble.cancelConnect).not.toHaveBeenCalled();
    });

    test('connecting, should emit connect with error', async () => {
      const options = { options: true };
      const connectCallback = jest.fn();

      peripheral.connect(connectCallback);
      peripheral.cancelConnect(options);

      expect(connectCallback).toHaveBeenCalledWith(expect.objectContaining({
        message: 'connection canceled!'
      }));
      expect(mockNoble.cancelConnect).toHaveBeenCalledWith(mockId, options);
      expect(mockNoble.cancelConnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('disconnect', () => {
    test('should delegate to noble', () => {
      peripheral.disconnect();
      expect(mockNoble.disconnect).toHaveBeenCalledWith(mockId);
      expect(mockNoble.disconnect).toHaveBeenCalledTimes(1);
    });

    test('should callback', () => {
      const callback = jest.fn();

      peripheral.disconnect(callback);
      peripheral.emit('disconnect');

      expect(callback).toHaveBeenCalledWith(null);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockNoble.disconnect).toHaveBeenCalledWith(mockId);
      expect(mockNoble.disconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('disconnectAsync', () => {
    test('should delegate to noble', async () => {
      const promise = peripheral.disconnectAsync();
      peripheral.emit('disconnect');

      await expect(promise).resolves.toBeUndefined();
      expect(mockNoble.disconnect).toHaveBeenCalledWith(mockId);
      expect(mockNoble.disconnect).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateRssi', () => {
    test('should delegate to noble', () => {
      peripheral.updateRssi();
      expect(mockNoble.updateRssi).toHaveBeenCalledWith(mockId);
      expect(mockNoble.updateRssi).toHaveBeenCalledTimes(1);
    });

    test('should callback', () => {
      const callback = jest.fn();

      peripheral.updateRssi(callback);
      peripheral.emit('rssiUpdate', 'new-rssi');

      expect(callback).toHaveBeenCalledWith(undefined, 'new-rssi');
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockNoble.updateRssi).toHaveBeenCalledWith(mockId);
      expect(mockNoble.updateRssi).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateRssiAsync', () => {
    test('should resolve with rssi', async () => {
      const promise = peripheral.updateRssiAsync();
      peripheral.emit('rssiUpdate', 'new-rssi');
      
      await expect(promise).resolves.toEqual('new-rssi');
    });
  });

  describe('discoverServices', () => {
    test('should delegate to noble', () => {
      peripheral.discoverServices();
      expect(mockNoble.discoverServices).toHaveBeenCalledWith(mockId, undefined);
      expect(mockNoble.discoverServices).toHaveBeenCalledTimes(1);
    });

    test('should delegate to noble, service uuids', () => {
      const mockServiceUuids = [];
      peripheral.discoverServices(mockServiceUuids);
      expect(mockNoble.discoverServices).toHaveBeenCalledWith(mockId, mockServiceUuids);
      expect(mockNoble.discoverServices).toHaveBeenCalledTimes(1);
    });

    test('should callback', () => {
      const callback = jest.fn();
      peripheral.discoverServices('uuids', callback);
      peripheral.emit('servicesDiscover', 'services');

      expect(callback).toHaveBeenCalledWith(undefined, 'services');
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockNoble.discoverServices).toHaveBeenCalledWith(mockId, 'uuids');
      expect(mockNoble.discoverServices).toHaveBeenCalledTimes(1);
    });
  });

  describe('discoverServicesAsync', () => {
    test('should resolve with services', async () => {
      const mockServices = 'discoveredServices';

      const promise = peripheral.discoverServicesAsync('uuids');
      peripheral.emit('servicesDiscover', mockServices);

      await expect(promise).resolves.toEqual(mockServices);
      expect(mockNoble.discoverServices).toHaveBeenCalledWith(mockId, 'uuids');
      expect(mockNoble.discoverServices).toHaveBeenCalledTimes(1);
    });
  });

  describe('discoverSomeServicesAndCharacteristics', () => {
    const mockServiceUuids = [];
    const mockCharacteristicUuids = [];
    let mockServices = null;

    beforeEach(() => {
      peripheral.discoverServices = jest.fn((uuids, callback) => {
        if (callback) callback(null, mockServices);
      });

      mockServices = [
        {
          uuid: '1',
          discoverCharacteristics: jest.fn((charUuids, callback) => {
            if (callback) callback(null, []);
          })
        },
        {
          uuid: '2',
          discoverCharacteristics: jest.fn((charUuids, callback) => {
            if (callback) callback(null, []);
          })
        }
      ];
    });

    test('should call discoverServices', () => {
      peripheral.discoverSomeServicesAndCharacteristics(mockServiceUuids);
      

      expect(peripheral.discoverServices).toHaveBeenCalled();
      // expect(peripheral.discoverServices.mock.calls[0][0]).toEqual(mockServiceUuids);
      expect(typeof peripheral.discoverServices.mock.calls[0][1]).toBe('function');
    });

    test('should call discoverCharacteristics on each service discovered', () => {
      peripheral.discoverSomeServicesAndCharacteristics(mockServiceUuids, mockCharacteristicUuids);
      
      expect(peripheral.discoverServices).toHaveBeenCalled();
      expect(mockServices[0].discoverCharacteristics).toHaveBeenCalled();
      expect(mockServices[1].discoverCharacteristics).toHaveBeenCalled();
      
      // expect(mockServices[0].discoverCharacteristics.mock.calls[0][0]).toEqual(mockCharacteristicUuids);
      expect(typeof mockServices[0].discoverCharacteristics.mock.calls[0][1]).toBe('function');
    });

    test('should callback', () => {
      const callback = jest.fn();

      peripheral.discoverSomeServicesAndCharacteristics(mockServiceUuids, mockCharacteristicUuids, callback);
      
      expect(peripheral.discoverServices).toHaveBeenCalled();
      expect(mockServices[0].discoverCharacteristics).toHaveBeenCalled();
      expect(mockServices[1].discoverCharacteristics).toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(null, mockServices, []);
    });

    test('should callback with the services and characteristics discovered', () => {
      const callback = jest.fn();
      const mockCharacteristic1 = { uuid: '1' };
      const mockCharacteristic2 = { uuid: '2' };
      const mockCharacteristic3 = { uuid: '3' };

      mockServices[0].discoverCharacteristics = jest.fn((charUuids, callback) => {
        if (callback) callback(null, [mockCharacteristic1]);
      });
      
      mockServices[1].discoverCharacteristics = jest.fn((charUuids, callback) => {
        if (callback) callback(null, [mockCharacteristic2, mockCharacteristic3]);
      });

      peripheral.discoverSomeServicesAndCharacteristics(mockServiceUuids, mockCharacteristicUuids, callback);
      
      expect(callback).toHaveBeenCalledWith(
        null, 
        mockServices, 
        [mockCharacteristic1, mockCharacteristic2, mockCharacteristic3]
      );
    });
  });

  describe('discoverSomeServicesAndCharacteristicsAsync', () => {
    const mockServiceUuids = [];
    const mockCharacteristicUuids = [];
    let mockServices = null;

    beforeEach(() => {
      peripheral.discoverServices = jest.fn();

      mockServices = [
        {
          uuid: '1',
          discoverCharacteristics: jest.fn()
        },
        {
          uuid: '2',
          discoverCharacteristics: jest.fn()
        }
      ];
    });

    test('should call discoverServices', async () => {
      const promise = peripheral.discoverSomeServicesAndCharacteristicsAsync(mockServiceUuids);
      
      // Call the callback passed to discoverServices
      peripheral.discoverServices.mock.calls[0][1](null, mockServices);
      
      // Call the callbacks for each service's discoverCharacteristics
      mockServices[0].discoverCharacteristics.mock.calls[0][1](null, []);
      mockServices[1].discoverCharacteristics.mock.calls[0][1](null, []);
      
      await expect(promise).resolves.toEqual({ characteristics: [], services: mockServices });
      expect(peripheral.discoverServices).toHaveBeenCalled();
      expect(peripheral.discoverServices.mock.calls[0][0]).toEqual(mockServiceUuids);
    });

    test('should call discoverCharacteristics on each service discovered', async () => {
      const promise = peripheral.discoverSomeServicesAndCharacteristicsAsync(mockServiceUuids, mockCharacteristicUuids);
      
      // Call the callback passed to discoverServices
      peripheral.discoverServices.mock.calls[0][1](null, mockServices);
      
      // Call the callbacks for each service's discoverCharacteristics
      mockServices[0].discoverCharacteristics.mock.calls[0][1](null, []);
      mockServices[1].discoverCharacteristics.mock.calls[0][1](null, []);
      
      await expect(promise).resolves.toEqual({ characteristics: [], services: mockServices });
      expect(peripheral.discoverServices).toHaveBeenCalled();
      expect(mockServices[0].discoverCharacteristics).toHaveBeenCalled();
      expect(mockServices[1].discoverCharacteristics).toHaveBeenCalled();
    });

    test('should reject on error', async () => {
      const promise = peripheral.discoverSomeServicesAndCharacteristicsAsync(mockServiceUuids, mockCharacteristicUuids);
      
      // Call the callback passed to discoverServices with an error
      peripheral.discoverServices.mock.calls[0][1]('error', null);
      
      await expect(promise).rejects.toEqual('error');
      expect(peripheral.discoverServices).toHaveBeenCalled();
      expect(mockServices[0].discoverCharacteristics).not.toHaveBeenCalled();
    });

    test('should resolve with the services and characteristics discovered', async () => {
      const mockCharacteristic1 = { uuid: '1' };
      const mockCharacteristic2 = { uuid: '2' };
      const mockCharacteristic3 = { uuid: '3' };

      const promise = peripheral.discoverSomeServicesAndCharacteristicsAsync(mockServiceUuids, mockCharacteristicUuids);
      
      // Call the callback passed to discoverServices
      peripheral.discoverServices.mock.calls[0][1](null, mockServices);
      
      // Call the callbacks for each service's discoverCharacteristics
      mockServices[0].discoverCharacteristics.mock.calls[0][1](null, [mockCharacteristic1]);
      mockServices[1].discoverCharacteristics.mock.calls[0][1](null, [mockCharacteristic2, mockCharacteristic3]);
      
      await expect(promise).resolves.toEqual({ characteristics: [mockCharacteristic1, mockCharacteristic2, mockCharacteristic3], services: mockServices });
    });

    test('should reject when disconnect happens during execution', async () => {
      const mockServiceUuids = [];
      const mockCharacteristicUuids = [];
      
      // Override the implementation of _withDisconnectHandler to simulate disconnect during operation
      mockNoble._withDisconnectHandler = jest.fn((id, operation) => {
        return new Promise((resolve, reject) => {
          // Start the operation
          const operationPromise = operation();
          
          // Simulate a disconnect by rejecting with a disconnect error
          setTimeout(() => {
            reject(new Error('Peripheral disconnected'));
          }, 10);
          
          return operationPromise;
        });
      });
      
      // Start the async operation
      const promise = peripheral.discoverSomeServicesAndCharacteristicsAsync(mockServiceUuids, mockCharacteristicUuids);
      
      // Verify the promise rejects
      await expect(promise).rejects.toEqual(expect.objectContaining({
        message: 'Peripheral disconnected'
      }));
      
      // Restore original implementation
      mockNoble._withDisconnectHandler = jest.fn((id, operation) => {
        return new Promise((resolve, reject) => {
          return Promise.resolve(operation())
            .then(result => {
              resolve(result);
            })
            .catch(error => {
              reject(error);
            });
        });
      });
    });
  });

  describe('discoverAllServicesAndCharacteristics', () => {
    beforeEach(() => {
      peripheral.discoverSomeServicesAndCharacteristics = jest.fn();
    });

    test('should call discoverSomeServicesAndCharacteristics', () => {
      const callback = jest.fn();
      peripheral.discoverAllServicesAndCharacteristics(callback);
      expect(peripheral.discoverSomeServicesAndCharacteristics).toHaveBeenCalledWith([], [], callback);
    });
  });

  describe('discoverAllServicesAndCharacteristicsAsync', () => {
    beforeEach(() => {
      peripheral.discoverAllServicesAndCharacteristics = jest.fn();
    });
  
    test('should call discoverAllServicesAndCharacteristics with a callback', async () => {
      const promise = peripheral.discoverAllServicesAndCharacteristicsAsync();
      
      // Find the callback that was passed to discoverAllServicesAndCharacteristics
      const callback = peripheral.discoverAllServicesAndCharacteristics.mock.calls[0][0];
      
      // Simulate successful callback
      const mockServices = ['service1', 'service2'];
      const mockCharacteristics = ['char1', 'char2'];
      callback(null, mockServices, mockCharacteristics);
      
      const result = await promise;
      expect(result).toEqual({ services: mockServices, characteristics: mockCharacteristics });
      expect(peripheral.discoverAllServicesAndCharacteristics).toHaveBeenCalledTimes(1);
    });
  
    test('should reject when discoverAllServicesAndCharacteristics returns an error', async () => {
      const promise = peripheral.discoverAllServicesAndCharacteristicsAsync();
      
      // Find the callback that was passed to discoverAllServicesAndCharacteristics
      const callback = peripheral.discoverAllServicesAndCharacteristics.mock.calls[0][0];
      
      // Simulate error callback
      const mockError = new Error('Discovery failed');
      callback(mockError);
      
      await expect(promise).rejects.toEqual(mockError);
      expect(peripheral.discoverAllServicesAndCharacteristics).toHaveBeenCalledTimes(1);
    });
  });

  describe('readHandle', () => {
    test('should delegate to noble', () => {
      peripheral.readHandle(mockHandle);
      expect(mockNoble.readHandle).toHaveBeenCalledWith(mockId, mockHandle);
      expect(mockNoble.readHandle).toHaveBeenCalledTimes(1);
    });

    test('should callback', () => {
      const callback = jest.fn();

      peripheral.readHandle(mockHandle, callback);
      peripheral.emit(`handleRead${mockHandle}`);

      expect(callback).toHaveBeenCalledWith(undefined, undefined);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockNoble.readHandle).toHaveBeenCalledWith(mockId, mockHandle);
      expect(mockNoble.readHandle).toHaveBeenCalledTimes(1);
    });

    test('should callback with data', () => {
      const callback = jest.fn();

      peripheral.readHandle(mockHandle, callback);
      peripheral.emit(`handleRead${mockHandle}`, mockData);

      expect(callback).toHaveBeenCalledWith(undefined, mockData);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockNoble.readHandle).toHaveBeenCalledWith(mockId, mockHandle);
      expect(mockNoble.readHandle).toHaveBeenCalledTimes(1);
    });
  });

  describe('readHandleAsync', () => {
    test('should delegate to noble', async () => {
      const promise = peripheral.readHandleAsync(mockHandle);
      peripheral.emit(`handleRead${mockHandle}`);

      await expect(promise).resolves.toBeUndefined();
      expect(mockNoble.readHandle).toHaveBeenCalledWith(mockId, mockHandle);
      expect(mockNoble.readHandle).toHaveBeenCalledTimes(1);
    });

    test('should resolve with data', async () => {
      const promise = peripheral.readHandleAsync(mockHandle);
      peripheral.emit(`handleRead${mockHandle}`, mockData);

      await expect(promise).resolves.toEqual(mockData);
      expect(mockNoble.readHandle).toHaveBeenCalledWith(mockId, mockHandle);
      expect(mockNoble.readHandle).toHaveBeenCalledTimes(1);
    });
  });

  describe('writeHandle', () => {
    test('should only accept data as a buffer', () => {
      const mockData = {};
      expect(() => peripheral.writeHandle(mockHandle, mockData)).toThrow('data must be a Buffer');
      expect(mockNoble.writeHandle).not.toHaveBeenCalled();
    });

    test('should delegate to noble, withoutResponse false', () => {
      const mockData = Buffer.alloc(0);
      peripheral.writeHandle(mockHandle, mockData, false);

      expect(mockNoble.writeHandle).toHaveBeenCalledWith(mockId, mockHandle, mockData, false);
      expect(mockNoble.writeHandle).toHaveBeenCalledTimes(1);
    });

    test('should delegate to noble, withoutResponse true', () => {
      const mockData = Buffer.alloc(0);
      peripheral.writeHandle(mockHandle, mockData, true);

      expect(mockNoble.writeHandle).toHaveBeenCalledWith(mockId, mockHandle, mockData, true);
      expect(mockNoble.writeHandle).toHaveBeenCalledTimes(1);
    });

    test('should callback', () => {
      const mockData = Buffer.alloc(0);
      const callback = jest.fn();

      peripheral.writeHandle(mockHandle, mockData, false, callback);
      peripheral.emit(`handleWrite${mockHandle}`);

      expect(callback).toHaveBeenCalledWith(undefined);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(mockNoble.writeHandle).toHaveBeenCalledWith(mockId, mockHandle, mockData, false);
      expect(mockNoble.writeHandle).toHaveBeenCalledTimes(1);
    });
  });

  describe('writeHandleAsync', () => {
    test('should only accept data as a buffer', async () => {
      const mockData = {};
      
      await expect(peripheral.writeHandleAsync(mockHandle, mockData)).rejects.toThrow('data must be a Buffer');
      expect(mockNoble.writeHandle).not.toHaveBeenCalled();
    });

    test('should delegate to noble, withoutResponse false', async () => {
      const mockData = Buffer.alloc(0);
      const promise = peripheral.writeHandleAsync(mockHandle, mockData, false);
      peripheral.emit(`handleWrite${mockHandle}`);

      await expect(promise).resolves.toBeUndefined();
      expect(mockNoble.writeHandle).toHaveBeenCalledWith(mockId, mockHandle, mockData, false);
      expect(mockNoble.writeHandle).toHaveBeenCalledTimes(1);
    });

    test('should delegate to noble, withoutResponse true', async () => {
      const mockData = Buffer.alloc(0);
      const promise = peripheral.writeHandleAsync(mockHandle, mockData, true);
      peripheral.emit(`handleWrite${mockHandle}`);

      await expect(promise).resolves.toBeUndefined();
      expect(mockNoble.writeHandle).toHaveBeenCalledWith(mockId, mockHandle, mockData, true);
      expect(mockNoble.writeHandle).toHaveBeenCalledTimes(1);
    });
  });

  describe('async commands with disconnect handling', () => {
    // Setup a reusable helper to manage the original and mocked _withDisconnectHandler
    let originalWithDisconnectHandler;
    
    const setupDisconnectMock = (simulateDisconnect = true, disconnectDelay = 10) => {
      // Save the original implementation
      originalWithDisconnectHandler = mockNoble._withDisconnectHandler;
      
      // Create the mock implementation
      mockNoble._withDisconnectHandler = jest.fn((id, operation) => {
        return new Promise((resolve, reject) => {
          // Start the operation
          const operationPromise = operation();
          
          if (simulateDisconnect) {
            // Simulate a disconnect by rejecting with a disconnect error
            setTimeout(() => {
              reject(new Error('Peripheral disconnected'));
            }, disconnectDelay);
          }
          
          return operationPromise;
        });
      });
    };
    
    const restoreDisconnectMock = () => {
      // Restore the original implementation
      mockNoble._withDisconnectHandler = originalWithDisconnectHandler;
    };
    
    afterEach(() => {
      // Always restore after each test
      restoreDisconnectMock();
    });
    
    test('discoverServicesAsync should handle disconnect during operation', async () => {
      setupDisconnectMock();
      
      const promise = peripheral.discoverServicesAsync();
      
      await expect(promise).rejects.toEqual(expect.objectContaining({
        message: 'Peripheral disconnected'
      }));
    });
    
    test('updateRssiAsync should handle disconnect during operation', async () => {
      setupDisconnectMock();
      
      const promise = peripheral.updateRssiAsync();
      
      await expect(promise).rejects.toEqual(expect.objectContaining({
        message: 'Peripheral disconnected'
      }));
    });
    
    test('readHandleAsync should handle disconnect during operation', async () => {
      setupDisconnectMock();
      
      const promise = peripheral.readHandleAsync(mockHandle);
      
      await expect(promise).rejects.toEqual(expect.objectContaining({
        message: 'Peripheral disconnected'
      }));
    });
    
    test('writeHandleAsync should handle disconnect during operation', async () => {
      setupDisconnectMock();
      
      const mockData = Buffer.alloc(0);
      const promise = peripheral.writeHandleAsync(mockHandle, mockData, false);
      
      await expect(promise).rejects.toEqual(expect.objectContaining({
        message: 'Peripheral disconnected'
      }));
    });
    
    test('chain of async operations should all fail on disconnect', async () => {
      // We'll run without disconnect initially
      setupDisconnectMock(false);
      
      // Setup mock responses for service discovery
      const mockCharacteristic = { uuid: '1' };
      const mockService = {
        uuid: '1',
        discoverCharacteristics: jest.fn((charUuids, callback) => {
          callback(null, [mockCharacteristic]);
        })
      };
      
      peripheral.discoverServices = jest.fn((uuids, callback) => {
        callback(null, [mockService]);
      });
      
      // Start a chain of operations
      const runOperations = async () => {

        setTimeout(() => peripheral.emit('connect'), 20);

        // First operation succeeds
        await peripheral.connectAsync();
        
        // Enable disconnection before second operation
        setupDisconnectMock(true, 5);
        
        // This should fail with disconnect
        await peripheral.discoverAllServicesAndCharacteristics();
        
        // These should never be reached
        await peripheral.readHandleAsync(mockHandle);
        await peripheral.writeHandleAsync(mockHandle, Buffer.alloc(0));
        
        return 'completed';
      };
      
      await expect(runOperations()).rejects.toEqual(expect.objectContaining({
        message: 'Peripheral disconnected'
      }));
    });
    
    test('multiple concurrent async operations should all fail on disconnect', async () => {
      setupDisconnectMock(true, 5);
      
      // Start multiple operations at the same time
      const promises = [
        peripheral.updateRssiAsync(),
        peripheral.discoverServicesAsync(),
        peripheral.readHandleAsync(mockHandle),
        peripheral.writeHandleAsync(mockHandle, Buffer.alloc(0))
      ];
      
      // All operations should fail with the same disconnect error
      await Promise.all(promises.map(promise => 
        expect(promise).rejects.toEqual(expect.objectContaining({
          message: 'Peripheral disconnected'
        }))
      ));
    });
  });
});