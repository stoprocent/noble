import type { AdapterState, DisconnectReason } from '../types';

/** Base class of every error noble raises on purpose. */
export class NobleError extends Error {
  constructor (message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The link dropped (or was torn down) while an operation was in flight. */
export class DisconnectedError extends NobleError {
  constructor (readonly reason: DisconnectReason) {
    super(`Disconnected ${reason}`);
  }
}

/** The active binding cannot perform the requested operation. */
export class NotSupportedError extends NobleError {}

/** An operation needed the adapter to be powered on and it was not. */
export class AdapterStateError extends NobleError {
  constructor (message: string, readonly state: AdapterState) {
    super(message);
  }
}

export class TimeoutError extends NobleError {}

/** A pending connection attempt was cancelled by the caller. */
export class ConnectionCancelledError extends NobleError {
  constructor () {
    super('connection canceled!');
  }
}
