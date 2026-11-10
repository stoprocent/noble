import type {
  AdapterState,
  AddressType,
  Advertisement,
  CharacteristicProperty,
  ConnectOptions,
  DisconnectReason
} from '../types';

export interface DiscoveredPeripheral {
  id: string;
  address: string;
  addressType: AddressType;
  connectable: boolean;
  scannable?: boolean;
  advertisement: Advertisement;
  rssi: number;
}

export interface CharacteristicInfo {
  uuid: string;
  properties: CharacteristicProperty[];
}

/**
 * Everything a binding reports that nobody asked for. Requests and their
 * results never travel through here: those are the promises returned by
 * {@link Bindings}.
 */
export interface BindingsDelegate {
  onStateChange (state: AdapterState): void;
  onAddressChange (address: string): void;
  onScanStart (filterDuplicates?: boolean): void;
  onScanStop (): void;
  onDiscover (peripheral: DiscoveredPeripheral): void;
  /** A link came up that no `connect()` call on this instance asked for. */
  onConnect (peripheralId: string): void;
  /** Fires for every lost link, whether or not `disconnect()` asked for it. */
  onDisconnect (peripheralId: string, reason: DisconnectReason): void;
  onMtu (peripheralId: string, mtu: number): void;
  onRssi (peripheralId: string, rssi: number): void;
  onNotification (peripheralId: string, serviceUuid: string, characteristicUuid: string, data: Buffer): void;
  onHandleNotification (peripheralId: string, handle: number, data: Buffer): void;
  onWarning (message: string): void;
}

/**
 * A platform backend (HCI socket, BlueZ D-Bus, CoreBluetooth, WinRT).
 *
 * The contract is deliberately one-directional: noble owns a binding and calls
 * down into it; a binding only ever answers through the promise it returned or
 * through the {@link BindingsDelegate} handed to {@link start}.
 */
export interface Bindings {
  start (delegate: BindingsDelegate): void;
  stop (): void;
  reset? (): void;
  setAddress? (address: string): void;
  setScanParameters? (interval?: number, window?: number): Promise<void>;

  /** Resolves once the controller is scanning. */
  startScanning (serviceUuids: string[], allowDuplicates: boolean): Promise<void>;
  /** Resolves once the controller stopped scanning. */
  stopScanning (): Promise<void>;

  /** Maps a MAC address to this binding's peripheral id, or `null` when it cannot. */
  addressToId (address: string): string | null;

  /** Resolves once the link is up. Rejects when the attempt fails or is cancelled. */
  connect (peripheralId: string, options?: ConnectOptions): Promise<void>;
  cancelConnect (peripheralId: string): void;
  /** Requests a disconnect; completion is reported through `onDisconnect`. */
  disconnect (peripheralId: string): void;
  /**
   * `pin`, when given, is a non-empty string answering PIN ceremonies; it is
   * omitted (not passed as `undefined`) for pairing without a PIN.
   */
  pair? (peripheralId: string, kind: number, protectionLevel: number, pin?: string): Promise<void>;
  /** Whether the platform reports a bond with the peripheral. Absent where pairing state is unavailable. */
  isPaired? (peripheralId: string): Promise<boolean>;
  updateRssi (peripheralId: string): Promise<number>;

  discoverServices (peripheralId: string, serviceUuids: string[]): Promise<string[]>;
  discoverIncludedServices (peripheralId: string, serviceUuid: string, serviceUuids: string[]): Promise<string[]>;
  discoverCharacteristics (peripheralId: string, serviceUuid: string, characteristicUuids: string[]): Promise<CharacteristicInfo[]>;

  read (peripheralId: string, serviceUuid: string, characteristicUuid: string): Promise<Buffer>;
  write (peripheralId: string, serviceUuid: string, characteristicUuid: string, data: Buffer, withoutResponse: boolean): Promise<void>;
  broadcast? (peripheralId: string, serviceUuid: string, characteristicUuid: string, broadcast: boolean): Promise<void>;
  notify (peripheralId: string, serviceUuid: string, characteristicUuid: string, notify: boolean): Promise<void>;

  discoverDescriptors (peripheralId: string, serviceUuid: string, characteristicUuid: string): Promise<string[]>;
  readValue (peripheralId: string, serviceUuid: string, characteristicUuid: string, descriptorUuid: string): Promise<Buffer>;
  writeValue (peripheralId: string, serviceUuid: string, characteristicUuid: string, descriptorUuid: string, data: Buffer): Promise<void>;

  readHandle (peripheralId: string, handle: number): Promise<Buffer>;
  writeHandle (peripheralId: string, handle: number, data: Buffer, withoutResponse: boolean): Promise<void>;
}
