import { resolve } from 'path';

import type { BindingsDelegate } from '../../src/bindings/bindings';
import { NativeBindings, loadNativeBindings } from '../../src/bindings/native';
import { DisconnectedError, NobleError } from '../../src/common/errors';
import { flushPromises, isPending } from '../helpers/fake-bindings';

const mockLoad = jest.fn();
jest.mock('node-gyp-build', () => (dir: string) => mockLoad(dir));

const ID = 'aabbccddeeff';
const SERVICE = '180f';
const CHARACTERISTIC = '2a19';
const DESCRIPTOR = '2901';

/** The CoreBluetooth / WinRT addon surface, as jest mocks. */
const createAddon = () => ({
  eventSink: undefined as undefined | ((event: string, args: unknown[]) => void),
  start: jest.fn(),
  stop: jest.fn(),
  startScanning: jest.fn(),
  stopScanning: jest.fn(),
  connect: jest.fn(),
  cancelConnect: jest.fn(),
  disconnect: jest.fn(),
  updateRssi: jest.fn(),
  discoverServices: jest.fn(),
  discoverIncludedServices: jest.fn(),
  discoverCharacteristics: jest.fn(),
  read: jest.fn(),
  write: jest.fn(),
  notify: jest.fn(),
  discoverDescriptors: jest.fn(),
  readValue: jest.fn(),
  writeValue: jest.fn(),
  readHandle: jest.fn(),
  writeHandle: jest.fn(),
  addressToId: jest.fn()
});

const createDelegate = (): jest.Mocked<BindingsDelegate> => ({
  onStateChange: jest.fn(),
  onAddressChange: jest.fn(),
  onScanStart: jest.fn(),
  onScanStop: jest.fn(),
  onDiscover: jest.fn(),
  onConnect: jest.fn(),
  onDisconnect: jest.fn(),
  onMtu: jest.fn(),
  onRssi: jest.fn(),
  onNotification: jest.fn(),
  onHandleNotification: jest.fn(),
  onWarning: jest.fn()
});

describe('NativeBindings', () => {
  let addon: ReturnType<typeof createAddon>;
  let delegate: jest.Mocked<BindingsDelegate>;
  let bindings: NativeBindings;

  /** What the addon does when it calls `this.emit(event, ...args)`. */
  const emit = (event: string, ...args: unknown[]): void => addon.eventSink!(event, args);

  beforeEach(() => {
    addon = createAddon();
    delegate = createDelegate();
    bindings = new NativeBindings(addon as any);
    bindings.start(delegate);
  });

  describe('lifecycle', () => {
    test('start installs the event sink and starts the addon', () => {
      expect(typeof addon.eventSink).toBe('function');
      expect(addon.start).toHaveBeenCalledTimes(1);
    });

    test('stop stops the addon', () => {
      bindings.stop();

      expect(addon.stop).toHaveBeenCalledTimes(1);
    });

    test('has no reset, setAddress, setScanParameters or broadcast', () => {
      for (const method of ['reset', 'setAddress', 'setScanParameters', 'broadcast']) {
        expect((bindings as any)[method]).toBeUndefined();
      }
    });
  });

  describe('unsolicited reports', () => {
    test('stateChange', () => {
      emit('stateChange', 'poweredOn');

      expect(delegate.onStateChange).toHaveBeenCalledWith('poweredOn');
    });

    test('addressChange', () => {
      emit('addressChange', '00:11:22:33:44:55');

      expect(delegate.onAddressChange).toHaveBeenCalledWith('00:11:22:33:44:55');
    });

    test('discover maps the positional arguments to a discovery report', () => {
      const advertisement = { localName: 'thing', serviceUuids: ['180f'], serviceData: [] };

      emit('discover', ID, 'aa:bb:cc:dd:ee:ff', 'random', true, advertisement, -55);

      expect(delegate.onDiscover).toHaveBeenCalledTimes(1);
      expect(delegate.onDiscover).toHaveBeenCalledWith({
        id: ID,
        address: 'aa:bb:cc:dd:ee:ff',
        addressType: 'random',
        connectable: true,
        advertisement,
        rssi: -55
      });
    });

    test('onMtu', () => {
      emit('onMtu', ID, 185);

      expect(delegate.onMtu).toHaveBeenCalledWith(ID, 185);
    });

    test('handleNotify', () => {
      const data = Buffer.from([1]);

      emit('handleNotify', ID, 0x2a, data);

      expect(delegate.onHandleNotification).toHaveBeenCalledWith(ID, 0x2a, data);
    });

    test('scanStart and scanStop are reported even when nobody asked', () => {
      emit('scanStart');
      emit('scanStop');

      expect(delegate.onScanStart).toHaveBeenCalledTimes(1);
      expect(delegate.onScanStop).toHaveBeenCalledTimes(1);
    });

    test('an rssiUpdate nobody asked for is reported', () => {
      emit('rssiUpdate', ID, -70, null);

      expect(delegate.onRssi).toHaveBeenCalledWith(ID, -70);
    });

    test('an unknown event becomes a warning', () => {
      emit('somethingNew', 1, 2);

      expect(delegate.onWarning).toHaveBeenCalledTimes(1);
      expect(delegate.onWarning).toHaveBeenCalledWith('unhandled native event somethingNew');
    });

    test('completions nobody asked for are dropped silently', () => {
      emit('connect', ID, null);
      emit('servicesDiscover', ID, ['180f'], null);
      emit('read', ID, SERVICE, CHARACTERISTIC, Buffer.alloc(1), false, null);
      emit('write', ID, SERVICE, CHARACTERISTIC, null);

      expect(delegate.onWarning).not.toHaveBeenCalled();
      expect(delegate.onConnect).not.toHaveBeenCalled();
      expect(delegate.onNotification).not.toHaveBeenCalled();
    });

    test('events arriving before start() are ignored', () => {
      const idle = new NativeBindings(addon as any);

      expect(() => (idle as any).dispatch('stateChange', ['poweredOn'])).not.toThrow();
    });
  });

  describe('scanning', () => {
    test('startScanning forwards its arguments and resolves on scanStart', async () => {
      const scanning = bindings.startScanning(['180f'], true);

      expect(addon.startScanning).toHaveBeenCalledWith(['180f'], true);
      expect(await isPending(scanning)).toBe(true);

      emit('scanStart');

      await expect(scanning).resolves.toBeUndefined();
      expect(delegate.onScanStart).toHaveBeenCalledTimes(1);
    });

    test('stopScanning resolves on scanStop', async () => {
      const stopping = bindings.stopScanning();

      expect(addon.stopScanning).toHaveBeenCalledTimes(1);
      expect(await isPending(stopping)).toBe(true);

      emit('scanStop');

      await expect(stopping).resolves.toBeUndefined();
      expect(delegate.onScanStop).toHaveBeenCalledTimes(1);
    });

    test('the delegate hears about the scan before the request resolves', async () => {
      const order: string[] = [];
      delegate.onScanStart.mockImplementation(() => order.push('delegate'));
      const scanning = bindings.startScanning([], false).then(() => order.push('promise'));

      emit('scanStart');
      await scanning;

      expect(order).toEqual(['delegate', 'promise']);
    });

    test('a scanStart does not settle a pending stopScanning', async () => {
      const stopping = bindings.stopScanning();

      emit('scanStart');

      expect(await isPending(stopping)).toBe(true);
    });
  });

  describe('addressToId', () => {
    test('asks the addon', () => {
      addon.addressToId.mockReturnValueOnce(ID).mockReturnValueOnce(null);

      expect(bindings.addressToId('aa:bb:cc:dd:ee:ff')).toBe(ID);
      expect(bindings.addressToId('bogus')).toBeNull();
      expect(addon.addressToId).toHaveBeenCalledWith('aa:bb:cc:dd:ee:ff');
    });
  });

  describe('connections', () => {
    test('connect forwards id and options and resolves on a clean connect event', async () => {
      const options = { mtu: 185 };
      const connecting = bindings.connect(ID, options);

      expect(addon.connect).toHaveBeenCalledWith(ID, options);
      expect(await isPending(connecting)).toBe(true);

      emit('connect', ID, null);

      await expect(connecting).resolves.toBeUndefined();
    });

    test('connect rejects with the error of the connect event', async () => {
      const failure = new Error('connection failed');
      const connecting = bindings.connect(ID);

      emit('connect', ID, failure);

      await expect(connecting).rejects.toBe(failure);
    });

    test('a connect event of another peripheral settles nothing', async () => {
      const connecting = bindings.connect(ID);

      emit('connect', '112233445566', null);

      expect(await isPending(connecting)).toBe(true);
    });

    test('cancelConnect and disconnect are forwarded', () => {
      bindings.cancelConnect(ID);
      bindings.disconnect(ID);

      expect(addon.cancelConnect).toHaveBeenCalledWith(ID);
      expect(addon.disconnect).toHaveBeenCalledWith(ID);
    });

    test('a disconnect event is reported with reason "unknown"', () => {
      emit('disconnect', ID);

      expect(delegate.onDisconnect).toHaveBeenCalledTimes(1);
      expect(delegate.onDisconnect).toHaveBeenCalledWith(ID, 'unknown');
    });

    test('a disconnect event carrying a reason passes it on', () => {
      emit('disconnect', ID, 0x13);

      expect(delegate.onDisconnect).toHaveBeenCalledWith(ID, 0x13);
    });

    test('a disconnect rejects every pending request of that peripheral', async () => {
      const pending = [
        bindings.read(ID, SERVICE, CHARACTERISTIC),
        bindings.read(ID, SERVICE, CHARACTERISTIC),
        bindings.write(ID, SERVICE, CHARACTERISTIC, Buffer.alloc(1), false),
        bindings.discoverServices(ID, []),
        bindings.updateRssi(ID),
        bindings.readHandle(ID, 3)
      ];

      emit('disconnect', ID);

      for (const request of pending) {
        await expect(request).rejects.toBeInstanceOf(DisconnectedError);
        await expect(request).rejects.toMatchObject({ reason: 'unknown' });
      }
    });

    test('a disconnect leaves other peripherals and the scan requests alone', async () => {
      const otherRead = bindings.read('112233445566', SERVICE, CHARACTERISTIC);
      const scanning = bindings.startScanning([], false);

      emit('disconnect', ID);

      expect(await isPending(otherRead)).toBe(true);
      expect(await isPending(scanning)).toBe(true);

      const data = Buffer.from([1]);
      emit('read', '112233445566', SERVICE, CHARACTERISTIC, data, false, null);
      emit('scanStart');
      await expect(otherRead).resolves.toBe(data);
      await expect(scanning).resolves.toBeUndefined();
    });

    test('a completion arriving after the disconnect does not settle a later request', async () => {
      const stale = bindings.read(ID, SERVICE, CHARACTERISTIC);
      emit('disconnect', ID);
      await expect(stale).rejects.toBeInstanceOf(DisconnectedError);

      const fresh = bindings.read(ID, SERVICE, CHARACTERISTIC);
      const data = Buffer.from([2]);
      emit('read', ID, SERVICE, CHARACTERISTIC, data, false, null);

      await expect(fresh).resolves.toBe(data);
    });
  });

  describe('pair', () => {
    beforeEach(() => {
      (addon as any).pair = jest.fn();
      bindings = new NativeBindings(addon as any);
      bindings.start(delegate);
    });

    test('is absent when the addon cannot pair', () => {
      const withoutPair = new NativeBindings(createAddon() as any);

      expect(withoutPair.pair).toBeUndefined();
      expect('pair' in withoutPair).toBe(false);
    });

    test('forwards its arguments with the addon as receiver and resolves when paired', async () => {
      const pairing = bindings.pair!(ID, 8, 2);

      expect((addon as any).pair).toHaveBeenCalledWith(ID, 8, 2);
      expect((addon as any).pair.mock.contexts[0]).toBe(addon);
      expect(await isPending(pairing)).toBe(true);

      emit('pair', ID, true, null);

      await expect(pairing).resolves.toBeUndefined();
    });

    test('rejects with "pairing failed" when the addon reports paired=false without an error', async () => {
      const pairing = bindings.pair!(ID, 8, 2);

      emit('pair', ID, false, null);

      await expect(pairing).rejects.toBeInstanceOf(NobleError);
      await expect(pairing).rejects.toThrow('pairing failed');
    });

    test('rejects with the error of the pair event', async () => {
      const failure = new Error('AuthenticationFailure');
      const pairing = bindings.pair!(ID, 8, 2);

      emit('pair', ID, false, failure);

      await expect(pairing).rejects.toBe(failure);
    });

    test('an error wins even if the addon also claims paired=true', async () => {
      const failure = new Error('inconsistent');
      const pairing = bindings.pair!(ID, 8, 2);

      emit('pair', ID, true, failure);

      await expect(pairing).rejects.toBe(failure);
    });
  });

  describe('request / completion pairs', () => {
    const data = Buffer.from([1, 2, 3]);
    const failure = new Error('native failure');
    const characteristics = [{ uuid: CHARACTERISTIC, properties: ['read', 'notify'] }];

    interface Pair {
      name: string;
      request: () => Promise<unknown>;
      /** The addon method that must be called, with these arguments. */
      native: [string, unknown[]];
      /** Event name, then the arguments of a successful and of a failed completion. */
      event: string;
      ok: unknown[];
      fail: unknown[];
      value: unknown;
    }

    const pairs: Pair[] = [
      {
        name: 'updateRssi / rssiUpdate',
        request: () => bindings.updateRssi(ID),
        native: ['updateRssi', [ID]],
        event: 'rssiUpdate',
        ok: [ID, -67, null],
        fail: [ID, 0, failure],
        value: -67
      },
      {
        name: 'discoverServices / servicesDiscover',
        request: () => bindings.discoverServices(ID, ['180f']),
        native: ['discoverServices', [ID, ['180f']]],
        event: 'servicesDiscover',
        ok: [ID, ['180f', '180a'], null],
        fail: [ID, [], failure],
        value: ['180f', '180a']
      },
      {
        name: 'discoverIncludedServices / includedServicesDiscover',
        request: () => bindings.discoverIncludedServices(ID, SERVICE, ['180a']),
        native: ['discoverIncludedServices', [ID, SERVICE, ['180a']]],
        event: 'includedServicesDiscover',
        ok: [ID, SERVICE, ['180a'], null],
        fail: [ID, SERVICE, [], failure],
        value: ['180a']
      },
      {
        name: 'discoverCharacteristics / characteristicsDiscover',
        request: () => bindings.discoverCharacteristics(ID, SERVICE, [CHARACTERISTIC]),
        native: ['discoverCharacteristics', [ID, SERVICE, [CHARACTERISTIC]]],
        event: 'characteristicsDiscover',
        ok: [ID, SERVICE, characteristics, null],
        fail: [ID, SERVICE, [], failure],
        value: characteristics
      },
      {
        name: 'read / read',
        request: () => bindings.read(ID, SERVICE, CHARACTERISTIC),
        native: ['read', [ID, SERVICE, CHARACTERISTIC]],
        event: 'read',
        ok: [ID, SERVICE, CHARACTERISTIC, data, false, null],
        fail: [ID, SERVICE, CHARACTERISTIC, null, false, failure],
        value: data
      },
      {
        name: 'write / write',
        request: () => bindings.write(ID, SERVICE, CHARACTERISTIC, data, true),
        native: ['write', [ID, SERVICE, CHARACTERISTIC, data, true]],
        event: 'write',
        ok: [ID, SERVICE, CHARACTERISTIC, null],
        fail: [ID, SERVICE, CHARACTERISTIC, failure],
        value: undefined
      },
      {
        name: 'notify / notify',
        request: () => bindings.notify(ID, SERVICE, CHARACTERISTIC, true),
        native: ['notify', [ID, SERVICE, CHARACTERISTIC, true]],
        event: 'notify',
        ok: [ID, SERVICE, CHARACTERISTIC, true, null],
        fail: [ID, SERVICE, CHARACTERISTIC, false, failure],
        value: undefined
      },
      {
        name: 'discoverDescriptors / descriptorsDiscover',
        request: () => bindings.discoverDescriptors(ID, SERVICE, CHARACTERISTIC),
        native: ['discoverDescriptors', [ID, SERVICE, CHARACTERISTIC]],
        event: 'descriptorsDiscover',
        ok: [ID, SERVICE, CHARACTERISTIC, ['2901', '2902'], null],
        fail: [ID, SERVICE, CHARACTERISTIC, [], failure],
        value: ['2901', '2902']
      },
      {
        name: 'readValue / valueRead',
        request: () => bindings.readValue(ID, SERVICE, CHARACTERISTIC, DESCRIPTOR),
        native: ['readValue', [ID, SERVICE, CHARACTERISTIC, DESCRIPTOR]],
        event: 'valueRead',
        ok: [ID, SERVICE, CHARACTERISTIC, DESCRIPTOR, data, null],
        fail: [ID, SERVICE, CHARACTERISTIC, DESCRIPTOR, null, failure],
        value: data
      },
      {
        name: 'writeValue / valueWrite',
        request: () => bindings.writeValue(ID, SERVICE, CHARACTERISTIC, DESCRIPTOR, data),
        native: ['writeValue', [ID, SERVICE, CHARACTERISTIC, DESCRIPTOR, data]],
        event: 'valueWrite',
        ok: [ID, SERVICE, CHARACTERISTIC, DESCRIPTOR, null],
        fail: [ID, SERVICE, CHARACTERISTIC, DESCRIPTOR, failure],
        value: undefined
      },
      {
        name: 'readHandle / handleRead',
        request: () => bindings.readHandle(ID, 0x2a),
        native: ['readHandle', [ID, 0x2a]],
        event: 'handleRead',
        ok: [ID, 0x2a, data, null],
        fail: [ID, 0x2a, null, failure],
        value: data
      },
      {
        name: 'writeHandle / handleWrite',
        request: () => bindings.writeHandle(ID, 0x2a, data, false),
        native: ['writeHandle', [ID, 0x2a, data, false]],
        event: 'handleWrite',
        ok: [ID, 0x2a, null],
        fail: [ID, 0x2a, failure],
        value: undefined
      }
    ];

    describe.each(pairs)('$name', ({ request, native, event, ok, fail, value }) => {
      test('calls the addon and stays pending until the completion arrives', async () => {
        const pending = request();

        expect((addon as any)[native[0]]).toHaveBeenCalledTimes(1);
        expect((addon as any)[native[0]]).toHaveBeenCalledWith(...native[1]);
        expect(await isPending(pending)).toBe(true);

        emit(event, ...ok);
        await pending;
      });

      test('resolves with the value of the completion', async () => {
        const pending = request();

        emit(event, ...ok);

        await expect(pending).resolves.toEqual(value);
      });

      test('rejects with the error of the completion', async () => {
        const pending = request();

        emit(event, ...fail);

        await expect(pending).rejects.toBe(failure);
      });

      test('ignores the completion of another peripheral', async () => {
        const pending = request();

        emit(event, '112233445566', ...ok.slice(1));

        expect(await isPending(pending)).toBe(true);
      });

      test('a synchronous throw of the addon rejects the request and leaves nothing pending', async () => {
        const thrown = new Error('bad argument');
        (addon as any)[native[0]].mockImplementationOnce(() => {
          throw thrown;
        });

        await expect(request()).rejects.toBe(thrown);

        // The failed request must not swallow the completion of the next one.
        const retry = request();
        emit(event, ...ok);
        await expect(retry).resolves.toEqual(value);
      });
    });

    test('a failed rssiUpdate is not reported to the delegate', async () => {
      const pending = bindings.updateRssi(ID);

      emit('rssiUpdate', ID, 0, failure);

      await expect(pending).rejects.toBe(failure);
      expect(delegate.onRssi).not.toHaveBeenCalled();
    });

    test('a successful rssiUpdate is also reported to the delegate', async () => {
      const pending = bindings.updateRssi(ID);

      emit('rssiUpdate', ID, -67, null);

      await pending;
      expect(delegate.onRssi).toHaveBeenCalledWith(ID, -67);
    });

    test('a synchronous throw of something that is not an Error is wrapped in a NobleError', async () => {
      addon.read.mockImplementationOnce(() => {
        // eslint-disable-next-line no-throw-literal
        throw 'plain string';
      });

      const reading = bindings.read(ID, SERVICE, CHARACTERISTIC);

      await expect(reading).rejects.toBeInstanceOf(NobleError);
      await expect(reading).rejects.toThrow('plain string');
    });

    test('a synchronous throw of startScanning rejects', async () => {
      addon.startScanning.mockImplementationOnce(() => {
        throw new Error('bad uuid');
      });

      await expect(bindings.startScanning(['zz'], false)).rejects.toThrow('bad uuid');
    });
  });

  describe('matching completions to requests', () => {
    test('two identical concurrent requests are settled first in, first out', async () => {
      const first = bindings.read(ID, SERVICE, CHARACTERISTIC);
      const second = bindings.read(ID, SERVICE, CHARACTERISTIC);
      const one = Buffer.from([1]);
      const two = Buffer.from([2]);

      emit('read', ID, SERVICE, CHARACTERISTIC, one, false, null);
      await expect(first).resolves.toBe(one);
      expect(await isPending(second)).toBe(true);

      emit('read', ID, SERVICE, CHARACTERISTIC, two, false, null);
      await expect(second).resolves.toBe(two);
    });

    test('an error completion only fails the oldest of two identical requests', async () => {
      const first = bindings.write(ID, SERVICE, CHARACTERISTIC, Buffer.alloc(1), false);
      const second = bindings.write(ID, SERVICE, CHARACTERISTIC, Buffer.alloc(1), false);

      emit('write', ID, SERVICE, CHARACTERISTIC, new Error('first failed'));
      emit('write', ID, SERVICE, CHARACTERISTIC, null);

      await expect(first).rejects.toThrow('first failed');
      await expect(second).resolves.toBeUndefined();
    });

    test('requests for different characteristics are matched independently of their order', async () => {
      const level = bindings.read(ID, SERVICE, '2a19');
      const other = bindings.read(ID, SERVICE, '2a1a');
      const otherData = Buffer.from([2]);

      emit('read', ID, SERVICE, '2a1a', otherData, false, null);

      await expect(other).resolves.toBe(otherData);
      expect(await isPending(level)).toBe(true);
    });

    test('different kinds of request on the same characteristic do not collide', async () => {
      const reading = bindings.read(ID, SERVICE, CHARACTERISTIC);
      const writing = bindings.write(ID, SERVICE, CHARACTERISTIC, Buffer.alloc(1), false);
      const subscribing = bindings.notify(ID, SERVICE, CHARACTERISTIC, true);

      emit('notify', ID, SERVICE, CHARACTERISTIC, true, null);
      await expect(subscribing).resolves.toBeUndefined();
      expect(await isPending(reading)).toBe(true);
      expect(await isPending(writing)).toBe(true);

      emit('write', ID, SERVICE, CHARACTERISTIC, null);
      await expect(writing).resolves.toBeUndefined();
      expect(await isPending(reading)).toBe(true);
    });

    test('handles are told apart', async () => {
      const three = bindings.readHandle(ID, 3);
      const thirty = bindings.readHandle(ID, 30);
      const data = Buffer.from([30]);

      emit('handleRead', ID, 30, data, null);

      await expect(thirty).resolves.toBe(data);
      expect(await isPending(three)).toBe(true);
    });

    test('uuids are matched regardless of dashes and case (the addons answer lowercase, undashed)', async () => {
      const service = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
      const characteristic = '6E400003-B5A3-F393-E0A9-E50E24DCCA9E';
      const reading = bindings.read(ID, service, characteristic);
      const data = Buffer.from([1]);

      expect(addon.read).toHaveBeenCalledWith(ID, service, characteristic);
      emit('read', ID, '6e400001b5a3f393e0a9e50e24dcca9e', '6e400003b5a3f393e0a9e50e24dcca9e', data, false, null);

      await expect(reading).resolves.toBe(data);
    });

    test('a dashed, uppercase peripheral id is matched too', async () => {
      const connecting = bindings.connect('0A1B2C3D-0000-1111-2222-333344445555');

      emit('connect', '0a1b2c3d000011112222333344445555', null);

      await expect(connecting).resolves.toBeUndefined();
    });

    test('a disconnect rejects pending requests issued with a dashed, uppercase peripheral id', async () => {
      const reading = bindings.read('0A1B2C3D-0000-1111-2222-333344445555', SERVICE, CHARACTERISTIC);

      emit('disconnect', '0a1b2c3d000011112222333344445555');

      await expect(reading).rejects.toBeInstanceOf(DisconnectedError);
    });

    // cancelConnect() only forwards to the addon. The WinRT addon answers a
    // cancelled attempt with no event at all, so the abandoned request stays at
    // the head of the 'connect' queue and swallows the completion of the next
    // attempt, whose own request then never settles.
    test('the completion of a new connect is not consumed by an attempt that was cancelled', async () => {
      const cancelled = bindings.connect(ID);
      cancelled.catch(() => {});
      bindings.cancelConnect(ID);

      const retry = bindings.connect(ID);
      emit('connect', ID, null);

      expect(await isPending(retry)).toBe(false);
    });
  });

  describe('notifications arriving as read events', () => {
    test('a read event flagged isNotification goes to the delegate', () => {
      const data = Buffer.from([0x64]);

      emit('read', ID, SERVICE, CHARACTERISTIC, data, true, null);

      expect(delegate.onNotification).toHaveBeenCalledTimes(1);
      expect(delegate.onNotification).toHaveBeenCalledWith(ID, SERVICE, CHARACTERISTIC, data);
    });

    test('a notification does not settle a pending read of the same characteristic', async () => {
      const reading = bindings.read(ID, SERVICE, CHARACTERISTIC);
      const notified = Buffer.from([1]);
      const readValue = Buffer.from([2]);

      emit('read', ID, SERVICE, CHARACTERISTIC, notified, true, null);
      expect(await isPending(reading)).toBe(true);

      emit('read', ID, SERVICE, CHARACTERISTIC, readValue, false, null);
      await expect(reading).resolves.toBe(readValue);
      expect(delegate.onNotification).toHaveBeenCalledTimes(1);
      expect(delegate.onNotification).toHaveBeenCalledWith(ID, SERVICE, CHARACTERISTIC, notified);
    });

    test('a read completion is not reported as a notification', async () => {
      const reading = bindings.read(ID, SERVICE, CHARACTERISTIC);

      emit('read', ID, SERVICE, CHARACTERISTIC, Buffer.alloc(1), false, null);
      await reading;

      expect(delegate.onNotification).not.toHaveBeenCalled();
    });
  });
});

describe('loadNativeBindings', () => {
  /** A fresh addon class per test: loadNativeBindings patches the prototype. */
  const createAddonClass = () => {
    class Addon {
      static instances: Addon[] = [];
      eventSink?: (event: string, args: unknown[]) => void;
      options: unknown;
      start = jest.fn();
      stop = jest.fn();

      constructor (options: unknown) {
        this.options = options;
        Addon.instances.push(this);
      }
    }
    return Addon;
  };

  beforeEach(() => {
    mockLoad.mockReset();
  });

  test('loads the addon from the package root', () => {
    mockLoad.mockReturnValue({ NobleMac: createAddonClass(), NobleWinrt: createAddonClass() });

    loadNativeBindings('NobleMac');

    expect(mockLoad).toHaveBeenCalledTimes(1);
    expect(mockLoad).toHaveBeenCalledWith(resolve(__dirname, '..', '..'));
  });

  test.each(['NobleMac', 'NobleWinrt'] as const)('wraps a %s instance built with the given options', name => {
    const Mac = createAddonClass();
    const Winrt = createAddonClass();
    mockLoad.mockReturnValue({ NobleMac: Mac, NobleWinrt: Winrt });
    const options = { some: 'option' };

    const bindings = loadNativeBindings(name, options);

    const [used, unused] = name === 'NobleMac' ? [Mac, Winrt] : [Winrt, Mac];
    expect(bindings).toBeInstanceOf(NativeBindings);
    expect(used.instances).toHaveLength(1);
    expect(used.instances[0].options).toBe(options);
    expect(unused.instances).toHaveLength(0);
  });

  test('options default to an empty object', () => {
    const Mac = createAddonClass();
    mockLoad.mockReturnValue({ NobleMac: Mac });

    loadNativeBindings('NobleMac');

    expect(Mac.instances[0].options).toEqual({});
  });

  test('patches an emit onto the addon prototype that forwards to the delegate', () => {
    const Mac = createAddonClass();
    mockLoad.mockReturnValue({ NobleMac: Mac });
    const delegate = createDelegate();

    const bindings = loadNativeBindings('NobleMac');
    expect(typeof (Mac.prototype as any).emit).toBe('function');
    bindings.start(delegate);

    const instance = Mac.instances[0] as any;
    expect(instance.start).toHaveBeenCalledTimes(1);
    instance.emit('stateChange', 'poweredOn');
    instance.emit('discover', 'aabb', 'aa:bb', 'public', true, { serviceUuids: [], serviceData: [] }, -50);

    expect(delegate.onStateChange).toHaveBeenCalledWith('poweredOn');
    expect(delegate.onDiscover).toHaveBeenCalledWith(expect.objectContaining({ id: 'aabb', rssi: -50 }));
  });

  test('the patched emit settles requests', async () => {
    const Mac = createAddonClass();
    (Mac.prototype as any).connect = jest.fn();
    mockLoad.mockReturnValue({ NobleMac: Mac });
    const bindings = loadNativeBindings('NobleMac');
    bindings.start(createDelegate());

    const connecting = bindings.connect('aabb');
    (Mac.instances[0] as any).emit('connect', 'aabb', null);

    await expect(connecting).resolves.toBeUndefined();
  });

  test('events emitted before start() are dropped without throwing', async () => {
    const Mac = createAddonClass();
    mockLoad.mockReturnValue({ NobleMac: Mac });

    loadNativeBindings('NobleMac');

    expect(() => (Mac.instances[0] as any).emit('stateChange', 'poweredOn')).not.toThrow();
    await flushPromises();
  });

  test('the emit is already in place while the addon constructor runs', () => {
    // The real addons capture `this.emit` in their constructor.
    let emitDuringConstruction: unknown;
    class Mac {
      constructor () {
        emitDuringConstruction = (this as any).emit;
      }
    }
    mockLoad.mockReturnValue({ NobleMac: Mac });

    loadNativeBindings('NobleMac');

    expect(typeof emitDuringConstruction).toBe('function');
  });

  test('pair is exposed exactly when the loaded addon has it', () => {
    const Mac = createAddonClass();
    const Winrt = createAddonClass();
    (Winrt.prototype as any).pair = jest.fn();
    mockLoad.mockReturnValue({ NobleMac: Mac, NobleWinrt: Winrt });

    expect(loadNativeBindings('NobleMac').pair).toBeUndefined();
    expect(typeof loadNativeBindings('NobleWinrt').pair).toBe('function');
  });

  test('an emit the prototype already has is left alone', () => {
    const Mac = createAddonClass();
    const existing = jest.fn();
    (Mac.prototype as any).emit = existing;
    mockLoad.mockReturnValue({ NobleMac: Mac });

    loadNativeBindings('NobleMac');

    expect((Mac.prototype as any).emit).toBe(existing);
  });

  test('loading twice patches once and keeps both instances independent', () => {
    const Mac = createAddonClass();
    mockLoad.mockReturnValue({ NobleMac: Mac });
    const first = loadNativeBindings('NobleMac');
    const patched = (Mac.prototype as any).emit;
    const second = loadNativeBindings('NobleMac');
    const firstDelegate = createDelegate();
    const secondDelegate = createDelegate();
    first.start(firstDelegate);
    second.start(secondDelegate);

    (Mac.instances[1] as any).emit('stateChange', 'poweredOff');

    expect((Mac.prototype as any).emit).toBe(patched);
    expect(firstDelegate.onStateChange).not.toHaveBeenCalled();
    expect(secondDelegate.onStateChange).toHaveBeenCalledWith('poweredOff');
  });
});
