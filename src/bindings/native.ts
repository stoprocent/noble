import { resolve } from 'path';

import type { Bindings } from './bindings';

/**
 * The CoreBluetooth (macOS) and WinRT (Windows) addons.
 *
 * Both implement the {@link Bindings} contract natively: every request
 * returns a promise settled by the addon itself, and unsolicited activity is
 * reported by calling the `BindingsDelegate` passed to `start()`. Nothing has
 * to be adapted on the JavaScript side.
 *
 * Conventions the addons follow:
 * - peripheral ids and UUIDs are lowercase hex without dashes;
 * - a failed request rejects with an `Error` carrying the platform's message;
 * - requests still pending when their peripheral disconnects are rejected;
 * - `pair` exists on Windows only, `broadcast` and `reset` on neither.
 */
export type NativeAddonName = 'NobleMac' | 'NobleWinrt';

type NativeAddonConstructor = new (options?: object) => Bindings;

/** Loads the prebuilt (or locally built) addon and instantiates the requested backend. */
export function loadNativeBindings (name: NativeAddonName, options: object = {}): Bindings {
  // The addon lives at the package root, two levels above both src/bindings and dist/bindings.
  const packageRoot = resolve(__dirname, '..', '..');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const load = require('node-gyp-build') as (dir: string) => Partial<Record<NativeAddonName, NativeAddonConstructor>>;
  const Addon = load(packageRoot)[name];
  if (!Addon) {
    throw new Error(`The native noble addon does not provide ${name} on this platform`);
  }
  return new Addon(options);
}
