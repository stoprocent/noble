import type { Bindings, DiscoveredPeripheral } from '../bindings/bindings';
import { AsyncQueue } from '../common/async-queue';
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
  /** Notification state changes in flight, so concurrent callers share one request. */
  private readonly notifyRequests = new Map<string, { notify: boolean; promise: Promise<void> }>();
  /** Characteristics the application subscribed to itself, as opposed to through a stream. */
  private readonly explicitlySubscribed = new Set<string>();
  private lastDisconnectReason: DisconnectReason = 'unknown';
  /** Counts link losses, so queued work can tell it outlived its link. */
  private linkEpoch = 0;
  /** Live `notifications()` iterations per characteristic. */
  private readonly streams = new Map<string, Set<AsyncQueue<Buffer>>>();

  constructor (
    readonly bindings: Bindings,
    readonly peripheralId: string
  ) {
    // Subscriptions do not survive a link loss.
    this.disconnected.subscribe(reason => {
      this.lastDisconnectReason = reason;
      this.linkEpoch += 1;
      this.explicitlySubscribed.clear();
      this.notifying.clear();
      this.notifyRequests.clear();
      for (const stream of [...this.streams.values()].flatMap(streams => [...streams])) {
        stream.end(new DisconnectedError(reason));
      }
      this.streams.clear();
    });
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

  /**
   * Switches notifications for a characteristic on or off. A no-op when
   * already in that state; concurrent calls for the same state share one
   * request, and opposite requests are applied in the order they were made.
   *
   * `explicit` marks a subscription the application asked for itself, which
   * a finishing `notifications()` loop must leave in place.
   */
  setNotifying (serviceUuid: string, characteristicUuid: string, notify: boolean, explicit = true): Promise<void> {
    const key = characteristicKey(serviceUuid, characteristicUuid);
    if (!notify) {
      this.explicitlySubscribed.delete(key);
    } else if (explicit) {
      this.explicitlySubscribed.add(key);
    }

    const inFlight = this.notifyRequests.get(key);
    if (inFlight?.notify === notify) {
      return inFlight.promise;
    }
    if (!inFlight && this.notifying.has(key) === notify) {
      return Promise.resolve();
    }

    const request = { notify, promise: Promise.resolve() };
    const epoch = this.linkEpoch;
    const apply = async (): Promise<void> => {
      if (this.linkEpoch !== epoch) {
        // The link dropped while this request was waiting its turn.
        throw new DisconnectedError(this.lastDisconnectReason);
      }
      try {
        await this.guard(this.bindings.notify(this.peripheralId, serviceUuid, characteristicUuid, notify));
      } finally {
        if (this.notifyRequests.get(key) === request) {
          this.notifyRequests.delete(key);
        }
      }
      if (notify) {
        this.notifying.add(key);
      } else {
        this.notifying.delete(key);
        // Nothing more will arrive: finish the iterations that were consuming it.
        for (const stream of this.streams.get(key) ?? []) {
          stream.end();
        }
        this.streams.delete(key);
      }
    };

    this.notifyRequests.set(key, request);
    request.promise = inFlight ? inFlight.promise.then(apply, apply) : apply();
    return request.promise;
  }

  /** Whether the application itself asked for the subscription (see {@link setNotifying}). */
  isExplicitlySubscribed (serviceUuid: string, characteristicUuid: string): boolean {
    return this.explicitlySubscribed.has(characteristicKey(serviceUuid, characteristicUuid));
  }

  /** Opens a queue fed by the characteristic's notifications until {@link closeStream}. */
  openStream (serviceUuid: string, characteristicUuid: string): AsyncQueue<Buffer> {
    const key = characteristicKey(serviceUuid, characteristicUuid);
    const stream = new AsyncQueue<Buffer>();
    const streams = this.streams.get(key) ?? new Set<AsyncQueue<Buffer>>();
    streams.add(stream);
    this.streams.set(key, streams);
    return stream;
  }

  /** Closes a stream and returns how many others are still open on the characteristic. */
  closeStream (serviceUuid: string, characteristicUuid: string, stream: AsyncQueue<Buffer>): number {
    const key = characteristicKey(serviceUuid, characteristicUuid);
    const streams = this.streams.get(key);
    stream.end();
    if (!streams) {
      return 0;
    }
    streams.delete(stream);
    if (streams.size === 0) {
      this.streams.delete(key);
    }
    return streams.size;
  }
}

function characteristicKey (serviceUuid: string, characteristicUuid: string): string {
  return `${serviceUuid}/${characteristicUuid}`;
}
