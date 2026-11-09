import {
  AdapterStateError,
  ConnectionCancelledError,
  DisconnectedError,
  NobleError,
  NotSupportedError,
  TimeoutError
} from '../src/common/errors';
import { Peripheral } from '../src/gatt/peripheral';
import { Noble } from '../src/noble';
import { DevicePairingKinds, DevicePairingProtectionLevel } from '../src/types';
import { Deferred, FakeBindings, discovery, flushPromises, isPending } from './helpers/fake-bindings';

const ID = 'aabbccddeeff';
const ADDRESS = 'aa:bb:cc:dd:ee:ff';

/** The private signals a running discover() loop listens on. */
const LOOP_SIGNALS = ['discoverSignal', 'scanStartSignal', 'scanStopSignal', 'stateSignal', 'stopSignal'];

describe('Noble', () => {
  let bindings: FakeBindings;
  let noble: Noble;

  beforeEach(() => {
    bindings = new FakeBindings();
    noble = new Noble(bindings);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Starts the bindings and lets them report a powered-on adapter. */
  const powerOn = (): void => {
    noble.start();
    bindings.delegate.onStateChange('poweredOn');
  };

  /** Reports a discovery and returns the peripheral Noble tracks for it. */
  const discover = (overrides = {}): Peripheral => {
    const seen: Peripheral[] = [];
    const unsubscribe = noble.onDiscover(peripheral => seen.push(peripheral));
    const report = discovery(overrides);
    bindings.delegate.onDiscover(report);
    unsubscribe();
    if (seen.length !== 1) {
      throw new Error(`expected ${report.id} to be reported once, got ${seen.length}`);
    }
    return seen[0];
  };

  describe('lazy start', () => {
    test('constructing does not start the bindings', () => {
      expect(bindings.start).not.toHaveBeenCalled();
    });

    test('start() hands the bindings a complete delegate', () => {
      noble.start();

      expect(bindings.start).toHaveBeenCalledTimes(1);
      const delegate = bindings.start.mock.calls[0][0];
      for (const method of [
        'onStateChange', 'onAddressChange', 'onScanStart', 'onScanStop', 'onDiscover', 'onConnect',
        'onDisconnect', 'onMtu', 'onRssi', 'onNotification', 'onHandleNotification', 'onWarning'
      ]) {
        expect(typeof (delegate as any)[method]).toBe('function');
      }
    });

    test('reading state starts the bindings', () => {
      expect(noble.state).toBe('unknown');

      expect(bindings.start).toHaveBeenCalledTimes(1);
    });

    test('onStateChange starts the bindings', () => {
      noble.onStateChange(jest.fn());

      expect(bindings.start).toHaveBeenCalledTimes(1);
    });

    test('startScanning starts the bindings', () => {
      noble.startScanning().catch(() => {});

      expect(bindings.start).toHaveBeenCalledTimes(1);
    });

    test('connect starts the bindings', async () => {
      await noble.connect(ID);

      expect(bindings.start).toHaveBeenCalledTimes(1);
    });

    test('pair starts the bindings', async () => {
      await noble.pair(ID);

      expect(bindings.start).toHaveBeenCalledTimes(1);
    });

    test('waitForPoweredOn starts the bindings', () => {
      jest.useFakeTimers();
      try {
        noble.waitForPoweredOn().catch(() => {});

        expect(bindings.start).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    test('the bindings are started exactly once, whatever triggers it', async () => {
      noble.start();
      noble.start();
      expect(noble.state).toBe('unknown');
      noble.onStateChange(jest.fn());
      bindings.delegate.onStateChange('poweredOn');
      await noble.startScanning();
      await noble.connect(ID);

      expect(bindings.start).toHaveBeenCalledTimes(1);
    });

    test('passive accessors and listeners do not start the bindings', () => {
      expect(noble.address).toBe('unknown');
      noble.onAddressChange(jest.fn());
      noble.onDiscover(jest.fn());
      noble.onScanStart(jest.fn());
      noble.onScanStop(jest.fn());
      noble.onWarning(jest.fn());

      expect(bindings.start).not.toHaveBeenCalled();
    });

    test('stop() before start still reaches the bindings, without starting them', () => {
      noble.stop();

      expect(bindings.stop).toHaveBeenCalledTimes(1);
      expect(bindings.start).not.toHaveBeenCalled();
    });

    test('stop() after start stops the bindings', () => {
      noble.start();

      noble.stop();

      expect(bindings.stop).toHaveBeenCalledTimes(1);
    });
  });

  describe('state and address', () => {
    test('tracks the state reported by the bindings and notifies listeners', () => {
      const listener = jest.fn();
      noble.onStateChange(listener);

      bindings.delegate.onStateChange('poweredOff');
      expect(noble.state).toBe('poweredOff');

      bindings.delegate.onStateChange('poweredOn');
      expect(noble.state).toBe('poweredOn');

      expect(listener.mock.calls).toEqual([['poweredOff'], ['poweredOn']]);
    });

    test('the state is already updated when listeners run', () => {
      const seen: string[] = [];
      noble.onStateChange(() => seen.push(noble.state));

      bindings.delegate.onStateChange('poweredOn');

      expect(seen).toEqual(['poweredOn']);
    });

    test('onStateChange returns an unsubscribe function', () => {
      const listener = jest.fn();
      const unsubscribe = noble.onStateChange(listener);

      unsubscribe();
      bindings.delegate.onStateChange('poweredOn');

      expect(listener).not.toHaveBeenCalled();
    });

    test('tracks the adapter address and notifies listeners', () => {
      const listener = jest.fn();
      const unsubscribe = noble.onAddressChange(listener);
      noble.start();

      bindings.delegate.onAddressChange('00:11:22:33:44:55');

      expect(noble.address).toBe('00:11:22:33:44:55');
      expect(listener).toHaveBeenCalledWith('00:11:22:33:44:55');

      unsubscribe();
      bindings.delegate.onAddressChange('66:77:88:99:aa:bb');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(noble.address).toBe('66:77:88:99:aa:bb');
    });

    test('scan start and stop reports reach their listeners', () => {
      const started = jest.fn();
      const stopped = jest.fn();
      const unsubscribeStart = noble.onScanStart(started);
      const unsubscribeStop = noble.onScanStop(stopped);
      noble.start();

      bindings.delegate.onScanStart(true);
      bindings.delegate.onScanStop();
      expect(started).toHaveBeenCalledTimes(1);
      expect(stopped).toHaveBeenCalledTimes(1);

      unsubscribeStart();
      unsubscribeStop();
      bindings.delegate.onScanStart();
      bindings.delegate.onScanStop();
      expect(started).toHaveBeenCalledTimes(1);
      expect(stopped).toHaveBeenCalledTimes(1);
    });
  });

  describe('waitForPoweredOn', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('resolves immediately when already powered on', async () => {
      powerOn();

      await expect(noble.waitForPoweredOn()).resolves.toBeUndefined();

      expect(jest.getTimerCount()).toBe(0);
    });

    test('resolves once the adapter powers on, and drops its timer', async () => {
      const waiting = noble.waitForPoweredOn();
      expect(await isPending(waiting)).toBe(true);

      bindings.delegate.onStateChange('poweredOff');
      expect(await isPending(waiting)).toBe(true);

      bindings.delegate.onStateChange('poweredOn');

      await expect(waiting).resolves.toBeUndefined();
      expect(jest.getTimerCount()).toBe(0);
    });

    test('rejects with TimeoutError after 10 seconds by default', async () => {
      const waiting = noble.waitForPoweredOn();

      jest.advanceTimersByTime(9999);
      expect(await isPending(waiting)).toBe(true);

      jest.advanceTimersByTime(1);

      await expect(waiting).rejects.toBeInstanceOf(TimeoutError);
      await expect(waiting).rejects.toThrow('Timeout waiting for Noble to be powered on');
    });

    test('honours a custom timeout', async () => {
      const waiting = noble.waitForPoweredOn(50);

      jest.advanceTimersByTime(50);

      await expect(waiting).rejects.toBeInstanceOf(TimeoutError);
    });

    test('stops listening once it timed out', async () => {
      const waiting = noble.waitForPoweredOn(50);
      jest.advanceTimersByTime(50);
      await expect(waiting).rejects.toBeInstanceOf(TimeoutError);

      expect((noble as any).stateSignal.hasListeners).toBe(false);
    });
  });

  describe('startScanning', () => {
    test('when not started, waits for the first reported state before scanning', async () => {
      const scanning = noble.startScanning();
      await flushPromises();
      expect(bindings.startScanning).not.toHaveBeenCalled();

      bindings.delegate.onStateChange('poweredOn');

      await expect(scanning).resolves.toBeUndefined();
      expect(bindings.startScanning).toHaveBeenCalledTimes(1);
    });

    test('when not started, rejects if the first reported state is not poweredOn', async () => {
      const scanning = noble.startScanning();

      bindings.delegate.onStateChange('poweredOff');

      await expect(scanning).rejects.toBeInstanceOf(AdapterStateError);
      await expect(scanning).rejects.toMatchObject({
        state: 'poweredOff',
        message: 'Could not start scanning, state is poweredOff (not poweredOn)'
      });
      expect(bindings.startScanning).not.toHaveBeenCalled();
    });

    test.each(['poweredOff', 'unauthorized', 'unsupported', 'resetting', 'unknown'] as const)(
      'rejects with AdapterStateError while the adapter is %s',
      async state => {
        noble.start();
        bindings.delegate.onStateChange(state);

        const scanning = noble.startScanning();

        await expect(scanning).rejects.toBeInstanceOf(AdapterStateError);
        await expect(scanning).rejects.toMatchObject({ state });
        expect(bindings.startScanning).not.toHaveBeenCalled();
      });

    test('scans for everything, without duplicates, by default', async () => {
      powerOn();

      await noble.startScanning();

      expect(bindings.startScanning).toHaveBeenCalledWith([], false);
    });

    test('passes serviceUuids and allowDuplicates', async () => {
      powerOn();

      await noble.startScanning({ serviceUuids: ['180f', '180a'], allowDuplicates: true });

      expect(bindings.startScanning).toHaveBeenCalledWith(['180f', '180a'], true);
    });

    test('resolves only once the bindings confirmed the scan', async () => {
      powerOn();
      const confirmed = new Deferred<void>();
      bindings.startScanning.mockReturnValueOnce(confirmed.promise);

      const scanning = noble.startScanning();
      expect(await isPending(scanning)).toBe(true);

      confirmed.resolve();
      await expect(scanning).resolves.toBeUndefined();
    });

    test('propagates a failure of the bindings', async () => {
      powerOn();
      bindings.startScanning.mockRejectedValueOnce(new Error('scan failed'));

      await expect(noble.startScanning()).rejects.toThrow('scan failed');
    });

    test('forgets which peripherals were already reported', async () => {
      powerOn();
      const listener = jest.fn();
      noble.onDiscover(listener);
      await noble.startScanning();
      bindings.delegate.onDiscover(discovery());
      bindings.delegate.onDiscover(discovery());
      expect(listener).toHaveBeenCalledTimes(1);

      await noble.startScanning();
      bindings.delegate.onDiscover(discovery());

      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener.mock.calls[1][0]).toBe(listener.mock.calls[0][0]);
    });

    // Only the call that starts the bindings waits for the first report. See the
    // report: this makes the outcome depend on whether anything else (reading
    // `state`, onStateChange, an earlier startScanning) started them first.
    test('when started but nothing was reported yet, rejects right away with state "unknown"', async () => {
      noble.onStateChange(jest.fn());

      const scanning = noble.startScanning();
      bindings.delegate.onStateChange('poweredOn');

      await expect(scanning).rejects.toMatchObject({ name: 'AdapterStateError', state: 'unknown' });
      expect(bindings.startScanning).not.toHaveBeenCalled();
    });
  });

  describe('stopScanning', () => {
    test('rejects before the bindings were started', async () => {
      const stopping = noble.stopScanning();

      await expect(stopping).rejects.toBeInstanceOf(NobleError);
      await expect(stopping).rejects.toThrow('Bindings are not initialized');
      expect(bindings.stopScanning).not.toHaveBeenCalled();
      expect(bindings.start).not.toHaveBeenCalled();
    });

    test('asks the bindings to stop and resolves once they confirmed', async () => {
      powerOn();
      const confirmed = new Deferred<void>();
      bindings.stopScanning.mockReturnValueOnce(confirmed.promise);

      const stopping = noble.stopScanning();
      expect(bindings.stopScanning).toHaveBeenCalledTimes(1);
      expect(await isPending(stopping)).toBe(true);

      confirmed.resolve();
      await expect(stopping).resolves.toBeUndefined();
    });

    test('propagates a failure of the bindings', async () => {
      powerOn();
      bindings.stopScanning.mockRejectedValueOnce(new Error('stop failed'));

      await expect(noble.stopScanning()).rejects.toThrow('stop failed');
    });
  });

  describe('discovery', () => {
    beforeEach(() => {
      powerOn();
    });

    test('creates a peripheral for a new discovery and reports it', () => {
      const listener = jest.fn();
      noble.onDiscover(listener);
      const advertisement = { localName: 'thing', serviceUuids: ['180f'], serviceData: [] };

      bindings.delegate.onDiscover(discovery({ addressType: 'random', advertisement, rssi: -40 }));

      expect(listener).toHaveBeenCalledTimes(1);
      const peripheral: Peripheral = listener.mock.calls[0][0];
      expect(peripheral).toBeInstanceOf(Peripheral);
      expect(peripheral).toMatchObject({
        id: ID,
        address: ADDRESS,
        addressType: 'random',
        connectable: true,
        scannable: true,
        rssi: -40,
        state: 'disconnected'
      });
      expect(peripheral.advertisement).toEqual(advertisement);
    });

    test('reports distinct peripherals separately', () => {
      const listener = jest.fn();
      noble.onDiscover(listener);

      bindings.delegate.onDiscover(discovery({ id: 'a1' }));
      bindings.delegate.onDiscover(discovery({ id: 'b2' }));

      expect(listener.mock.calls.map(([peripheral]) => peripheral.id)).toEqual(['a1', 'b2']);
    });

    test('a repeated discovery updates the same peripheral without reporting it again', () => {
      const listener = jest.fn();
      noble.onDiscover(listener);
      const manufacturerData = Buffer.from([1, 2, 3]);

      bindings.delegate.onDiscover(discovery({
        advertisement: { localName: 'device', serviceUuids: ['180f'], serviceData: [] }
      }));
      bindings.delegate.onDiscover(discovery({
        connectable: false,
        rssi: -80,
        advertisement: { manufacturerData, txPowerLevel: 4 } as any
      }));

      expect(listener).toHaveBeenCalledTimes(1);
      const peripheral: Peripheral = listener.mock.calls[0][0];
      expect(peripheral.advertisement).toEqual({
        localName: 'device',
        serviceUuids: ['180f'],
        serviceData: [],
        manufacturerData,
        txPowerLevel: 4
      });
      expect(peripheral.rssi).toBe(-80);
      expect(peripheral.connectable).toBe(false);
    });

    test('with allowDuplicates every advertisement is reported, always with the same peripheral', async () => {
      const listener = jest.fn();
      noble.onDiscover(listener);
      await noble.startScanning({ allowDuplicates: true });

      bindings.delegate.onDiscover(discovery({ rssi: -50 }));
      bindings.delegate.onDiscover(discovery({ rssi: -55 }));
      bindings.delegate.onDiscover(discovery({ rssi: -60 }));

      expect(listener).toHaveBeenCalledTimes(3);
      expect(listener.mock.calls[2][0]).toBe(listener.mock.calls[0][0]);
      expect(listener.mock.calls[0][0].rssi).toBe(-60);
    });

    test('allowDuplicates is reset by the next scan', async () => {
      const listener = jest.fn();
      noble.onDiscover(listener);
      await noble.startScanning({ allowDuplicates: true });
      await noble.startScanning();

      bindings.delegate.onDiscover(discovery());
      bindings.delegate.onDiscover(discovery());

      expect(listener).toHaveBeenCalledTimes(1);
    });

    test('an advertiser that is neither connectable nor scannable is reported every time', () => {
      const listener = jest.fn();
      noble.onDiscover(listener);
      const beacon = { connectable: false, scannable: false };

      bindings.delegate.onDiscover(discovery(beacon));
      bindings.delegate.onDiscover(discovery(beacon));

      expect(listener).toHaveBeenCalledTimes(2);
    });

    test.each([
      ['connectable only', { connectable: true, scannable: false }],
      ['scannable only', { connectable: false, scannable: true }]
    ])('a %s advertiser is reported once', (_label, flags) => {
      const listener = jest.fn();
      noble.onDiscover(listener);

      bindings.delegate.onDiscover(discovery(flags));
      bindings.delegate.onDiscover(discovery(flags));

      expect(listener).toHaveBeenCalledTimes(1);
    });

    test('onDiscover returns an unsubscribe function', () => {
      const listener = jest.fn();
      const unsubscribe = noble.onDiscover(listener);

      unsubscribe();
      bindings.delegate.onDiscover(discovery());

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('discover()', () => {
    beforeEach(() => {
      powerOn();
    });

    test('does not scan before the first value is requested', async () => {
      noble.discover();
      await flushPromises();

      expect(bindings.startScanning).not.toHaveBeenCalled();
    });

    test('yields discovered peripherals and stops scanning when returned', async () => {
      const iterator = noble.discover();
      const next = iterator.next();
      await flushPromises();

      bindings.delegate.onDiscover(discovery());

      const result = await next;
      expect(result.done).toBe(false);
      expect(result.value).toBeInstanceOf(Peripheral);
      expect((result.value as Peripheral).id).toBe(ID);

      await iterator.return();

      expect(bindings.startScanning).toHaveBeenCalledTimes(1);
      expect(bindings.stopScanning).toHaveBeenCalledTimes(1);
    });

    test('forwards the scan options', async () => {
      const iterator = noble.discover({ serviceUuids: ['180f'], allowDuplicates: true });
      const next = iterator.next();
      await flushPromises();

      expect(bindings.startScanning).toHaveBeenCalledWith(['180f'], true);

      bindings.delegate.onDiscover(discovery());
      await next;
      await iterator.return();
    });

    test('yields peripherals discovered while the consumer was busy, in order', async () => {
      const iterator = noble.discover();
      const first = iterator.next();
      await flushPromises();

      bindings.delegate.onDiscover(discovery({ id: 'a1' }));
      bindings.delegate.onDiscover(discovery({ id: 'b2' }));
      bindings.delegate.onDiscover(discovery({ id: 'c3' }));

      expect((await first).value).toMatchObject({ id: 'a1' });
      expect((await iterator.next()).value).toMatchObject({ id: 'b2' });
      expect((await iterator.next()).value).toMatchObject({ id: 'c3' });
      await iterator.return();
    });

    test('when the bindings are not started yet, waits for the adapter before scanning', async () => {
      bindings = new FakeBindings();
      noble = new Noble(bindings);
      const iterator = noble.discover();

      const next = iterator.next();
      await flushPromises();
      expect(bindings.start).toHaveBeenCalledTimes(1);
      expect(bindings.startScanning).not.toHaveBeenCalled();

      bindings.delegate.onStateChange('poweredOn');
      await flushPromises();
      bindings.delegate.onDiscover(discovery());

      await expect(next).resolves.toMatchObject({ done: false });
      await iterator.return();
    });

    test('throws AdapterStateError when the adapter is not powered on, leaving no listeners behind', async () => {
      bindings.delegate.onStateChange('poweredOff');
      const iterator = noble.discover();

      await expect(iterator.next()).rejects.toBeInstanceOf(AdapterStateError);

      expect(bindings.startScanning).not.toHaveBeenCalled();
      expect(bindings.stopScanning).not.toHaveBeenCalled();
      for (const signal of LOOP_SIGNALS) {
        expect((noble as any)[signal].hasListeners).toBe(false);
      }
    });

    test('restarts the scan when the bindings stop it on their own while waiting', async () => {
      const iterator = noble.discover();
      const next = iterator.next();
      await flushPromises();
      expect(bindings.startScanning).toHaveBeenCalledTimes(1);

      // Not through Noble.stopScanning(): e.g. the HCI binding pausing the scan to connect.
      bindings.delegate.onScanStop();
      await flushPromises();

      expect(bindings.startScanning).toHaveBeenCalledTimes(2);
      expect(await isPending(next)).toBe(true);

      bindings.delegate.onDiscover(discovery());
      await expect(next).resolves.toMatchObject({ done: false });
      await iterator.return();
    });

    test('restarts with the original scan options', async () => {
      const iterator = noble.discover({ serviceUuids: ['180f'], allowDuplicates: true });
      const next = iterator.next();
      await flushPromises();

      bindings.delegate.onScanStop();
      await flushPromises();

      expect(bindings.startScanning.mock.calls).toEqual([[['180f'], true], [['180f'], true]]);
      bindings.delegate.onDiscover(discovery());
      await next;
      await iterator.return();
    });

    test('resumes after a binding-level scan pause followed by a transient scan start', async () => {
      const iterator = noble.discover();
      const first = iterator.next();
      await flushPromises();
      bindings.delegate.onDiscover(discovery({ id: 'a1' }));
      await first;

      // The HCI binding stops scanning internally before connecting. This does
      // not pass through Noble.stopScanning(), so it must remain resumable.
      bindings.delegate.onScanStop();
      // LE connection setup can briefly enable controller scanning and report a
      // scan start without a matching stop. It is not the discovery scan.
      bindings.delegate.onScanStart();

      const second = iterator.next();
      await flushPromises();
      bindings.delegate.onDiscover(discovery({ id: 'b2' }));

      await expect(second).resolves.toMatchObject({ done: false, value: { id: 'b2' } });
      expect(bindings.startScanning).toHaveBeenCalledTimes(2);
      await iterator.return();
    });

    test('a peripheral seen before a restart is yielded again after it', async () => {
      const iterator = noble.discover();
      const first = iterator.next();
      await flushPromises();
      bindings.delegate.onDiscover(discovery());
      const { value: before } = await first;

      bindings.delegate.onScanStop();
      const second = iterator.next();
      await flushPromises();
      bindings.delegate.onDiscover(discovery());

      expect((await second).value).toBe(before);
      await iterator.return();
    });

    test('ends after an explicit stopScanning()', async () => {
      const iterator = noble.discover();
      const first = iterator.next();
      await flushPromises();
      bindings.delegate.onDiscover(discovery());
      await first;

      await noble.stopScanning();

      await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
      expect(bindings.startScanning).toHaveBeenCalledTimes(1);
      expect(bindings.stopScanning).toHaveBeenCalledTimes(1);
    });

    test('a consumer waiting for the next peripheral is released by stopScanning()', async () => {
      const iterator = noble.discover();
      const next = iterator.next();
      await flushPromises();

      await noble.stopScanning();

      await expect(next).resolves.toEqual({ value: undefined, done: true });
      expect(bindings.startScanning).toHaveBeenCalledTimes(1);
      expect(bindings.stopScanning).toHaveBeenCalledTimes(1);
    });

    test('ends after stop()', async () => {
      const iterator = noble.discover();
      const first = iterator.next();
      await flushPromises();
      bindings.delegate.onDiscover(discovery());
      await first;

      noble.stop();

      await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
      expect(bindings.startScanning).toHaveBeenCalledTimes(1);
      expect(bindings.stop).toHaveBeenCalledTimes(1);
    });

    test('a consumer waiting for the next peripheral is released by stop(), even if the bindings report nothing', async () => {
      const iterator = noble.discover();
      const next = iterator.next();
      await flushPromises();

      noble.stop();

      await expect(next).resolves.toEqual({ value: undefined, done: true });
      expect(bindings.stopScanning).not.toHaveBeenCalled();
    });

    test('ends instead of restarting when the adapter powers off', async () => {
      const iterator = noble.discover();
      const first = iterator.next();
      await flushPromises();
      bindings.delegate.onDiscover(discovery());
      await first;

      bindings.delegate.onScanStop();
      bindings.delegate.onStateChange('poweredOff');

      await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
      expect(bindings.startScanning).toHaveBeenCalledTimes(1);
    });

    test('a consumer waiting for the next peripheral is released when the adapter leaves poweredOn', async () => {
      const iterator = noble.discover();
      const next = iterator.next();
      await flushPromises();

      bindings.delegate.onStateChange('resetting');

      await expect(next).resolves.toEqual({ value: undefined, done: true });
      // The adapter is gone; there is no scan left to stop.
      expect(bindings.stopScanning).not.toHaveBeenCalled();
    });

    test('stops scanning when the consumer breaks out of the loop', async () => {
      const seen: string[] = [];
      const consumer = (async () => {
        for await (const peripheral of noble.discover()) {
          seen.push(peripheral.id);
          if (seen.length === 2) break;
        }
      })();
      await flushPromises();

      bindings.delegate.onDiscover(discovery({ id: 'a1' }));
      bindings.delegate.onDiscover(discovery({ id: 'b2' }));
      bindings.delegate.onDiscover(discovery({ id: 'c3' }));
      await consumer;

      expect(seen).toEqual(['a1', 'b2']);
      expect(bindings.stopScanning).toHaveBeenCalledTimes(1);
    });

    test('unsubscribes from everything when the loop is left', async () => {
      const iterator = noble.discover();
      const next = iterator.next();
      await flushPromises();
      bindings.delegate.onDiscover(discovery());
      await next;

      await iterator.return();

      for (const signal of LOOP_SIGNALS) {
        expect((noble as any)[signal].hasListeners).toBe(false);
      }
    });

    test('does not stop a scan the bindings already stopped when the consumer leaves', async () => {
      const iterator = noble.discover();
      const next = iterator.next();
      await flushPromises();
      bindings.delegate.onDiscover(discovery());
      await next;
      bindings.delegate.onScanStop();

      await iterator.return();

      expect(bindings.stopScanning).not.toHaveBeenCalled();
    });

    test('a later discover() works after an earlier one was stopped', async () => {
      const first = noble.discover();
      const firstNext = first.next();
      await flushPromises();
      await noble.stopScanning();
      await expect(firstNext).resolves.toMatchObject({ done: true });

      const second = noble.discover();
      const secondNext = second.next();
      await flushPromises();
      bindings.delegate.onDiscover(discovery());

      await expect(secondNext).resolves.toMatchObject({ done: false, value: { id: ID } });
      await second.return();
    });
  });

  describe('discover() on bindings that do not report onScanStart', () => {
    beforeEach(() => {
      powerOn();
      bindings.reportScanEvents = false;
    });

    test('a resolved startScanning() counts as scanning: the scan is started once and peripherals are yielded', async () => {
      const iterator = noble.discover();
      const next = iterator.next();
      await flushPromises(200);

      expect(bindings.startScanning).toHaveBeenCalledTimes(1);

      bindings.delegate.onDiscover(discovery());
      await expect(next).resolves.toMatchObject({ done: false, value: { id: ID } });
    });

    test('leaving the loop stops the scan', async () => {
      const iterator = noble.discover();
      const next = iterator.next();
      await flushPromises();
      bindings.delegate.onDiscover(discovery());
      await next;

      await iterator.return();

      expect(bindings.stopScanning).toHaveBeenCalledTimes(1);
    });

    test('an unsolicited scan stop still restarts the scan, once', async () => {
      const iterator = noble.discover();
      const next = iterator.next();
      await flushPromises();

      bindings.delegate.onScanStop();
      await flushPromises(200);

      expect(bindings.startScanning).toHaveBeenCalledTimes(2);
      bindings.delegate.onDiscover(discovery());
      await expect(next).resolves.toMatchObject({ done: false });
    });

    test('a scan stop reported while the start was still pending is not mistaken for a running scan', async () => {
      const starting = new Deferred<void>();
      bindings.startScanning.mockReturnValueOnce(starting.promise);
      const iterator = noble.discover();
      const next = iterator.next();
      await flushPromises();

      bindings.delegate.onScanStop();
      starting.resolve();
      await flushPromises(200);

      expect(bindings.startScanning).toHaveBeenCalledTimes(2);
      bindings.delegate.onDiscover(discovery());
      await expect(next).resolves.toMatchObject({ done: false });
    });
  });

  describe('connect', () => {
    test('passes a peripheral id straight through', async () => {
      const options = { mtu: 185 };

      await noble.connect(ID, options);

      expect(bindings.addressToId).not.toHaveBeenCalled();
      expect(bindings.connect).toHaveBeenCalledTimes(1);
      expect(bindings.connect).toHaveBeenCalledWith(ID, options);
    });

    test('maps an address to the peripheral id of the bindings', async () => {
      bindings.addressToId.mockReturnValueOnce('mapped01');

      await noble.connect('AA:BB:CC:DD:EE:FF');

      expect(bindings.addressToId).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF');
      expect(bindings.connect).toHaveBeenCalledWith('mapped01', undefined);
    });

    test('rejects when the bindings cannot map the address', async () => {
      bindings.addressToId.mockReturnValue(null);

      const connecting = noble.connect('not an address');

      await expect(connecting).rejects.toBeInstanceOf(NobleError);
      await expect(connecting).rejects.toThrow('Invalid peripheral ID or Address not an address');
      expect(bindings.connect).not.toHaveBeenCalled();
    });

    test('resolves with the connected peripheral', async () => {
      const peripheral = await noble.connect(ID);

      expect(peripheral).toBeInstanceOf(Peripheral);
      expect(peripheral.id).toBe(ID);
      expect(peripheral.state).toBe('connected');
    });

    test('an unknown id gets a placeholder peripheral without an address', async () => {
      const peripheral = await noble.connect(ID);

      expect(peripheral).toMatchObject({
        id: ID,
        address: '',
        addressType: 'unknown',
        connectable: true,
        scannable: false,
        rssi: 127
      });
      expect(peripheral.advertisement).toEqual({ serviceUuids: [], serviceData: [] });
    });

    test('an unknown address gets a placeholder peripheral carrying that address', async () => {
      const peripheral = await noble.connect(ADDRESS);

      expect(peripheral).toMatchObject({ id: ID, address: ADDRESS, addressType: 'unknown' });
    });

    test('returns the peripheral that was discovered earlier', async () => {
      powerOn();
      const discovered = discover();

      await expect(noble.connect(ID)).resolves.toBe(discovered);
      expect(discovered.state).toBe('connected');
    });

    test('a placeholder is completed by a later discovery, and reported', async () => {
      powerOn();
      const placeholder = await noble.connect(ID);

      const discovered = discover({ addressType: 'random', rssi: -47 });

      expect(discovered).toBe(placeholder);
      expect(placeholder).toMatchObject({ address: ADDRESS, addressType: 'random', rssi: -47 });
      expect(placeholder.advertisement.localName).toBe('device');
    });

    test('rejects for a peripheral that is already connected, leaving it connected', async () => {
      const peripheral = await noble.connect(ID);

      await expect(noble.connect(ID)).rejects.toThrow('Peripheral already connected');

      expect(bindings.connect).toHaveBeenCalledTimes(1);
      expect(peripheral.state).toBe('connected');
    });

    test('propagates a connection failure; the placeholder is reused by the next attempt', async () => {
      bindings.connect.mockRejectedValueOnce(new Error('connection refused'));

      await expect(noble.connect(ID)).rejects.toThrow('connection refused');
      const peripheral = await noble.connect(ID);

      expect(peripheral.state).toBe('connected');
      expect(bindings.connect).toHaveBeenCalledTimes(2);
    });

    test('routes later activity of the bindings to the returned peripheral', async () => {
      const peripheral = await noble.connect(ID);
      const onDisconnect = jest.fn();
      peripheral.onDisconnect(onDisconnect);

      bindings.delegate.onDisconnect(ID, 0x13);

      expect(onDisconnect).toHaveBeenCalledWith(0x13);
      expect(peripheral.state).toBe('disconnected');
    });
  });

  describe('cancelConnect', () => {
    test('cancels the pending attempt of a known peripheral', async () => {
      bindings.connect.mockReturnValueOnce(new Deferred<void>().promise);
      const connecting = noble.connect(ID);
      await flushPromises();

      noble.cancelConnect(ID);

      await expect(connecting).rejects.toBeInstanceOf(ConnectionCancelledError);
      expect(bindings.cancelConnect).toHaveBeenCalledTimes(1);
      expect(bindings.cancelConnect).toHaveBeenCalledWith(ID);
    });

    test('accepts an address', async () => {
      bindings.connect.mockReturnValueOnce(new Deferred<void>().promise);
      const connecting = noble.connect(ADDRESS);
      await flushPromises();

      noble.cancelConnect(ADDRESS);

      await expect(connecting).rejects.toBeInstanceOf(ConnectionCancelledError);
      expect(bindings.cancelConnect).toHaveBeenCalledWith(ID);
    });

    test('for a peripheral Noble does not know, asks the bindings directly', () => {
      noble.cancelConnect('0123abcd');

      expect(bindings.cancelConnect).toHaveBeenCalledWith('0123abcd');
    });

    test('does nothing for a known peripheral without a pending attempt', async () => {
      await noble.connect(ID);

      noble.cancelConnect(ID);

      expect(bindings.cancelConnect).not.toHaveBeenCalled();
    });

    test('throws when the bindings cannot map the address', () => {
      bindings.addressToId.mockReturnValue(null);

      expect(() => noble.cancelConnect('not an address')).toThrow('Invalid peripheral ID or Address not an address');
      expect(bindings.cancelConnect).not.toHaveBeenCalled();
    });
  });

  describe('pair', () => {
    test('pairs by id with the default kind and protection level', async () => {
      await expect(noble.pair(ID)).resolves.toBeUndefined();

      expect(bindings.pair).toHaveBeenCalledWith(
        ID, DevicePairingKinds.ConfirmOnly, DevicePairingProtectionLevel.Encryption);
    });

    test('pairs by address, forwarding kind and protection level', async () => {
      await noble.pair(ADDRESS, DevicePairingKinds.ProvidePin, DevicePairingProtectionLevel.EncryptionAndAuthentication);

      expect(bindings.pair).toHaveBeenCalledWith(
        ID, DevicePairingKinds.ProvidePin, DevicePairingProtectionLevel.EncryptionAndAuthentication);
    });

    test('null kind and protection level mean the defaults', async () => {
      await noble.pair(ID, null, null);

      expect(bindings.pair).toHaveBeenCalledWith(
        ID, DevicePairingKinds.ConfirmOnly, DevicePairingProtectionLevel.Encryption);
    });

    test('rejects invalid arguments', async () => {
      await expect(noble.pair(ID, DevicePairingKinds.None)).rejects.toBeInstanceOf(TypeError);
      await expect(noble.pair(ID, -1)).rejects.toBeInstanceOf(TypeError);
      expect(bindings.pair).not.toHaveBeenCalled();
    });

    test('rejects with NotSupportedError when the bindings cannot pair', async () => {
      delete bindings.pair;

      await expect(noble.pair(ID)).rejects.toBeInstanceOf(NotSupportedError);
    });

    test('rejects when the bindings cannot map the address', async () => {
      bindings.addressToId.mockReturnValue(null);

      await expect(noble.pair('not an address')).rejects.toThrow('Invalid peripheral ID or Address not an address');
    });

    test('propagates a pairing failure', async () => {
      bindings.pair!.mockRejectedValueOnce(new Error('pairing failed'));

      await expect(noble.pair(ID)).rejects.toThrow('pairing failed');
    });

    test('options without a PIN forward kind and protection level only', async () => {
      await noble.pair(ADDRESS, {
        kind: DevicePairingKinds.DisplayPin,
        protectionLevel: DevicePairingProtectionLevel.EncryptionAndAuthentication
      });

      expect(bindings.pair!.mock.calls).toEqual([
        [ID, DevicePairingKinds.DisplayPin, DevicePairingProtectionLevel.EncryptionAndAuthentication]
      ]);
    });

    test('a PIN is forwarded with authenticated defaults', async () => {
      await expect(noble.pair(ID, { pin: '123456' })).resolves.toBeUndefined();

      expect(bindings.pair!.mock.calls).toEqual([[
        ID,
        DevicePairingKinds.ConfirmOnly | DevicePairingKinds.ProvidePin | DevicePairingKinds.ConfirmPinMatch,
        DevicePairingProtectionLevel.EncryptionAndAuthentication,
        '123456'
      ]]);
    });

    test('rejects an invalid PIN', async () => {
      await expect(noble.pair(ID, { pin: 123456 as any })).rejects.toThrow(
        new TypeError('pair() options.pin must be a non-empty string'));
      await expect(noble.pair(ID, { pin: '' })).rejects.toBeInstanceOf(TypeError);
      expect(bindings.pair).not.toHaveBeenCalled();
    });

    test('rejects a PIN with a protection level below EncryptionAndAuthentication', async () => {
      await expect(noble.pair(ID, { pin: '123456', protectionLevel: DevicePairingProtectionLevel.Encryption }))
        .rejects.toThrow('pair() with a PIN requires DevicePairingProtectionLevel.EncryptionAndAuthentication');
      expect(bindings.pair).not.toHaveBeenCalled();
    });

    test('rejects options mixed with a positional protection level', async () => {
      await expect((noble.pair as any)(ID, { pin: '123456' }, DevicePairingProtectionLevel.EncryptionAndAuthentication))
        .rejects.toBeInstanceOf(TypeError);
      expect(bindings.pair).not.toHaveBeenCalled();
    });

    test('a PIN on a platform without pairing rejects with NotSupportedError', async () => {
      delete bindings.pair;

      await expect(noble.pair(ID, { pin: '123456' })).rejects.toBeInstanceOf(NotSupportedError);
    });
  });

  describe('isPaired', () => {
    test('reports the pairing state from the bindings, by id', async () => {
      bindings.isPaired!.mockResolvedValueOnce(true);

      await expect(noble.isPaired(ID)).resolves.toBe(true);
      expect(bindings.isPaired).toHaveBeenCalledWith(ID);
    });

    test('resolves the address and reports an unpaired peripheral', async () => {
      await expect(noble.isPaired(ADDRESS)).resolves.toBe(false);
      expect(bindings.isPaired).toHaveBeenCalledWith(ID);
    });

    test('resolves false when the bindings have no pairing state', async () => {
      delete bindings.isPaired;

      await expect(noble.isPaired(ID)).resolves.toBe(false);
    });

    test('starts the bindings', async () => {
      await noble.isPaired(ID);

      expect(bindings.start).toHaveBeenCalledTimes(1);
    });

    test('rejects when the bindings cannot map the address', async () => {
      bindings.addressToId.mockReturnValue(null);

      await expect(noble.isPaired('not an address')).rejects.toThrow('Invalid peripheral ID or Address not an address');
    });

    test('propagates a failure from the bindings', async () => {
      bindings.isPaired!.mockRejectedValueOnce(new Error('peripheral not found'));

      await expect(noble.isPaired(ID)).rejects.toThrow('peripheral not found');
    });
  });

  describe('activity routed to known peripherals', () => {
    let peripheral: Peripheral;

    beforeEach(() => {
      powerOn();
      peripheral = discover();
    });

    test('an unsolicited link marks the peripheral connected', () => {
      bindings.delegate.onConnect(ID);

      expect(peripheral.state).toBe('connected');
    });

    test('mtu reports update the peripheral; a zero mtu is ignored', () => {
      const listener = jest.fn();
      peripheral.onMtuChange(listener);

      bindings.delegate.onMtu(ID, 0);
      expect(peripheral.mtu).toBeNull();

      bindings.delegate.onMtu(ID, 185);
      expect(peripheral.mtu).toBe(185);
      expect(listener.mock.calls).toEqual([[185]]);
    });

    test('rssi reports update the peripheral', () => {
      bindings.delegate.onRssi(ID, -33);

      expect(peripheral.rssi).toBe(-33);
    });

    test('notifications reach the listeners of the matching characteristic only', async () => {
      await peripheral.connect();
      bindings.discoverServices.mockResolvedValueOnce(['180f']);
      bindings.discoverCharacteristics.mockResolvedValueOnce([
        { uuid: '2a19', properties: ['notify'] },
        { uuid: '2a1a', properties: ['notify'] }
      ]);
      const { characteristics } = await peripheral.discoverAllServicesAndCharacteristics();
      const level = jest.fn();
      const other = jest.fn();
      characteristics[0].onNotification(level);
      characteristics[1].onNotification(other);
      const data = Buffer.from([0x64]);

      bindings.delegate.onNotification(ID, '180f', '2a19', data);

      expect(level).toHaveBeenCalledWith(data);
      expect(other).not.toHaveBeenCalled();
    });

    test('raw handle notifications reach the peripheral', () => {
      const listener = jest.fn();
      peripheral.onHandleNotification(listener);
      const data = Buffer.from([1]);

      bindings.delegate.onHandleNotification(ID, 0x2a, data);

      expect(listener).toHaveBeenCalledWith({ handle: 0x2a, data });
    });

    test('a disconnect resolves a pending disconnect() and reaches onDisconnect', async () => {
      await peripheral.connect();
      const onDisconnect = jest.fn();
      peripheral.onDisconnect(onDisconnect);

      const disconnecting = peripheral.disconnect();
      bindings.delegate.onDisconnect(ID, 0x16);

      await expect(disconnecting).resolves.toBeUndefined();
      expect(onDisconnect).toHaveBeenCalledWith(0x16);
    });

    test('activity for one peripheral does not touch another', async () => {
      const other = discover({ id: '112233445566', address: '11:22:33:44:55:66' });
      await peripheral.connect();
      await other.connect();

      bindings.delegate.onDisconnect(ID, 'remote');

      expect(peripheral.state).toBe('disconnected');
      expect(other.state).toBe('connected');
    });
  });

  describe('adapter leaving poweredOn', () => {
    beforeEach(() => {
      powerOn();
    });

    test('connected peripherals are disconnected with reason "cleanup"', async () => {
      const peripheral = discover();
      await peripheral.connect();
      const onDisconnect = jest.fn();
      peripheral.onDisconnect(onDisconnect);

      bindings.delegate.onStateChange('poweredOff');

      expect(onDisconnect).toHaveBeenCalledTimes(1);
      expect(onDisconnect).toHaveBeenCalledWith('cleanup');
      expect(peripheral.state).toBe('disconnected');
    });

    test('operations in flight reject with DisconnectedError("cleanup")', async () => {
      const peripheral = discover();
      await peripheral.connect();
      bindings.readHandle.mockReturnValueOnce(new Deferred<Buffer>().promise);
      const reading = peripheral.readHandle(1);

      bindings.delegate.onStateChange('resetting');

      await expect(reading).rejects.toBeInstanceOf(DisconnectedError);
      await expect(reading).rejects.toMatchObject({ reason: 'cleanup' });
    });

    test('a connection attempt in flight rejects with DisconnectedError and ends up disconnected', async () => {
      const peripheral = discover();
      bindings.connect.mockReturnValueOnce(new Deferred<void>().promise);
      const onDisconnect = jest.fn();
      peripheral.onDisconnect(onDisconnect);
      const connecting = peripheral.connect();

      bindings.delegate.onStateChange('poweredOff');

      await expect(connecting).rejects.toBeInstanceOf(DisconnectedError);
      await expect(connecting).rejects.toMatchObject({ reason: 'cleanup' });
      expect(peripheral.state).toBe('disconnected');
      expect(onDisconnect).not.toHaveBeenCalled();
    });

    test('a pending disconnect() resolves', async () => {
      const peripheral = discover();
      await peripheral.connect();
      const disconnecting = peripheral.disconnect();

      bindings.delegate.onStateChange('poweredOff');

      await expect(disconnecting).resolves.toBeUndefined();
    });

    test('peripherals without a link are left alone', () => {
      const peripheral = discover();
      const onDisconnect = jest.fn();
      peripheral.onDisconnect(onDisconnect);

      bindings.delegate.onStateChange('poweredOff');

      expect(onDisconnect).not.toHaveBeenCalled();
      expect(peripheral.state).toBe('disconnected');
    });

    test('the teardown is reported before the state change, with the new state already readable', async () => {
      const peripheral = discover();
      await peripheral.connect();
      const order: string[] = [];
      peripheral.onDisconnect(() => order.push(`disconnect while ${noble.state}`));
      noble.onStateChange(state => order.push(state));

      bindings.delegate.onStateChange('poweredOff');

      expect(order).toEqual(['disconnect while poweredOff', 'poweredOff']);
    });

    test('peripherals stay known: a later discovery reports the same object again', () => {
      const before = discover();

      bindings.delegate.onStateChange('poweredOff');
      bindings.delegate.onStateChange('poweredOn');
      const after = discover({ rssi: -30 });

      expect(after).toBe(before);
      expect(before.rssi).toBe(-30);
    });

    test('nothing is torn down by a change between two states that are not poweredOn', async () => {
      const peripheral = discover();
      await peripheral.connect();
      bindings.delegate.onStateChange('poweredOff');
      const onDisconnect = jest.fn();
      peripheral.onDisconnect(onDisconnect);

      bindings.delegate.onStateChange('unknown');

      expect(onDisconnect).not.toHaveBeenCalled();
    });

    test('a repeated poweredOn report tears nothing down', async () => {
      const peripheral = discover();
      await peripheral.connect();

      bindings.delegate.onStateChange('poweredOn');

      expect(peripheral.state).toBe('connected');
    });

    describe('a Peripheral the application kept across the power cycle', () => {
      let peripheral: Peripheral;
      let warnings: jest.Mock;

      beforeEach(async () => {
        warnings = jest.fn();
        noble.onWarning(warnings);
        peripheral = discover();
        await peripheral.connect();
        bindings.delegate.onStateChange('poweredOff');
        bindings.delegate.onStateChange('poweredOn');
        await peripheral.connect();
      });

      test('reconnects through the bindings', () => {
        expect(bindings.connect).toHaveBeenCalledTimes(2);
        expect(peripheral.state).toBe('connected');
      });

      test('still learns about the loss of its link', () => {
        const onDisconnect = jest.fn();
        peripheral.onDisconnect(onDisconnect);

        bindings.delegate.onDisconnect(ID, 0x08);

        expect(warnings).not.toHaveBeenCalled();
        expect(onDisconnect).toHaveBeenCalledWith(0x08);
        expect(peripheral.state).toBe('disconnected');
      });

      test('disconnect() still resolves', async () => {
        const disconnecting = peripheral.disconnect();
        expect(bindings.disconnect).toHaveBeenCalledWith(ID);

        bindings.delegate.onDisconnect(ID, 0x16);

        await expect(disconnecting).resolves.toBeUndefined();
      });

      test('is the peripheral noble.connect() resolves with', async () => {
        bindings.delegate.onDisconnect(ID, 0x08);

        await expect(noble.connect(ID)).resolves.toBe(peripheral);
      });
    });
  });

  describe('stop()', () => {
    beforeEach(() => {
      powerOn();
    });

    test('connected peripherals are disconnected with reason "stopped"', async () => {
      const peripheral = discover();
      await peripheral.connect();
      const onDisconnect = jest.fn();
      peripheral.onDisconnect(onDisconnect);

      noble.stop();

      expect(onDisconnect).toHaveBeenCalledTimes(1);
      expect(onDisconnect).toHaveBeenCalledWith('stopped');
      expect(peripheral.state).toBe('disconnected');
    });

    test('operations and connection attempts in flight reject with DisconnectedError("stopped")', async () => {
      const connected = discover();
      await connected.connect();
      bindings.readHandle.mockReturnValueOnce(new Deferred<Buffer>().promise);
      const reading = connected.readHandle(1);
      const other = discover({ id: '112233445566', address: '11:22:33:44:55:66' });
      bindings.connect.mockReturnValueOnce(new Deferred<void>().promise);
      const connecting = other.connect();

      noble.stop();

      await expect(reading).rejects.toMatchObject({ name: 'DisconnectedError', reason: 'stopped' });
      await expect(connecting).rejects.toMatchObject({ name: 'DisconnectedError', reason: 'stopped' });
      expect(other.state).toBe('disconnected');
    });

    test('the bindings are stopped before the teardown is reported', async () => {
      const peripheral = discover();
      await peripheral.connect();
      let stoppedWhenReported = false;
      peripheral.onDisconnect(() => {
        stoppedWhenReported = bindings.stop.mock.calls.length === 1;
      });

      noble.stop();

      expect(stoppedWhenReported).toBe(true);
    });

    test('peripherals without a link are left alone, and stay known', () => {
      const peripheral = discover();
      const onDisconnect = jest.fn();
      peripheral.onDisconnect(onDisconnect);

      noble.stop();

      expect(onDisconnect).not.toHaveBeenCalled();
      expect(discover()).toBe(peripheral);
    });
  });

  describe('warnings', () => {
    let consoleWarn: jest.SpyInstance;

    beforeEach(() => {
      consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      noble.start();
    });

    test('go to console.warn while nobody listens', () => {
      bindings.delegate.onWarning('something odd');

      expect(consoleWarn).toHaveBeenCalledTimes(1);
      expect(consoleWarn).toHaveBeenCalledWith('noble: something odd');
    });

    test('go to onWarning listeners instead of the console once there is one', () => {
      const listener = jest.fn();
      noble.onWarning(listener);

      bindings.delegate.onWarning('something odd');

      expect(listener).toHaveBeenCalledWith('something odd');
      expect(consoleWarn).not.toHaveBeenCalled();
    });

    test('fall back to the console again when the last listener is removed', () => {
      const unsubscribe = noble.onWarning(jest.fn());
      unsubscribe();

      bindings.delegate.onWarning('something odd');

      expect(consoleWarn).toHaveBeenCalledWith('noble: something odd');
    });

    test.each([
      ['a connect', 'connected', (d: any) => d.onConnect('f00d')],
      ['a disconnect', 'disconnected', (d: any) => d.onDisconnect('f00d', 'remote')],
      ['an rssi update', 'RSSI update', (d: any) => d.onRssi('f00d', -50)],
      ['a notification', 'notification', (d: any) => d.onNotification('f00d', '180f', '2a19', Buffer.alloc(1))],
      ['a handle notification', 'handle notify', (d: any) => d.onHandleNotification('f00d', 1, Buffer.alloc(1))]
    ])('%s for an unknown peripheral warns', (_label, what, report) => {
      const listener = jest.fn();
      noble.onWarning(listener);

      report(bindings.delegate);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(`unknown peripheral f00d ${what}!`);
    });

    test('activity for an unknown peripheral warns on the console without a listener', () => {
      bindings.delegate.onDisconnect('f00d', 'remote');

      expect(consoleWarn).toHaveBeenCalledWith('noble: unknown peripheral f00d disconnected!');
    });

    test('an mtu report for an unknown peripheral is dropped silently', () => {
      const listener = jest.fn();
      noble.onWarning(listener);

      bindings.delegate.onMtu('f00d', 185);

      expect(listener).not.toHaveBeenCalled();
    });

    test('activity for an unknown peripheral does not create one', async () => {
      noble.onWarning(jest.fn());
      bindings.delegate.onStateChange('poweredOn');
      bindings.delegate.onConnect(ID);

      const peripheral = discover();

      expect(peripheral.state).toBe('disconnected');
    });
  });

  describe('optional binding methods', () => {
    test('setAddress forwards to bindings that implement it', () => {
      noble.setAddress('00:11:22:33:44:55');

      expect(bindings.setAddress).toHaveBeenCalledWith('00:11:22:33:44:55');
    });

    test('setAddress throws NotSupportedError otherwise', () => {
      delete bindings.setAddress;

      expect(() => noble.setAddress('00:11:22:33:44:55')).toThrow(NotSupportedError);
      expect(() => noble.setAddress('00:11:22:33:44:55')).toThrow('The current bindings do not implement setAddress');
    });

    test('setScanParameters starts the bindings and forwards interval and window', async () => {
      await expect(noble.setScanParameters(0x10, 0x10)).resolves.toBeUndefined();

      expect(bindings.start).toHaveBeenCalledTimes(1);
      expect(bindings.setScanParameters).toHaveBeenCalledWith(0x10, 0x10);
    });

    test('setScanParameters resolves once the bindings applied them', async () => {
      const applied = new Deferred<void>();
      bindings.setScanParameters!.mockReturnValueOnce(applied.promise);

      const setting = noble.setScanParameters();
      expect(await isPending(setting)).toBe(true);
      expect(bindings.setScanParameters).toHaveBeenCalledWith(undefined, undefined);

      applied.resolve();
      await expect(setting).resolves.toBeUndefined();
    });

    test('setScanParameters rejects with NotSupportedError otherwise, without starting the bindings', async () => {
      delete bindings.setScanParameters;

      const setting = noble.setScanParameters(0x10, 0x10);

      await expect(setting).rejects.toBeInstanceOf(NotSupportedError);
      await expect(setting).rejects.toThrow('The current bindings do not implement setScanParameters');
      expect(bindings.start).not.toHaveBeenCalled();
    });

    test('reset forwards to bindings that implement it', () => {
      noble.reset();

      expect(bindings.reset).toHaveBeenCalledTimes(1);
    });

    test('reset is a no-op otherwise', () => {
      delete bindings.reset;

      expect(() => noble.reset()).not.toThrow();
    });
  });
});
