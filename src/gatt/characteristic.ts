import { AsyncQueue } from '../common/async-queue';
import { DisconnectedError, NotSupportedError } from '../common/errors';
import type { Listener, Unsubscribe } from '../common/signal';
import type { CharacteristicProperty } from '../types';
import characteristics from './characteristics.json';
import { Descriptor } from './descriptor';
import type { PeripheralSession } from './session';

const KNOWN_CHARACTERISTICS: Record<string, { name: string; type: string } | undefined> = characteristics;

export class Characteristic {
  /** Assigned name, when the UUID is a Bluetooth SIG characteristic. */
  readonly name: string | null;
  /** Assigned type identifier, when the UUID is a Bluetooth SIG characteristic. */
  readonly type: string | null;

  private discoveredDescriptors: Descriptor[] | null = null;
  /** Live {@link notifications} iterations, ended when notifications are switched off. */
  private readonly activeStreams = new Set<AsyncQueue<Buffer>>();

  /** @internal */
  constructor (
    private readonly session: PeripheralSession,
    private readonly serviceUuid: string,
    readonly uuid: string,
    readonly properties: readonly CharacteristicProperty[]
  ) {
    const known = KNOWN_CHARACTERISTICS[uuid];
    this.name = known?.name ?? null;
    this.type = known?.type ?? null;
  }

  /** The result of the last {@link discoverDescriptors}, or `null` before the first. */
  get descriptors (): readonly Descriptor[] | null {
    return this.discoveredDescriptors;
  }

  /** Whether this process currently has notifications/indications enabled. */
  get isNotifying (): boolean {
    return this.session.isNotifying(this.serviceUuid, this.uuid);
  }

  read (): Promise<Buffer> {
    const { bindings, peripheralId } = this.session;
    return this.session.guard(bindings.read(peripheralId, this.serviceUuid, this.uuid));
  }

  write (data: Buffer | Uint8Array, withoutResponse = false): Promise<void> {
    if (!(data instanceof Uint8Array)) {
      throw new TypeError('data must be a Buffer or Uint8Array');
    }
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const { bindings, peripheralId } = this.session;
    return this.session.guard(
      bindings.write(peripheralId, this.serviceUuid, this.uuid, buffer, withoutResponse)
    );
  }

  /** Enables notifications (or indications). A no-op when already enabled. */
  async subscribe (): Promise<void> {
    await this.setNotify(true);
  }

  /** Disables notifications (or indications). A no-op when not enabled. */
  async unsubscribe (): Promise<void> {
    await this.setNotify(false);
  }

  /**
   * Calls `listener` with the value of every notification/indication.
   * Listening does not enable notifications; pair it with {@link subscribe},
   * or use {@link notifications} which does both.
   */
  onNotification (listener: Listener<Buffer>): Unsubscribe {
    return this.session.notifications(this.serviceUuid, this.uuid).subscribe(listener);
  }

  /**
   * Subscribes and yields every notified value until the consumer stops
   * iterating (which unsubscribes again) or {@link unsubscribe} is called.
   * Throws {@link DisconnectedError} if the link drops mid-stream.
   */
  async * notifications (): AsyncGenerator<Buffer, void, void> {
    const queue = new AsyncQueue<Buffer>();
    const stopListening = this.onNotification(data => queue.push(data));
    const stopWatching = this.session.disconnected.subscribe(reason => {
      queue.end(new DisconnectedError(reason));
    });
    this.activeStreams.add(queue);

    try {
      await this.subscribe();
      yield * queue;
    } finally {
      stopListening();
      stopWatching();
      this.activeStreams.delete(queue);
      if (this.activeStreams.size === 0 && this.isNotifying) {
        await this.unsubscribe().catch(() => {
          // The link may already be gone; there is nothing left to undo.
        });
      }
    }
  }

  async discoverDescriptors (): Promise<Descriptor[]> {
    const { bindings, peripheralId } = this.session;
    const uuids = await this.session.guard(
      bindings.discoverDescriptors(peripheralId, this.serviceUuid, this.uuid)
    );
    this.discoveredDescriptors = uuids.map(
      uuid => new Descriptor(this.session, this.serviceUuid, this.uuid, uuid)
    );
    return this.discoveredDescriptors;
  }

  broadcast (broadcast: boolean): Promise<void> {
    const { bindings, peripheralId } = this.session;
    if (!bindings.broadcast) {
      return Promise.reject(new NotSupportedError('Broadcast is not supported by the current bindings'));
    }
    return this.session.guard(bindings.broadcast(peripheralId, this.serviceUuid, this.uuid, broadcast));
  }

  toJSON (): Record<string, unknown> {
    return { uuid: this.uuid, name: this.name, type: this.type, properties: this.properties };
  }

  toString (): string {
    return JSON.stringify(this);
  }

  private async setNotify (notify: boolean): Promise<void> {
    if (notify === this.isNotifying) {
      return;
    }
    const { bindings, peripheralId } = this.session;
    await this.session.guard(bindings.notify(peripheralId, this.serviceUuid, this.uuid, notify));
    this.session.setNotifying(this.serviceUuid, this.uuid, notify);
    if (!notify) {
      for (const stream of this.activeStreams) {
        stream.end();
      }
    }
  }
}
