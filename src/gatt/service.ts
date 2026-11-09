import { Characteristic } from './characteristic';
import services from './services.json';
import type { PeripheralSession } from './session';

const KNOWN_SERVICES: Record<string, { name: string; type: string } | undefined> = services;

export class Service {
  /** Assigned name, when the UUID is a Bluetooth SIG service. */
  readonly name: string | null;
  /** Assigned type identifier, when the UUID is a Bluetooth SIG service. */
  readonly type: string | null;

  private discoveredCharacteristics: Characteristic[] | null = null;
  private discoveredIncludedServiceUuids: string[] | null = null;

  /** @internal */
  constructor (
    private readonly session: PeripheralSession,
    readonly uuid: string
  ) {
    const known = KNOWN_SERVICES[uuid];
    this.name = known?.name ?? null;
    this.type = known?.type ?? null;
  }

  /** The result of the last {@link discoverCharacteristics}, or `null` before the first. */
  get characteristics (): readonly Characteristic[] | null {
    return this.discoveredCharacteristics;
  }

  /** The result of the last {@link discoverIncludedServices}, or `null` before the first. */
  get includedServiceUuids (): readonly string[] | null {
    return this.discoveredIncludedServiceUuids;
  }

  async discoverIncludedServices (serviceUuids: string[] = []): Promise<string[]> {
    const { bindings, peripheralId } = this.session;
    this.discoveredIncludedServiceUuids = await this.session.guard(
      bindings.discoverIncludedServices(peripheralId, this.uuid, serviceUuids)
    );
    return this.discoveredIncludedServiceUuids;
  }

  async discoverCharacteristics (characteristicUuids: string[] = []): Promise<Characteristic[]> {
    const { bindings, peripheralId } = this.session;
    const infos = await this.session.guard(
      bindings.discoverCharacteristics(peripheralId, this.uuid, characteristicUuids)
    );
    this.discoveredCharacteristics = infos.map(
      info => new Characteristic(this.session, this.uuid, info.uuid, info.properties)
    );
    return this.discoveredCharacteristics;
  }

  toJSON (): Record<string, unknown> {
    return {
      uuid: this.uuid,
      name: this.name,
      type: this.type,
      includedServiceUuids: this.discoveredIncludedServiceUuids
    };
  }

  toString (): string {
    return JSON.stringify(this);
  }
}
