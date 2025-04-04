const { EventEmitter } = require('events');
const descriptors = require('./descriptors.json');

class Descriptor extends EventEmitter {
  constructor(noble, peripheralId, serviceUuid, characteristicUuid, uuid) {
    super();
    
    this._noble = noble;
    this._peripheralId = peripheralId;
    this._serviceUuid = serviceUuid;
    this._characteristicUuid = characteristicUuid;

    this.uuid = uuid;
    this.name = null;
    this.type = null;

    const descriptor = descriptors[uuid];
    if (descriptor) {
      this.name = descriptor.name;
      this.type = descriptor.type;
    }
  }

  toString() {
    return JSON.stringify({
      uuid: this.uuid,
      name: this.name,
      type: this.type
    });
  }

  readValue(callback) {
    if (callback) {
      this.once('valueRead', (data, error) => callback(error, data));
    }
    this._noble.readValue(
      this._peripheralId,
      this._serviceUuid,
      this._characteristicUuid,
      this.uuid
    );
  }

  async readValueAsync() {
    return new Promise((resolve, reject) => {
      this.readValue((error, data) => error ? reject(error) : resolve(data));
    });
  }

  writeValue(data, callback) {
    if (!(data instanceof Buffer)) {
      throw new Error('data must be a Buffer');
    }

    if (callback) {
      this.once('valueWrite', error => callback(error));
    }
    this._noble.writeValue(
      this._peripheralId,
      this._serviceUuid,
      this._characteristicUuid,
      this.uuid,
      data
    );
  }

  // Using modern async/await pattern instead of util.promisify
  async writeValueAsync(data) {
    return new Promise((resolve, reject) => {
      this.writeValue(data, error => error ? reject(error) : resolve());
    });
  }
}

module.exports = Descriptor;
