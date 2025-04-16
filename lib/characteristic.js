const { EventEmitter } = require('events');

const characteristics = require('./characteristics.json');

class Characteristic extends EventEmitter {
  
  constructor (noble, peripheralId, serviceUuid, uuid, properties) {
    super();
    this._noble = noble;
    this._peripheralId = peripheralId;
    this._serviceUuid = serviceUuid;

    this.uuid = uuid;
    this.name = null;
    this.type = null;
    this.properties = properties;
    this.descriptors = null;

    const characteristic = characteristics[uuid];
    if (characteristic) {
      this.name = characteristic.name;
      this.type = characteristic.type;
    }
  }

  toString () {
    return JSON.stringify({
      uuid: this.uuid,
      name: this.name,
      type: this.type,
      properties: this.properties
    });
  }

  read (callback) {
    if (callback) {
      const onRead = (data, isNotification, error) => {
        // only call the callback if 'read' event and non-notification
        // 'read' for non-notifications is only present for backwards compatbility
        if (!isNotification) {
          // remove the listener
          this.removeListener('read', onRead);
          // call the callback
          callback(error, data);
        }
      };

      this.on('read', onRead);
    }

    this._noble.read(
      this._peripheralId,
      this._serviceUuid,
      this.uuid
    );
  }

  async readAsync () {
    return this._noble._withDisconnectHandler(this._peripheralId, () => {
      return new Promise((resolve, reject) => {
        this.read((error, data) => error ? reject(error) : resolve(data));
      });
    });
  }

  write (data, withoutResponse, callback) {
    if (process.title !== 'browser') {
      const allowedTypes = [
        Buffer,
        Uint8Array,
        Uint16Array,
        Uint32Array
      ];
      if (!allowedTypes.some((allowedType) => data instanceof allowedType)) {
        throw new Error(`data must be a ${allowedTypes.map((allowedType) => allowedType.name).join(' or ')}`);
      }
    }

    if (callback) {
      this.once('write', error => callback(error));
    }

    this._noble.write(
      this._peripheralId,
      this._serviceUuid,
      this.uuid,
      data,
      withoutResponse
    );
  }

  async writeAsync (data, withoutResponse) {
    return this._noble._withDisconnectHandler(this._peripheralId, () => {
      return new Promise((resolve, reject) => {
        this.write(data, withoutResponse, error => error ? reject(error) : resolve());
      });
    });
  }

  broadcast (broadcast, callback) {
    if (callback) {
      this.once('broadcast', error => callback(error));
    }

    this._noble.broadcast(
      this._peripheralId,
      this._serviceUuid,
      this.uuid,
      broadcast
    );
  }

  async broadcastAsync (broadcast) {
    return this._noble._withDisconnectHandler(this._peripheralId, () => {
      return new Promise((resolve, reject) => {
        this.broadcast(broadcast, (state, error) => error ? reject(error) : resolve(state));
      });
    });
  }

  notify (notify, callback) {
    if (callback) {
      this.once('notify', (state, error) => callback(error, state));
    }

    this._noble.notify(
      this._peripheralId,
      this._serviceUuid,
      this.uuid,
      notify
    );
  }

  async notifyAsync (notify) {
    return this._noble._withDisconnectHandler(this._peripheralId, () => {
      return new Promise((resolve, reject) => {
        this.notify(notify, (error, state) => error ? reject(error) : resolve(state));
      });
    });
  }

  subscribe (callback) {
    this.notify(true, callback);
  }

  async subscribeAsync () {
    return this._noble._withDisconnectHandler(this._peripheralId, () => {
      return new Promise((resolve, reject) => {
        this.subscribe((error, state) => error ? reject(error) : resolve(state));
      });
    });
  }

  unsubscribe (callback) {
    this.notify(false, callback);
  }

  async unsubscribeAsync () {
    return this._noble._withDisconnectHandler(this._peripheralId, () => {
      return new Promise((resolve, reject) => {
        this.unsubscribe(error => error ? reject(error) : resolve());
      });
    });
  }

  discoverDescriptors (callback) {
    if (callback) {
      this.once('descriptorsDiscover', (descriptors, error) => callback(error, descriptors));
    }

    this._noble.discoverDescriptors(
      this._peripheralId,
      this._serviceUuid,
      this.uuid
    );
  }

  async discoverDescriptorsAsync () {
    return this._noble._withDisconnectHandler(this._peripheralId, () => {
      return new Promise((resolve, reject) => {
        this.discoverDescriptors((error, descriptors) => error ? reject(error) : resolve(descriptors));
      });
    });
  }
}

module.exports = Characteristic;
