import type { DiscoveredPeripheral } from '../bindings/bindings';
import { Deferred } from '../common/deferred';
import { ConnectionCancelledError, NobleError, NotSupportedError } from '../common/errors';
import { Signal, type Listener, type Unsubscribe } from '../common/signal';
import {
  DevicePairingKinds,
  DevicePairingProtectionLevel,
  type AddressType,
  type Advertisement,
  type ConnectOptions,
  type DisconnectReason,
  type PairOptions,
  type PeripheralState
} from '../types';
import type { Characteristic } from './characteristic';
import { Service } from './service';
import type { HandleNotification, PeripheralSession } from './session';

const UINT32_MAX = 0xffffffff;

interface ConnectAttempt {
  promise: Promise<void>;
  cancelled: Deferred<never>;
}

export interface ServicesAndCharacteristics {
  services: Service[];
  characteristics: Characteristic[];
}

export class Peripheral {
  readonly id: string;

  private currentAddress: string;
  private currentAddressType: AddressType;
  private currentConnectable: boolean;
  private currentScannable: boolean;
  private currentAdvertisement: Advertisement;
  private currentRssi: number;
  private currentMtu: number | null = null;
  private currentState: PeripheralState = 'disconnected';
  private discoveredServices: Service[] | null = null;

  /** The connection attempt in flight, shared by concurrent `connect()` callers. */
  private pendingConnect: ConnectAttempt | null = null;

  private readonly disconnectSignal = new Signal<DisconnectReason>();

  /** @internal */
  constructor (
    private readonly session: PeripheralSession,
    discovery: DiscoveredPeripheral
  ) {
    this.id = discovery.id;
    this.currentAddress = discovery.address;
    this.currentAddressType = discovery.addressType;
    this.currentConnectable = discovery.connectable;
    this.currentScannable = discovery.scannable ?? false;
    this.currentAdvertisement = discovery.advertisement;
    this.currentRssi = discovery.rssi;

    session.advertised.subscribe(update => this.applyAdvertisement(update));
    session.rssiUpdated.subscribe(rssi => {
      this.currentRssi = rssi;
    });
    session.mtuChanged.subscribe(mtu => {
      this.currentMtu = mtu;
    });
    session.connected.subscribe(() => {
      this.currentState = 'connected';
    });
    session.disconnected.subscribe(reason => {
      // An attempt that never produced a link is reported by `connect()` rejecting.
      const hadLink = this.currentState === 'connected' || this.currentState === 'disconnecting';
      this.currentState = 'disconnected';
      this.currentMtu = null;
      if (hadLink) {
        this.disconnectSignal.emit(reason);
      }
    });
  }

  get address (): string { return this.currentAddress; }
  get addressType (): AddressType { return this.currentAddressType; }
  get connectable (): boolean { return this.currentConnectable; }
  get scannable (): boolean { return this.currentScannable; }
  get advertisement (): Readonly<Advertisement> { return this.currentAdvertisement; }
  get rssi (): number { return this.currentRssi; }
  /** The negotiated ATT MTU, once the binding reported one. */
  get mtu (): number | null { return this.currentMtu; }
  get state (): PeripheralState { return this.currentState; }
  /** The result of the last {@link discoverServices}, or `null` before the first. */
  get services (): readonly Service[] | null { return this.discoveredServices; }

  /**
   * Connects to the peripheral. Concurrent calls share one attempt.
   * Rejects with {@link ConnectionCancelledError} after {@link cancelConnect}.
   */
  connect (options?: ConnectOptions): Promise<void> {
    if (this.currentState === 'connected') {
      return Promise.reject(new NobleError('Peripheral already connected'));
    }
    if (this.currentState === 'disconnecting') {
      // Let the old link finish going down, then connect afresh.
      return this.disconnect().then(() => this.connect(options));
    }
    if (this.pendingConnect) {
      return this.pendingConnect.promise;
    }

    const { bindings, peripheralId } = this.session;
    const attempt: ConnectAttempt = { cancelled: new Deferred<never>(), promise: Promise.resolve() };
    const isCurrent = (): boolean => this.pendingConnect === attempt;

    let linking: Promise<void>;
    try {
      linking = bindings.connect(peripheralId, options);
    } catch (error) {
      linking = Promise.reject(error);
    }
    // A link that comes up after the attempt was abandoned must not be left dangling.
    linking.then(() => {
      if (!isCurrent() && this.pendingConnect === null && this.currentState !== 'connected') {
        bindings.disconnect(peripheralId);
      }
    }, () => {});

    this.currentState = 'connecting';
    this.pendingConnect = attempt;
    attempt.promise = Promise.race([this.session.guard(linking), attempt.cancelled.promise]).then(
      () => {
        if (isCurrent()) {
          this.pendingConnect = null;
          this.currentState = 'connected';
        }
      },
      (error: Error) => {
        if (isCurrent()) {
          this.pendingConnect = null;
          if (this.currentState === 'connecting') {
            this.currentState = 'error';
          }
        }
        throw error;
      }
    );
    return attempt.promise;
  }

  /** Abandons a connection attempt that has not completed yet. */
  cancelConnect (): void {
    const attempt = this.pendingConnect;
    if (!attempt) {
      return;
    }
    this.pendingConnect = null;
    this.currentState = 'disconnected';
    attempt.cancelled.reject(new ConnectionCancelledError());
    this.session.bindings.cancelConnect(this.session.peripheralId);
  }

  /** Resolves once the link is down. A no-op when there is no link. */
  disconnect (): Promise<void> {
    if (this.currentState === 'connecting') {
      this.cancelConnect();
      return Promise.resolve();
    }
    if (this.currentState !== 'connected' && this.currentState !== 'disconnecting') {
      return Promise.resolve();
    }

    const { bindings, peripheralId } = this.session;
    return new Promise<void>(resolve => {
      const unsubscribe = this.session.disconnected.subscribe(() => {
        unsubscribe();
        resolve();
      });
      if (this.currentState !== 'disconnecting') {
        this.currentState = 'disconnecting';
        bindings.disconnect(peripheralId);
      }
    });
  }

  /**
   * Pairs with the peripheral. `kind` defaults to
   * `DevicePairingKinds.ConfirmOnly` and `protectionLevel` to
   * `DevicePairingProtectionLevel.Encryption`.
   *
   * Pass {@link PairOptions} with a `pin` for authenticated PIN pairing: the
   * defaults then become `ConfirmOnly | ProvidePin | ConfirmPinMatch` and
   * `EncryptionAndAuthentication`.
   *
   * Only the Windows binding implements pairing; elsewhere this rejects with
   * {@link NotSupportedError}.
   */
  pair (options: PairOptions): Promise<void>;
  pair (kind?: DevicePairingKinds | null, protectionLevel?: DevicePairingProtectionLevel | null): Promise<void>;
  async pair (
    kindOrOptions?: DevicePairingKinds | PairOptions | null,
    positionalProtectionLevel?: DevicePairingProtectionLevel | null
  ): Promise<void> {
    let kind: DevicePairingKinds | null | undefined;
    let protectionLevel: DevicePairingProtectionLevel | null | undefined;
    let pin: unknown;
    if (typeof kindOrOptions === 'object' && kindOrOptions !== null && !Array.isArray(kindOrOptions)) {
      if (positionalProtectionLevel !== undefined) {
        throw new TypeError('pair() takes either options or (kind, protectionLevel), not both');
      }
      ({ kind, protectionLevel, pin } = kindOrOptions);
    } else {
      kind = kindOrOptions;
      protectionLevel = positionalProtectionLevel;
    }

    // An empty PIN is refused rather than read as "no PIN": the caller asked
    // for authenticated pairing and must not silently get less.
    if (pin !== undefined && (typeof pin !== 'string' || pin.length === 0)) {
      throw new TypeError('pair() options.pin must be a non-empty string');
    }
    const hasPin = pin !== undefined;

    kind ??= hasPin
      ? DevicePairingKinds.ConfirmOnly | DevicePairingKinds.ProvidePin | DevicePairingKinds.ConfirmPinMatch
      : DevicePairingKinds.ConfirmOnly;
    protectionLevel ??= hasPin
      ? DevicePairingProtectionLevel.EncryptionAndAuthentication
      : DevicePairingProtectionLevel.Encryption;

    if (!isUint32(kind)) {
      throw new TypeError('pair() kind must be a finite uint32 DevicePairingKinds bitmask');
    }
    // An empty mask can never match a ceremony; the native handler would fail
    // with a generic rejection indistinguishable from the device refusing.
    if (kind === DevicePairingKinds.None) {
      throw new TypeError('pair() requires at least one DevicePairingKinds value; DevicePairingKinds.None matches no ceremony');
    }
    if (!isUint32(protectionLevel)) {
      throw new TypeError('pair() protectionLevel must be a finite uint32 DevicePairingProtectionLevel');
    }
    if (hasPin && protectionLevel !== DevicePairingProtectionLevel.EncryptionAndAuthentication) {
      throw new TypeError('pair() with a PIN requires DevicePairingProtectionLevel.EncryptionAndAuthentication');
    }

    const { bindings, peripheralId } = this.session;
    if (!bindings.pair) {
      throw new NotSupportedError('Pairing is not supported on this platform');
    }
    if (hasPin) {
      await bindings.pair(peripheralId, kind, protectionLevel, pin as string);
    } else {
      await bindings.pair(peripheralId, kind, protectionLevel);
    }
  }

  /**
   * Whether the platform already holds a bond with the peripheral, so an
   * application can skip asking for a PIN. Only the Windows binding reports
   * pairing state, and only for a connected peripheral; with any other
   * binding this resolves `false`.
   */
  async isPaired (): Promise<boolean> {
    const { bindings, peripheralId } = this.session;
    if (!bindings.isPaired) {
      return false;
    }
    return await bindings.isPaired(peripheralId) === true;
  }

  /** Reads the RSSI of the live connection. */
  async updateRssi (): Promise<number> {
    const { bindings, peripheralId } = this.session;
    const rssi = await this.session.guard(bindings.updateRssi(peripheralId));
    this.currentRssi = rssi;
    return rssi;
  }

  /** Discovers primary services, optionally restricted to `serviceUuids`. */
  async discoverServices (serviceUuids: string[] = []): Promise<Service[]> {
    const { bindings, peripheralId } = this.session;
    const uuids = await this.session.guard(bindings.discoverServices(peripheralId, serviceUuids));
    this.discoveredServices = uuids.map(uuid => new Service(this.session, uuid));
    return this.discoveredServices;
  }

  /**
   * Discovers the given services and, within each, the given characteristics.
   * Rejects when not every requested service is present.
   */
  async discoverSomeServicesAndCharacteristics (
    serviceUuids: string[],
    characteristicUuids: string[]
  ): Promise<ServicesAndCharacteristics> {
    const services = await this.discoverServices(serviceUuids);
    if (services.length < serviceUuids.length) {
      throw new NobleError('Could not find all requested services');
    }

    // Sequential on purpose: GATT allows one outstanding request per link.
    const characteristics: Characteristic[] = [];
    for (const service of services) {
      characteristics.push(...await service.discoverCharacteristics(characteristicUuids));
    }
    return { services, characteristics };
  }

  discoverAllServicesAndCharacteristics (): Promise<ServicesAndCharacteristics> {
    return this.discoverSomeServicesAndCharacteristics([], []);
  }

  readHandle (handle: number): Promise<Buffer> {
    const { bindings, peripheralId } = this.session;
    return this.session.guard(bindings.readHandle(peripheralId, handle));
  }

  async writeHandle (handle: number, data: Buffer, withoutResponse = false): Promise<void> {
    if (!Buffer.isBuffer(data)) {
      throw new TypeError('data must be a Buffer');
    }
    const { bindings, peripheralId } = this.session;
    await this.session.guard(bindings.writeHandle(peripheralId, handle, data, withoutResponse));
  }

  /** Called whenever the link goes down, for any reason. */
  onDisconnect (listener: Listener<DisconnectReason>): Unsubscribe {
    return this.disconnectSignal.subscribe(listener);
  }

  /** Called when the ATT MTU of the link is (re)negotiated. */
  onMtuChange (listener: Listener<number>): Unsubscribe {
    return this.session.mtuChanged.subscribe(listener);
  }

  /** Called for every raw handle value notification/indication on the link. */
  onHandleNotification (listener: Listener<HandleNotification>): Unsubscribe {
    return this.session.handleNotified.subscribe(listener);
  }

  toJSON (): Record<string, unknown> {
    return {
      id: this.id,
      address: this.address,
      addressType: this.addressType,
      connectable: this.connectable,
      scannable: this.scannable,
      advertisement: this.advertisement,
      rssi: this.rssi,
      mtu: this.mtu,
      state: this.state
    };
  }

  toString (): string {
    return JSON.stringify(this);
  }

  /** Advertisement fields accumulate: a later report only overrides what it carries. */
  private applyAdvertisement (update: DiscoveredPeripheral): void {
    const merged: Advertisement = { ...this.currentAdvertisement };
    for (const [key, value] of Object.entries(update.advertisement)) {
      // The native addons send `null` for fields a report does not carry.
      if (value !== undefined && value !== null) {
        (merged as unknown as Record<string, unknown>)[key] = value;
      }
    }
    this.currentAdvertisement = merged;
    this.currentConnectable = update.connectable;
    this.currentScannable = update.scannable ?? false;
    this.currentRssi = update.rssi;
    if (update.address) {
      this.currentAddress = update.address;
      this.currentAddressType = update.addressType;
    }
  }
}

function isUint32 (value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= UINT32_MAX;
}
