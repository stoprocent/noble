import type {
  Bindings,
  BindingsDelegate,
  CharacteristicInfo,
  DiscoveredPeripheral
} from '../../src/bindings/bindings';
import { Deferred } from '../../src/common/deferred';
import { PeripheralSession } from '../../src/gatt/session';

export { Deferred };

/**
 * An in-memory {@link Bindings} for unit tests.
 *
 * Every method is a `jest.fn()`. Requests resolve immediately with a neutral
 * value by default; override one per test to control when and how it settles:
 *
 *   const pending = new Deferred<Buffer>();
 *   fake.read.mockReturnValueOnce(pending.promise);
 *
 * The delegate handed to `start()` is captured, so tests drive unsolicited
 * activity through `fake.delegate.onStateChange('poweredOn')` and friends.
 *
 * Like the real backends, `startScanning` / `stopScanning` report
 * `onScanStart` / `onScanStop` before resolving. Set `reportScanEvents` to
 * `false` to drive those reports by hand.
 */
export class FakeBindings implements Bindings {
  reportScanEvents = true;

  private capturedDelegate: BindingsDelegate | null = null;

  /** The delegate passed to `start()`. Throws when the bindings were never started. */
  get delegate (): BindingsDelegate {
    if (!this.capturedDelegate) {
      throw new Error('FakeBindings: start() was not called, there is no delegate yet');
    }
    return this.capturedDelegate;
  }

  get started (): boolean {
    return this.capturedDelegate !== null;
  }

  start = jest.fn((delegate: BindingsDelegate): void => {
    this.capturedDelegate = delegate;
  });

  stop = jest.fn((): void => {});

  // Optional members: `delete fake.reset` (etc.) models a backend without them.
  reset? = jest.fn((): void => {});
  setAddress? = jest.fn((_address: string): void => {});
  setScanParameters? = jest.fn(async (_interval?: number, _window?: number): Promise<void> => {});
  pair? = jest.fn(async (_id: string, _kind: number, _protectionLevel: number): Promise<void> => {});
  broadcast? = jest.fn(async (_id: string, _service: string, _characteristic: string, _on: boolean): Promise<void> => {});

  startScanning = jest.fn(async (_serviceUuids: string[], _allowDuplicates: boolean): Promise<void> => {
    if (this.reportScanEvents) {
      this.capturedDelegate?.onScanStart();
    }
  });

  stopScanning = jest.fn(async (): Promise<void> => {
    if (this.reportScanEvents) {
      this.capturedDelegate?.onScanStop();
    }
  });

  /** `aa:bb:cc:dd:ee:ff` -> `aabbccddeeff`, like the HCI backend. */
  addressToId = jest.fn((address: string): string | null =>
    typeof address === 'string' ? address.replace(/:/g, '').toLowerCase() : null);

  connect = jest.fn(async (_id: string, _options?: unknown): Promise<void> => {});
  cancelConnect = jest.fn((_id: string): void => {});
  disconnect = jest.fn((_id: string): void => {});
  updateRssi = jest.fn(async (_id: string): Promise<number> => 0);

  discoverServices = jest.fn(async (_id: string, _serviceUuids: string[]): Promise<string[]> => []);
  discoverIncludedServices = jest.fn(
    async (_id: string, _serviceUuid: string, _serviceUuids: string[]): Promise<string[]> => []);

  discoverCharacteristics = jest.fn(
    async (_id: string, _serviceUuid: string, _characteristicUuids: string[]): Promise<CharacteristicInfo[]> => []);

  read = jest.fn(async (_id: string, _service: string, _characteristic: string): Promise<Buffer> => Buffer.alloc(0));
  write = jest.fn(
    async (_id: string, _service: string, _characteristic: string, _data: Buffer, _withoutResponse: boolean): Promise<void> => {});

  notify = jest.fn(async (_id: string, _service: string, _characteristic: string, _notify: boolean): Promise<void> => {});

  discoverDescriptors = jest.fn(async (_id: string, _service: string, _characteristic: string): Promise<string[]> => []);
  readValue = jest.fn(
    async (_id: string, _service: string, _characteristic: string, _descriptor: string): Promise<Buffer> => Buffer.alloc(0));

  writeValue = jest.fn(
    async (_id: string, _service: string, _characteristic: string, _descriptor: string, _data: Buffer): Promise<void> => {});

  readHandle = jest.fn(async (_id: string, _handle: number): Promise<Buffer> => Buffer.alloc(0));
  writeHandle = jest.fn(async (_id: string, _handle: number, _data: Buffer, _withoutResponse: boolean): Promise<void> => {});
}

/** A complete discovery report; override what the test cares about. */
export function discovery (overrides: Partial<DiscoveredPeripheral> = {}): DiscoveredPeripheral {
  return {
    id: 'aabbccddeeff',
    address: 'aa:bb:cc:dd:ee:ff',
    addressType: 'public',
    connectable: true,
    scannable: true,
    advertisement: { localName: 'device', serviceUuids: [], serviceData: [] },
    rssi: -60,
    ...overrides
  };
}

/** A real session over fake bindings: what the GATT objects are constructed with. */
export function createSession (peripheralId = 'aabbccddeeff'): { bindings: FakeBindings; session: PeripheralSession } {
  const bindings = new FakeBindings();
  return { bindings, session: new PeripheralSession(bindings, peripheralId) };
}

/**
 * Lets every already-queued promise continuation run. Purely microtask based,
 * so it neither waits on the clock nor is affected by jest fake timers.
 */
export async function flushPromises (turns = 25): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
}

/**
 * Whether `promise` is still unsettled once all queued continuations ran.
 * Lets a test assert "this hangs" without hanging itself.
 */
export async function isPending (promise: Promise<unknown>): Promise<boolean> {
  const pending = Symbol('pending');
  const settled = promise.then(() => null, () => null);
  await flushPromises();
  const winner = await Promise.race([settled, Promise.resolve(pending)]);
  return winner === pending;
}
