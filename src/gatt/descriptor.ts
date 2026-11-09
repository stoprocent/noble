import type { PeripheralSession } from './session';
import descriptors from './descriptors.json';

const KNOWN_DESCRIPTORS: Record<string, { name: string; type: string } | undefined> = descriptors;

export class Descriptor {
  /** Assigned name, when the UUID is a Bluetooth SIG descriptor. */
  readonly name: string | null;
  /** Assigned type identifier, when the UUID is a Bluetooth SIG descriptor. */
  readonly type: string | null;

  /** @internal */
  constructor (
    private readonly session: PeripheralSession,
    private readonly serviceUuid: string,
    private readonly characteristicUuid: string,
    readonly uuid: string
  ) {
    const known = KNOWN_DESCRIPTORS[uuid];
    this.name = known?.name ?? null;
    this.type = known?.type ?? null;
  }

  readValue (): Promise<Buffer> {
    const { bindings, peripheralId } = this.session;
    return this.session.guard(
      bindings.readValue(peripheralId, this.serviceUuid, this.characteristicUuid, this.uuid)
    );
  }

  async writeValue (data: Buffer): Promise<void> {
    if (!Buffer.isBuffer(data)) {
      throw new TypeError('data must be a Buffer');
    }
    const { bindings, peripheralId } = this.session;
    await this.session.guard(
      bindings.writeValue(peripheralId, this.serviceUuid, this.characteristicUuid, this.uuid, data)
    );
  }

  toJSON (): Record<string, unknown> {
    return { uuid: this.uuid, name: this.name, type: this.type };
  }

  toString (): string {
    return JSON.stringify(this);
  }
}
