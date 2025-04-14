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
    this._discoveredPeripherals = new Set();
    this._peripherals = new Map();
    this._services = {};
    this._characteristics = {};
    this._descriptors = {};
    this._initialized = false;
    this._state = 'unknown';
    this._bindings = null;
    
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
    const emitDisconnect = (peripheral) => {
      if (peripheral.state !== 'disconnected') {
        this._onDisconnect(peripheral.id, 'cleanup');
      }
    };
    if (uuid) {
      const peripheral = this._peripherals.get(uuid);
      if (peripheral) {
        emitDisconnect(peripheral);
      }
      this._peripherals.delete(uuid);
      this._discoveredPeripherals.delete(uuid);
      delete this._services[uuid];
      delete this._characteristics[uuid];
      delete this._descriptors[uuid];
    } else {
      this._peripherals.forEach(peripheral => emitDisconnect(peripheral));
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

  async waitForPoweredOn (timeout = 10000) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Timeout waiting for Noble to be powered on'));
      }, timeout);

      let listener;
      listener = (state) => {
        clearTimeout(timeoutId);
        if (state === 'poweredOn') {
          resolve();
        } else {
          this.once('stateChange', listener);
        }
      };

      this.once('stateChange', listener);
    });
  }

  startScanning (serviceUuids, allowDuplicates, callback) {
    if (typeof serviceUuids === 'function') {
      this.emit('warning', 'calling startScanning(callback) is deprecated');
    }

    if (typeof allowDuplicates === 'function') {
      this.emit('warning', 'calling startScanning(serviceUuids, callback) is deprecated');
    }

    const self = this;
    const scan = (state) => {
      if (state !== 'poweredOn') {
        self.once('stateChange', scan.bind(self));
        // const error = new Error(`Could not start scanning, state is ${state} (not poweredOn)`);

        if (typeof callback === 'function') {
          // callback(error);
        } else {
          // throw error;
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
    }
    if (callback) {
      this.once('scanStop', callback);
    }
    this._bindings.stopScanning();
  }

  async stopScanningAsync () {
    return new Promise(resolve => this.stopScanning(resolve));
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

  connect (peripheralUuid, parameters, callback) {
    // Check if callback is a function
    if (typeof callback === 'function') {
      // Add a one-time listener for this specific event
      this.once(`connect:${peripheralUuid}`, error => callback(error, this._peripherals.get(peripheralUuid)));
    }
    // Proceed to initiate the connection
    this._bindings.connect(peripheralUuid, parameters);
  }
  
  async connectAsync (peripheralUuid, parameters) {
    return new Promise((resolve, reject) => {
      this.connect(peripheralUuid, parameters, (error, peripheral) => error ? reject(error) : resolve(peripheral));
    });
  }

  _onConnect (peripheralUuid, error) {
    const peripheral = this._peripherals.get(peripheralUuid);

    if (peripheral) {
      // Emit a unique connect event for the specific peripheral
      this.emit(`connect:${peripheralUuid}`, error);

      peripheral.state = error ? 'error' : 'connected';
      // Also emit the general 'connect' event for a peripheral
      peripheral.emit('connect', error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralUuid} connected!`);
    }
  }

  cancelConnect (peripheralUuid, parameters) {
    this._bindings.cancelConnect(peripheralUuid, parameters);
  }

  disconnect (peripheralUuid) {
    this._bindings.disconnect(peripheralUuid);
  }

  _onDisconnect (peripheralUuid, reason) {
    const peripheral = this._peripherals.get(peripheralUuid);

    if (peripheral) {
      peripheral.state = 'disconnected';
      peripheral.emit('disconnect', reason);
      this.emit(`disconnect:${peripheralUuid}`, reason);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralUuid} disconnected!`);
    }
  }

  updateRssi (peripheralUuid) {
    this._bindings.updateRssi(peripheralUuid);
  }

  _onRssiUpdate (peripheralUuid, rssi) {
    const peripheral = this._peripherals.get(peripheralUuid);

    if (peripheral) {
      peripheral.rssi = rssi;

      peripheral.emit('rssiUpdate', rssi);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralUuid} RSSI update!`);
    }
  }

  /// add an array of service objects (as retrieved via the servicesDiscovered event)
  addServices (peripheralUuid, services) {
    const servObjs = [];

    for (let i = 0; i < services.length; i++) {
      const o = this.addService(peripheralUuid, services[i]);
      servObjs.push(o);
    }
    return servObjs;
  }

  /// service is a ServiceObject { uuid, startHandle, endHandle,..}
  addService (peripheralUuid, service) {
    const peripheral = this._peripherals.get(peripheralUuid);

    // pass on to lower layers (gatt)
    if (this._bindings.addService) {
      this._bindings.addService(peripheralUuid, service);
    }

    if (!peripheral.services) {
      peripheral.services = [];
    }
    // allocate internal service object and return
    const serv = new Service(this, peripheralUuid, service.uuid);

    this._services[peripheralUuid][service.uuid] = serv;
    this._characteristics[peripheralUuid][service.uuid] = {};
    this._descriptors[peripheralUuid][service.uuid] = {};

    peripheral.services.push(serv);

    return serv;
  }

  /// callback receiving a list of service objects from the gatt layer
  _onServicesDiscovered (peripheralUuid, services) {
    const peripheral = this._peripherals.get(peripheralUuid);

    if (peripheral) { peripheral.emit('servicesDiscovered', peripheral, services); } // pass on to higher layers
  }

  discoverServices (peripheralUuid, uuids) {
    this._bindings.discoverServices(peripheralUuid, uuids);
  }

  _onServicesDiscover (peripheralUuid, serviceUuids, error) {
    const peripheral = this._peripherals.get(peripheralUuid);

    if (peripheral) {
      const services = [];

      for (let i = 0; i < serviceUuids.length; i++) {
        const serviceUuid = serviceUuids[i];
        const service = new Service(this, peripheralUuid, serviceUuid);

        this._services[peripheralUuid][serviceUuid] = service;
        this._characteristics[peripheralUuid][serviceUuid] = {};
        this._descriptors[peripheralUuid][serviceUuid] = {};

        services.push(service);
      }

      peripheral.services = services;
      
      peripheral.emit('servicesDiscover', services, error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralUuid} services discover!`);
    }
  }

  discoverIncludedServices (peripheralUuid, serviceUuid, serviceUuids) {
    this._bindings.discoverIncludedServices(peripheralUuid, serviceUuid, serviceUuids);
  }

  _onIncludedServicesDiscover (peripheralUuid, serviceUuid, includedServiceUuids, error) {
    const service = this._services[peripheralUuid][serviceUuid];

    if (service) {
      service.includedServiceUuids = includedServiceUuids;

      service.emit('includedServicesDiscover', includedServiceUuids, error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralUuid}, ${serviceUuid} included services discover!`);
    }
  }

  /// add characteristics to the peripheral; returns an array of initialized Characteristics objects
  addCharacteristics (peripheralUuid, serviceUuid, characteristics) {
    // first, initialize gatt layer:
    if (this._bindings.addCharacteristics) {
      this._bindings.addCharacteristics(peripheralUuid, serviceUuid, characteristics);
    }

    const service = this._services[peripheralUuid][serviceUuid];
    if (!service) {
      this.emit('warning', `unknown service ${peripheralUuid}, ${serviceUuid} characteristics discover!`);
      return;
    }

    const characteristics_ = [];
    for (let i = 0; i < characteristics.length; i++) {
      const characteristicUuid = characteristics[i].uuid;

      const characteristic = new Characteristic(
        this,
        peripheralUuid,
        serviceUuid,
        characteristicUuid,
        characteristics[i].properties
      );

      this._characteristics[peripheralUuid][serviceUuid][characteristicUuid] = characteristic;
      this._descriptors[peripheralUuid][serviceUuid][characteristicUuid] = {};

      characteristics_.push(characteristic);
    }
    service.characteristics = characteristics_;
    return characteristics_;
  }

  _onCharacteristicsDiscovered (peripheralUuid, serviceUuid, characteristics) {
    const service = this._services[peripheralUuid][serviceUuid];

    service.emit('characteristicsDiscovered', characteristics);
  }

  discoverCharacteristics (peripheralUuid, serviceUuid, characteristicUuids) {
    this._bindings.discoverCharacteristics(peripheralUuid, serviceUuid, characteristicUuids);
  }

  _onCharacteristicsDiscover (peripheralUuid, serviceUuid, characteristics, error) {
    const service = this._services[peripheralUuid][serviceUuid];

    if (service) {
      const characteristics_ = [];

      for (let i = 0; i < characteristics.length; i++) {
        const characteristicUuid = characteristics[i].uuid;

        const characteristic = new Characteristic(
          this,
          peripheralUuid,
          serviceUuid,
          characteristicUuid,
          characteristics[i].properties
        );

        this._characteristics[peripheralUuid][serviceUuid][characteristicUuid] = characteristic;
        this._descriptors[peripheralUuid][serviceUuid][characteristicUuid] = {};

        characteristics_.push(characteristic);
      }

      service.characteristics = characteristics_;

      service.emit('characteristicsDiscover', characteristics_, error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralUuid}, ${serviceUuid} characteristics discover!`);
    }
  }

  read (peripheralUuid, serviceUuid, characteristicUuid) {
    this._bindings.read(peripheralUuid, serviceUuid, characteristicUuid);
  }

  _onRead (peripheralUuid, serviceUuid, characteristicUuid, data, isNotification, error) {
    const characteristic = this._characteristics[peripheralUuid][serviceUuid][characteristicUuid];

    if (characteristic) {
      characteristic.emit('read', data, isNotification, error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralUuid}, ${serviceUuid}, ${characteristicUuid} read!`);
    }
  }

  write (peripheralUuid, serviceUuid, characteristicUuid, data, withoutResponse) {
    this._bindings.write(peripheralUuid, serviceUuid, characteristicUuid, data, withoutResponse);
  }

  _onWrite (peripheralUuid, serviceUuid, characteristicUuid, error) {
    const characteristic = this._characteristics[peripheralUuid][serviceUuid][characteristicUuid];

    if (characteristic) {
      characteristic.emit('write', error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralUuid}, ${serviceUuid}, ${characteristicUuid} write!`);
    }
  }

  broadcast (peripheralUuid, serviceUuid, characteristicUuid, broadcast) {
    this._bindings.broadcast(peripheralUuid, serviceUuid, characteristicUuid, broadcast);
  }

  _onBroadcast (peripheralUuid, serviceUuid, characteristicUuid, state) {
    const characteristic = this._characteristics[peripheralUuid][serviceUuid][characteristicUuid];

    if (characteristic) {
      characteristic.emit('broadcast', state);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralUuid}, ${serviceUuid}, ${characteristicUuid} broadcast!`);
    }
  }

  notify (peripheralUuid, serviceUuid, characteristicUuid, notify) {
    this._bindings.notify(peripheralUuid, serviceUuid, characteristicUuid, notify);
  }

  _onNotify (peripheralUuid, serviceUuid, characteristicUuid, state, error) {
    const characteristic = this._characteristics[peripheralUuid][serviceUuid][characteristicUuid];

    if (characteristic) {
      characteristic.emit('notify', state, error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralUuid}, ${serviceUuid}, ${characteristicUuid} notify!`);
    }
  }

  discoverDescriptors (peripheralUuid, serviceUuid, characteristicUuid) {
    this._bindings.discoverDescriptors(peripheralUuid, serviceUuid, characteristicUuid);
  }

  _onDescriptorsDiscover (peripheralUuid, serviceUuid, characteristicUuid, descriptors, error) {
    const characteristic = this._characteristics[peripheralUuid][serviceUuid][characteristicUuid];

    if (characteristic) {
      const descriptors_ = [];

      for (let i = 0; i < descriptors.length; i++) {
        const descriptorUuid = descriptors[i];

        const descriptor = new Descriptor(
          this,
          peripheralUuid,
          serviceUuid,
          characteristicUuid,
          descriptorUuid
        );

        this._descriptors[peripheralUuid][serviceUuid][characteristicUuid][descriptorUuid] = descriptor;

        descriptors_.push(descriptor);
      }

      characteristic.descriptors = descriptors_;

      characteristic.emit('descriptorsDiscover', descriptors_, error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralUuid}, ${serviceUuid}, ${characteristicUuid} descriptors discover!`);
    }
  }

  readValue (peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid) {
    this._bindings.readValue(peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid);
  }

  _onValueRead (peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid, data, error) {
    const descriptor = this._descriptors[peripheralUuid][serviceUuid][characteristicUuid][descriptorUuid];

    if (descriptor) {
      descriptor.emit('valueRead', data, error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralUuid}, ${serviceUuid}, ${characteristicUuid}, ${descriptorUuid} value read!`);
    }
  }

  writeValue (peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid, data) {
    this._bindings.writeValue(peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid, data);
  }

  _onValueWrite (peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid, error) {
    const descriptor = this._descriptors[peripheralUuid][serviceUuid][characteristicUuid][descriptorUuid];

    if (descriptor) {
      descriptor.emit('valueWrite', error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralUuid}, ${serviceUuid}, ${characteristicUuid}, ${descriptorUuid} value write!`);
    }
  }

  readHandle (peripheralUuid, handle) {
    this._bindings.readHandle(peripheralUuid, handle);
  }

  _onHandleRead (peripheralUuid, handle, data, error) {
    const peripheral = this._peripherals.get(peripheralUuid);

    if (peripheral) {
      peripheral.emit(`handleRead${handle}`, data, error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralUuid} handle read!`);
    }
  }

  writeHandle (peripheralUuid, handle, data, withoutResponse) {
    this._bindings.writeHandle(peripheralUuid, handle, data, withoutResponse);
  }

  _onHandleWrite (peripheralUuid, handle, error) {
    const peripheral = this._peripherals.get(peripheralUuid);

    if (peripheral) {
      peripheral.emit(`handleWrite${handle}`, error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralUuid} handle write!`);
    }
  }

  _onHandleNotify (peripheralUuid, handle, data, error) {
    const peripheral = this._peripherals.get(peripheralUuid);

    if (peripheral) {
      peripheral.emit('handleNotify', handle, data, error);
    } else {
      this.emit('warning', `unknown peripheral ${peripheralUuid} handle notify!`);
    }
  }

  _onMtu (peripheralUuid, mtu) {
    const peripheral = this._peripherals.get(peripheralUuid);
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
