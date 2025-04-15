const { EventEmitter } = require('events');
const services = require('./services.json');

class Service extends EventEmitter {

  constructor (noble, peripheralId, uuid) {
    super();
    
    this._noble = noble;
    this._peripheralId = peripheralId;

    this.uuid = uuid;
    this.name = null;
    this.type = null;
    this.includedServiceUuids = null;
    this.characteristics = null;

    const service = services[uuid];
    if (service) {
      this.name = service.name;
      this.type = service.type;
    }
  }

  toString () {
    return JSON.stringify({
      uuid: this.uuid,
      name: this.name,
      type: this.type,
      includedServiceUuids: this.includedServiceUuids
    });
  }

  discoverIncludedServices (serviceUuids, callback) {
    if (callback) {
      this.once('includedServicesDiscover', (includedServiceUuids, error) => callback(error, includedServiceUuids));
    }

    this._noble.discoverIncludedServices(
      this._peripheralId,
      this.uuid,
      serviceUuids
    );
  }

  async discoverIncludedServicesAsync (serviceUuids) {
    return this._noble._withDisconnectHandler(this._peripheralId, () => {
      return new Promise((resolve, reject) => {
        this.discoverIncludedServices(serviceUuids, (error, includedServiceUuids) => error ? reject(error) : resolve(includedServiceUuids));
      });
    });
  }

  discoverCharacteristics (characteristicUuids, callback) {
    if (callback) {
      this.once('characteristicsDiscover', (characteristics, error) => callback(error, characteristics));
    }

    this._noble.discoverCharacteristics(
      this._peripheralId,
      this.uuid,
      characteristicUuids
    );
  }

  async discoverCharacteristicsAsync (characteristicUuids) {
    return this._noble._withDisconnectHandler(this._peripheralId, () => {
      return new Promise((resolve, reject) => {
        this.discoverCharacteristics(characteristicUuids, (error, characteristics) => error ? reject(error) : resolve(characteristics));
      });
    });
  }
}

module.exports = Service;
