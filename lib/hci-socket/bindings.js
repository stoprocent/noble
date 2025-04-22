const { EventEmitter } = require('events');

const AclStream = require('./acl-stream');
const Gatt = require('./gatt');
const Gap = require('./gap');
const Hci = require('./hci');
const Signaling = require('./signaling');

const NobleBindings = function (options) {
  this._state = null;
  this._isScanning = false;
  this._isScanningStarted = false;
  this._scanServiceUuids = [];

  this._options = { ...options };
  this._addresses = {};
  this._addresseTypes = {};
  this._connectable = {};
  this._isExtended = 'extended' in options && options.extended;
  this.scannable = {};

  this._pendingConnectionUuid = null;
  this._connectionQueue = [];

  this._handles = {};
  this._gatts = {};
  this._aclStreams = {};
  this._signalings = {};

  this._hci = null;
  this._gap = null;
};

Object.setPrototypeOf(NobleBindings.prototype, EventEmitter.prototype);

NobleBindings.prototype.start = function () {
  /* Add exit handlers after `init()` has completed. If no adaptor
  is present it can throw an exception - in which case we don't
  want to try and clear up afterwards (issue #502) */
  this._sigIntHandler = this.onSigInt.bind(this);
  this._exitHandler = this.stop.bind(this);
  process.on('SIGINT', this._sigIntHandler);
  process.on('exit', this._exitHandler);

  // Initialize the hci
  this._hci = new Hci(this._options);

  // Register event listeners for the hci
  this._hci.on('stateChange', this.onStateChange.bind(this));
  this._hci.on('addressChange', this.onAddressChange.bind(this));
  this._hci.on('leConnComplete', this.onLeConnComplete.bind(this));
  this._hci.on('leConnUpdateComplete', this.onLeConnUpdateComplete.bind(this));
  this._hci.on('rssiRead', this.onRssiRead.bind(this));
  this._hci.on('disconnComplete', this.onDisconnComplete.bind(this));
  this._hci.on('encryptChange', this.onEncryptChange.bind(this));
  this._hci.on('aclDataPkt', this.onAclDataPkt.bind(this));

  // Initialize the gap
  this._gap = new Gap(this._hci);

  // Register event listeners for the gap
  this._gap.on('scanParametersSet', this.onScanParametersSet.bind(this));
  this._gap.on('scanStart', this.onScanStart.bind(this));
  this._gap.on('scanStop', this.onScanStop.bind(this));
  this._gap.on('discover', this.onDiscover.bind(this));

  // Initialize the hci
  this._hci.init();
};

NobleBindings.prototype.stop = function () {
  process.removeListener('exit', this._exitHandler);
  process.removeListener('SIGINT', this._sigIntHandler);

  this.stopScanning();
  for (const handle in this._aclStreams) {
    this._hci.disconnect(handle);
  }
  this._hci.stop();
};

NobleBindings.prototype.setScanParameters = function (interval, window) {
  this._gap.setScanParameters(interval, window);
};

NobleBindings.prototype.setAddress = function (address) {
  this._hci.setAddress(address);
};

NobleBindings.prototype.startScanning = function (
  serviceUuids,
  allowDuplicates
) {
  if (this._isScanning) { 
    this.emit('scanStart'); 
    return;
  }
  if (this._isScanningStarted) { 
    return; 
  }
  this._isScanningStarted = true;
  this._scanServiceUuids = serviceUuids || [];
  this._gap.startScanning(allowDuplicates);
};

NobleBindings.prototype.stopScanning = function () {
  this._gap.stopScanning();
  if (!this._isScanning) {
    this.emit('scanStop');
  }
};

NobleBindings.prototype.connect = function (peripheralUuid, parameters = {}) {
  let address = this._addresses[peripheralUuid];
  let addressType = this._addresseTypes[peripheralUuid] || 'random';
  
  if (!address) {
    address = peripheralUuid.match(/.{1,2}/g).join(':');
    addressType = parameters && parameters.addressType ? parameters.addressType : 'random';
  }

  // Add connection request to queue
  this._connectionQueue.push({ 
    id: peripheralUuid, 
    address, 
    addressType, 
    params: parameters
  });

  const processNextConnection = () => {
    if (this._connectionQueue.length === 1) {
      const nextConn = this._connectionQueue[0]; // Look at next connection but don't remove yet
      this._hci.createLeConn(nextConn.address, nextConn.addressType, nextConn.params, Object.keys(this._handles).length === 0);
    }
  };

  if (this._isScanning) {
    this.once('scanStop', processNextConnection);
    this.stopScanning();
  } else {
    processNextConnection();
  }
};

NobleBindings.prototype.disconnect = function (peripheralUuid) {
  this._hci.disconnect(this._handles[peripheralUuid]);
};

NobleBindings.prototype.cancelConnect = function (peripheralUuid) {
  // TODO: check if it was not in the queue and only then issue cancel on hci
  this._connectionQueue = this._connectionQueue.filter(
    (c) => c.id !== peripheralUuid
  );
  this._hci.cancelConnect(this._handles[peripheralUuid]);
};

NobleBindings.prototype.updateRssi = function (peripheralUuid) {
  this._hci.readRssi(this._handles[peripheralUuid]);
};

NobleBindings.prototype.onSigInt = function () {
  const sigIntListeners = process.listeners('SIGINT');

  if (sigIntListeners[sigIntListeners.length - 1] === this._sigIntHandler) {
    // we are the last listener, so exit
    // this will trigger onExit, and clean up
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }
};

NobleBindings.prototype.onStateChange = function (state) {
  if (this._state === state) {
    return;
  }

  // If we are powered on and we are powered off, disconnect all connections
  if (this._state === 'poweredOn' && state === 'poweredOff') {
    for (const handle in this._handles) {
      this.onDisconnComplete(handle, 0x03); // Hardward Failure
    }
  }

  this._state = state;

  if (state === 'unauthorized') {
    console.log(
      'noble warning: adapter state unauthorized, please run as root or with sudo'
    );
    console.log(
      '               or see README for information on running without root/sudo:'
    );
    console.log(
      '               https://github.com/sandeepmistry/noble#running-on-linux'
    );
  } else if (state === 'unsupported') {
    console.log(
      'noble warning: adapter does not support Bluetooth Low Energy (BLE, Bluetooth Smart).'
    );
    console.log('               Try to run with environment variable:');
    console.log('               [sudo] NOBLE_HCI_DEVICE_ID=x node ...');
  } 

  this.emit('stateChange', state);
};

NobleBindings.prototype.onAddressChange = function (address) {
  this.emit('addressChange', address);
};

NobleBindings.prototype.onScanParametersSet = function () {
  this.emit('scanParametersSet');
};

NobleBindings.prototype.onScanStart = function (filterDuplicates) {
  if (this._isScanningStarted) { 
    this._isScanning = true;
  }
  this.emit('scanStart', filterDuplicates);
};

NobleBindings.prototype.onScanStop = function () {
  this._isScanning = false;
  this._isScanningStarted = false;
  this.emit('scanStop');
};

NobleBindings.prototype.onDiscover = function (
  status,
  address,
  addressType,
  connectable,
  advertisement,
  rssi,
  scannable
) {
  if (this._scanServiceUuids === undefined) {
    return;
  }

  let serviceUuids = advertisement.serviceUuids || [];
  const serviceData = advertisement.serviceData || [];
  let hasScanServiceUuids = this._scanServiceUuids.length === 0;

  if (!hasScanServiceUuids) {
    let i;

    serviceUuids = serviceUuids.slice();

    for (i in serviceData) {
      serviceUuids.push(serviceData[i].uuid);
    }

    for (i in serviceUuids) {
      hasScanServiceUuids =
        this._scanServiceUuids.indexOf(serviceUuids[i]) !== -1;

      if (hasScanServiceUuids) {
        break;
      }
    }
  }

  if (hasScanServiceUuids) {
    const uuid = this.addressToId(address);
    this._addresses[uuid] = address;
    this._addresseTypes[uuid] = addressType;
    this._connectable[uuid] = connectable;
    this.scannable[uuid] = scannable;

    this.emit(
      'discover',
      uuid,
      address,
      addressType,
      connectable,
      advertisement,
      rssi,
      scannable
    );
  }
};

NobleBindings.prototype.onLeConnComplete = function (
  status,
  handle,
  role,
  addressType,
  address,
  interval,
  latency,
  supervisionTimeout,
  masterClockAccuracy
) {
  if (role !== 0 && role !== undefined) {
    // not master, ignore
    return;
  }

  let uuid = null;
  let error = null;

  if (status === 0) {
    uuid = this.addressToId(address);

    // Check if address is already known
    if (!this._addresses[uuid]) {
      // Simulate discovery if address is not known
      const advertisement = { // Assume structure, adjust as necessary
        serviceUuids: [], // Actual service UUID data needed here
        serviceData: [] // Actual service data needed here
      };
      const rssi = 127;
      const connectable = true; // Assuming the device is connectable
      const scannable = false; // Assuming the device is not scannable

      this._scanServiceUuids = []; // We have to set this to fake scan

      // Call onDiscover to simulate device discovery
      this.onDiscover(
        status,
        address,
        addressType,
        connectable,
        advertisement,
        rssi,
        scannable
      );
    }

    const aclStream = new AclStream(
      this._hci,
      handle,
      this._hci.addressType,
      this._hci.address,
      addressType,
      address
    );
    const gatt = new Gatt(address, aclStream);
    const signaling = new Signaling(handle, aclStream);

    this._gatts[uuid] = this._gatts[handle] = gatt;
    this._signalings[uuid] = this._signalings[handle] = signaling;
    this._aclStreams[handle] = aclStream;
    this._handles[uuid] = handle;
    this._handles[handle] = uuid;

    this._gatts[handle].on('mtu', this.onMtu.bind(this));
    this._gatts[handle].on(
      'servicesDiscover',
      this.onServicesDiscovered.bind(this)
    );
    this._gatts[handle].on(
      'servicesDiscovered',
      this.onServicesDiscoveredEX.bind(this)
    );
    this._gatts[handle].on(
      'includedServicesDiscover',
      this.onIncludedServicesDiscovered.bind(this)
    );
    this._gatts[handle].on(
      'characteristicsDiscover',
      this.onCharacteristicsDiscovered.bind(this)
    );
    this._gatts[handle].on(
      'characteristicsDiscovered',
      this.onCharacteristicsDiscoveredEX.bind(this)
    );
    this._gatts[handle].on('read', this.onRead.bind(this));
    this._gatts[handle].on('write', this.onWrite.bind(this));
    this._gatts[handle].on('broadcast', this.onBroadcast.bind(this));
    this._gatts[handle].on('notify', this.onNotify.bind(this));
    this._gatts[handle].on('notification', this.onNotification.bind(this));
    this._gatts[handle].on(
      'descriptorsDiscover',
      this.onDescriptorsDiscovered.bind(this)
    );
    this._gatts[handle].on('valueRead', this.onValueRead.bind(this));
    this._gatts[handle].on('valueWrite', this.onValueWrite.bind(this));
    this._gatts[handle].on('handleRead', this.onHandleRead.bind(this));
    this._gatts[handle].on('handleWrite', this.onHandleWrite.bind(this));
    this._gatts[handle].on('handleNotify', this.onHandleNotify.bind(this));

    this._signalings[handle].on(
      'connectionParameterUpdateRequest',
      this.onConnectionParameterUpdateRequest.bind(this)
    );

    this._gatts[handle].exchangeMtu();
  } else {
    const currentConn = this._connectionQueue[0];
    uuid = currentConn ? currentConn.id : null;
    let statusMessage = Hci.STATUS_MAPPER[status] || 'HCI Error: Unknown';
    const errorCode = ` (0x${status.toString(16)})`;
    statusMessage = statusMessage + errorCode;
    error = new Error(statusMessage);
  }

  // Remove the completed/failed connection attempt from queue
  this._connectionQueue.shift();

  this.emit('connect', uuid, error);

  // Process next connection in queue if any
  if (this._connectionQueue.length > 0 && !this._isScanning) {
    const nextConn = this._connectionQueue[0];
    this._hci.createLeConn(nextConn.address, nextConn.addressType, nextConn.params, Object.keys(this._handles).length === 0);
  }
};

NobleBindings.prototype.onLeConnUpdateComplete = function (
  handle,
  interval,
  latency,
  supervisionTimeout
) {
  // no-op
};

NobleBindings.prototype.onDisconnComplete = function (handle, reason) {
  const uuid = this._handles[handle];

  if (uuid) {
    this._aclStreams[handle].push(null, null);
    this._gatts[handle].removeAllListeners();
    this._signalings[handle].removeAllListeners();

    delete this._gatts[uuid];
    delete this._gatts[handle];
    delete this._signalings[uuid];
    delete this._signalings[handle];
    delete this._aclStreams[handle];
    delete this._handles[uuid];
    delete this._handles[handle];

    this.emit('disconnect', uuid, reason);
  } else {
    console.warn(`noble warning: unknown handle ${handle} disconnected!`);
  }
};

NobleBindings.prototype.onEncryptChange = function (handle, encrypt) {
  const aclStream = this._aclStreams[handle];

  if (aclStream) {
    aclStream.pushEncrypt(encrypt);
  }
};

NobleBindings.prototype.onMtu = function (address, mtu) {
  const uuid = this.addressToId(address);

  this.emit('onMtu', uuid, mtu);
};

NobleBindings.prototype.onRssiRead = function (handle, rssi) {
  this.emit('rssiUpdate', this._handles[handle], rssi);
};

NobleBindings.prototype.onAclDataPkt = function (handle, cid, data) {
  const aclStream = this._aclStreams[handle];

  if (aclStream) {
    aclStream.push(cid, data);
  }
};

NobleBindings.prototype.addService = function (peripheralUuid, service) {
  const handle = this._handles[peripheralUuid];
  const gatt = this._gatts[handle];

  if (gatt) {
    gatt.addService(service);
  } else {
    console.warn(`noble warning: unknown peripheral ${peripheralUuid}`);
  }
};

NobleBindings.prototype.discoverServices = function (peripheralUuid, uuids) {
  const handle = this._handles[peripheralUuid];
  const gatt = this._gatts[handle];

  if (gatt) {
    gatt.discoverServices(uuids || []);
  } else {
    console.warn(`noble warning: unknown peripheral ${peripheralUuid}`);
  }
};

NobleBindings.prototype.onServicesDiscovered = function (
  address,
  serviceUuids
) {
  const uuid = this.addressToId(address);

  this.emit('servicesDiscover', uuid, serviceUuids);
};

NobleBindings.prototype.onServicesDiscoveredEX = function (address, services) {
  const uuid = this.addressToId(address);

  this.emit('servicesDiscovered', uuid, services);
};

NobleBindings.prototype.discoverIncludedServices = function (
  peripheralUuid,
  serviceUuid,
  serviceUuids
) {
  const handle = this._handles[peripheralUuid];
  const gatt = this._gatts[handle];

  if (gatt) {
    gatt.discoverIncludedServices(serviceUuid, serviceUuids || []);
  } else {
    console.warn(`noble warning: unknown peripheral ${peripheralUuid}`);
  }
};

NobleBindings.prototype.onIncludedServicesDiscovered = function (
  address,
  serviceUuid,
  includedServiceUuids
) {
  const uuid = this.addressToId(address);

  this.emit(
    'includedServicesDiscover',
    uuid,
    serviceUuid,
    includedServiceUuids
  );
};

NobleBindings.prototype.addCharacteristics = function (
  peripheralUuid,
  serviceUuid,
  characteristics
) {
  const handle = this._handles[peripheralUuid];
  const gatt = this._gatts[handle];

  if (gatt) {
    gatt.addCharacteristics(serviceUuid, characteristics);
  } else {
    console.warn(`noble warning: unknown peripheral ${peripheralUuid}`);
  }
};

NobleBindings.prototype.discoverCharacteristics = function (
  peripheralUuid,
  serviceUuid,
  characteristicUuids
) {
  const handle = this._handles[peripheralUuid];
  const gatt = this._gatts[handle];

  if (gatt) {
    gatt.discoverCharacteristics(serviceUuid, characteristicUuids || []);
  } else {
    console.warn(`noble warning: unknown peripheral ${peripheralUuid}`);
  }
};

NobleBindings.prototype.onCharacteristicsDiscovered = function (
  address,
  serviceUuid,
  characteristics
) {
  const uuid = this.addressToId(address);

  this.emit('characteristicsDiscover', uuid, serviceUuid, characteristics);
};

NobleBindings.prototype.onCharacteristicsDiscoveredEX = function (
  address,
  serviceUuid,
  characteristics
) {
  const uuid = this.addressToId(address);

  this.emit('characteristicsDiscovered', uuid, serviceUuid, characteristics);
};

NobleBindings.prototype.read = function (
  peripheralUuid,
  serviceUuid,
  characteristicUuid
) {
  const handle = this._handles[peripheralUuid];
  const gatt = this._gatts[handle];

  if (gatt) {
    gatt.read(serviceUuid, characteristicUuid);
  } else {
    console.warn(`noble warning: unknown peripheral ${peripheralUuid}`);
  }
};

NobleBindings.prototype.onRead = function (
  address,
  serviceUuid,
  characteristicUuid,
  data
) {
  const uuid = this.addressToId(address);

  this.emit('read', uuid, serviceUuid, characteristicUuid, data, false);
};

NobleBindings.prototype.write = function (
  peripheralUuid,
  serviceUuid,
  characteristicUuid,
  data,
  withoutResponse
) {
  const handle = this._handles[peripheralUuid];
  const gatt = this._gatts[handle];

  if (gatt) {
    gatt.write(serviceUuid, characteristicUuid, data, withoutResponse);
  } else {
    console.warn(`noble warning: unknown peripheral ${peripheralUuid}`);
  }
};

NobleBindings.prototype.onWrite = function (
  address,
  serviceUuid,
  characteristicUuid
) {
  const uuid = this.addressToId(address);

  this.emit('write', uuid, serviceUuid, characteristicUuid);
};

NobleBindings.prototype.broadcast = function (
  peripheralUuid,
  serviceUuid,
  characteristicUuid,
  broadcast
) {
  const handle = this._handles[peripheralUuid];
  const gatt = this._gatts[handle];

  if (gatt) {
    gatt.broadcast(serviceUuid, characteristicUuid, broadcast);
  } else {
    console.warn(`noble warning: unknown peripheral ${peripheralUuid}`);
  }
};

NobleBindings.prototype.onBroadcast = function (
  address,
  serviceUuid,
  characteristicUuid,
  state
) {
  const uuid = this.addressToId(address);

  this.emit('broadcast', uuid, serviceUuid, characteristicUuid, state);
};

NobleBindings.prototype.notify = function (
  peripheralUuid,
  serviceUuid,
  characteristicUuid,
  notify
) {
  const handle = this._handles[peripheralUuid];
  const gatt = this._gatts[handle];
  if (gatt) {
    gatt.notify(serviceUuid, characteristicUuid, notify);
  } else {
    console.warn(`noble warning: unknown peripheral ${peripheralUuid}`);
  }
};

NobleBindings.prototype.onNotify = function (
  address,
  serviceUuid,
  characteristicUuid,
  state
) {
  const uuid = this.addressToId(address);

  this.emit('notify', uuid, serviceUuid, characteristicUuid, state);
};

NobleBindings.prototype.onNotification = function (
  address,
  serviceUuid,
  characteristicUuid,
  data
) {
  const uuid = this.addressToId(address);

  this.emit('read', uuid, serviceUuid, characteristicUuid, data, true);
};

NobleBindings.prototype.discoverDescriptors = function (
  peripheralUuid,
  serviceUuid,
  characteristicUuid
) {
  const handle = this._handles[peripheralUuid];
  const gatt = this._gatts[handle];

  if (gatt) {
    gatt.discoverDescriptors(serviceUuid, characteristicUuid);
  } else {
    console.warn(`noble warning: unknown peripheral ${peripheralUuid}`);
  }
};

NobleBindings.prototype.onDescriptorsDiscovered = function (
  address,
  serviceUuid,
  characteristicUuid,
  descriptorUuids
) {
  const uuid = this.addressToId(address);

  this.emit(
    'descriptorsDiscover',
    uuid,
    serviceUuid,
    characteristicUuid,
    descriptorUuids
  );
};

NobleBindings.prototype.readValue = function (
  peripheralUuid,
  serviceUuid,
  characteristicUuid,
  descriptorUuid
) {
  const handle = this._handles[peripheralUuid];
  const gatt = this._gatts[handle];

  if (gatt) {
    gatt.readValue(serviceUuid, characteristicUuid, descriptorUuid);
  } else {
    console.warn(`noble warning: unknown peripheral ${peripheralUuid}`);
  }
};

NobleBindings.prototype.onValueRead = function (
  address,
  serviceUuid,
  characteristicUuid,
  descriptorUuid,
  data
) {
  const uuid = this.addressToId(address);

  this.emit(
    'valueRead',
    uuid,
    serviceUuid,
    characteristicUuid,
    descriptorUuid,
    data
  );
};

NobleBindings.prototype.writeValue = function (
  peripheralUuid,
  serviceUuid,
  characteristicUuid,
  descriptorUuid,
  data
) {
  const handle = this._handles[peripheralUuid];
  const gatt = this._gatts[handle];

  if (gatt) {
    gatt.writeValue(serviceUuid, characteristicUuid, descriptorUuid, data);
  } else {
    console.warn(`noble warning: unknown peripheral ${peripheralUuid}`);
  }
};

NobleBindings.prototype.onValueWrite = function (
  address,
  serviceUuid,
  characteristicUuid,
  descriptorUuid
) {
  const uuid = this.addressToId(address);

  this.emit(
    'valueWrite',
    uuid,
    serviceUuid,
    characteristicUuid,
    descriptorUuid
  );
};

NobleBindings.prototype.readHandle = function (peripheralUuid, attHandle) {
  const handle = this._handles[peripheralUuid];
  const gatt = this._gatts[handle];

  if (gatt) {
    gatt.readHandle(attHandle);
  } else {
    console.warn(`noble warning: unknown peripheral ${peripheralUuid}`);
  }
};

NobleBindings.prototype.onHandleRead = function (address, handle, data) {
  const uuid = this.addressToId(address);

  this.emit('handleRead', uuid, handle, data);
};

NobleBindings.prototype.writeHandle = function (
  peripheralUuid,
  attHandle,
  data,
  withoutResponse
) {
  const handle = this._handles[peripheralUuid];
  const gatt = this._gatts[handle];

  if (gatt) {
    gatt.writeHandle(attHandle, data, withoutResponse);
  } else {
    console.warn(`noble warning: unknown peripheral ${peripheralUuid}`);
  }
};

NobleBindings.prototype.onHandleWrite = function (address, handle) {
  const uuid = this.addressToId(address);

  this.emit('handleWrite', uuid, handle);
};

NobleBindings.prototype.onHandleNotify = function (address, handle, data) {
  const uuid = this.addressToId(address);

  this.emit('handleNotify', uuid, handle, data);
};

NobleBindings.prototype.onConnectionParameterUpdateRequest = function (
  handle,
  minInterval,
  maxInterval,
  latency,
  supervisionTimeout
) {
  this._hci.connUpdateLe(
    handle,
    minInterval,
    maxInterval,
    latency,
    supervisionTimeout
  );
};

NobleBindings.prototype.addressToId = function (address) {
  return address.replace(/:/g, '').toLowerCase();
};

module.exports = NobleBindings;
