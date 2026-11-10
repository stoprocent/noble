// ESM entry point: re-exports the CommonJS build so that
// `import noble, { withBindings } from '@stoprocent/noble'` works natively.
import cjs from '../dist/index.js';

export default cjs.default;

export const {
  withBindings,
  Noble,
  Peripheral,
  Service,
  Characteristic,
  Descriptor,
  NobleError,
  AdapterStateError,
  ConnectionCancelledError,
  DisconnectedError,
  NotSupportedError,
  TimeoutError,
  DevicePairingKinds,
  DevicePairingProtectionLevel,
  hciStatusMessage
} = cjs;
