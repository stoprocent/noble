const { EventEmitter } = require('events');

const characteristics = require('./characteristics.json');

class Characteristic extends EventEmitter {
  
  constructor (noble, peripheralId, serviceUuid, uuid, properties) {
    super();
    this._noble = noble;
    this._peripheralId = peripheralId;
    this._serviceUuid = serviceUuid;
    this._isNotifying = false;

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
    
    // set the isNotifying state
    this.on('notify', (state, error) => !error ? this._isNotifying = state : null);
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
          this.removeListener('data', onRead);
          // call the callback
          callback(error, data);
        }
      };

      this.on('data', onRead);
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

  subscribe (callback) {
    this._notify(true, callback);
  }

  async subscribeAsync () {
    return this._noble._withDisconnectHandler(this._peripheralId, () => {
      return new Promise((resolve, reject) => {
        this.subscribe((error, state) => error ? reject(error) : resolve(state));
      });
    });
  }

  unsubscribe (callback) {
    this._notify(false, callback);
  }

  async unsubscribeAsync () {
    return this._noble._withDisconnectHandler(this._peripheralId, () => {
      return new Promise((resolve, reject) => {
        this.unsubscribe(error => error ? reject(error) : resolve());
      });
    });
  }

  _notify (notify, callback) {
    if (notify === this._isNotifying) {
      if (callback) {
        callback(null, this._isNotifying);
      }
      return;
    }

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

  async *notificationsAsync () {
    const notifications = [];
    let notifying = true;
    
    // Main data listener that populates the notifications array
    const dataListener = (data, isNotification, error) => {
      if (error) {
        notifying = false;
      }
      if (isNotification) {
        notifications.push(data);
      }
    };
    
    // Notify state listener
    const notifyListener = (state) => {
      notifying = state;
    };
    
    // Set up listeners
    this.on('data', dataListener);
    this.on('notify', notifyListener);
    
    try {
      // Start subscribing
      await this.subscribeAsync();
      
      // Process notifications
      while (notifying || notifications.length > 0) {
        if (notifications.length > 0) {
          // If we have notifications, yield them
          yield notifications.shift();
        } else if (notifying) {
          // Wait for more data or notify=false
          await new Promise(resolve => {
            // Create listeners that automatically remove themselves
            const tempDataListener = (...args) => {
              this.removeListener('data', tempDataListener);
              this.removeListener('notify', tempNotifyListener);
              resolve();
            };
            
            const tempNotifyListener = (state) => {
              if (state === false) {
                this.removeListener('data', tempDataListener);
                this.removeListener('notify', tempNotifyListener);
                resolve();
              }
            };
            
            // Set up temporary listeners
            this.once('data', tempDataListener);
            this.once('notify', tempNotifyListener);
            
            // Clean up if we already have notifications (race condition)
            if (notifications.length > 0) {
              this.removeListener('data', tempDataListener);
              this.removeListener('notify', tempNotifyListener);
              resolve();
            }
          });
        }
      }
    } finally {
      // Clean up all listeners
      this.removeListener('data', dataListener);
      this.removeListener('notify', notifyListener);
      // Unsubscribe
      await this.unsubscribeAsync();
    }
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
}

module.exports = Characteristic;
