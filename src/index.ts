import { withBindings } from './bindings/resolve';

export { withBindings } from './bindings/resolve';
export type {
  BindingType,
  DbusBindingsOptions,
  HciBindingsOptions,
  MacBindingsOptions,
  WinBindingsOptions,
  WithBindingsOptions
} from './bindings/resolve';
export type { Bindings, BindingsDelegate, CharacteristicInfo, DiscoveredPeripheral } from './bindings/bindings';

export { Noble } from './noble';
export { Peripheral } from './gatt/peripheral';
export type { ServicesAndCharacteristics } from './gatt/peripheral';
export { Service } from './gatt/service';
export { Characteristic } from './gatt/characteristic';
export { Descriptor } from './gatt/descriptor';
export type { HandleNotification } from './gatt/session';

export {
  AdapterStateError,
  ConnectionCancelledError,
  DisconnectedError,
  NobleError,
  NotSupportedError,
  TimeoutError
} from './common/errors';
export type { Listener, Unsubscribe } from './common/signal';

export { DevicePairingKinds, DevicePairingProtectionLevel } from './types';
export type {
  AdapterState,
  AddressType,
  Advertisement,
  CharacteristicProperty,
  ConnectOptions,
  DisconnectReason,
  PeripheralState,
  ScanOptions,
  ServiceData
} from './types';

export { hciStatusMessage } from './hci-status-message';

/** A ready-to-use instance on the default bindings for this platform. */
const noble = withBindings();
export default noble;
