const { EventEmitter } = require('events');

class NobleEventEmitter extends EventEmitter {
  /**
   * Like once(), but ensures at most one listener exists for the given event.
   * If a previous exclusive listener was registered for the same event, it is
   * removed before the new one is added. This prevents listener accumulation
   * when a method is called repeatedly before the event fires.
   */
  onceExclusive (event, callback) {
    if (!this._exclusiveCallbacks) {
      this._exclusiveCallbacks = new Map();
    }
    const prev = this._exclusiveCallbacks.get(event);
    if (prev) {
      this.removeListener(event, prev);
    }
    const wrappedCallback = (...args) => {
      this._exclusiveCallbacks.delete(event);
      callback(...args);
    };
    this._exclusiveCallbacks.set(event, wrappedCallback);
    this.once(event, wrappedCallback);
  }
}

module.exports = NobleEventEmitter;
