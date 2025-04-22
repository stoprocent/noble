const should = require('should');

// Mock the required modules before importing the Bindings module
jest.mock('../../../lib/hci-socket/acl-stream', () => {
  return jest.fn();
});

jest.mock('../../../lib/hci-socket/gap', () => {
  const gapMock = jest.fn();
  gapMock.prototype.on = jest.fn();
  gapMock.prototype.setScanParameters = jest.fn().mockResolvedValue(null);
  gapMock.prototype.startScanning = jest.fn().mockResolvedValue(null);
  gapMock.prototype.stopScanning = jest.fn().mockResolvedValue(null);
  gapMock.prototype.setAddress = jest.fn().mockResolvedValue(null);
  gapMock.prototype.createLeConn = jest.fn().mockResolvedValue(null);
  gapMock.prototype.disconnect = jest.fn().mockResolvedValue(null);
  gapMock.prototype.reset = jest.fn().mockResolvedValue(null);
  return gapMock;
});

jest.mock('../../../lib/hci-socket/gatt', () => {
  const gattOnMock = jest.fn();
  const gattExchangeMtuMock = jest.fn();
  
  const gattMock = jest.fn().mockImplementation(() => ({
    on: gattOnMock,
    exchangeMtu: gattExchangeMtuMock
  }));
  
  // Make the mocks accessible for assertions
  gattMock.onMock = gattOnMock;
  gattMock.exchangeMtuMock = gattExchangeMtuMock;
  
  return gattMock;
});

jest.mock('../../../lib/hci-socket/hci', () => {
  const createLeConnSpy = jest.fn();
  
  const hciMock = jest.fn();
  hciMock.prototype.createLeConn = createLeConnSpy;
  hciMock.prototype.on = jest.fn();
  hciMock.prototype.init = jest.fn();
  hciMock.prototype.setAddress = jest.fn().mockResolvedValue(null);
  hciMock.prototype.reset = jest.fn().mockResolvedValue(null);
  
  // Add STATUS_MAPPER to the constructor
  hciMock.STATUS_MAPPER = { 1: 'custom mapper' };
  
  // Make createLeConn accessible for later assertions
  hciMock.createLeConnSpy = createLeConnSpy;
  
  return hciMock;
});

jest.mock('../../../lib/hci-socket/signaling', () => {
  const signalingOnMock = jest.fn();
  
  const signalingMock = jest.fn().mockImplementation(() => ({
    on: signalingOnMock
  }));
  
  // Make the mock accessible for assertions
  signalingMock.onMock = signalingOnMock;
  
  return signalingMock;
});

// Mock 'os' module
jest.mock('os', () => ({
  platform: jest.fn().mockReturnValue('linux')
}));

// Import the Bindings module after mocking
const Bindings = require('../../../lib/hci-socket/bindings');
const Gap = require('../../../lib/hci-socket/gap');
const Gatt = require('../../../lib/hci-socket/gatt');
const Hci = require('../../../lib/hci-socket/hci');
const AclStream = require('../../../lib/hci-socket/acl-stream');
const Signaling = require('../../../lib/hci-socket/signaling');

describe('hci-socket bindings', () => {
  let bindings;
  const options = {};
  
  beforeEach(() => {
    // Mock process methods
    jest.spyOn(process, 'on').mockImplementation(() => {});
    jest.spyOn(process, 'exit').mockImplementation(() => {});
    
    // Mock console.warn - silent implementation
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    
    // Reset all mock state
    jest.clearAllMocks();
    
    // Mock timing functions
    jest.useFakeTimers();
    
    // Create bindings instance and start it
    bindings = new Bindings(options);
    bindings.start();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks(); // This will restore both process and console.warn mocks
  });

  it('constructor', () => {
    should(bindings._state).eql(null);
    should(bindings._isScanning).eql(false);
    should(bindings._isScanningStarted).eql(false);

    should(bindings._addresses).deepEqual({});
    should(bindings._addresseTypes).deepEqual({});
    should(bindings._connectable).deepEqual({});
    should(bindings._isExtended).eql('extended' in options && options.extended);
    should(bindings.scannable).deepEqual({});

    should(bindings._pendingConnectionUuid).eql(null);
    should(bindings._connectionQueue).deepEqual([]);

    should(bindings._handles).deepEqual({});
    should(bindings._gatts).deepEqual({});
    should(bindings._aclStreams).deepEqual({});
    should(bindings._signalings).deepEqual({});

  });

  it('start', () => {
    expect(bindings._gap.on).toHaveBeenCalledTimes(4);
    expect(bindings._hci.on).toHaveBeenCalledTimes(8);
    expect(bindings._hci.init).toHaveBeenCalledTimes(1);

    expect(process.on).toHaveBeenCalledTimes(2);
  });

  describe('onSigInt', () => {
    it('should exit', () => {
      const sigIntListeners = process.listeners('SIGINT');
      bindings._sigIntHandler = sigIntListeners[sigIntListeners.length - 1];
      bindings.onSigInt();
      expect(process.exit).toHaveBeenCalledWith(1);
      expect(process.exit).toHaveBeenCalledTimes(1);
    });

    it('should not exit', () => {
      bindings._sigIntHandler = jest.fn();
      bindings.onSigInt();
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  it('setScanParameters', () => {
    bindings.setScanParameters('interval', 'window');

    expect(bindings._gap.setScanParameters).toHaveBeenCalledTimes(1);
    expect(bindings._gap.setScanParameters).toHaveBeenCalledWith('interval', 'window');
  });

  describe('startScanning', () => {
    it('no args, already scanning', () => {
      bindings._isScanning = true;
      const scanStartSpy = jest.fn();
      bindings.on('scanStart', scanStartSpy);

      bindings.startScanning();

      should(bindings._scanServiceUuids).deepEqual([]);
      expect(scanStartSpy).toHaveBeenCalledTimes(1);
      expect(bindings._gap.startScanning).not.toHaveBeenCalled();
    });

    it('no args, not scanning but started', () => {
      bindings._isScanning = false;
      bindings._isScanningStarted = true;
      bindings._gap.startScanning = jest.fn();

      bindings.startScanning();

      should(bindings._scanServiceUuids).deepEqual([]);
      expect(bindings._gap.startScanning).not.toHaveBeenCalled();
    });

    it('with args, first time', () => {
      bindings._isScanning = false;
      bindings._isScanningStarted = false;
      bindings._gap.startScanning = jest.fn();

      bindings.startScanning(['uuid'], true);

      should(bindings._scanServiceUuids).deepEqual(['uuid']);
      should(bindings._isScanningStarted).true();

      expect(bindings._gap.startScanning).toHaveBeenCalledTimes(1);
      expect(bindings._gap.startScanning).toHaveBeenCalledWith(true);
    });
  });

  describe('stopScanning', () => {
    it('when scanning', () => {
      bindings._isScanning = true;
      bindings._gap.stopScanning = jest.fn();

      bindings.stopScanning();

      expect(bindings._gap.stopScanning).toHaveBeenCalledTimes(1);
    });

    it('when not scanning', () => {
      bindings._isScanning = false;
      bindings._gap.stopScanning = jest.fn();
      const scanStopSpy = jest.fn();
      bindings.on('scanStop', scanStopSpy);

      bindings.stopScanning();

      expect(bindings._gap.stopScanning).toHaveBeenCalledTimes(1);
      expect(scanStopSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('setAddress', () => {
    bindings.setAddress('test-address');

    expect(bindings._hci.setAddress).toHaveBeenCalledTimes(1);
    expect(bindings._hci.setAddress).toHaveBeenCalledWith('test-address');
  });

  describe('connect', () => {
    it('missing peripheral, no queue, public address', () => {
      bindings._hci.createLeConn = jest.fn();

      bindings.connect('112233445566', { addressType: 'public' });

      should(bindings._connectionQueue).length(1);
      should(bindings._connectionQueue[0].id).eql('112233445566');
      should(bindings._connectionQueue[0].params).eql({ addressType: 'public' });

      expect(bindings._hci.createLeConn).toHaveBeenCalledTimes(1);
      expect(bindings._hci.createLeConn).toHaveBeenCalledWith('11:22:33:44:55:66', 'public', { addressType: 'public' });
    });

    it('missing peripheral, no queue, random address', () => {
      bindings._hci.createLeConn = jest.fn();

      bindings.connect('f32233445566', { addressType: 'random' });

      should(bindings._connectionQueue).length(1);
      should(bindings._connectionQueue[0].id).eql('f32233445566');
      should(bindings._connectionQueue[0].params).eql({ addressType: 'random' });

      expect(bindings._hci.createLeConn).toHaveBeenCalledTimes(1);
      expect(bindings._hci.createLeConn).toHaveBeenCalledWith('f3:22:33:44:55:66', 'random', { addressType: 'random' });
    });

    it('existing peripheral, no queue', () => {
      bindings._hci.createLeConn = jest.fn();
      bindings._addresses = {
        peripheralUuid: 'address'
      };
      bindings._addresseTypes = {
        peripheralUuid: 'addressType'
      };

      bindings.connect('peripheralUuid', 'parameters');

      should(bindings._connectionQueue).length(1);
      should(bindings._connectionQueue[0].id).eql('peripheralUuid');
      should(bindings._connectionQueue[0].params).eql('parameters');

      expect(bindings._hci.createLeConn).toHaveBeenCalledTimes(1);
      expect(bindings._hci.createLeConn).toHaveBeenCalledWith('address', 'addressType', 'parameters');
    });

    it('missing peripheral, with queue', () => {
      bindings._pendingConnectionUuid = 'pending-uuid';

      bindings.connect('peripheralUuid', 'parameters');
      
      should(bindings._connectionQueue).length(1);
      should(bindings._connectionQueue[0].id).eql('peripheralUuid');
      should(bindings._connectionQueue[0].params).eql('parameters');
    });
  });

  describe('disconnect', () => {
    it('missing handle', () => {
      bindings._hci.disconnect = jest.fn();

      bindings.disconnect('peripheralUuid');

      expect(bindings._hci.disconnect).toHaveBeenCalledTimes(1);
      expect(bindings._hci.disconnect).toHaveBeenCalledWith(undefined);
    });

    it('existing handle', () => {
      bindings._handles = {
        peripheralUuid: 'handle'
      };
      bindings._hci.disconnect = jest.fn();

      bindings.disconnect('peripheralUuid');

      expect(bindings._hci.disconnect).toHaveBeenCalledTimes(1);
      expect(bindings._hci.disconnect).toHaveBeenCalledWith('handle');
    });
  });

  describe('cancel', () => {
    it('missing handle', () => {
      bindings._connectionQueue.push({ id: 'anotherPeripheralUuid' });

      bindings._hci.cancelConnect = jest.fn();

      bindings.cancelConnect('peripheralUuid');

      should(bindings._connectionQueue).size(1);

      expect(bindings._hci.cancelConnect).toHaveBeenCalledTimes(1);
      expect(bindings._hci.cancelConnect).toHaveBeenCalledWith(undefined);
    });

    it('existing handle', () => {
      bindings._handles = {
        peripheralUuid: 'handle'
      };
      bindings._connectionQueue.push({ id: 'anotherPeripheralUuid' });
      bindings._connectionQueue.push({ id: 'peripheralUuid' });
      bindings._hci.cancelConnect = jest.fn();

      bindings.cancelConnect('peripheralUuid');

      should(bindings._connectionQueue).size(1);

      expect(bindings._hci.cancelConnect).toHaveBeenCalledTimes(1);
      expect(bindings._hci.cancelConnect).toHaveBeenCalledWith('handle');
    });
  });

  describe('updateRssi', () => {
    it('missing handle', () => {
      bindings._hci.readRssi = jest.fn();

      bindings.updateRssi('peripheralUuid');

      expect(bindings._hci.readRssi).toHaveBeenCalledTimes(1);
      expect(bindings._hci.readRssi).toHaveBeenCalledWith(undefined);
    });

    it('existing handle', () => {
      bindings._handles = {
        peripheralUuid: 'handle'
      };
      bindings._hci.readRssi = jest.fn();

      bindings.updateRssi('peripheralUuid');

      expect(bindings._hci.readRssi).toHaveBeenCalledTimes(1);
      expect(bindings._hci.readRssi).toHaveBeenCalledWith('handle');
    });
  });

  describe('stop', () => {
    it('no handles', () => {
      bindings._isScanning = true;
      bindings._gap.stopScanning = jest.fn();
      bindings._hci.reset = jest.fn();
      bindings._hci.stop = jest.fn();
      bindings._sigIntHandler = jest.fn();
      bindings._exitHandler = jest.fn();
      
      bindings.stop();
      
      expect(bindings._gap.stopScanning).toHaveBeenCalledTimes(1);
      expect(bindings._hci.reset).not.toHaveBeenCalled();  // Reset is not called in stop()
      expect(bindings._hci.stop).toHaveBeenCalledTimes(1);
    });

    it('with handles', () => {
      bindings._isScanning = true;
      bindings._gap.stopScanning = jest.fn();
      bindings._hci.disconnect = jest.fn();
      bindings._hci.reset = jest.fn();
      bindings._hci.stop = jest.fn();
      bindings._sigIntHandler = jest.fn();
      bindings._exitHandler = jest.fn();

      bindings._aclStreams = [1, 2, 3];

      bindings.stop();

      expect(bindings._gap.stopScanning).toHaveBeenCalledTimes(1);
      expect(bindings._hci.disconnect).toHaveBeenCalledTimes(3);
    });
  });

  describe('onStateChange', () => {
    it('same state', () => {
      const stateChange = jest.fn();

      bindings._state = 'state';
      bindings.on('stateChange', stateChange);

      bindings.onStateChange('state');

      expect(stateChange).not.toHaveBeenCalled();
    });

    it('new state', () => {
      const stateChange = jest.fn();

      bindings._state = 'state';
      bindings.on('stateChange', stateChange);

      bindings.onStateChange('newState');

      expect(stateChange).toHaveBeenCalledTimes(1);
      expect(stateChange).toHaveBeenCalledWith('newState');
    });

    it('unauthorized', () => {
      const stateChange = jest.fn();

      bindings._state = 'state';
      bindings.on('stateChange', stateChange);
      
      jest.spyOn(console, 'log').mockImplementation(() => {});

      bindings.onStateChange('unauthorized');

      expect(stateChange).toHaveBeenCalledTimes(1);
      expect(stateChange).toHaveBeenCalledWith('unauthorized');

      expect(console.log).toHaveBeenCalledTimes(3);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('adapter state unauthorized'));
    });

    it('unsupported', () => {
      const stateChange = jest.fn();

      bindings._state = 'state';
      bindings.on('stateChange', stateChange);

      jest.spyOn(console, 'log').mockImplementation(() => {});

      bindings.onStateChange('unsupported');

      expect(stateChange).toHaveBeenCalledTimes(1);
      expect(stateChange).toHaveBeenCalledWith('unsupported');
      expect(console.log).toHaveBeenCalledTimes(3);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('adapter does not support Bluetooth'));
    });
  });

  it('onAddressChange', () => {
    const onAddressChange = jest.fn();

    bindings.on('addressChange', onAddressChange);

    bindings.onAddressChange('newAddress');

    expect(onAddressChange).toHaveBeenCalledTimes(1);
    expect(onAddressChange).toHaveBeenCalledWith('newAddress');
  });

  it('onScanParametersSet', () => {
    const onScanParametersSet = jest.fn();

    bindings.on('scanParametersSet', onScanParametersSet);

    bindings.onScanParametersSet();

    expect(onScanParametersSet).toHaveBeenCalledTimes(1);
  });

  it('onScanStart', () => {
    const onScanStart = jest.fn();

    bindings.on('scanStart', onScanStart);

    bindings.onScanStart('filterDuplicates');

    expect(onScanStart).toHaveBeenCalledTimes(1);
    expect(onScanStart).toHaveBeenCalledWith('filterDuplicates');
  });

  it('onScanStop', () => {
    const onScanStop = jest.fn();

    bindings.on('scanStop', onScanStop);

    bindings.onScanStop();

    expect(onScanStop).toHaveBeenCalledTimes(1);
  });

  describe('onDiscover', () => {
    it('new device, no scanServiceUuids', () => {
      const onDiscover = jest.fn();

      bindings.on('discover', onDiscover);

      bindings._scanServiceUuids = [];

      const status = 'status';
      const address = 'address:as:mac';
      const addressType = 'addressType';
      const connectable = 'connectable';
      const advertisement = 'advertisement';
      const rssi = 'rssi';
      bindings.onDiscover(status, address, addressType, connectable, advertisement, rssi, undefined);

      const uuid = 'addressasmac';
      should(bindings._addresses).deepEqual({ [uuid]: address });
      should(bindings._addresseTypes).deepEqual({ [uuid]: addressType });
      should(bindings._connectable).deepEqual({ [uuid]: connectable });

      expect(onDiscover).toHaveBeenCalledTimes(1);
      expect(onDiscover).toHaveBeenCalledWith(uuid, address, addressType, connectable, advertisement, rssi, undefined);
    });

    it('new device, with matching scanServiceUuids', () => {
      const onDiscover = jest.fn();

      bindings.on('discover', onDiscover);

      bindings._scanServiceUuids = ['service-uuid'];

      const status = 'status';
      const address = 'address:as:mac';
      const addressType = 'addressType';
      const connectable = 'connectable';
      const advertisement = {
        serviceUuids: ['service-uuid']
      };
      const rssi = 'rssi';
      bindings.onDiscover(status, address, addressType, connectable, advertisement, rssi, undefined);

      const uuid = 'addressasmac';
      should(bindings._addresses).deepEqual({ [uuid]: address });
      should(bindings._addresseTypes).deepEqual({ [uuid]: addressType });
      should(bindings._connectable).deepEqual({ [uuid]: connectable });

      expect(onDiscover).toHaveBeenCalledTimes(1);
      expect(onDiscover).toHaveBeenCalledWith(uuid, address, addressType, connectable, advertisement, rssi, undefined);
    });

    it('new device, with non-matching scanServiceUuids', () => {
      const onDiscover = jest.fn();

      bindings.on('discover', onDiscover);

      bindings._scanServiceUuids = ['service-uuid'];

      const status = 'status';
      const address = 'address:as:mac';
      const addressType = 'addressType';
      const connectable = 'connectable';
      const advertisement = {
        serviceUuids: ['another-service-uuid']
      };
      const rssi = 'rssi';
      bindings.onDiscover(status, address, addressType, connectable, advertisement, rssi, undefined);

      should(bindings._addresses).deepEqual({});
      should(bindings._addresseTypes).deepEqual({});
      should(bindings._connectable).deepEqual({});

      expect(onDiscover).not.toHaveBeenCalled();
    });

    it('new device, with service data on advertisement', () => {
      const onDiscover = jest.fn();

      bindings.on('discover', onDiscover);

      bindings._scanServiceUuids = ['service-uuid'];

      const status = 'status';
      const address = 'address:as:mac';
      const addressType = 'addressType';
      const connectable = 'connectable';
      const advertisement = {
        serviceData: [{ uuid: 'service-uuid' }]
      };
      const rssi = 'rssi';
      bindings.onDiscover(status, address, addressType, connectable, advertisement, rssi, undefined);

      const uuid = 'addressasmac';
      should(bindings._addresses).deepEqual({ [uuid]: address });
      should(bindings._addresseTypes).deepEqual({ [uuid]: addressType });
      should(bindings._connectable).deepEqual({ [uuid]: connectable });

      expect(onDiscover).toHaveBeenCalledTimes(1);
      expect(onDiscover).toHaveBeenCalledWith(uuid, address, addressType, connectable, advertisement, rssi, undefined);
    });

    it('new device, non matching service data on advertisement', () => {
      const onDiscover = jest.fn();

      bindings.on('discover', onDiscover);

      bindings._scanServiceUuids = ['service-uuid'];

      const status = 'status';
      const address = 'address:as:mac';
      const addressType = 'addressType';
      const connectable = 'connectable';
      const advertisement = {
        serviceData: [{ uuid: 'another-service-uuid' }]
      };
      const rssi = 'rssi';
      bindings.onDiscover(status, address, addressType, connectable, advertisement, rssi, undefined);

      should(bindings._addresses).deepEqual({});
      should(bindings._addresseTypes).deepEqual({});
      should(bindings._connectable).deepEqual({});

      expect(onDiscover).not.toHaveBeenCalled();
    });

    it('new device, no services on advertisement', () => {
      const onDiscover = jest.fn();

      bindings.on('discover', onDiscover);

      bindings._scanServiceUuids = ['service-uuid'];

      const status = 'status';
      const address = 'address:as:mac';
      const addressType = 'addressType';
      const connectable = 'connectable';
      const advertisement = {};
      const rssi = 'rssi';
      bindings.onDiscover(status, address, addressType, connectable, advertisement, rssi, undefined);

      should(bindings._addresses).deepEqual({});
      should(bindings._addresseTypes).deepEqual({});
      should(bindings._connectable).deepEqual({});

      expect(onDiscover).not.toHaveBeenCalled();
    });

    it('new device, undefined _scanServiceUuids', () => {
      const onDiscover = jest.fn();

      bindings.on('discover', onDiscover);

      bindings._scanServiceUuids = undefined;

      const status = 'status';
      const address = 'address:as:mac';
      const addressType = 'addressType';
      const connectable = 'connectable';
      const advertisement = {
        serviceData: [{ uuid: 'service-uuid' }]
      };
      const rssi = 'rssi';
      bindings.onDiscover(status, address, addressType, connectable, advertisement, rssi, undefined);

      should(bindings._addresses).deepEqual({});
      should(bindings._addresseTypes).deepEqual({});
      should(bindings._connectable).deepEqual({});

      expect(onDiscover).not.toHaveBeenCalled();
    });
  });

  describe('onLeConnComplete', () => {
    it('not on master node', () => {
      const status = 1;
      const handle = 'handle';
      const role = 'not-master';
      const addressType = 'addressType';
      const address = 'address';

      const connectCallback = jest.fn();

      bindings.on('connect', connectCallback);
      bindings.onLeConnComplete(status, handle, role, addressType, address);

      expect(connectCallback).not.toHaveBeenCalled();
    });

    it('with right status on master node', () => {
      const status = 0;
      const handle = 'handle';
      const role = 0;
      const addressType = 'addressType';
      const address = 'address:split:by:separator';

      const connectCallback = jest.fn();

      bindings.on('connect', connectCallback);
      bindings.onLeConnComplete(status, handle, role, addressType, address);

      jest.advanceTimersByTime(0);

      expect(AclStream).toHaveBeenCalledTimes(1);
      expect(Gatt).toHaveBeenCalledTimes(1);
      expect(Signaling).toHaveBeenCalledTimes(1);

      expect(Gatt.onMock).toHaveBeenCalledTimes(17);
      expect(Gatt.onMock).toHaveBeenCalledWith(expect.any(String), expect.any(Function));
      expect(Gatt.onMock).toHaveBeenCalledWith(expect.any(String), expect.any(Function));
      expect(Gatt.onMock).toHaveBeenCalledWith(expect.any(String), expect.any(Function));
      expect(Gatt.onMock).toHaveBeenCalledWith(expect.any(String), expect.any(Function));
      expect(Gatt.onMock).toHaveBeenCalledWith(expect.any(String), expect.any(Function));
      expect(Gatt.onMock).toHaveBeenCalledWith(expect.any(String), expect.any(Function));
      expect(Gatt.onMock).toHaveBeenCalledWith(expect.any(String), expect.any(Function));
      expect(Gatt.onMock).toHaveBeenCalledWith(expect.any(String), expect.any(Function));
      expect(Gatt.onMock).toHaveBeenCalledWith(expect.any(String), expect.any(Function));
      expect(Gatt.onMock).toHaveBeenCalledWith(expect.any(String), expect.any(Function));
      expect(Gatt.onMock).toHaveBeenCalledWith(expect.any(String), expect.any(Function));
      expect(Gatt.onMock).toHaveBeenCalledWith(expect.any(String), expect.any(Function));
      expect(Gatt.onMock).toHaveBeenCalledWith(expect.any(String), expect.any(Function));
      expect(Gatt.onMock).toHaveBeenCalledWith(expect.any(String), expect.any(Function));
      expect(Gatt.onMock).toHaveBeenCalledWith(expect.any(String), expect.any(Function));
      expect(Gatt.onMock).toHaveBeenCalledWith(expect.any(String), expect.any(Function));

      expect(Signaling.onMock).toHaveBeenCalledTimes(1);
      expect(Signaling.onMock).toHaveBeenCalledWith(expect.any(String), expect.any(Function));

      expect(Gatt.exchangeMtuMock).toHaveBeenCalledTimes(1);

      expect(connectCallback).toHaveBeenCalledTimes(1);
      expect(connectCallback).toHaveBeenCalledWith('addresssplitbyseparator', null);

      should(bindings._pendingConnectionUuid).equal(null);
    });

    it('with invalid status on master node', () => {
      const status = 1;
      const handle = 'handle';
      const role = 0;
      const addressType = 'addressType';
      const address = 'address:split:by:separator';

      const connectCallback = jest.fn();

      bindings._connectionQueue.push({ id: 'pending_uuid' });
      bindings.on('connect', connectCallback);
      bindings.onLeConnComplete(status, handle, role, addressType, address);

      expect(AclStream).not.toHaveBeenCalled();
      expect(Gatt).not.toHaveBeenCalled();
      expect(Signaling).not.toHaveBeenCalled();

      expect(connectCallback).toHaveBeenCalledTimes(1);
      expect(connectCallback).toHaveBeenCalledWith('pending_uuid', expect.objectContaining({ 
        message: 'custom mapper (0x1)' 
      }));

      should(bindings._connectionQueue).length(0);
    });

    it('with unmapped status on master node', () => {
      const status = 2;
      const handle = 'handle';
      const role = 0;
      const addressType = 'addressType';
      const address = 'address:split:by:separator';

      const connectCallback = jest.fn();

      bindings._connectionQueue.push({ id: 'pending_uuid' });
      bindings.on('connect', connectCallback);
      bindings.onLeConnComplete(status, handle, role, addressType, address);

      expect(AclStream).not.toHaveBeenCalled();
      expect(Gatt).not.toHaveBeenCalled();
      expect(Signaling).not.toHaveBeenCalled();

      expect(connectCallback).toHaveBeenCalledTimes(1);
      expect(connectCallback).toHaveBeenCalledWith('pending_uuid', expect.objectContaining({ 
        message: 'HCI Error: Unknown (0x2)' 
      }));

      should(bindings._connectionQueue).length(0);
    });

    it('with connection queue', () => {
      const status = 0;
      const handle = 'handle';
      const role = 0;
      const addressType = 'random';
      const address = '11:22:33:44:55:66';

      const connectCallback = jest.fn();

      bindings._addresses = { 'queuedId_1': '112233445566', 'queuedId_2': '998877665544' };
      bindings._addresseTypes = { 'queuedId_1': 'random', 'queuedId_2': 'public' };
      bindings.connect('queuedId_1', { addressType: 'random' });
      bindings.connect('queuedId_2', { addressType: 'public' });

      bindings.on('connect', connectCallback);
      bindings.onLeConnComplete(status, handle, role, addressType, address);

      expect(connectCallback).toHaveBeenCalledTimes(1);
      expect(connectCallback).toHaveBeenCalledWith('112233445566', null);
      expect(Hci.createLeConnSpy).toHaveBeenCalledTimes(2);
      expect(Hci.createLeConnSpy).toHaveBeenCalledWith('112233445566', 'random', { addressType: 'random' });
      expect(Hci.createLeConnSpy).toHaveBeenCalledWith('998877665544', 'public', { addressType: 'public' });

      should(bindings._connectionQueue).length(1);
    });

    it('with longer connection queue', () => {
      const status = 0;
      const handle = 'handle';
      const role = 0;
      const addressType = 'random';
      const address = '11:22:33:44:55:66';

      const connectCallback = jest.fn();

      bindings._addresses = { 'queuedId_1': '112233445566', 'queuedId_2': '998877665544', 'queuedId_3': 'aabbccddeeff' };
      bindings._addresseTypes = { 'queuedId_1': 'random', 'queuedId_2': 'public', 'queuedId_3': 'random' };
      bindings.connect('queuedId_1', { addressType: 'random' });
      bindings.connect('queuedId_2', { addressType: 'public' });
      bindings.connect('queuedId_3', { addressType: 'random' });

      bindings.on('connect', connectCallback);
      bindings.onLeConnComplete(status, handle, role, addressType, address);

      expect(connectCallback).toHaveBeenCalledTimes(1);
      expect(connectCallback).toHaveBeenCalledWith('112233445566', null);
      expect(Hci.createLeConnSpy).toHaveBeenCalledTimes(2);
      expect(Hci.createLeConnSpy).toHaveBeenCalledWith('112233445566', 'random', { addressType: 'random' });
      expect(Hci.createLeConnSpy).toHaveBeenCalledWith('998877665544', 'public', { addressType: 'public' });
      expect(bindings._connectionQueue).toHaveLength(2);
    });

    it('with longer connection queue where 2 connections are completed', () => {
      const status = 0;
      const handle = 'handle';
      const role = 0;
      const addressType = 'random';
      const address = '11:22:33:44:55:66';

      const status2 = 0;
      const handle2 = 'handle2';
      const role2 = 0;
      const addressType2 = 'public';
      const address2 = '99:88:77:66:55:44';

      const connectCallback = jest.fn();

      bindings._addresses = { 'queuedId_1': '112233445566', 'queuedId_2': '998877665544', 'queuedId_3': 'aabbccddeeff' };
      bindings._addresseTypes = { 'queuedId_1': 'random', 'queuedId_2': 'public', 'queuedId_3': 'random' };
      bindings.connect('queuedId_1', { addressType: 'random' });
      bindings.connect('queuedId_2', { addressType: 'public' });
      bindings.connect('queuedId_3', { addressType: 'random' });

      bindings.on('connect', connectCallback);

      bindings.onLeConnComplete(status, handle, role, addressType, address);
      bindings.onLeConnComplete(status2, handle2, role2, addressType2, address2);

      expect(connectCallback).toHaveBeenCalledTimes(2);
      
      expect(connectCallback).toHaveBeenCalledWith('112233445566', null);
      expect(connectCallback).toHaveBeenCalledWith('998877665544', null);

      expect(Hci.createLeConnSpy).toHaveBeenCalledTimes(3);
      expect(Hci.createLeConnSpy).toHaveBeenCalledWith('112233445566', 'random', { addressType: 'random' });
      expect(Hci.createLeConnSpy).toHaveBeenCalledWith('998877665544', 'public', { addressType: 'public' });
      expect(Hci.createLeConnSpy).toHaveBeenCalledWith('aabbccddeeff', 'random', { addressType: 'random' });
      expect(bindings._connectionQueue).toHaveLength(1);
    });
  });

  describe('onDisconnComplete', () => {
    it('handle not found', () => {
      const disconnectCallback = jest.fn();

      bindings.on('disconnect', disconnectCallback);
      bindings.onDisconnComplete('missing', 'reason');

      expect(disconnectCallback).not.toHaveBeenCalled();
    });

    it('existing handle', () => {
      const disconnectCallback = jest.fn();
      const handle = 'handle';
      const anotherHandle = 'another_handle';
      const uuid = 'uuid';
      const anotherUuid = 'another_uuid';
      const reason = 'reason';

      const gattSpy = {
        removeAllListeners: jest.fn()
      };
      const signalingSpy = {
        removeAllListeners: jest.fn()
      };

      // Init expected
      bindings._handles[uuid] = uuid;
      bindings._handles[handle] = uuid;
      bindings._handles[anotherUuid] = uuid;
      bindings._handles[anotherHandle] = anotherUuid;
      bindings._aclStreams[handle] = [];
      bindings._aclStreams[anotherHandle] = [];
      bindings._gatts[handle] = gattSpy;
      bindings._gatts[uuid] = gattSpy;
      bindings._gatts[anotherHandle] = gattSpy;
      bindings._gatts[anotherUuid] = gattSpy;
      bindings._signalings[uuid] = signalingSpy;
      bindings._signalings[handle] = signalingSpy;
      bindings._signalings[anotherUuid] = signalingSpy;
      bindings._signalings[anotherHandle] = signalingSpy;

      bindings.on('disconnect', disconnectCallback);
      bindings.onDisconnComplete(handle, reason);

      expect(disconnectCallback).toHaveBeenCalledTimes(1);
      expect(disconnectCallback).toHaveBeenCalledWith(uuid, reason);
      expect(gattSpy.removeAllListeners).toHaveBeenCalledTimes(1);
      expect(signalingSpy.removeAllListeners).toHaveBeenCalledTimes(1);

      should(bindings._handles).not.have.keys(uuid, handle);
      should(bindings._aclStreams).not.have.keys(handle);
      should(bindings._gatts).not.have.keys(uuid, handle);
      should(bindings._signalings).not.have.keys(uuid, handle);
    });
  });

  describe('onEncryptChange', () => {
    it('missing handle', () => {
      const handle = 'handle';
      const anotherHandle = 'another_handle';
      const encrypt = 'encrypt';
      const aclSpy = {
        pushEncrypt: jest.fn()
      };

      bindings._aclStreams[handle] = aclSpy;
      bindings.onEncryptChange(anotherHandle, encrypt);

      expect(aclSpy.pushEncrypt).not.toHaveBeenCalled();
    });

    it('existing handle', () => {
      const handle = 'handle';
      const encrypt = 'encrypt';
      const aclSpy = {
        pushEncrypt: jest.fn()
      };

      bindings._aclStreams[handle] = aclSpy;
      bindings.onEncryptChange(handle, encrypt);

      expect(aclSpy.pushEncrypt).toHaveBeenCalledTimes(1);
      expect(aclSpy.pushEncrypt).toHaveBeenCalledWith(encrypt);
    });

    it('existing handle no encrypt', () => {
      const handle = 'handle';
      const aclSpy = {
        pushEncrypt: jest.fn()
      };

      bindings._aclStreams[handle] = aclSpy;
      bindings.onEncryptChange(handle);

      expect(aclSpy.pushEncrypt).toHaveBeenCalledTimes(1);
      expect(aclSpy.pushEncrypt).toHaveBeenCalledWith(undefined);
    });
  });

  it('onMtu', () => {
    const address = 'this:is:an:address';
    const rssi = 'rssi';
    const callback = jest.fn();

    bindings.on('onMtu', callback);
    bindings.onMtu(address, rssi);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('thisisanaddress', rssi);
  });

  it('onRssiRead', () => {
    const handle = 'handle';
    const rssi = 'rssi';
    const callback = jest.fn();

    bindings._handles[handle] = 'binding_handle';
    bindings.on('rssiUpdate', callback);
    bindings.onRssiRead(handle, rssi);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('binding_handle', rssi);
  });

  describe('onAclDataPkt', () => {
    it('missing handle', () => {
      const handle = 'handle';
      const anotherHandle = 'another_handle';
      const cid = 'cid';
      const data = 'data';
      const aclSpy = {
        push: jest.fn()
      };

      bindings._aclStreams[handle] = aclSpy;
      bindings.onAclDataPkt(anotherHandle, cid, data);

      expect(aclSpy.push).not.toHaveBeenCalled();
    });

    it('existing handle', () => {
      const handle = 'handle';
      const cid = 'cid';
      const data = 'data';
      const aclSpy = {
        push: jest.fn()
      };

      bindings._aclStreams[handle] = aclSpy;
      bindings.onAclDataPkt(handle, cid, data);

      expect(aclSpy.push).toHaveBeenCalledTimes(1);
      expect(aclSpy.push).toHaveBeenCalledWith(cid, data);
    });

    it('existing handle no cid no data', () => {
      const handle = 'handle';
      const aclSpy = {
        push: jest.fn()
      };

      bindings._aclStreams[handle] = aclSpy;
      bindings.onAclDataPkt(handle);

      expect(aclSpy.push).toHaveBeenCalledTimes(1);
      expect(aclSpy.push).toHaveBeenCalledWith(undefined, undefined);
    });
  });

  describe('addService', () => {
    it('missing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const anotherHandle = 'another_handle';
      const service = 'service';
      const gatt = {
        addService: jest.fn()
      };

      bindings._handles[peripheralUuid] = anotherHandle;
      bindings._gatts[handle] = gatt;
      bindings.addService(peripheralUuid, service);

      expect(gatt.addService).not.toHaveBeenCalled();
    });

    it('existing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const service = 'service';
      const gatt = {
        addService: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.addService(peripheralUuid, service);

      expect(gatt.addService).toHaveBeenCalledTimes(1);
      expect(gatt.addService).toHaveBeenCalledWith(service);
    });

    it('existing gatt no service', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const gatt = {
        addService: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.addService(peripheralUuid);

      expect(gatt.addService).toHaveBeenCalledTimes(1);
      expect(gatt.addService).toHaveBeenCalledWith(undefined);
    });
  });

  describe('discoverServices', () => {
    it('missing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const anotherHandle = 'another_handle';
      const uuids = 'uuids';
      const gatt = {
        discoverServices: jest.fn()
      };

      bindings._handles[peripheralUuid] = anotherHandle;
      bindings._gatts[handle] = gatt;
      bindings.discoverServices(peripheralUuid, uuids);

      expect(gatt.discoverServices).not.toHaveBeenCalled();
    });

    it('existing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const uuids = 'uuids';
      const gatt = {
        discoverServices: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.discoverServices(peripheralUuid, uuids);

      expect(gatt.discoverServices).toHaveBeenCalledTimes(1);
      expect(gatt.discoverServices).toHaveBeenCalledWith(uuids);
    });

    it('existing gatt no uuids', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const gatt = {
        discoverServices: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.discoverServices(peripheralUuid);

      expect(gatt.discoverServices).toHaveBeenCalledTimes(1);
      expect(gatt.discoverServices).toHaveBeenCalledWith([]);
    });
  });

  it('onServicesDiscovered', () => {
    const address = 'this:is:an:address';
    const serviceUuids = 'serviceUuids';
    const callback = jest.fn();

    bindings.on('servicesDiscover', callback);
    bindings.onServicesDiscovered(address, serviceUuids);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('thisisanaddress', serviceUuids);
  });

  it('onServicesDiscoveredEX', () => {
    const address = 'this:is:an:address';
    const serviceUuids = 'serviceUuids';
    const callback = jest.fn();

    bindings.on('servicesDiscovered', callback);
    bindings.onServicesDiscoveredEX(address, serviceUuids);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('thisisanaddress', serviceUuids);
  });

  describe('discoverIncludedServices', () => {
    it('missing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const anotherHandle = 'another_handle';
      const serviceUuid = 'service-uuid';
      const serviceUuids = 'serviceUuids';
      const gatt = {
        discoverIncludedServices: jest.fn()
      };

      bindings._handles[peripheralUuid] = anotherHandle;
      bindings._gatts[handle] = gatt;
      bindings.discoverIncludedServices(peripheralUuid, serviceUuid, serviceUuids);

      expect(gatt.discoverIncludedServices).not.toHaveBeenCalled();
    });

    it('existing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const serviceUuid = 'service-uuid';
      const serviceUuids = 'serviceUuids';
      const gatt = {
        discoverIncludedServices: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.discoverIncludedServices(peripheralUuid, serviceUuid, serviceUuids);

      expect(gatt.discoverIncludedServices).toHaveBeenCalledTimes(1);
      expect(gatt.discoverIncludedServices).toHaveBeenCalledWith(serviceUuid, serviceUuids);
    });

    it('existing gatt no uuids', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const serviceUuid = 'service-uuid';
      const gatt = {
        discoverIncludedServices: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.discoverIncludedServices(peripheralUuid, serviceUuid);

      expect(gatt.discoverIncludedServices).toHaveBeenCalledTimes(1);
      expect(gatt.discoverIncludedServices).toHaveBeenCalledWith(serviceUuid, []);
    });
  });

  it('onIncludedServicesDiscovered', () => {
    const address = 'this:is:an:address';
    const serviceUuid = 'serviceUuid';
    const includedServiceUuids = 'includedServiceUuids';
    const callback = jest.fn();

    bindings.on('includedServicesDiscover', callback);
    bindings.onIncludedServicesDiscovered(address, serviceUuid, includedServiceUuids);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('thisisanaddress', serviceUuid, includedServiceUuids);
  });

  describe('addCharacteristics', () => {
    it('missing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const anotherHandle = 'another_handle';
      const serviceUuid = 'serviceUuid';
      const characteristics = 'characteristics';
      const gatt = {
        addCharacteristics: jest.fn()
      };

      bindings._handles[peripheralUuid] = anotherHandle;
      bindings._gatts[handle] = gatt;
      bindings.addCharacteristics(peripheralUuid, serviceUuid, characteristics);

      expect(gatt.addCharacteristics).not.toHaveBeenCalled();
    });

    it('existing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const serviceUuid = 'serviceUuid';
      const characteristics = 'characteristics';
      const gatt = {
        addCharacteristics: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.addCharacteristics(peripheralUuid, serviceUuid, characteristics);

      expect(gatt.addCharacteristics).toHaveBeenCalledTimes(1);
      expect(gatt.addCharacteristics).toHaveBeenCalledWith(serviceUuid, characteristics);
    });

    it('existing gatt no serviceUuid no characteristics', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const gatt = {
        addCharacteristics: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.addCharacteristics(peripheralUuid);

      expect(gatt.addCharacteristics).toHaveBeenCalledTimes(1);
      expect(gatt.addCharacteristics).toHaveBeenCalledWith(undefined, undefined);
    });
  });

  describe('discoverCharacteristics', () => {
    it('missing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const anotherHandle = 'another_handle';
      const serviceUuid = 'serviceUuid';
      const characteristicUuids = 'characteristics';
      const gatt = {
        discoverCharacteristics: jest.fn()
      };

      bindings._handles[peripheralUuid] = anotherHandle;
      bindings._gatts[handle] = gatt;
      bindings.discoverCharacteristics(peripheralUuid, serviceUuid, characteristicUuids);

      expect(gatt.discoverCharacteristics).not.toHaveBeenCalled();
    });

    it('existing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const serviceUuid = 'serviceUuid';
      const characteristicUuids = 'characteristics';
      const gatt = {
        discoverCharacteristics: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.discoverCharacteristics(peripheralUuid, serviceUuid, characteristicUuids);

      expect(gatt.discoverCharacteristics).toHaveBeenCalledTimes(1);
      expect(gatt.discoverCharacteristics).toHaveBeenCalledWith(serviceUuid, characteristicUuids);
    });

    it('existing gatt no uuids', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const serviceUuid = 'serviceUuid';
      const gatt = {
        discoverCharacteristics: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.discoverCharacteristics(peripheralUuid, serviceUuid);

      expect(gatt.discoverCharacteristics).toHaveBeenCalledTimes(1);
      expect(gatt.discoverCharacteristics).toHaveBeenCalledWith(serviceUuid, []);
    });
  });

  it('onCharacteristicsDiscovered', () => {
    const address = 'this:is:an:address';
    const serviceUuid = 'serviceUuid';
    const characteristics = 'characteristics';
    const callback = jest.fn();

    bindings.on('characteristicsDiscover', callback);
    bindings.onCharacteristicsDiscovered(address, serviceUuid, characteristics);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('thisisanaddress', serviceUuid, characteristics);
  });

  it('onCharacteristicsDiscoveredEX', () => {
    const address = 'this:is:an:address';
    const serviceUuid = 'serviceUuid';
    const characteristics = 'characteristics';
    const callback = jest.fn();

    bindings.on('characteristicsDiscovered', callback);
    bindings.onCharacteristicsDiscoveredEX(address, serviceUuid, characteristics);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('thisisanaddress', serviceUuid, characteristics);
  });

  describe('read', () => {
    it('missing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const anotherHandle = 'another_handle';
      const serviceUuid = 'serviceUuid';
      const characteristicUuid = 'characteristic';
      const gatt = {
        read: jest.fn()
      };

      bindings._handles[peripheralUuid] = anotherHandle;
      bindings._gatts[handle] = gatt;
      bindings.read(peripheralUuid, serviceUuid, characteristicUuid);

      expect(gatt.read).not.toHaveBeenCalled();
    });

    it('existing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const serviceUuid = 'serviceUuid';
      const characteristicUuid = 'characteristics';
      const gatt = {
        read: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.read(peripheralUuid, serviceUuid, characteristicUuid);

      expect(gatt.read).toHaveBeenCalledTimes(1);
      expect(gatt.read).toHaveBeenCalledWith(serviceUuid, characteristicUuid);
    });

    it('existing gatt no uuids', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const gatt = {
        read: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.read(peripheralUuid);

      expect(gatt.read).toHaveBeenCalledTimes(1);
      expect(gatt.read).toHaveBeenCalledWith(undefined, undefined);
    });
  });

  it('onRead', () => {
    const address = 'this:is:an:address';
    const serviceUuid = 'serviceUuid';
    const characteristicUuid = 'characteristics';
    const data = 'data';
    const callback = jest.fn();

    bindings.on('read', callback);
    bindings.onRead(address, serviceUuid, characteristicUuid, data);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('thisisanaddress', serviceUuid, characteristicUuid, data, false);
  });

  describe('write', () => {
    it('missing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const anotherHandle = 'another_handle';
      const serviceUuid = 'serviceUuid';
      const characteristicUuid = 'characteristic';
      const data = 'data';
      const withoutResponse = true;

      const gatt = {
        write: jest.fn()
      };

      bindings._handles[peripheralUuid] = anotherHandle;
      bindings._gatts[handle] = gatt;
      bindings.write(peripheralUuid, serviceUuid, characteristicUuid, data, withoutResponse);

      expect(gatt.write).not.toHaveBeenCalled();
    });

    it('existing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const serviceUuid = 'serviceUuid';
      const characteristicUuid = 'characteristics';
      const data = 'data';
      const withoutResponse = true;
      const gatt = {
        write: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.write(peripheralUuid, serviceUuid, characteristicUuid, data, withoutResponse);

      expect(gatt.write).toHaveBeenCalledTimes(1);
      expect(gatt.write).toHaveBeenCalledWith(serviceUuid, characteristicUuid, data, withoutResponse);
    });

    it('existing gatt no uuids', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const gatt = {
        write: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.write(peripheralUuid);

      expect(gatt.write).toHaveBeenCalledTimes(1);
      expect(gatt.write).toHaveBeenCalledWith(undefined, undefined, undefined, undefined);
    });
  });

  it('onWrite', () => {
    const address = 'this:is:an:address';
    const serviceUuid = 'serviceUuid';
    const characteristicUuid = 'characteristics';
    const callback = jest.fn();

    bindings.on('write', callback);
    bindings.onWrite(address, serviceUuid, characteristicUuid);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('thisisanaddress', serviceUuid, characteristicUuid);
  });

  describe('broadcast', () => {
    it('missing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const anotherHandle = 'another_handle';
      const serviceUuid = 'serviceUuid';
      const characteristicUuid = 'characteristic';
      const broadcast = 'broadcast';
      const gatt = {
        broadcast: jest.fn()
      };

      bindings._handles[peripheralUuid] = anotherHandle;
      bindings._gatts[handle] = gatt;
      bindings.broadcast(peripheralUuid, serviceUuid, characteristicUuid, broadcast);

      expect(gatt.broadcast).not.toHaveBeenCalled();
    });

    it('existing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const serviceUuid = 'serviceUuid';
      const characteristicUuid = 'characteristics';
      const broadcast = 'broadcast';
      const gatt = {
        broadcast: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.broadcast(peripheralUuid, serviceUuid, characteristicUuid, broadcast);

      expect(gatt.broadcast).toHaveBeenCalledTimes(1);
      expect(gatt.broadcast).toHaveBeenCalledWith(serviceUuid, characteristicUuid, broadcast);
    });

    it('existing gatt no uuids', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const gatt = {
        broadcast: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.broadcast(peripheralUuid);

      expect(gatt.broadcast).toHaveBeenCalledTimes(1);
      expect(gatt.broadcast).toHaveBeenCalledWith(undefined, undefined, undefined);
    });
  });

  it('onBroadcast', () => {
    const address = 'this:is:an:address';
    const serviceUuid = 'serviceUuid';
    const characteristicUuid = 'characteristics';
    const state = 'data';
    const callback = jest.fn();

    bindings.on('broadcast', callback);
    bindings.onBroadcast(address, serviceUuid, characteristicUuid, state);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('thisisanaddress', serviceUuid, characteristicUuid, state);
  });

  describe('notify', () => {
    it('missing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const anotherHandle = 'another_handle';
      const serviceUuid = 'serviceUuid';
      const characteristicUuid = 'characteristic';
      const notify = 'notify';
      const gatt = {
        notify: jest.fn()
      };

      bindings._handles[peripheralUuid] = anotherHandle;
      bindings._gatts[handle] = gatt;
      bindings.notify(peripheralUuid, serviceUuid, characteristicUuid, notify);

      expect(gatt.notify).not.toHaveBeenCalled();
    });

    it('existing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const serviceUuid = 'serviceUuid';
      const characteristicUuid = 'characteristics';
      const notify = 'notify';
      const gatt = {
        notify: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.notify(peripheralUuid, serviceUuid, characteristicUuid, notify);

      expect(gatt.notify).toHaveBeenCalledTimes(1);
      expect(gatt.notify).toHaveBeenCalledWith(serviceUuid, characteristicUuid, notify);
    });

    it('existing gatt no uuids', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const gatt = {
        notify: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.notify(peripheralUuid);

      expect(gatt.notify).toHaveBeenCalledTimes(1);
      expect(gatt.notify).toHaveBeenCalledWith(undefined, undefined, undefined);
    });
  });

  it('onNotify', () => {
    const address = 'this:is:an:address';
    const serviceUuid = 'serviceUuid';
    const characteristicUuid = 'characteristics';
    const state = 'data';
    const callback = jest.fn();

    bindings.on('notify', callback);
    bindings.onNotify(address, serviceUuid, characteristicUuid, state);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('thisisanaddress', serviceUuid, characteristicUuid, state);
  });

  it('onNotification', () => {
    const address = 'this:is:an:address';
    const serviceUuid = 'serviceUuid';
    const characteristicUuid = 'characteristics';
    const data = 'data';
    const callback = jest.fn();

    bindings.on('read', callback);
    bindings.onNotification(address, serviceUuid, characteristicUuid, data);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('thisisanaddress', serviceUuid, characteristicUuid, data, true);
  });

  describe('discoverDescriptors', () => {
    it('missing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const anotherHandle = 'another_handle';
      const serviceUuid = 'serviceUuid';
      const characteristicUuid = 'characteristic';
      const gatt = {
        discoverDescriptors: jest.fn()
      };

      bindings._handles[peripheralUuid] = anotherHandle;
      bindings._gatts[handle] = gatt;
      bindings.discoverDescriptors(peripheralUuid, serviceUuid, characteristicUuid);

      expect(gatt.discoverDescriptors).not.toHaveBeenCalled();
    });

    it('existing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const serviceUuid = 'serviceUuid';
      const characteristicUuid = 'characteristics';
      const gatt = {
        discoverDescriptors: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.discoverDescriptors(peripheralUuid, serviceUuid, characteristicUuid);

      expect(gatt.discoverDescriptors).toHaveBeenCalledTimes(1);
      expect(gatt.discoverDescriptors).toHaveBeenCalledWith(serviceUuid, characteristicUuid);
    });

    it('existing gatt no uuids', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const gatt = {
        discoverDescriptors: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.discoverDescriptors(peripheralUuid);

      expect(gatt.discoverDescriptors).toHaveBeenCalledTimes(1);
      expect(gatt.discoverDescriptors).toHaveBeenCalledWith(undefined, undefined);
    });
  });

  it('onDescriptorsDiscovered', () => {
    const address = 'this:is:an:address';
    const serviceUuid = 'serviceUuid';
    const characteristicUuid = 'characteristics';
    const descriptorUuids = 'descriptorUuids';
    const callback = jest.fn();

    bindings.on('descriptorsDiscover', callback);
    bindings.onDescriptorsDiscovered(address, serviceUuid, characteristicUuid, descriptorUuids);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('thisisanaddress', serviceUuid, characteristicUuid, descriptorUuids);
  });

  describe('readValue', () => {
    it('missing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const anotherHandle = 'another_handle';
      const serviceUuid = 'serviceUuid';
      const characteristicUuid = 'characteristic';
      const descriptorUuid = 'descriptorUuid';
      const gatt = {
        readValue: jest.fn()
      };

      bindings._handles[peripheralUuid] = anotherHandle;
      bindings._gatts[handle] = gatt;
      bindings.readValue(peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid);

      expect(gatt.readValue).not.toHaveBeenCalled();
    });

    it('existing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const serviceUuid = 'serviceUuid';
      const characteristicUuid = 'characteristics';
      const descriptorUuid = 'descriptorUuid';
      const gatt = {
        readValue: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.readValue(peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid);

      expect(gatt.readValue).toHaveBeenCalledTimes(1);
      expect(gatt.readValue).toHaveBeenCalledWith(serviceUuid, characteristicUuid, descriptorUuid);
    });

    it('existing gatt no uuids', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const gatt = {
        readValue: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.readValue(peripheralUuid);

      expect(gatt.readValue).toHaveBeenCalledTimes(1);
      expect(gatt.readValue).toHaveBeenCalledWith(undefined, undefined, undefined);
    });
  });

  it('onValueRead', () => {
    const address = 'this:is:an:address';
    const serviceUuid = 'serviceUuid';
    const characteristicUuid = 'characteristics';
    const descriptorUuid = 'descriptorUuid';
    const data = 'data';
    const callback = jest.fn();

    bindings.on('valueRead', callback);
    bindings.onValueRead(address, serviceUuid, characteristicUuid, descriptorUuid, data);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('thisisanaddress', serviceUuid, characteristicUuid, descriptorUuid, data);
  });

  describe('writeValue', () => {
    it('missing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const anotherHandle = 'another_handle';
      const serviceUuid = 'serviceUuid';
      const characteristicUuid = 'characteristic';
      const descriptorUuid = 'descriptorUuid';
      const data = 'data';
      const gatt = {
        writeValue: jest.fn()
      };

      bindings._handles[peripheralUuid] = anotherHandle;
      bindings._gatts[handle] = gatt;
      bindings.writeValue(peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid, data);

      expect(gatt.writeValue).not.toHaveBeenCalled();
    });

    it('existing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const serviceUuid = 'serviceUuid';
      const characteristicUuid = 'characteristics';
      const descriptorUuid = 'descriptorUuid';
      const data = 'data';
      const gatt = {
        writeValue: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.writeValue(peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid, data);

      expect(gatt.writeValue).toHaveBeenCalledTimes(1);
      expect(gatt.writeValue).toHaveBeenCalledWith(serviceUuid, characteristicUuid, descriptorUuid, data);
    });

    it('existing gatt no uuids', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const gatt = {
        writeValue: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.writeValue(peripheralUuid);

      expect(gatt.writeValue).toHaveBeenCalledTimes(1);
      expect(gatt.writeValue).toHaveBeenCalledWith(undefined, undefined, undefined, undefined);
    });
  });

  it('onValueWrite', () => {
    const address = 'this:is:an:address';
    const serviceUuid = 'serviceUuid';
    const characteristicUuid = 'characteristics';
    const descriptorUuid = 'descriptorUuid';
    const callback = jest.fn();

    bindings.on('valueWrite', callback);
    bindings.onValueWrite(address, serviceUuid, characteristicUuid, descriptorUuid);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('thisisanaddress', serviceUuid, characteristicUuid, descriptorUuid);
  });

  describe('readHandle', () => {
    it('missing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const anotherHandle = 'another_handle';
      const attHandle = 'attHandle';
      const gatt = {
        readHandle: jest.fn()
      };

      bindings._handles[peripheralUuid] = anotherHandle;
      bindings._gatts[handle] = gatt;
      bindings.readHandle(peripheralUuid, attHandle);

      expect(gatt.readHandle).not.toHaveBeenCalled();
    });

    it('existing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const attHandle = 'attHandle';
      const gatt = {
        readHandle: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.readHandle(peripheralUuid, attHandle);

      expect(gatt.readHandle).toHaveBeenCalledTimes(1);
      expect(gatt.readHandle).toHaveBeenCalledWith(attHandle);
    });

    it('existing gatt no uuids', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const gatt = {
        readHandle: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.readHandle(peripheralUuid);

      expect(gatt.readHandle).toHaveBeenCalledTimes(1);
      expect(gatt.readHandle).toHaveBeenCalledWith(undefined);
    });
  });

  it('onHandleRead', () => {
    const address = 'this:is:an:address';
    const handle = 'handle';
    const data = 'data';
    const callback = jest.fn();

    bindings.on('handleRead', callback);
    bindings.onHandleRead(address, handle, data);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('thisisanaddress', handle, data);
  });

  describe('writeHandle', () => {
    it('missing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const anotherHandle = 'another_handle';
      const attHandle = 'attHandle';
      const data = 'data';
      const withoutResponse = true;
      const gatt = {
        writeHandle: jest.fn()
      };

      bindings._handles[peripheralUuid] = anotherHandle;
      bindings._gatts[handle] = gatt;
      bindings.writeHandle(peripheralUuid, attHandle, data, withoutResponse);

      expect(gatt.writeHandle).not.toHaveBeenCalled();
    });

    it('existing gatt', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const attHandle = 'attHandle';
      const data = 'data';
      const withoutResponse = true;
      const gatt = {
        writeHandle: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.writeHandle(peripheralUuid, attHandle, data, withoutResponse);

      expect(gatt.writeHandle).toHaveBeenCalledTimes(1);
      expect(gatt.writeHandle).toHaveBeenCalledWith(attHandle, data, withoutResponse);
    });

    it('existing gatt no uuids', () => {
      const peripheralUuid = 'uuid';
      const handle = 'handle';
      const gatt = {
        writeHandle: jest.fn()
      };

      bindings._handles[peripheralUuid] = handle;
      bindings._gatts[handle] = gatt;
      bindings.writeHandle(peripheralUuid);

      expect(gatt.writeHandle).toHaveBeenCalledTimes(1);
      expect(gatt.writeHandle).toHaveBeenCalledWith(undefined, undefined, undefined);
    });
  });

  it('onHandleWrite', () => {
    const address = 'this:is:an:address';
    const handle = 'handle';
    const callback = jest.fn();

    bindings.on('handleWrite', callback);
    bindings.onHandleWrite(address, handle);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('thisisanaddress', handle);
  });

  it('onHandleNotify', () => {
    const address = 'this:is:an:address';
    const handle = 'handle';
    const data = 'data';
    const callback = jest.fn();

    bindings.on('handleNotify', callback);
    bindings.onHandleNotify(address, handle, data);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('thisisanaddress', handle, data);
  });

  it('onConnectionParameterUpdateRequest', () => {
    const handle = 'handle';
    const minInterval = 'minInterval';
    const maxInterval = 'maxInterval';
    const latency = 'latency';
    const supervisionTimeout = 'supervisionTimeout';
    const connUpdateLe = jest.fn();

    bindings._hci.connUpdateLe = connUpdateLe;
    bindings.onConnectionParameterUpdateRequest(handle, minInterval, maxInterval, latency, supervisionTimeout);

    expect(connUpdateLe).toHaveBeenCalledTimes(1);
    expect(connUpdateLe).toHaveBeenCalledWith(handle, minInterval, maxInterval, latency, supervisionTimeout);
  });
});
