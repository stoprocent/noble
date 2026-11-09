import { resolve } from 'path';

import { Deferred } from '../common/deferred';
import { DisconnectedError, NobleError } from '../common/errors';
import type { AdapterState, AddressType, Advertisement, ConnectOptions } from '../types';
import type { Bindings, BindingsDelegate, CharacteristicInfo } from './bindings';

/** The methods exported by the CoreBluetooth and WinRT addons. */
interface NativeAddon {
  /** Installed by {@link NativeBindings}; the addon's `emit` forwards here. */
  eventSink?: (event: string, args: unknown[]) => void;
  start (): void;
  stop (): void;
  startScanning (serviceUuids: string[], allowDuplicates: boolean): void;
  stopScanning (): void;
  connect (id: string, options?: ConnectOptions): void;
  cancelConnect (id: string): void;
  disconnect (id: string): void;
  /** WinRT only. */
  pair? (id: string, kind: number, protectionLevel: number): void;
  updateRssi (id: string): void;
  discoverServices (id: string, serviceUuids: string[]): void;
  discoverIncludedServices (id: string, serviceUuid: string, serviceUuids: string[]): void;
  discoverCharacteristics (id: string, serviceUuid: string, characteristicUuids: string[]): void;
  read (id: string, serviceUuid: string, characteristicUuid: string): void;
  write (id: string, serviceUuid: string, characteristicUuid: string, data: Buffer, withoutResponse: boolean): void;
  notify (id: string, serviceUuid: string, characteristicUuid: string, notify: boolean): void;
  discoverDescriptors (id: string, serviceUuid: string, characteristicUuid: string): void;
  readValue (id: string, serviceUuid: string, characteristicUuid: string, descriptorUuid: string): void;
  writeValue (id: string, serviceUuid: string, characteristicUuid: string, descriptorUuid: string, data: Buffer): void;
  readHandle (id: string, handle: number): void;
  writeHandle (id: string, handle: number, data: Buffer, withoutResponse: boolean): void;
  addressToId (address: string): string | null;
}

interface NativeAddonConstructor {
  new (options?: object): NativeAddon;
  prototype: NativeAddon & { emit?: (event: string, ...args: unknown[]) => void };
}

export type NativeAddonName = 'NobleMac' | 'NobleWinrt';

type NativeError = Error | null | undefined;

interface PendingRequest {
  peripheralId: string | null;
  deferred: Deferred<unknown>;
}

/**
 * Adapts the native addons to the promise-based {@link Bindings} contract.
 *
 * The addons answer every request with a named completion event and no
 * request id. This class is the single place where those completions are
 * matched back to the requests that caused them: per completion key, first
 * in, first out.
 */
export class NativeBindings implements Bindings {
  pair?: (peripheralId: string, kind: number, protectionLevel: number) => Promise<void>;

  private delegate: BindingsDelegate | null = null;
  private readonly pending = new Map<string, PendingRequest[]>();

  constructor (private readonly native: NativeAddon) {
    const nativePair = native.pair;
    if (typeof nativePair === 'function') {
      this.pair = (id, kind, protectionLevel) =>
        this.request<void>(id, ['pair', id], () => nativePair.call(native, id, kind, protectionLevel));
    }
  }

  start (delegate: BindingsDelegate): void {
    this.delegate = delegate;
    this.native.eventSink = (event, args) => this.dispatch(event, args);
    this.native.start();
  }

  stop (): void {
    this.native.stop();
  }

  startScanning (serviceUuids: string[], allowDuplicates: boolean): Promise<void> {
    return this.request(null, ['scanStart'], () => this.native.startScanning(serviceUuids, allowDuplicates));
  }

  stopScanning (): Promise<void> {
    return this.request(null, ['scanStop'], () => this.native.stopScanning());
  }

  addressToId (address: string): string | null {
    return this.native.addressToId(address);
  }

  connect (id: string, options?: ConnectOptions): Promise<void> {
    return this.request(id, ['connect', id], () => this.native.connect(id, options));
  }

  cancelConnect (id: string): void {
    this.native.cancelConnect(id);
  }

  disconnect (id: string): void {
    this.native.disconnect(id);
  }

  updateRssi (id: string): Promise<number> {
    return this.request(id, ['rssi', id], () => this.native.updateRssi(id));
  }

  discoverServices (id: string, serviceUuids: string[]): Promise<string[]> {
    return this.request(id, ['services', id], () => this.native.discoverServices(id, serviceUuids));
  }

  discoverIncludedServices (id: string, serviceUuid: string, serviceUuids: string[]): Promise<string[]> {
    return this.request(id, ['includedServices', id, serviceUuid], () =>
      this.native.discoverIncludedServices(id, serviceUuid, serviceUuids));
  }

  discoverCharacteristics (id: string, serviceUuid: string, characteristicUuids: string[]): Promise<CharacteristicInfo[]> {
    return this.request(id, ['characteristics', id, serviceUuid], () =>
      this.native.discoverCharacteristics(id, serviceUuid, characteristicUuids));
  }

  read (id: string, serviceUuid: string, characteristicUuid: string): Promise<Buffer> {
    return this.request(id, ['read', id, serviceUuid, characteristicUuid], () =>
      this.native.read(id, serviceUuid, characteristicUuid));
  }

  write (id: string, serviceUuid: string, characteristicUuid: string, data: Buffer, withoutResponse: boolean): Promise<void> {
    return this.request(id, ['write', id, serviceUuid, characteristicUuid], () =>
      this.native.write(id, serviceUuid, characteristicUuid, data, withoutResponse));
  }

  notify (id: string, serviceUuid: string, characteristicUuid: string, notify: boolean): Promise<void> {
    return this.request(id, ['notify', id, serviceUuid, characteristicUuid], () =>
      this.native.notify(id, serviceUuid, characteristicUuid, notify));
  }

  discoverDescriptors (id: string, serviceUuid: string, characteristicUuid: string): Promise<string[]> {
    return this.request(id, ['descriptors', id, serviceUuid, characteristicUuid], () =>
      this.native.discoverDescriptors(id, serviceUuid, characteristicUuid));
  }

  readValue (id: string, serviceUuid: string, characteristicUuid: string, descriptorUuid: string): Promise<Buffer> {
    return this.request(id, ['valueRead', id, serviceUuid, characteristicUuid, descriptorUuid], () =>
      this.native.readValue(id, serviceUuid, characteristicUuid, descriptorUuid));
  }

  writeValue (id: string, serviceUuid: string, characteristicUuid: string, descriptorUuid: string, data: Buffer): Promise<void> {
    return this.request(id, ['valueWrite', id, serviceUuid, characteristicUuid, descriptorUuid], () =>
      this.native.writeValue(id, serviceUuid, characteristicUuid, descriptorUuid, data));
  }

  readHandle (id: string, handle: number): Promise<Buffer> {
    return this.request(id, ['handleRead', id, handle], () => this.native.readHandle(id, handle));
  }

  writeHandle (id: string, handle: number, data: Buffer, withoutResponse: boolean): Promise<void> {
    return this.request(id, ['handleWrite', id, handle], () =>
      this.native.writeHandle(id, handle, data, withoutResponse));
  }

  /** Registers a pending completion, then issues the native call that will produce it. */
  private request<T> (peripheralId: string | null, key: Array<string | number>, send: () => void): Promise<T> {
    const deferred = new Deferred<unknown>();
    const requestKey = completionKey(key);
    const queue = this.pending.get(requestKey) ?? [];
    queue.push({ peripheralId, deferred });
    this.pending.set(requestKey, queue);

    try {
      send();
    } catch (error) {
      this.take(requestKey, deferred);
      deferred.reject(error instanceof Error ? error : new NobleError(String(error)));
    }
    return deferred.promise as Promise<T>;
  }

  /** Settles the oldest request waiting on `key`; completions nobody asked for are dropped. */
  private settle (key: Array<string | number>, error: NativeError, value?: unknown): void {
    const requestKey = completionKey(key);
    const request = this.pending.get(requestKey)?.[0];
    if (!request) {
      return;
    }
    this.take(requestKey, request.deferred);
    if (error) {
      request.deferred.reject(error);
    } else {
      request.deferred.resolve(value);
    }
  }

  private take (requestKey: string, deferred: Deferred<unknown>): void {
    const queue = this.pending.get(requestKey);
    if (!queue) {
      return;
    }
    const remaining = queue.filter(request => request.deferred !== deferred);
    if (remaining.length > 0) {
      this.pending.set(requestKey, remaining);
    } else {
      this.pending.delete(requestKey);
    }
  }

  /** The addon will never answer requests of a peripheral whose link is gone. */
  private rejectAll (peripheralId: string, error: Error): void {
    for (const [requestKey, queue] of [...this.pending]) {
      const remaining = queue.filter(request => {
        if (request.peripheralId !== peripheralId) {
          return true;
        }
        request.deferred.reject(error);
        return false;
      });
      if (remaining.length > 0) {
        this.pending.set(requestKey, remaining);
      } else {
        this.pending.delete(requestKey);
      }
    }
  }

  /** Translates one positional native event into the typed contract. */
  private dispatch (event: string, args: unknown[]): void {
    const delegate = this.delegate;
    if (!delegate) {
      return;
    }
    // The addons only ever send the shapes spelled out below.
    const [a, b, c, d, e, f] = args as [never, never, never, never, never, never];

    switch (event) {
      case 'stateChange':
        delegate.onStateChange(a as AdapterState);
        break;
      case 'addressChange':
        delegate.onAddressChange(a as string);
        break;
      case 'scanStart':
        delegate.onScanStart();
        this.settle(['scanStart'], null);
        break;
      case 'scanStop':
        delegate.onScanStop();
        this.settle(['scanStop'], null);
        break;
      case 'discover':
        delegate.onDiscover({
          id: a as string,
          address: b as string,
          addressType: c as AddressType,
          connectable: d as boolean,
          advertisement: e as Advertisement,
          rssi: f as number
        });
        break;
      case 'connect':
        this.settle(['connect', a], b);
        break;
      case 'pair': {
        const failure = (c as NativeError) ?? (b ? null : new NobleError('pairing failed'));
        this.settle(['pair', a], failure);
        break;
      }
      case 'disconnect': {
        const reason = (b as string | number | undefined) ?? 'unknown';
        this.rejectAll(a, new DisconnectedError(reason));
        delegate.onDisconnect(a, reason);
        break;
      }
      case 'onMtu':
        delegate.onMtu(a, b);
        break;
      case 'rssiUpdate':
        if (!c) delegate.onRssi(a, b);
        this.settle(['rssi', a], c, b);
        break;
      case 'servicesDiscover':
        this.settle(['services', a], c, b);
        break;
      case 'includedServicesDiscover':
        this.settle(['includedServices', a, b], d, c);
        break;
      case 'characteristicsDiscover':
        this.settle(['characteristics', a, b], d, c);
        break;
      case 'read':
        // (id, serviceUuid, characteristicUuid, data, isNotification, error)
        if (e) {
          delegate.onNotification(a, b, c, d);
        } else {
          this.settle(['read', a, b, c], f, d);
        }
        break;
      case 'write':
        this.settle(['write', a, b, c], d);
        break;
      case 'notify':
        this.settle(['notify', a, b, c], e);
        break;
      case 'descriptorsDiscover':
        this.settle(['descriptors', a, b, c], e, d);
        break;
      case 'valueRead':
        this.settle(['valueRead', a, b, c, d], f, e);
        break;
      case 'valueWrite':
        this.settle(['valueWrite', a, b, c, d], e);
        break;
      case 'handleRead':
        this.settle(['handleRead', a, b], d, c);
        break;
      case 'handleWrite':
        this.settle(['handleWrite', a, b], c);
        break;
      case 'handleNotify':
        delegate.onHandleNotification(a, b, c);
        break;
      default:
        delegate.onWarning(`unhandled native event ${event}`);
    }
  }
}

function completionKey (parts: Array<string | number>): string {
  // UUIDs come back from the addons lowercased and without dashes.
  return parts.map(part => String(part).replace(/-/g, '').toLowerCase()).join('|');
}

/** Loads the prebuilt (or locally built) addon and wraps the requested backend. */
export function loadNativeBindings (name: NativeAddonName, options: object = {}): NativeBindings {
  // The addon lives at the package root, two levels above both src/bindings and dist/bindings.
  const packageRoot = resolve(__dirname, '..', '..');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const load = require('node-gyp-build') as (dir: string) => Record<NativeAddonName, NativeAddonConstructor>;
  const Addon = load(packageRoot)[name];

  // The addons report by calling `this.emit(event, ...args)`. Give them a
  // plain forwarding function instead of inheriting from EventEmitter.
  if (typeof Addon.prototype.emit !== 'function') {
    Addon.prototype.emit = function (this: NativeAddon, event: string, ...args: unknown[]): void {
      this.eventSink?.(event, args);
    };
  }
  return new NativeBindings(new Addon(options));
}
