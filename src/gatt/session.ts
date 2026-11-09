import type { Bindings, DiscoveredPeripheral } from '../bindings/bindings';
import { DisconnectedError } from '../common/errors';
import { Signal } from '../common/signal';
import type { DisconnectReason } from '../types';

export interface HandleNotification {
  handle: number;
  data: Buffer;
}

/**
 * Everything one peripheral and its services, characteristics and descriptors
 * share: the binding to send requests to, and the unsolicited activity the
 * adapter routes back for this peripheral id.
 *
 * `Noble` creates a session per peripheral and is the only one that emits on
 * its signals. The GATT objects hold the session — never `Noble` and never
 * their parent object — so ownership only ever points downwards.
 *
 * @internal
 */
export class PeripheralSession {
  readonly advertised = new Signal<DiscoveredPeripheral>();
  /** A link came up without this process asking for it. */
  readonly connected = new Signal<void>();
  readonly disconnected = new Signal<DisconnectReason>();
  readonly mtuChanged = new Signal<number>();
  readonly rssiUpdated = new Signal<number>();
  readonly handleNotified = new Signal<HandleNotification>();

  private readonly notificationSignals = new Map<string, Signal<Buffer>>();
  private readonly notifying = new Set<string>();

  constructor (
    readonly bindings: Bindings,
    readonly peripheralId: string
  ) {
    // Subscriptions do not survive a link loss.
    this.disconnected.subscribe(() => this.notifying.clear());
  }

  /**
   * Settles with `operation`, or rejects with {@link DisconnectedError} as
   * soon as the link drops — whichever happens first. Bindings are not
   * required to settle requests that were in flight when a link died.
   */
  guard<T> (operation: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const unsubscribe = this.disconnected.subscribe(reason => {
        unsubscribe();
        reject(new DisconnectedError(reason));
      });
      operation.then(
        value => {
          unsubscribe();
          resolve(value);
        },
        error => {
          unsubscribe();
          reject(error);
        }
      );
    });
  }

  /** The notification stream of one characteristic. */
  notifications (serviceUuid: string, characteristicUuid: string): Signal<Buffer> {
    const key = characteristicKey(serviceUuid, characteristicUuid);
    let signal = this.notificationSignals.get(key);
    if (!signal) {
      signal = new Signal<Buffer>();
      this.notificationSignals.set(key, signal);
    }
    return signal;
  }

  isNotifying (serviceUuid: string, characteristicUuid: string): boolean {
    return this.notifying.has(characteristicKey(serviceUuid, characteristicUuid));
  }

  setNotifying (serviceUuid: string, characteristicUuid: string, notifying: boolean): void {
    const key = characteristicKey(serviceUuid, characteristicUuid);
    if (notifying) {
      this.notifying.add(key);
    } else {
      this.notifying.delete(key);
    }
  }
}

function characteristicKey (serviceUuid: string, characteristicUuid: string): string {
  return `${serviceUuid}/${characteristicUuid}`;
}
