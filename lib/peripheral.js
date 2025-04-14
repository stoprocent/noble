const { EventEmitter } = require('events');

class Peripheral extends EventEmitter {
  constructor (noble, id, address, addressType, connectable, advertisement, rssi, scannable) {
    super();
    this._noble = noble;
    this.id = id;
    this.address = address;
    this.addressType = addressType;
    this.connectable = connectable;
    this.scannable = scannable;
    this.advertisement = advertisement;
    this.rssi = rssi;
    this.services = null;
    this.mtu = null;
    this.state = 'disconnected';
  }

  get uuid () {
    return this.id;
  }

  toString () {
    return JSON.stringify({
      id: this.id,
      address: this.address,
      addressType: this.addressType,
      connectable: this.connectable,
      advertisement: this.advertisement,
      rssi: this.rssi,
      mtu: this.mtu,
      state: this.state
    });
  }

  connect (options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = undefined;
    }

    if (callback) {
      this.once('connect', error => callback(error));
    }

    if (this.state === 'connected') {
      this.emit('connect', new Error('Peripheral already connected'));
    } else {
      this.state = 'connecting';
      this._noble.connect(this.id, options);
    }
  }

  async connectAsync (options) {
    return new Promise((resolve, reject) => {
      this.connect(options, error => error ? reject(error) : resolve());
    });
  }

  cancelConnect (options) {
    if (this.state === 'connecting') {
      this.emit('connect', new Error('connection canceled!'));
      this._noble.cancelConnect(this.id, options);
    }
  }

  disconnect (callback) {
    if (callback) {
      this.once('disconnect', () => callback(null));
    }
    this.state = 'disconnecting';
    this._noble.disconnect(this.id);
  }

  async disconnectAsync () {
    return new Promise((resolve, reject) => {
      this.disconnect(error => error ? reject(error) : resolve());
    });
  }

  updateRssi (callback) {
    if (callback) {
      this.once('rssiUpdate', (rssi, error) => callback(error, rssi));
    }
    this._noble.updateRssi(this.id);
  }

  async updateRssiAsync () {
    return this._noble._withDisconnectHandler(this.id, () => {
      return new Promise((resolve, reject) => {
        this.updateRssi((error, rssi) => error ? reject(error) : resolve(rssi));
      });
    });
  }

  discoverServices (uuids, callback) {
    if (callback) {
      this.once('servicesDiscover', (services, error) => callback(error, services));
    }
    this._noble.discoverServices(this.id, uuids);
  }

  async discoverServicesAsync (uuids) {
    return this._noble._withDisconnectHandler(this.id, () => {
      return new Promise((resolve, reject) => {
        this.discoverServices(uuids, (error, services) => error ? reject(error) : resolve(services));
      });
    });
  }

  discoverSomeServicesAndCharacteristics (serviceUuids, characteristicsUuids, callback) {
    this.discoverServices(serviceUuids, (err, services) => {
      if (!err && services.length < serviceUuids.length) {
        err = 'Could not find all requested services';
      }

      if (err) {
        callback(err, null, null);
        return;
      }
      let numDiscovered = 0;
      const allCharacteristics = [];

      for (const i in services) {
        const service = services[i];

        service.discoverCharacteristics(characteristicsUuids, (error, characteristics) => {
          numDiscovered++;

          if (error === null) {
            for (const j in characteristics) {
              const characteristic = characteristics[j];
              allCharacteristics.push(characteristic);
            }
          }

          if (numDiscovered === services.length) {
            if (callback) {
              callback(null, services, allCharacteristics);
            }
          }
        });
      }
    });
  }

  async discoverSomeServicesAndCharacteristicsAsync (serviceUuids, characteristicsUuids) {
    return this._noble._withDisconnectHandler(this.id, () => {
      return new Promise((resolve, reject) => {
        this.discoverSomeServicesAndCharacteristics(
          serviceUuids,
          characteristicsUuids,
          (error, services, characteristics) =>
            error ? reject(error) : resolve({ services, characteristics })
        );
      });
    });
  }

  discoverAllServicesAndCharacteristics (callback) {
    this.discoverSomeServicesAndCharacteristics([], [], callback);
  }

  async discoverAllServicesAndCharacteristicsAsync () {
    return this._noble._withDisconnectHandler(this.id, () => {
      return new Promise((resolve, reject) => {
        this.discoverAllServicesAndCharacteristics(
          (error, services, characteristics) =>
            error ? reject(error) : resolve({ services, characteristics })
        );
      });
    });
  }

  readHandle (handle, callback) {
    if (callback) {
      this.once(`handleRead${handle}`, (data, error) => callback(error, data));
    }
    this._noble.readHandle(this.id, handle);
  }

  async readHandleAsync (handle) {
    return this._noble._withDisconnectHandler(this.id, () => {
      return new Promise((resolve, reject) => {
        this.readHandle(handle, (error, data) => error ? reject(error) : resolve(data));
      });
    });
  }

  writeHandle (handle, data, withoutResponse, callback) {
    if (!(data instanceof Buffer)) {
      throw new Error('data must be a Buffer');
    }

    if (callback) {
      this.once(`handleWrite${handle}`, (error) => callback(error));
    }

    this._noble.writeHandle(this.id, handle, data, withoutResponse);
  }

  async writeHandleAsync (handle, data, withoutResponse) {
    return this._noble._withDisconnectHandler(this.id, () => {
      return new Promise((resolve, reject) => {
        this.writeHandle(handle, data, withoutResponse, error => error ? reject(error) : resolve());
      });
    });
  }
}

module.exports = Peripheral;
