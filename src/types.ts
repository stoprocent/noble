export type AdapterState =
  | 'poweredOn'
  | 'poweredOff'
  | 'unauthorized'
  | 'unsupported'
  | 'unknown'
  | 'resetting';

export type PeripheralState = 'error' | 'connecting' | 'connected' | 'disconnecting' | 'disconnected';

export type AddressType = 'public' | 'random' | 'unknown';

/**
 * Linux HCI bindings report the numeric controller status. Other bindings and
 * library-initiated teardown report a descriptive string.
 */
export type DisconnectReason = number | string;

export type CharacteristicProperty =
  | 'broadcast'
  | 'read'
  | 'writeWithoutResponse'
  | 'write'
  | 'notify'
  | 'indicate'
  | 'authenticatedSignedWrites'
  | 'extendedProperties';

export interface ServiceData {
  uuid: string;
  data: Buffer;
}

export interface Advertisement {
  localName?: string | null;
  txPowerLevel?: number | null;
  manufacturerData?: Buffer | null;
  serviceData: ServiceData[];
  serviceUuids: string[];
  serviceSolicitationUuids?: string[];
}

export interface ConnectOptions {
  /** Used by the HCI bindings when connecting to a peripheral that was never discovered. */
  addressType?: 'public' | 'random';
  minInterval?: number;
  maxInterval?: number;
  latency?: number;
  timeout?: number;
  /** Desired ATT MTU (HCI bindings only). */
  mtu?: number;
}

export interface ScanOptions {
  /** Only report peripherals advertising at least one of these services. */
  serviceUuids?: string[];
  /** Report every advertisement instead of each peripheral once. */
  allowDuplicates?: boolean;
}

/**
 * Mirrors WinRT's `DevicePairingKinds` (Windows.Devices.Enumeration).
 * A bitfield: pass one kind, or OR several together, to advertise which
 * ceremonies the caller can handle. Only the Windows binding supports pairing.
 */
export const DevicePairingKinds = {
  None: 0,
  ConfirmOnly: 0x00000008,
  DisplayPin: 0x00000010,
  ConfirmPinMatch: 0x00000020,
  ProvidePin: 0x00000040,
  ProvidePassword: 0x00000080,
  ConfirmPassword: 0x00000100
} as const;
export type DevicePairingKinds = number;

/** Mirrors WinRT's `DevicePairingProtectionLevel`. Only the Windows binding supports pairing. */
export const DevicePairingProtectionLevel = {
  Default: 0,
  None: 1,
  Encryption: 2,
  EncryptionAndAuthentication: 3
} as const;
export type DevicePairingProtectionLevel =
  typeof DevicePairingProtectionLevel[keyof typeof DevicePairingProtectionLevel];
