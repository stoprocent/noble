const debug = require('debug')('noble');

const { EventEmitter } = require('events');

const Peripheral = require('./peripheral');
const Service = require('./service');
const Characteristic = require('./characteristic');
const Descriptor = require('./descriptor');

class Noble extends EventEmitter {
  
  constructor (bindings) {
    super();

    this._address = 'unknown';
    this._state = 'unknown';
    
    this._initialized = false;
    this._bindings = bindings;

    this._discoveredPeripherals = new Set();
    this._peripherals = new Map();
    this._services = {};
    this._characteristics = {};
    this._descriptors = {};

    this._cleanupPeriperals();

    this.on('warning', message => console.warn(`noble: ${message}`));

    this.on('newListener', event => {
      if (event === 'stateChange' && this._initialized === false) {
        this._initialized = true;
        process.nextTick(this._initializeBindings.bind(this));
      }
    });
  }

  get state () {
    if (this._initialized === false) {
      this._initializeBindings();
    }
    return this._state;
  }

  get address () {
    return this._address;
  }

  _initializeBindings () {
    this._initialized = true;
    this._registerListeners();
    this._bindings.start();
  }

  _registerListeners () {
    this._bindings.on('stateChange', this._onStateChange.bind(this));
    this._bindings.on('addressChange', this._onAddressChange.bind(this));
    this._bindings.on('scanParametersSet', this._onScanParametersSet.bind(this));
    this._bindings.on('scanStart', this._onScanStart.bind(this));
    this._bindings.on('scanStop', this._onScanStop.bind(this));
    this._bindings.on('discover', this._onDiscover.bind(this));
    this._bindings.on('connect', this._onConnect.bind(this));
    this._bindings.on('disconnect', this._onDisconnect.bind(this));
    this._bindings.on('rssiUpdate', this._onRssiUpdate.bind(this));
    this._bindings.on('servicesDiscover', this._onServicesDiscover.bind(this));
    this._bindings.on('servicesDiscovered', this._onServicesDiscovered.bind(this));
    this._bindings.on('includedServicesDiscover', this._onIncludedServicesDiscover.bind(this));
    this._bindings.on('characteristicsDiscover', this._onCharacteristicsDiscover.bind(this));
    this._bindings.on('characteristicsDiscovered', this._onCharacteristicsDiscovered.bind(this));
    this._bindings.on('read', this._onRead.bind(this));
    this._bindings.on('write', this._onWrite.bind(this));
    this._bindings.on('broadcast', this._onBroadcast.bind(this));
    this._bindings.on('notify', this._onNotify.bind(this));
    this._bindings.on('descriptorsDiscover', this._onDescriptorsDiscover.bind(this));
    this._bindings.on('valueRead', this._onValueRead.bind(this));
    this._bindings.on('valueWrite', this._onValueWrite.bind(this));
    this._bindings.on('handleRead', this._onHandleRead.bind(this));
    this._bindings.on('handleWrite', this._onHandleWrite.bind(this));
    this._bindings.on('handleNotify', this._onHandleNotify.bind(this));
    this._bindings.on('onMtu', this._onMtu.bind(this));
  }

  _createPeripheral (uuid, address, addressType, connectable, advertisement, rssi, scannable) {
    const peripheral = new Peripheral(this, uuid, address, addressType, connectable, advertisement, rssi, scannable);

    this._peripherals.set(uuid, peripheral);
    this._services[uuid] = {};
    this._characteristics[uuid] = {};
    this._descriptors[uuid] = {};

    return peripheral;
  }

  _cleanupPeriperals (uuid = null) {
    const terminateConnection = (peripheral) => {
      if (peripheral.state === 'connecting') {
        // To unblock the async connect call
        this._onConnect(peripheral.id, new Error('cleanup'));
      }
      else if (peripheral.state !== 'disconnected') {
        this._onDisconnect(peripheral.id, 'cleanup');
      }
    };
    if (uuid) {
      const peripheral = this._peripherals.get(uuid);
      if (peripheral) {
        terminateConnection(peripheral);
      }
      this._peripherals.delete(uuid);
      this._discoveredPeripherals.delete(uuid);
      delete this._services[uuid];
      delete this._characteristics[uuid];
      delete this._descriptors[uuid];
    } else {
      this._peripherals.forEach(peripheral => terminateConnection(peripheral));
      this._peripherals.clear();
      this._discoveredPeripherals.clear();
      this._services = {};
      this._characteristics = {};
      this._descriptors = {};
    }
  }

  _onStateChange (state) {
    debug(`stateChange ${state}`);

    // If the state is poweredOff and the previous state was poweredOn, clean up the peripherals
    if (state === 'poweredOff' && this._state === 'poweredOn') {
      this._cleanupPeriperals();
    }

    this._state = state;
    this.emit('stateChange', state);
  }

  _onAddressChange (address) {
    debug(`addressChange ${address}`);
    this._address = address;
    this.emit('addressChange', address);
  }

  setScanParameters (interval, window, callback) {
    if (callback) {
      this.once('scanParametersSet', callback);
    }
    this._bindings.setScanParameters(interval, window);
  }

  _onScanParametersSet () {
    debug('scanParametersSet');
    this.emit('scanParametersSet');
  }
  
  setAddress (address) {
    if (this._bindings.setAddress) {
      this._bindings.setAddress(address);
    } else {
      this.emit('warning', 'current binding does not implement setAddress method.');
    }
  }

  async waitForPoweredOnAsync (timeout = 10000) {
    return new Promise((resolve, reject) => {
      if (this.state === 'poweredOn') {
        resolve();
        return;
      }
      const timeoutId = setTimeout(() => {
        reject(new Error('Timeout waiting for Noble to be powered on'));
      }, timeout);

      const listener = (state) => {
        if (state === 'poweredOn') {
          clearTimeout(timeoutId);
          resolve();
        } else {
          this.once('stateChange', listener);
        }
      };

      this.once('stateChange', listener);
    });
  }

  startScanning (serviceUuids, allowDuplicates, callback) {
    const self = this;
    const scan = (state) => {
      if (state !== 'poweredOn') {
        self.once('stateChange', scan.bind(self));
        const error = new Error(`Could not start scanning, state is ${state} (not poweredOn)`);

        if (typeof callback === 'function') {
          callback(error);
        } else {
          throw error;
        }
      } else {
        if (callback) {
          this.once('scanStart', filterDuplicates => callback(null, filterDuplicates));
        }

        this._discoveredPeripherals.clear();
        this._allowDuplicates = allowDuplicates;

        this._bindings.startScanning(serviceUuids, allowDuplicates);
      }
    };
    // if bindings still not init, do it now
    if (this._initialized === false) {
      this.once('stateChange', scan.bind(this));
      this._initializeBindings();
    } else {
      scan.call(this, this._state);
    }
  }

  async startScanningAsync (serviceUUIDs, allowDuplicates) {
    return new Promise((resolve, reject) => {
      this.startScanning(serviceUUIDs, allowDuplicates, error => error ? reject(error) : resolve());
    });
  }

  _onScanStart (filterDuplicates) {
    debug('scanStart');
    this.emit('scanStart', filterDuplicates);
  }

  stopScanning (callback) {
    if (this._initialized === false || this._bindings === null) {
      callback(new Error('Bindings are not initialized'));
      return;
    }
    if (callback) {
      this.once('scanStop', callback);
    }
    this._bindings.stopScanning();
  }

  async stopScanningAsync () {
    return new Promise((resolve, reject) => {
      this.stopScanning(error => error ? reject(error) : resolve());
    });
  }

  async *discoverAsync () {
    const deviceQueue = [];
    let scanning = true;
    
    // Main discover listener to add devices to the queue
    const discoverListener = peripheral => deviceQueue.push(peripheral);
    
    // State change listener
    const scanStopListener = () => scanning = false;
    
    // Set up listeners
    this.on('discover', discoverListener);
    this.once('scanStop', scanStopListener);
    
    try {
        // Start the scanning process
        await this.startScanningAsync();
        
        // Process discovered devices
        while (scanning || deviceQueue.length > 0) {
            if (deviceQueue.length > 0) {
                // If we have devices in the queue, yield them
                yield deviceQueue.shift();
            } else if (scanning) {
                // Wait for either a new device or scan stop
                await new Promise(resolve => {
                    const tempDiscoverListener = () => resolve();
                    
                    // Set up a temporary discover listener
                    this.once('discover', tempDiscoverListener);
                    
                    // Set up a cleanup for when scanning stops
                    const tempScanStopListener = () => {
                        this.removeListener('discover', tempDiscoverListener);
                        resolve();
                    };
                    this.once('scanStop', tempScanStopListener);
                    
                    // Handle race condition where a device might arrive during promise setup
                    if (deviceQueue.length > 0) {
                        this.removeListener('discover', tempDiscoverListener);
                        this.removeListener('scanStop', tempScanStopListener);
                        resolve();
                    }
                    
                    // Optional: Add a maximum wait time, but with proper cleanup
                    // This can be removed to eliminate timer dependency
                    if (scanning) {
                        const timeoutId = setTimeout(() => {
                            this.removeListener('discover', tempDiscoverListener);
                            this.removeListener('scanStop', tempScanStopListener);
                            resolve();
                        }, 1000);
                        
                        // Make sure we clear the timeout if we resolve before timeout
                        const clearTimeoutFn = () => clearTimeout(timeoutId);
                        this.once('discover', clearTimeoutFn);
                        this.once('scanStop', clearTimeoutFn);
                    }
                });
            }
        }
    } finally {
        // Clean up listeners
        this.removeListener('discover', discoverListener);
        this.removeListener('scanStop', scanStopListener);
        
        // Ensure scanning is stopped
        if (scanning) {
            await this.stopScanningAsync();
        }
    }
  }

  _onScanStop () {
    debug('scanStop');
    this.emit('scanStop');
  }

  reset () {
    if (typeof this._bindings.reset !== 'function') { return; }
    this._bindings.reset();
  }

  stop () {
    if (typeof this._bindings.stop !== 'function') { return; }
    this._bindings.stop();
  }

  _onDiscover (uuid, address, addressType, connectable, advertisement, rssi, scannable) {
    let peripheral = this._peripherals.get(uuid);

    if (!peripheral) {
      peripheral = this._createPeripheral(uuid, address, addressType, connectable, advertisement, rssi, scannable);
    } else {
      // "or" the advertisment data with existing
      for (const i in advertisement) {
        if (advertisement[i] !== undefined) {
          peripheral.advertisement[i] = advertisement[i];
        }
      }

      peripheral.connectable = connectable;
      peripheral.scannable = scannable;
      peripheral.rssi = rssi;
    }

    const previouslyDiscoverd = this._discoveredPeripherals.has(uuid);

    if (!previouslyDiscoverd) {
      this._discoveredPeripherals.add(uuid);
    }
    if (this._allowDuplicates || !previouslyDiscoverd || (!scannable && !connectable)) {
      this.emit('discover', peripheral);
    }
  }

  _getPeripheralId (idOrAddress) {
    let identifier;
    // Convert the peripheralId to an identifier
    if (/^[0-9A-Fa-f]+$/.test(idOrAddress) === false) {
      identifier = this._bindings.addressToId(idOrAddress);
      if (identifier === null) {
        throw new Error(`Invalid peripheral ID or Address ${idOrAddress}`);
      }
    } else {
      identifier = idOrAddress;
    }
    return identifier;
  }

  connect (idOrAddress, parameters, callback) {
    // Get the identifier for the peripheral
    const identifier = this._getPeripheralId(idOrAddress);
    // Check if callback is a function
    if (typeof callback === 'function') {
      // Add a one-time listener for this specific event
      this.once(`connect:${identifier}`, error => callback(error, this._peripherals.get(identifier)));
    }

    // Proceed to initiate the connection
    this._bindings.connect(identifier, parameters);
  }
  
  async connectAsync (idOrAddress, parameters) {
    return new Promise((resolve, reject) => {
      this.connect(idOrAddress, parameters, (error, peripheral) => error ? reject(error) : resolve(peripheral));
    });
  }

  _onConnect (peripheralId, error) {
    const peripheral = this._peripherals.get(peripheralId);

    if (peripheral) {
      // Emit a unique connect event for the specific peripheral
      this.emit(`connect:${peripheralId}`, error);

      peripheral.state = error ? 'error' : 'connected';
      // Also emit the general 'connect' event for a peripheral
      peripheral.emit('connect', error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralId} connected!`);
    }
  }

  cancelConnect (idOrAddress, parameters) {
    // Get the identifier for the peripheral
    const identifier = this._getPeripheralId(idOrAddress);
    
    // Check if the peripheral is connecting
    const peripheral = this._peripherals.get(identifier);
    if (peripheral && peripheral.state === 'connecting') {
      peripheral.state = 'disconnected';
    }
    // Emit a unique connect event for the specific peripheral
    this.emit(`connect:${identifier}`, new Error('connection canceled!'));
    // Cancel the connection
    this._bindings.cancelConnect(identifier, parameters);
  }

  disconnect (peripheralId) {
    // Disconnect the peripheral
    this._bindings.disconnect(peripheralId);
  }

  _onDisconnect (peripheralId, reason) {
    const peripheral = this._peripherals.get(peripheralId);

    if (peripheral) {
      peripheral.state = 'disconnected';
      peripheral.emit('disconnect', reason);
      this.emit(`disconnect:${peripheralId}`, reason);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralId} disconnected!`);
    }
  }

  updateRssi (peripheralId) {
    this._bindings.updateRssi(peripheralId);
  }

  _onRssiUpdate (peripheralId, rssi, error) {
    const peripheral = this._peripherals.get(peripheralId);

    if (peripheral) {
      peripheral.rssi = rssi;

      peripheral.emit('rssiUpdate', rssi, error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralId} RSSI update!`);
    }
  }

  /// add an array of service objects (as retrieved via the servicesDiscovered event)
  addServices (peripheralId, services) {
    const servObjs = [];

    for (let i = 0; i < services.length; i++) {
      const o = this.addService(peripheralId, services[i]);
      servObjs.push(o);
    }
    return servObjs;
  }

  /// service is a ServiceObject { uuid, startHandle, endHandle,..}
  addService (peripheralId, service) {
    const peripheral = this._peripherals.get(peripheralId);

    // pass on to lower layers (gatt)
    if (this._bindings.addService) {
      this._bindings.addService(peripheralId, service);
    }

    if (!peripheral.services) {
      peripheral.services = [];
    }
    // allocate internal service object and return
    const serv = new Service(this, peripheralId, service.uuid);

    this._services[peripheralId][service.uuid] = serv;
    this._characteristics[peripheralId][service.uuid] = {};
    this._descriptors[peripheralId][service.uuid] = {};

    peripheral.services.push(serv);

    return serv;
  }

  /// callback receiving a list of service objects from the gatt layer
  _onServicesDiscovered (peripheralId, services) {
    const peripheral = this._peripherals.get(peripheralId);

    if (peripheral) { peripheral.emit('servicesDiscovered', peripheral, services); } // pass on to higher layers
  }

  discoverServices (peripheralId, uuids) {
    this._bindings.discoverServices(peripheralId, uuids);
  }

  _onServicesDiscover (peripheralId, serviceUuids, error) {
    const peripheral = this._peripherals.get(peripheralId);

    if (peripheral) {
      const services = [];

      for (let i = 0; i < serviceUuids.length; i++) {
        const serviceUuid = serviceUuids[i];
        const service = new Service(this, peripheralId, serviceUuid);

        this._services[peripheralId][serviceUuid] = service;
        this._characteristics[peripheralId][serviceUuid] = {};
        this._descriptors[peripheralId][serviceUuid] = {};

        services.push(service);
      }

      peripheral.services = services;
      
      peripheral.emit('servicesDiscover', services, error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralId} services discover!`);
    }
  }

  discoverIncludedServices (peripheralId, serviceUuid, serviceUuids) {
    this._bindings.discoverIncludedServices(peripheralId, serviceUuid, serviceUuids);
  }

  _onIncludedServicesDiscover (peripheralId, serviceUuid, includedServiceUuids, error) {
    const service = this._services[peripheralId][serviceUuid];

    if (service) {
      service.includedServiceUuids = includedServiceUuids;

      service.emit('includedServicesDiscover', includedServiceUuids, error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralId}, ${serviceUuid} included services discover!`);
    }
  }

  /// add characteristics to the peripheral; returns an array of initialized Characteristics objects
  addCharacteristics (peripheralId, serviceUuid, characteristics) {
    // first, initialize gatt layer:
    if (this._bindings.addCharacteristics) {
      this._bindings.addCharacteristics(peripheralId, serviceUuid, characteristics);
    }

    const service = this._services[peripheralId][serviceUuid];
    if (!service) {
      this.emit('warning', `unknown service ${peripheralId}, ${serviceUuid} characteristics discover!`);
      return;
    }

    const characteristics_ = [];
    for (let i = 0; i < characteristics.length; i++) {
      const characteristicUuid = characteristics[i].uuid;

      const characteristic = new Characteristic(
        this,
        peripheralId,
        serviceUuid,
        characteristicUuid,
        characteristics[i].properties
      );

      this._characteristics[peripheralId][serviceUuid][characteristicUuid] = characteristic;
      this._descriptors[peripheralId][serviceUuid][characteristicUuid] = {};

      characteristics_.push(characteristic);
    }
    service.characteristics = characteristics_;
    return characteristics_;
  }

  _onCharacteristicsDiscovered (peripheralId, serviceUuid, characteristics) {
    const service = this._services[peripheralId][serviceUuid];

    service.emit('characteristicsDiscovered', characteristics);
  }

  discoverCharacteristics (peripheralId, serviceUuid, characteristicUuids) {
    this._bindings.discoverCharacteristics(peripheralId, serviceUuid, characteristicUuids);
  }

  _onCharacteristicsDiscover (peripheralId, serviceUuid, characteristics, error) {
    const service = this._services[peripheralId][serviceUuid];

    if (service) {
      const characteristics_ = [];

      for (let i = 0; i < characteristics.length; i++) {
        const characteristicUuid = characteristics[i].uuid;

        const characteristic = new Characteristic(
          this,
          peripheralId,
          serviceUuid,
          characteristicUuid,
          characteristics[i].properties
        );

        this._characteristics[peripheralId][serviceUuid][characteristicUuid] = characteristic;
        this._descriptors[peripheralId][serviceUuid][characteristicUuid] = {};

        characteristics_.push(characteristic);
      }

      service.characteristics = characteristics_;

      service.emit('characteristicsDiscover', characteristics_, error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralId}, ${serviceUuid} characteristics discover!`);
    }
  }

  read (peripheralId, serviceUuid, characteristicUuid) {
    this._bindings.read(peripheralId, serviceUuid, characteristicUuid);
  }

  _onRead (peripheralId, serviceUuid, characteristicUuid, data, isNotification, error) {
    const characteristic = this._characteristics[peripheralId][serviceUuid][characteristicUuid];

    if (characteristic) {
      characteristic.emit('data', data, isNotification, error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralId}, ${serviceUuid}, ${characteristicUuid} read!`);
    }
  }

  write (peripheralId, serviceUuid, characteristicUuid, data, withoutResponse) {
    this._bindings.write(peripheralId, serviceUuid, characteristicUuid, data, withoutResponse);
  }

  _onWrite (peripheralId, serviceUuid, characteristicUuid, error) {
    const characteristic = this._characteristics[peripheralId][serviceUuid][characteristicUuid];

    if (characteristic) {
      characteristic.emit('write', error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralId}, ${serviceUuid}, ${characteristicUuid} write!`);
    }
  }

  broadcast (peripheralId, serviceUuid, characteristicUuid, broadcast) {
    this._bindings.broadcast(peripheralId, serviceUuid, characteristicUuid, broadcast);
  }

  _onBroadcast (peripheralId, serviceUuid, characteristicUuid, state) {
    const characteristic = this._characteristics[peripheralId][serviceUuid][characteristicUuid];

    if (characteristic) {
      characteristic.emit('broadcast', state);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralId}, ${serviceUuid}, ${characteristicUuid} broadcast!`);
    }
  }

  notify (peripheralId, serviceUuid, characteristicUuid, notify) {
    this._bindings.notify(peripheralId, serviceUuid, characteristicUuid, notify);
  }

  _onNotify (peripheralId, serviceUuid, characteristicUuid, state, error) {
    const characteristic = this._characteristics[peripheralId][serviceUuid][characteristicUuid];
    if (characteristic) {
      characteristic.emit('notify', state, error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralId}, ${serviceUuid}, ${characteristicUuid} notify!`);
    }
  }

  discoverDescriptors (peripheralId, serviceUuid, characteristicUuid) {
    this._bindings.discoverDescriptors(peripheralId, serviceUuid, characteristicUuid);
  }

  _onDescriptorsDiscover (peripheralId, serviceUuid, characteristicUuid, descriptors, error) {
    const characteristic = this._characteristics[peripheralId][serviceUuid][characteristicUuid];

    if (characteristic) {
      const descriptors_ = [];

      for (let i = 0; i < descriptors.length; i++) {
        const descriptorUuid = descriptors[i];

        const descriptor = new Descriptor(
          this,
          peripheralId,
          serviceUuid,
          characteristicUuid,
          descriptorUuid
        );

        this._descriptors[peripheralId][serviceUuid][characteristicUuid][descriptorUuid] = descriptor;

        descriptors_.push(descriptor);
      }

      characteristic.descriptors = descriptors_;

      characteristic.emit('descriptorsDiscover', descriptors_, error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralId}, ${serviceUuid}, ${characteristicUuid} descriptors discover!`);
    }
  }

  readValue (peripheralId, serviceUuid, characteristicUuid, descriptorUuid) {
    this._bindings.readValue(peripheralId, serviceUuid, characteristicUuid, descriptorUuid);
  }

  _onValueRead (peripheralId, serviceUuid, characteristicUuid, descriptorUuid, data, error) {
    const descriptor = this._descriptors[peripheralId][serviceUuid][characteristicUuid][descriptorUuid];

    if (descriptor) {
      descriptor.emit('valueRead', data, error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralId}, ${serviceUuid}, ${characteristicUuid}, ${descriptorUuid} value read!`);
    }
  }

  writeValue (peripheralId, serviceUuid, characteristicUuid, descriptorUuid, data) {
    this._bindings.writeValue(peripheralId, serviceUuid, characteristicUuid, descriptorUuid, data);
  }

  _onValueWrite (peripheralId, serviceUuid, characteristicUuid, descriptorUuid, error) {
    const descriptor = this._descriptors[peripheralId][serviceUuid][characteristicUuid][descriptorUuid];

    if (descriptor) {
      descriptor.emit('valueWrite', error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralId}, ${serviceUuid}, ${characteristicUuid}, ${descriptorUuid} value write!`);
    }
  }

  readHandle (peripheralId, handle) {
    this._bindings.readHandle(peripheralId, handle);
  }

  _onHandleRead (peripheralId, handle, data, error) {
    const peripheral = this._peripherals.get(peripheralId);

    if (peripheral) {
      peripheral.emit(`handleRead${handle}`, data, error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralId} handle read!`);
    }
  }

  writeHandle (peripheralId, handle, data, withoutResponse) {
    this._bindings.writeHandle(peripheralId, handle, data, withoutResponse);
  }

  _onHandleWrite (peripheralId, handle, error) {
    const peripheral = this._peripherals.get(peripheralId);

    if (peripheral) {
      peripheral.emit(`handleWrite${handle}`, error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralId} handle write!`);
    }
  }

  _onHandleNotify (peripheralId, handle, data, error) {
    const peripheral = this._peripherals.get(peripheralId);

    if (peripheral) {
      peripheral.emit('handleNotify', handle, data, error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralId} handle notify!`);
    }
  }

  _onMtu (peripheralId, mtu) {
    const peripheral = this._peripherals.get(peripheralId);
    if (peripheral && mtu) {
      peripheral.mtu = mtu;
      peripheral.emit('mtu', mtu);
    }
  }

  async _withDisconnectHandler (peripheralId, operation) {
    return new Promise((resolve, reject) => {
      const disconnectListener = error => reject(error);
      this.once(`disconnect:${peripheralId}`, disconnectListener);
      
      Promise.resolve(operation())
        .then(result => {
          this.removeListener(`disconnect:${peripheralId}`, disconnectListener);
          resolve(result);
        })
        .catch(error => {
          this.removeListener(`disconnect:${peripheralId}`, disconnectListener);
          reject(error);
        });
    });
  }
}

module.exports = Noble;
