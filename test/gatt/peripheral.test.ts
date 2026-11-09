import {
  ConnectionCancelledError,
  DisconnectedError,
  NobleError,
  NotSupportedError
} from '../../src/common/errors';
import { Characteristic } from '../../src/gatt/characteristic';
import { Peripheral } from '../../src/gatt/peripheral';
import { Service } from '../../src/gatt/service';
import { PeripheralSession } from '../../src/gatt/session';
import { DevicePairingKinds, DevicePairingProtectionLevel } from '../../src/types';
import { Deferred, FakeBindings, discovery, flushPromises, isPending } from '../helpers/fake-bindings';

const ID = 'aabbccddeeff';

describe('Peripheral', () => {
  let bindings: FakeBindings;
  let session: PeripheralSession;
  let peripheral: Peripheral;

  beforeEach(() => {
    bindings = new FakeBindings();
    session = new PeripheralSession(bindings, ID);
    peripheral = new Peripheral(session, discovery());
  });

  /** Brings the link up the way Noble would observe it. */
  const connect = async (): Promise<void> => {
    await peripheral.connect();
  };

  describe('construction', () => {
    test('exposes the discovery report', () => {
      const advertisement = { localName: 'thing', serviceUuids: ['180f'], serviceData: [] };
      peripheral = new Peripheral(session, discovery({
        address: '11:22:33:44:55:66',
        addressType: 'random',
        connectable: false,
        scannable: true,
        advertisement,
        rssi: -42
      }));

      expect(peripheral.id).toBe(ID);
      expect(peripheral.address).toBe('11:22:33:44:55:66');
      expect(peripheral.addressType).toBe('random');
      expect(peripheral.connectable).toBe(false);
      expect(peripheral.scannable).toBe(true);
      expect(peripheral.advertisement).toEqual(advertisement);
      expect(peripheral.rssi).toBe(-42);
    });

    test('starts disconnected, without mtu or services', () => {
      expect(peripheral.state).toBe('disconnected');
      expect(peripheral.mtu).toBeNull();
      expect(peripheral.services).toBeNull();
    });

    test('scannable defaults to false when the binding does not report it', () => {
      const report = discovery();
      delete report.scannable;

      expect(new Peripheral(session, report).scannable).toBe(false);
    });
  });

  describe('advertisement updates', () => {
    test('later reports override only the advertisement fields they carry', () => {
      const manufacturerData = Buffer.from([1, 2]);
      session.advertised.emit(discovery({
        advertisement: { manufacturerData, serviceUuids: ['180f'], serviceData: [], localName: undefined }
      }));

      expect(peripheral.advertisement).toEqual({
        localName: 'device',
        manufacturerData,
        serviceUuids: ['180f'],
        serviceData: []
      });
    });

    test('updates rssi, connectable and scannable', () => {
      const update = discovery({ connectable: false, rssi: -90 });
      delete update.scannable;

      session.advertised.emit(update);

      expect(peripheral.rssi).toBe(-90);
      expect(peripheral.connectable).toBe(false);
      expect(peripheral.scannable).toBe(false);
    });

    test('adopts address and address type only when the report carries an address', () => {
      peripheral = new Peripheral(session, discovery({ address: '', addressType: 'unknown' }));

      session.advertised.emit(discovery({ address: '', addressType: 'random' }));
      expect(peripheral.address).toBe('');
      expect(peripheral.addressType).toBe('unknown');

      session.advertised.emit(discovery({ address: '11:22:33:44:55:66', addressType: 'random' }));
      expect(peripheral.address).toBe('11:22:33:44:55:66');
      expect(peripheral.addressType).toBe('random');
    });

    test('does not mutate the advertisement object handed out earlier', () => {
      const before = peripheral.advertisement;

      session.advertised.emit(discovery({ advertisement: { localName: 'renamed', serviceUuids: [], serviceData: [] } }));

      expect(before.localName).toBe('device');
      expect(peripheral.advertisement.localName).toBe('renamed');
    });
  });

  describe('connect', () => {
    test('forwards id and options to the bindings and ends up connected', async () => {
      const options = { addressType: 'random' as const, mtu: 185 };

      await expect(peripheral.connect(options)).resolves.toBeUndefined();

      expect(bindings.connect).toHaveBeenCalledTimes(1);
      expect(bindings.connect).toHaveBeenCalledWith(ID, options);
      expect(peripheral.state).toBe('connected');
    });

    test('is "connecting" while the attempt is in flight', async () => {
      const pending = new Deferred<void>();
      bindings.connect.mockReturnValueOnce(pending.promise);

      const connecting = peripheral.connect();
      expect(peripheral.state).toBe('connecting');

      pending.resolve();
      await connecting;
      expect(peripheral.state).toBe('connected');
    });

    test('a failed attempt rejects with the binding error and leaves the state "error"', async () => {
      const failure = new Error('connection refused');
      bindings.connect.mockRejectedValueOnce(failure);

      await expect(peripheral.connect()).rejects.toBe(failure);

      expect(peripheral.state).toBe('error');
    });

    test('can be retried after a failure', async () => {
      bindings.connect.mockRejectedValueOnce(new Error('connection refused'));
      await expect(peripheral.connect()).rejects.toThrow('connection refused');

      await peripheral.connect();

      expect(bindings.connect).toHaveBeenCalledTimes(2);
      expect(peripheral.state).toBe('connected');
    });

    test('rejects when already connected, without touching the bindings or the state', async () => {
      await connect();
      bindings.connect.mockClear();

      const second = peripheral.connect();

      await expect(second).rejects.toBeInstanceOf(NobleError);
      await expect(second).rejects.toThrow('Peripheral already connected');
      expect(bindings.connect).not.toHaveBeenCalled();
      expect(peripheral.state).toBe('connected');
    });

    test('concurrent calls share one attempt', async () => {
      const pending = new Deferred<void>();
      bindings.connect.mockReturnValueOnce(pending.promise);

      const first = peripheral.connect();
      const second = peripheral.connect({ mtu: 100 });

      expect(second).toBe(first);
      expect(bindings.connect).toHaveBeenCalledTimes(1);

      pending.resolve();
      await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    });

    test('concurrent callers all see the failure of the shared attempt', async () => {
      const pending = new Deferred<void>();
      bindings.connect.mockReturnValueOnce(pending.promise);
      const first = peripheral.connect();
      const second = peripheral.connect();

      pending.reject(new Error('nope'));

      await expect(first).rejects.toThrow('nope');
      await expect(second).rejects.toThrow('nope');
    });

    test('a link loss reported during the attempt rejects with DisconnectedError and state "disconnected"', async () => {
      bindings.connect.mockReturnValueOnce(new Deferred<void>().promise);
      const onDisconnect = jest.fn();
      peripheral.onDisconnect(onDisconnect);

      const connecting = peripheral.connect();
      session.disconnected.emit(0x3e);

      await expect(connecting).rejects.toBeInstanceOf(DisconnectedError);
      await expect(connecting).rejects.toMatchObject({ reason: 0x3e });
      expect(peripheral.state).toBe('disconnected');
      // No link ever existed: the rejection is the report, not onDisconnect.
      expect(onDisconnect).not.toHaveBeenCalled();
    });

    test('an unsolicited link reported by the bindings marks the peripheral connected', () => {
      session.connected.emit();

      expect(peripheral.state).toBe('connected');
    });
  });

  describe('cancelConnect', () => {
    test('rejects the pending attempt with ConnectionCancelledError and returns to "disconnected"', async () => {
      bindings.connect.mockReturnValueOnce(new Deferred<void>().promise);
      const connecting = peripheral.connect();

      peripheral.cancelConnect();

      await expect(connecting).rejects.toBeInstanceOf(ConnectionCancelledError);
      await expect(connecting).rejects.toThrow('connection canceled!');
      expect(bindings.cancelConnect).toHaveBeenCalledTimes(1);
      expect(bindings.cancelConnect).toHaveBeenCalledWith(ID);
      expect(peripheral.state).toBe('disconnected');
    });

    test('is a no-op when no attempt is pending', async () => {
      peripheral.cancelConnect();
      expect(bindings.cancelConnect).not.toHaveBeenCalled();

      await connect();
      peripheral.cancelConnect();
      expect(bindings.cancelConnect).not.toHaveBeenCalled();
      expect(peripheral.state).toBe('connected');
    });

    test('a new attempt can be started once the cancelled one has settled', async () => {
      bindings.connect.mockReturnValueOnce(new Deferred<void>().promise);
      const cancelled = peripheral.connect();
      peripheral.cancelConnect();
      await expect(cancelled).rejects.toBeInstanceOf(ConnectionCancelledError);

      await peripheral.connect();

      expect(bindings.connect).toHaveBeenCalledTimes(2);
      expect(peripheral.state).toBe('connected');
    });

    // cancelConnect() rejects the attempt but `pendingConnect` is only cleared a
    // microtask later, so a connect() issued in the same tick is handed the
    // attempt that was just cancelled.
    test('[BUG] connect() right after cancelConnect() starts a fresh attempt', async () => {
      bindings.connect.mockReturnValueOnce(new Deferred<void>().promise);
      const cancelled = peripheral.connect();
      cancelled.catch(() => {});

      peripheral.cancelConnect();
      const retry = peripheral.connect();
      retry.catch(() => {});

      await expect(cancelled).rejects.toBeInstanceOf(ConnectionCancelledError);
      await expect(retry).resolves.toBeUndefined();
      expect(bindings.connect).toHaveBeenCalledTimes(2);
    });

    // The binding is allowed to lose the race: the link may come up although
    // cancelConnect() was called. The peripheral then reports 'disconnected'
    // while the binding holds a live link nobody will ever tear down.
    test('[BUG] a connect that completes despite the cancellation does not leave an orphaned link', async () => {
      const pending = new Deferred<void>();
      bindings.connect.mockReturnValueOnce(pending.promise);
      const connecting = peripheral.connect();

      peripheral.cancelConnect();
      await expect(connecting).rejects.toBeInstanceOf(ConnectionCancelledError);
      pending.resolve();
      await flushPromises();

      const linkIsTracked = peripheral.state === 'connected';
      const linkWasDropped = bindings.disconnect.mock.calls.length > 0;
      expect(linkIsTracked || linkWasDropped).toBe(true);
    });
  });

  describe('disconnect', () => {
    test('is a no-op when there is no link', async () => {
      await expect(peripheral.disconnect()).resolves.toBeUndefined();

      expect(bindings.disconnect).not.toHaveBeenCalled();
      expect(peripheral.state).toBe('disconnected');
    });

    test('requests the disconnect and resolves once the bindings report it', async () => {
      await connect();
      const onDisconnect = jest.fn();
      peripheral.onDisconnect(onDisconnect);

      const disconnecting = peripheral.disconnect();

      expect(bindings.disconnect).toHaveBeenCalledWith(ID);
      expect(peripheral.state).toBe('disconnecting');
      expect(await isPending(disconnecting)).toBe(true);

      session.disconnected.emit(0x16);

      await expect(disconnecting).resolves.toBeUndefined();
      expect(peripheral.state).toBe('disconnected');
      expect(onDisconnect).toHaveBeenCalledTimes(1);
      expect(onDisconnect).toHaveBeenCalledWith(0x16);
    });

    test('concurrent calls request the disconnect once and all resolve', async () => {
      await connect();

      const first = peripheral.disconnect();
      const second = peripheral.disconnect();
      expect(bindings.disconnect).toHaveBeenCalledTimes(1);

      session.disconnected.emit('remote');

      await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    });

    test('while connecting it cancels the attempt and resolves immediately', async () => {
      bindings.connect.mockReturnValueOnce(new Deferred<void>().promise);
      const connecting = peripheral.connect();

      await expect(peripheral.disconnect()).resolves.toBeUndefined();

      await expect(connecting).rejects.toBeInstanceOf(ConnectionCancelledError);
      expect(bindings.cancelConnect).toHaveBeenCalledWith(ID);
      expect(bindings.disconnect).not.toHaveBeenCalled();
      expect(peripheral.state).toBe('disconnected');
    });

    test('the peripheral can reconnect afterwards', async () => {
      await connect();
      const disconnecting = peripheral.disconnect();
      session.disconnected.emit('remote');
      await disconnecting;

      await peripheral.connect();

      expect(peripheral.state).toBe('connected');
      expect(bindings.connect).toHaveBeenCalledTimes(2);
    });

    // connect() does not look at 'disconnecting'. It flips the state to
    // 'connecting', so when the awaited disconnect report arrives the peripheral
    // believes no link ever existed and swallows the onDisconnect notification.
    test('[BUG] connect() while disconnecting does not swallow the onDisconnect notification', async () => {
      await connect();
      const onDisconnect = jest.fn();
      peripheral.onDisconnect(onDisconnect);
      const disconnecting = peripheral.disconnect();
      bindings.connect.mockReturnValueOnce(new Deferred<void>().promise);

      peripheral.connect().catch(() => {});
      session.disconnected.emit('remote');
      await disconnecting;

      expect(onDisconnect).toHaveBeenCalledWith('remote');
    });
  });

  describe('onDisconnect', () => {
    test('reports an unsolicited link loss with its reason', async () => {
      await connect();
      const listener = jest.fn();
      peripheral.onDisconnect(listener);

      session.disconnected.emit(0x08);

      expect(listener).toHaveBeenCalledWith(0x08);
      expect(peripheral.state).toBe('disconnected');
    });

    test('is not called for a peripheral that never had a link', () => {
      const listener = jest.fn();
      peripheral.onDisconnect(listener);

      session.disconnected.emit('cleanup');

      expect(listener).not.toHaveBeenCalled();
    });

    test('returns an unsubscribe function', async () => {
      await connect();
      const listener = jest.fn();
      const unsubscribe = peripheral.onDisconnect(listener);

      unsubscribe();
      session.disconnected.emit('remote');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('guard: operations in flight when the link drops', () => {
    const operations: Array<[string, keyof FakeBindings, (p: Peripheral) => Promise<unknown>]> = [
      ['updateRssi', 'updateRssi', p => p.updateRssi()],
      ['discoverServices', 'discoverServices', p => p.discoverServices()],
      ['discoverSomeServicesAndCharacteristics', 'discoverServices', p => p.discoverSomeServicesAndCharacteristics(['180f'], [])],
      ['readHandle', 'readHandle', p => p.readHandle(3)],
      ['writeHandle', 'writeHandle', p => p.writeHandle(3, Buffer.from([1]))]
    ];

    test.each(operations)('%s rejects with DisconnectedError carrying the reason', async (_name, method, run) => {
      await connect();
      (bindings[method] as jest.Mock).mockReturnValueOnce(new Deferred<never>().promise);

      const operation = run(peripheral);
      session.disconnected.emit(0x13);

      await expect(operation).rejects.toBeInstanceOf(DisconnectedError);
      await expect(operation).rejects.toMatchObject({ reason: 0x13, message: 'Disconnected 19' });
    });

    test('a late answer from the bindings after the link dropped is ignored', async () => {
      await connect();
      const pending = new Deferred<Buffer>();
      bindings.readHandle.mockReturnValueOnce(pending.promise);

      const read = peripheral.readHandle(1);
      session.disconnected.emit('remote');
      pending.resolve(Buffer.from([1]));

      await expect(read).rejects.toBeInstanceOf(DisconnectedError);
    });

    test('an operation that settled before the drop is unaffected and leaves no listener behind', async () => {
      await connect();
      bindings.readHandle.mockResolvedValueOnce(Buffer.from([7]));

      await expect(peripheral.readHandle(1)).resolves.toEqual(Buffer.from([7]));
      const listenersBefore = (session.disconnected as any).listeners.size;
      await peripheral.readHandle(1);

      expect((session.disconnected as any).listeners.size).toBe(listenersBefore);
    });
  });

  describe('pair', () => {
    test('defaults to ConfirmOnly and Encryption', async () => {
      await expect(peripheral.pair()).resolves.toBeUndefined();

      expect(bindings.pair).toHaveBeenCalledWith(
        ID, DevicePairingKinds.ConfirmOnly, DevicePairingProtectionLevel.Encryption);
    });

    test('forwards an explicit kind bitmask and protection level', async () => {
      const kind = DevicePairingKinds.ConfirmOnly | DevicePairingKinds.ProvidePin;

      await peripheral.pair(kind, DevicePairingProtectionLevel.EncryptionAndAuthentication);

      expect(bindings.pair).toHaveBeenCalledWith(ID, kind, DevicePairingProtectionLevel.EncryptionAndAuthentication);
    });

    test('accepts the uint32 boundaries', async () => {
      await peripheral.pair(0xffffffff, DevicePairingProtectionLevel.Default);

      expect(bindings.pair).toHaveBeenCalledWith(ID, 0xffffffff, 0);
    });

    test.each([
      ['negative', -1],
      ['fractional', 8.5],
      ['too large', 0x100000000],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['a string', '8'],
      ['null', null]
    ])('rejects a kind that is %s', async (_label, kind) => {
      await expect(peripheral.pair(kind as any)).rejects.toThrow(
        new TypeError('pair() kind must be a finite uint32 DevicePairingKinds bitmask'));
      expect(bindings.pair).not.toHaveBeenCalled();
    });

    test('rejects DevicePairingKinds.None', async () => {
      const pairing = peripheral.pair(DevicePairingKinds.None);

      await expect(pairing).rejects.toBeInstanceOf(TypeError);
      await expect(pairing).rejects.toThrow('DevicePairingKinds.None matches no ceremony');
      expect(bindings.pair).not.toHaveBeenCalled();
    });

    test.each([
      ['negative', -1],
      ['fractional', 1.5],
      ['too large', 0x100000000],
      ['a string', '2']
    ])('rejects a protection level that is %s', async (_label, level) => {
      await expect(peripheral.pair(DevicePairingKinds.ConfirmOnly, level as any)).rejects.toThrow(
        new TypeError('pair() protectionLevel must be a finite uint32 DevicePairingProtectionLevel'));
      expect(bindings.pair).not.toHaveBeenCalled();
    });

    test('rejects with NotSupportedError when the bindings cannot pair', async () => {
      delete bindings.pair;

      const pairing = peripheral.pair();

      await expect(pairing).rejects.toBeInstanceOf(NotSupportedError);
      await expect(pairing).rejects.toThrow('Pairing is not supported on this platform');
    });

    test('arguments are validated before platform support is checked', async () => {
      delete bindings.pair;

      await expect(peripheral.pair(-1)).rejects.toBeInstanceOf(TypeError);
    });

    test('propagates a pairing failure from the bindings', async () => {
      bindings.pair!.mockRejectedValueOnce(new Error('pairing failed'));

      await expect(peripheral.pair()).rejects.toThrow('pairing failed');
    });
  });

  describe('updateRssi', () => {
    test('resolves with the value read from the bindings and remembers it', async () => {
      bindings.updateRssi.mockResolvedValueOnce(-71);

      await expect(peripheral.updateRssi()).resolves.toBe(-71);

      expect(bindings.updateRssi).toHaveBeenCalledWith(ID);
      expect(peripheral.rssi).toBe(-71);
    });

    test('leaves the rssi untouched when the read fails', async () => {
      bindings.updateRssi.mockRejectedValueOnce(new Error('not connected'));

      await expect(peripheral.updateRssi()).rejects.toThrow('not connected');

      expect(peripheral.rssi).toBe(-60);
    });

    test('an rssi reported by the bindings on their own is applied too', () => {
      session.rssiUpdated.emit(-33);

      expect(peripheral.rssi).toBe(-33);
    });
  });

  describe('mtu', () => {
    test('tracks the value reported by the bindings and notifies listeners', () => {
      const listener = jest.fn();
      const unsubscribe = peripheral.onMtuChange(listener);

      session.mtuChanged.emit(185);

      expect(peripheral.mtu).toBe(185);
      expect(listener).toHaveBeenCalledWith(185);

      unsubscribe();
      session.mtuChanged.emit(247);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(peripheral.mtu).toBe(247);
    });
  });

  describe('discoverServices', () => {
    test('discovers all services by default', async () => {
      bindings.discoverServices.mockResolvedValueOnce(['180f', '1800']);

      const services = await peripheral.discoverServices();

      expect(bindings.discoverServices).toHaveBeenCalledWith(ID, []);
      expect(services).toHaveLength(2);
      expect(services[0]).toBeInstanceOf(Service);
      expect(services.map(service => service.uuid)).toEqual(['180f', '1800']);
      expect(peripheral.services).toBe(services);
    });

    test('forwards the service filter', async () => {
      await peripheral.discoverServices(['180f']);

      expect(bindings.discoverServices).toHaveBeenCalledWith(ID, ['180f']);
    });

    test('the created services talk to the same session', async () => {
      bindings.discoverServices.mockResolvedValueOnce(['180f']);
      const [service] = await peripheral.discoverServices();

      await service.discoverCharacteristics(['2a19']);

      expect(bindings.discoverCharacteristics).toHaveBeenCalledWith(ID, '180f', ['2a19']);
    });

    test('a failed discovery rejects and keeps the previous result', async () => {
      bindings.discoverServices.mockResolvedValueOnce(['180f']);
      const first = await peripheral.discoverServices();
      bindings.discoverServices.mockRejectedValueOnce(new Error('gatt error'));

      await expect(peripheral.discoverServices()).rejects.toThrow('gatt error');

      expect(peripheral.services).toBe(first);
    });
  });

  describe('discoverSomeServicesAndCharacteristics', () => {
    const info = (uuid: string) => ({ uuid, properties: ['read' as const] });

    test('collects the characteristics of every service, in service order', async () => {
      bindings.discoverServices.mockResolvedValueOnce(['180f', '180a']);
      bindings.discoverCharacteristics
        .mockResolvedValueOnce([info('2a19')])
        .mockResolvedValueOnce([info('2a29'), info('2a24')]);

      const result = await peripheral.discoverSomeServicesAndCharacteristics(['180f', '180a'], ['2a19', '2a29', '2a24']);

      expect(bindings.discoverServices).toHaveBeenCalledWith(ID, ['180f', '180a']);
      expect(bindings.discoverCharacteristics.mock.calls).toEqual([
        [ID, '180f', ['2a19', '2a29', '2a24']],
        [ID, '180a', ['2a19', '2a29', '2a24']]
      ]);
      expect(result.services.map(service => service.uuid)).toEqual(['180f', '180a']);
      expect(result.characteristics.map(characteristic => characteristic.uuid)).toEqual(['2a19', '2a29', '2a24']);
      expect(result.characteristics[0]).toBeInstanceOf(Characteristic);
      expect(result.services[1].characteristics).toEqual(result.characteristics.slice(1));
    });

    test('queries one service at a time', async () => {
      bindings.discoverServices.mockResolvedValueOnce(['180f', '180a']);
      const first = new Deferred<any[]>();
      bindings.discoverCharacteristics.mockReturnValueOnce(first.promise);

      const result = peripheral.discoverSomeServicesAndCharacteristics([], []);
      await flushPromises();
      expect(bindings.discoverCharacteristics).toHaveBeenCalledTimes(1);

      first.resolve([]);
      await result;
      expect(bindings.discoverCharacteristics).toHaveBeenCalledTimes(2);
    });

    test('rejects when not every requested service was found', async () => {
      bindings.discoverServices.mockResolvedValueOnce(['180f']);

      const result = peripheral.discoverSomeServicesAndCharacteristics(['180f', '180a'], []);

      await expect(result).rejects.toBeInstanceOf(NobleError);
      await expect(result).rejects.toThrow('Could not find all requested services');
      expect(bindings.discoverCharacteristics).not.toHaveBeenCalled();
    });

    test('propagates a characteristic discovery failure', async () => {
      bindings.discoverServices.mockResolvedValueOnce(['180f']);
      bindings.discoverCharacteristics.mockRejectedValueOnce(new Error('gatt error'));

      await expect(peripheral.discoverSomeServicesAndCharacteristics(['180f'], [])).rejects.toThrow('gatt error');
    });

    test('discoverAllServicesAndCharacteristics asks for everything', async () => {
      bindings.discoverServices.mockResolvedValueOnce(['180f']);
      bindings.discoverCharacteristics.mockResolvedValueOnce([info('2a19')]);

      const result = await peripheral.discoverAllServicesAndCharacteristics();

      expect(bindings.discoverServices).toHaveBeenCalledWith(ID, []);
      expect(bindings.discoverCharacteristics).toHaveBeenCalledWith(ID, '180f', []);
      expect(result.services).toHaveLength(1);
      expect(result.characteristics).toHaveLength(1);
    });
  });

  describe('handles', () => {
    test('readHandle forwards the handle and resolves with the data', async () => {
      const data = Buffer.from([1, 2, 3]);
      bindings.readHandle.mockResolvedValueOnce(data);

      await expect(peripheral.readHandle(0x2a)).resolves.toBe(data);

      expect(bindings.readHandle).toHaveBeenCalledWith(ID, 0x2a);
    });

    test('writeHandle writes with response by default', async () => {
      const data = Buffer.from([9]);

      await expect(peripheral.writeHandle(0x2a, data)).resolves.toBeUndefined();

      expect(bindings.writeHandle).toHaveBeenCalledWith(ID, 0x2a, data, false);
    });

    test('writeHandle forwards withoutResponse', async () => {
      const data = Buffer.from([9]);

      await peripheral.writeHandle(0x2a, data, true);

      expect(bindings.writeHandle).toHaveBeenCalledWith(ID, 0x2a, data, true);
    });

    test.each([
      ['a string', 'data'],
      ['an array', [1, 2]],
      ['a Uint8Array', new Uint8Array([1])],
      ['undefined', undefined]
    ])('writeHandle refuses %s', (_label, data) => {
      expect(() => peripheral.writeHandle(1, data as any)).toThrow(new TypeError('data must be a Buffer'));
      expect(bindings.writeHandle).not.toHaveBeenCalled();
    });

    test('onHandleNotification reports raw handle notifications until unsubscribed', () => {
      const listener = jest.fn();
      const unsubscribe = peripheral.onHandleNotification(listener);
      const notification = { handle: 0x10, data: Buffer.from([1]) };

      session.handleNotified.emit(notification);
      expect(listener).toHaveBeenCalledWith(notification);

      unsubscribe();
      session.handleNotified.emit(notification);
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('serialisation', () => {
    test('toJSON lists the public state', async () => {
      await connect();
      session.mtuChanged.emit(185);

      expect(peripheral.toJSON()).toEqual({
        id: ID,
        address: 'aa:bb:cc:dd:ee:ff',
        addressType: 'public',
        connectable: true,
        advertisement: { localName: 'device', serviceUuids: [], serviceData: [] },
        rssi: -60,
        mtu: 185,
        state: 'connected'
      });
    });

    test('toString is the JSON form', () => {
      expect(peripheral.toString()).toBe(JSON.stringify(peripheral.toJSON()));
      expect(JSON.parse(`${peripheral}`)).toMatchObject({ id: ID, state: 'disconnected', mtu: null });
    });
  });
});
