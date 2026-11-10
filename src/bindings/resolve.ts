import { platform, release } from 'os';

import { Noble } from '../noble';
import type { Bindings } from './bindings';
import type { DbusBindingsOptions } from './dbus/bindings';
import type { HciBindingsOptions } from './hci/types';

export type BindingType = 'default' | 'hci' | 'dbus' | 'mac' | 'win';

export type { DbusBindingsOptions, HciBindingsOptions };
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface MacBindingsOptions {}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface WinBindingsOptions {}

export type WithBindingsOptions =
  | HciBindingsOptions
  | DbusBindingsOptions
  | MacBindingsOptions
  | WinBindingsOptions;

type ConcreteBindingType = Exclude<BindingType, 'default'>;

/* Backends are required lazily: each pulls in platform-specific native code. */

function loadHciBindings (options: WithBindingsOptions): Bindings {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { HciBindings } = require('./hci/bindings') as typeof import('./hci/bindings');
  return new HciBindings(options as HciBindingsOptions);
}

function loadBindings (type: ConcreteBindingType, options: WithBindingsOptions): Bindings {
  switch (type) {
    case 'hci':
      return loadHciBindings(options);
    case 'dbus': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { DbusBindings } = require('./dbus/bindings') as typeof import('./dbus/bindings');
      return new DbusBindings(options as DbusBindingsOptions);
    }
    case 'mac': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { loadNativeBindings } = require('./native') as typeof import('./native');
      return loadNativeBindings('NobleMac', options);
    }
    case 'win': {
      if (!windowsHasNativeBle()) {
        return loadHciBindings(options);
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { loadNativeBindings } = require('./native') as typeof import('./native');
      return loadNativeBindings('NobleWinrt', options);
    }
    default:
      throw new Error(`Unsupported binding type: ${String(type)}`);
  }
}

/** WinRT BLE is available from Windows 10 build 15063 (Creators Update). */
function windowsHasNativeBle (): boolean {
  const [major, minor, build] = release().split('.').map(part => parseInt(part, 10));
  return major > 10 ||
    (major === 10 && minor > 0) ||
    (major === 10 && minor === 0 && build >= 15063);
}

function defaultBindingType (): ConcreteBindingType {
  const requested = (process.env.NOBLE_BINDINGS ?? '').toLowerCase();
  if (requested === 'dbus' || requested === 'hci' || requested === 'mac' || requested === 'win') {
    return requested;
  }

  const os = platform();
  if (
    os === 'linux' ||
    os === 'freebsd' ||
    process.env.BLUETOOTH_HCI_SOCKET_UART_PORT ||
    process.env.BLUETOOTH_HCI_SOCKET_FORCE_UART ||
    (process.env.BLUETOOTH_HCI_SOCKET_USB_VID && process.env.BLUETOOTH_HCI_SOCKET_USB_PID)
  ) {
    return 'hci';
  }
  if (os === 'darwin') {
    return 'mac';
  }
  if (os === 'win32') {
    return 'win';
  }
  throw new Error(`Unsupported platform: ${os}`);
}

/**
 * Creates a {@link Noble} instance on the given backend. `'default'` picks
 * the backend for the current platform (overridable with `NOBLE_BINDINGS`).
 */
export function withBindings (type?: 'default', options?: WithBindingsOptions): Noble;
export function withBindings (type: 'hci', options?: HciBindingsOptions): Noble;
export function withBindings (type: 'dbus', options?: DbusBindingsOptions): Noble;
export function withBindings (type: 'mac', options?: MacBindingsOptions): Noble;
export function withBindings (type: 'win', options?: WinBindingsOptions | HciBindingsOptions): Noble;
export function withBindings (type: BindingType = 'default', options: WithBindingsOptions = {}): Noble {
  return new Noble(loadBindings(type === 'default' ? defaultBindingType() : type, options));
}
