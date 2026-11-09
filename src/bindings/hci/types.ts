import type { AdapterState, Advertisement, CharacteristicProperty, ConnectOptions } from '../../types';

/**
 * Internal contracts between the layers of the HCI socket backend.
 *
 * Ownership runs strictly downwards:
 *
 *   HciBindings ─┬─ Hci            (socket, HCI commands and events)
 *                ├─ Gap            (scanning state machine, advertisement parsing)
 *                └─ per connection ─┬─ AclStream ── Smp
 *                                   ├─ Gatt
 *                                   └─ Signaling
 *
 * A layer talks to the layer above it only through the delegate it was
 * constructed with, and anything that is a request/response is a promise.
 */

export type HciAddressType = 'public' | 'random';

/** Opaque identity of one locally initiated connection attempt. */
export type ConnectionAttemptToken = object;

export interface LeConnCompleteEvent {
  status: number;
  /** Absent when the attempt failed before a connection handle existed. */
  handle?: number;
  role?: number;
  addressType?: HciAddressType;
  address?: string;
  interval?: number;
  latency?: number;
  supervisionTimeout?: number;
  masterClockAccuracy?: number;
  /** Only reported by LE Enhanced Connection Complete. */
  peerResolvablePrivateAddress?: string;
  /** Set when the event answers an attempt this process started. */
  attemptToken?: ConnectionAttemptToken;
}

export interface LeAdvertisingReport {
  status: number;
  type: number;
  address: string;
  addressType: HciAddressType;
  eir: Buffer;
  rssi: number;
}

export interface LeExtendedAdvertisingReport extends LeAdvertisingReport {
  txpower: number;
}

export interface LeDataLengthChangeEvent {
  handle: number;
  maxTxOctets: number;
  maxTxTime: number;
  maxRxOctets: number;
  maxRxTime: number;
}

export interface LocalVersion {
  hciVer: number;
  hciRev: number;
  lmpVer: number;
  manufacturer: number;
  lmpSubVer: number;
}

/** Unsolicited controller activity, reported by `Hci` to its single owner. */
export interface HciDelegate {
  onStateChange (state: AdapterState): void;
  onAddressChange (address: string): void;
  onError (error: Error): void;

  onLeScanParametersSet (): void;
  /** Command Complete for LE Set (Extended) Scan Enable. */
  onLeScanEnableSet (status: number): void;
  /** An LE Set (Extended) Scan Enable command was observed on the socket (possibly from another process). */
  onLeScanEnableSetCmd (enable: boolean, filterDuplicates: boolean): void;
  onLeAdvertisingReport (report: LeAdvertisingReport): void;
  onLeExtendedAdvertisingReport (report: LeExtendedAdvertisingReport): void;

  onLeConnComplete (event: LeConnCompleteEvent): void;
  onLeConnUpdateComplete (status: number, handle: number, interval: number, latency: number, supervisionTimeout: number): void;
  onDisconnComplete (handle: number, reason: number): void;
  onEncryptChange (handle: number, encrypt: number): void;
  onAclDataPkt (handle: number, cid: number, data: Buffer): void;
  onRssiRead (handle: number, rssi: number): void;

  /** Informational; implementers may ignore these. */
  onLeFeatures? (features: Buffer): void;
  onLeDataLengthChange? (event: LeDataLengthChangeEvent): void;
  onReadLocalVersion? (version: LocalVersion): void;
}

export interface GapDiscovery {
  status: number;
  address: string;
  addressType: HciAddressType;
  connectable: boolean;
  scannable: boolean;
  advertisement: Advertisement;
  rssi: number;
}

export interface GapDelegate {
  onScanParametersSet (): void;
  onScanStart (filterDuplicates: boolean): void;
  onScanStop (): void;
  onDiscover (discovery: GapDiscovery): void;
}

/** The slice of `Hci` that `Gap` drives. */
export interface GapController {
  setScanParameters (interval?: number, window?: number): void;
  setScanEnabled (enabled: boolean, filterDuplicates: boolean): void;
}

/** The slice of `Hci` that an `AclStream` drives. */
export interface AclController {
  writeAclDataPkt (handle: number, cid: number, data: Buffer): unknown;
  startLeEncryption (handle: number, random: Buffer, diversifier: Buffer, key: Buffer): void;
}

/** Receives the payloads of one L2CAP channel. */
export type L2capChannelHandler = (data: Buffer) => void;

/** Unsolicited ATT traffic, reported by `Gatt` to its owner. */
export interface GattDelegate {
  onNotification (serviceUuid: string, characteristicUuid: string, data: Buffer): void;
  onHandleNotify (handle: number, data: Buffer): void;
}

export interface GattCharacteristic {
  uuid: string;
  properties: CharacteristicProperty[];
}

export interface ConnectionParameterUpdateRequest {
  handle: number;
  minInterval: number;
  maxInterval: number;
  latency: number;
  supervisionTimeout: number;
}

export interface HciBindingsOptions {
  /** Driver type: 'default' | 'uart' | 'usb' | 'native'. */
  hciDriver?: import('@stoprocent/bluetooth-hci-socket').DriverType;
  /** Bind params (USB and UART drivers only). */
  bindParams?: Partial<import('@stoprocent/bluetooth-hci-socket').BindParams>;
  /** HCI device id (Linux only). Defaults to `NOBLE_HCI_DEVICE_ID`, then 0. */
  deviceId?: number;
  /** Use BLE 5 extended features. Defaults to what LE Read Local Supported Features reports. */
  extended?: boolean;
  /**
   * Use the exclusive Linux HCI user channel instead of the shared raw
   * channel. The selected adapter must be down before binding.
   */
  userChannel?: boolean;
  /**
   * Offer LE Coded PHY as an acceptable PHY for connections, for long-range
   * links. Off by default: Coded PHY trades throughput for range, and a peer
   * may negotiate onto it. Ignored on controllers that do not report the LE
   * Coded PHY feature. Does not affect scanning.
   */
  codedPhy?: boolean;
}

export type HciConnectOptions = ConnectOptions;
