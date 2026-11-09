import { DisconnectedError, NotSupportedError } from '../../src/common/errors';
import { Characteristic } from '../../src/gatt/characteristic';
import { Descriptor } from '../../src/gatt/descriptor';
import { PeripheralSession } from '../../src/gatt/session';
import { Deferred, FakeBindings, createSession, flushPromises, isPending } from '../helpers/fake-bindings';

const ID = 'aabbccddeeff';
const SERVICE = '180f';
const UUID = '2a19';

describe('Characteristic', () => {
  let bindings: FakeBindings;
  let session: PeripheralSession;
  let characteristic: Characteristic;

  /** What Noble does when the bindings report a notification for this characteristic. */
  const notify = (data: Buffer, uuid = UUID): void => session.notifications(SERVICE, uuid).emit(data);

  beforeEach(() => {
    ({ bindings, session } = createSession(ID));
    characteristic = new Characteristic(session, SERVICE, UUID, ['read', 'notify']);
  });

  describe('assigned numbers', () => {
    test('resolves name and type of a Bluetooth SIG characteristic', () => {
      expect(characteristic.uuid).toBe('2a19');
      expect(characteristic.name).toBe('Battery Level');
      expect(characteristic.type).toBe('org.bluetooth.characteristic.battery_level');
      expect(characteristic.properties).toEqual(['read', 'notify']);
    });

    test('leaves name and type null for a vendor characteristic', () => {
      const vendor = new Characteristic(session, SERVICE, '6e400002b5a3f393e0a9e50e24dcca9e', []);

      expect(vendor.name).toBeNull();
      expect(vendor.type).toBeNull();
    });
  });

  describe('read', () => {
    test('addresses the characteristic through its service and resolves with the data', async () => {
      const data = Buffer.from([0x64]);
      bindings.read.mockResolvedValueOnce(data);

      await expect(characteristic.read()).resolves.toBe(data);

      expect(bindings.read).toHaveBeenCalledWith(ID, SERVICE, UUID);
    });

    test('propagates a failure', async () => {
      bindings.read.mockRejectedValueOnce(new Error('read not permitted'));

      await expect(characteristic.read()).rejects.toThrow('read not permitted');
    });

    test('rejects with DisconnectedError carrying the reason when the link drops mid-read', async () => {
      bindings.read.mockReturnValueOnce(new Deferred<Buffer>().promise);

      const reading = characteristic.read();
      session.disconnected.emit(0x08);

      await expect(reading).rejects.toBeInstanceOf(DisconnectedError);
      await expect(reading).rejects.toMatchObject({ reason: 0x08 });
    });
  });

  describe('write', () => {
    test('writes a Buffer as is, with response by default', async () => {
      const data = Buffer.from([1, 2, 3]);

      await expect(characteristic.write(data)).resolves.toBeUndefined();

      expect(bindings.write).toHaveBeenCalledWith(ID, SERVICE, UUID, data, false);
      expect(bindings.write.mock.calls[0][3]).toBe(data);
    });

    test('forwards withoutResponse', async () => {
      const data = Buffer.from([1]);

      await characteristic.write(data, true);

      expect(bindings.write).toHaveBeenCalledWith(ID, SERVICE, UUID, data, true);
    });

    test('hands a Uint8Array to the bindings as a Buffer over the same bytes', async () => {
      await characteristic.write(new Uint8Array([1, 2, 3]));

      const sent = bindings.write.mock.calls[0][3];
      expect(Buffer.isBuffer(sent)).toBe(true);
      expect(sent).toEqual(Buffer.from([1, 2, 3]));
    });

    test('respects the offset and length of a Uint8Array view', async () => {
      const backing = new Uint8Array([9, 9, 1, 2, 3, 9]);

      await characteristic.write(backing.subarray(2, 5));

      expect(bindings.write.mock.calls[0][3]).toEqual(Buffer.from([1, 2, 3]));
    });

    test.each([
      ['a string', 'data'],
      ['an array', [1, 2]],
      ['an ArrayBuffer', new ArrayBuffer(2)],
      ['a Uint16Array', new Uint16Array([1])],
      ['undefined', undefined],
      ['null', null]
    ])('rejects %s with a TypeError', async (_label, data) => {
      const writing = characteristic.write(data as any);

      await expect(writing).rejects.toThrow(new TypeError('data must be a Buffer or Uint8Array'));
      expect(bindings.write).not.toHaveBeenCalled();
    });

    test('propagates a failure', async () => {
      bindings.write.mockRejectedValueOnce(new Error('write not permitted'));

      await expect(characteristic.write(Buffer.alloc(1))).rejects.toThrow('write not permitted');
    });

    test('rejects with DisconnectedError when the link drops mid-write', async () => {
      bindings.write.mockReturnValueOnce(new Deferred<void>().promise);

      const writing = characteristic.write(Buffer.alloc(1));
      session.disconnected.emit('remote');

      await expect(writing).rejects.toBeInstanceOf(DisconnectedError);
    });
  });

  describe('subscribe / unsubscribe', () => {
    test('subscribe enables notifications', async () => {
      expect(characteristic.isNotifying).toBe(false);

      await expect(characteristic.subscribe()).resolves.toBeUndefined();

      expect(bindings.notify).toHaveBeenCalledTimes(1);
      expect(bindings.notify).toHaveBeenCalledWith(ID, SERVICE, UUID, true);
      expect(characteristic.isNotifying).toBe(true);
    });

    test('isNotifying only flips once the bindings confirmed', async () => {
      const pending = new Deferred<void>();
      bindings.notify.mockReturnValueOnce(pending.promise);

      const subscribing = characteristic.subscribe();
      expect(characteristic.isNotifying).toBe(false);

      pending.resolve();
      await subscribing;
      expect(characteristic.isNotifying).toBe(true);
    });

    test('subscribe is a no-op when already subscribed', async () => {
      await characteristic.subscribe();
      await characteristic.subscribe();

      expect(bindings.notify).toHaveBeenCalledTimes(1);
    });

    test('unsubscribe disables notifications', async () => {
      await characteristic.subscribe();

      await expect(characteristic.unsubscribe()).resolves.toBeUndefined();

      expect(bindings.notify).toHaveBeenLastCalledWith(ID, SERVICE, UUID, false);
      expect(characteristic.isNotifying).toBe(false);
    });

    test('unsubscribe is a no-op when not subscribed', async () => {
      await characteristic.unsubscribe();
      await characteristic.subscribe();
      await characteristic.unsubscribe();
      await characteristic.unsubscribe();

      expect(bindings.notify.mock.calls.map(call => call[3])).toEqual([true, false]);
    });

    test('a failed subscribe rejects and leaves the characteristic unsubscribed', async () => {
      bindings.notify.mockRejectedValueOnce(new Error('cccd write failed'));

      await expect(characteristic.subscribe()).rejects.toThrow('cccd write failed');

      expect(characteristic.isNotifying).toBe(false);
    });

    test('a failed unsubscribe rejects and leaves the characteristic subscribed', async () => {
      await characteristic.subscribe();
      bindings.notify.mockRejectedValueOnce(new Error('cccd write failed'));

      await expect(characteristic.unsubscribe()).rejects.toThrow('cccd write failed');

      expect(characteristic.isNotifying).toBe(true);
    });

    test('rejects with DisconnectedError when the link drops mid-request', async () => {
      bindings.notify.mockReturnValueOnce(new Deferred<void>().promise);

      const subscribing = characteristic.subscribe();
      await flushPromises();
      expect(bindings.notify).toHaveBeenCalledTimes(1);
      session.disconnected.emit('remote');

      await expect(subscribing).rejects.toBeInstanceOf(DisconnectedError);
      expect(characteristic.isNotifying).toBe(false);
    });

    // The request goes out synchronously, so it is guarded against a link
    // loss reported right after subscribe() returns.
    test('a link drop right after subscribe() was called rejects it', async () => {
      bindings.notify.mockReturnValueOnce(new Deferred<void>().promise);

      const subscribing = characteristic.subscribe();
      expect(bindings.notify).toHaveBeenCalledTimes(1);
      session.disconnected.emit('remote');

      await expect(subscribing).rejects.toBeInstanceOf(DisconnectedError);
      expect(characteristic.isNotifying).toBe(false);
    });

    test('a request that was in flight when the link dropped does not block the next one', async () => {
      bindings.notify.mockReturnValueOnce(new Deferred<void>().promise);
      const lost = characteristic.subscribe();
      await flushPromises();
      session.disconnected.emit('remote');
      await expect(lost).rejects.toBeInstanceOf(DisconnectedError);

      await characteristic.subscribe();

      expect(bindings.notify).toHaveBeenCalledTimes(2);
      expect(characteristic.isNotifying).toBe(true);
    });

    test('a disconnect resets the notifying state, so subscribing again reaches the bindings', async () => {
      await characteristic.subscribe();

      session.disconnected.emit('remote');
      expect(characteristic.isNotifying).toBe(false);

      await characteristic.subscribe();
      expect(bindings.notify).toHaveBeenCalledTimes(2);
      expect(bindings.notify).toHaveBeenLastCalledWith(ID, SERVICE, UUID, true);
    });

    test('the notifying state is per characteristic', async () => {
      const other = new Characteristic(session, SERVICE, '2a1a', ['notify']);

      await characteristic.subscribe();

      expect(other.isNotifying).toBe(false);
    });

    test('the notifying state is shared by objects describing the same characteristic', async () => {
      const rediscovered = new Characteristic(session, SERVICE, UUID, ['notify']);

      await characteristic.subscribe();

      expect(rediscovered.isNotifying).toBe(true);
      await rediscovered.subscribe();
      expect(bindings.notify).toHaveBeenCalledTimes(1);
    });

    test('concurrent subscribe() calls share one request', async () => {
      const pending = new Deferred<void>();
      bindings.notify.mockReturnValueOnce(pending.promise);

      const first = characteristic.subscribe();
      const second = characteristic.subscribe();
      await flushPromises();
      pending.resolve();
      await Promise.all([first, second]);

      expect(bindings.notify).toHaveBeenCalledTimes(1);
      expect(characteristic.isNotifying).toBe(true);
    });

    test('concurrent subscribe() calls through different objects share one request', async () => {
      const rediscovered = new Characteristic(session, SERVICE, UUID, ['notify']);

      await Promise.all([characteristic.subscribe(), rediscovered.subscribe()]);

      expect(bindings.notify).toHaveBeenCalledTimes(1);
    });

    test('concurrent unsubscribe() calls share one request', async () => {
      await characteristic.subscribe();

      await Promise.all([characteristic.unsubscribe(), characteristic.unsubscribe()]);

      expect(bindings.notify.mock.calls.map(call => call[3])).toEqual([true, false]);
    });

    test('all callers of a shared request see its failure', async () => {
      bindings.notify.mockRejectedValueOnce(new Error('cccd write failed'));

      const first = characteristic.subscribe();
      const second = characteristic.subscribe();

      await expect(first).rejects.toThrow('cccd write failed');
      await expect(second).rejects.toThrow('cccd write failed');
    });

    test('an unsubscribe() issued while a subscribe() is in flight is applied after it', async () => {
      const enabling = new Deferred<void>();
      bindings.notify.mockReturnValueOnce(enabling.promise);

      const subscribing = characteristic.subscribe();
      const unsubscribing = characteristic.unsubscribe();
      await flushPromises();
      expect(bindings.notify.mock.calls.map(call => call[3])).toEqual([true]);

      enabling.resolve();
      await Promise.all([subscribing, unsubscribing]);

      expect(bindings.notify.mock.calls.map(call => call[3])).toEqual([true, false]);
      expect(characteristic.isNotifying).toBe(false);
    });

    test('subscribe, unsubscribe, subscribe issued together end up subscribed', async () => {
      await Promise.all([characteristic.subscribe(), characteristic.unsubscribe(), characteristic.subscribe()]);

      expect(bindings.notify.mock.calls.map(call => call[3])).toEqual([true, false, true]);
      expect(characteristic.isNotifying).toBe(true);
    });
  });

  describe('onNotification', () => {
    test('delivers the value of every notification for this characteristic', () => {
      const listener = jest.fn();
      characteristic.onNotification(listener);
      const data = Buffer.from([0x50]);

      notify(data);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(data);
    });

    test('does not enable notifications by itself', () => {
      characteristic.onNotification(jest.fn());

      expect(bindings.notify).not.toHaveBeenCalled();
    });

    test('ignores notifications of other characteristics', () => {
      const listener = jest.fn();
      characteristic.onNotification(listener);

      notify(Buffer.from([1]), '2a1a');
      session.notifications('1800', UUID).emit(Buffer.from([1]));

      expect(listener).not.toHaveBeenCalled();
    });

    test('returns an unsubscribe function', () => {
      const listener = jest.fn();
      const stop = characteristic.onNotification(listener);

      stop();
      notify(Buffer.from([1]));

      expect(listener).not.toHaveBeenCalled();
    });

    test('listeners survive a disconnect', () => {
      const listener = jest.fn();
      characteristic.onNotification(listener);

      session.disconnected.emit('remote');
      notify(Buffer.from([1]));

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('notifications()', () => {
    test('does nothing until the first value is requested', async () => {
      characteristic.notifications();
      await flushPromises();

      expect(bindings.notify).not.toHaveBeenCalled();
    });

    test('subscribes, then yields every notified value in order', async () => {
      const stream = characteristic.notifications();

      const first = stream.next();
      await flushPromises();
      expect(bindings.notify).toHaveBeenCalledWith(ID, SERVICE, UUID, true);

      notify(Buffer.from([1]));
      notify(Buffer.from([2]));

      await expect(first).resolves.toEqual({ value: Buffer.from([1]), done: false });
      await expect(stream.next()).resolves.toEqual({ value: Buffer.from([2]), done: false });

      await stream.return();
    });

    test('buffers values that arrive while the subscription is being set up', async () => {
      const subscribed = new Deferred<void>();
      bindings.notify.mockReturnValueOnce(subscribed.promise);
      const stream = characteristic.notifications();

      const first = stream.next();
      notify(Buffer.from([1]));
      subscribed.resolve();

      await expect(first).resolves.toEqual({ value: Buffer.from([1]), done: false });
      await stream.return();
    });

    test('unsubscribes when the consumer breaks out of the loop', async () => {
      const seen: number[] = [];
      const consumer = (async () => {
        for await (const value of characteristic.notifications()) {
          seen.push(value[0]);
          if (seen.length === 2) break;
        }
      })();
      await flushPromises();

      notify(Buffer.from([1]));
      notify(Buffer.from([2]));
      notify(Buffer.from([3]));
      await consumer;

      expect(seen).toEqual([1, 2]);
      expect(bindings.notify.mock.calls.map(call => call[3])).toEqual([true, false]);
      expect(characteristic.isNotifying).toBe(false);
      expect(session.notifications(SERVICE, UUID).hasListeners).toBe(false);
    });

    test('ends when unsubscribe() is called, without unsubscribing twice', async () => {
      const stream = characteristic.notifications();
      const first = stream.next();
      await flushPromises();

      await characteristic.unsubscribe();

      await expect(first).resolves.toEqual({ value: undefined, done: true });
      expect(bindings.notify.mock.calls.map(call => call[3])).toEqual([true, false]);
      expect(session.notifications(SERVICE, UUID).hasListeners).toBe(false);
    });

    test('yields what was already buffered before ending on unsubscribe()', async () => {
      const stream = characteristic.notifications();
      const first = stream.next();
      await flushPromises();
      notify(Buffer.from([1]));
      notify(Buffer.from([2]));
      await first;

      await characteristic.unsubscribe();

      await expect(stream.next()).resolves.toEqual({ value: Buffer.from([2]), done: false });
      await expect(stream.next()).resolves.toEqual({ value: undefined, done: true });
    });

    test('throws DisconnectedError carrying the reason when the link drops mid-stream', async () => {
      const stream = characteristic.notifications();
      const first = stream.next();
      await flushPromises();

      session.disconnected.emit(0x08);

      await expect(first).rejects.toBeInstanceOf(DisconnectedError);
      await expect(first).rejects.toMatchObject({ reason: 0x08 });
      // The link is gone: there is nothing to unsubscribe from.
      expect(bindings.notify).toHaveBeenCalledTimes(1);
      expect(characteristic.isNotifying).toBe(false);
      expect(session.notifications(SERVICE, UUID).hasListeners).toBe(false);
    });

    test('a for await loop surfaces the link loss as an exception after the delivered values', async () => {
      const seen: number[] = [];
      const consumer = (async () => {
        for await (const value of characteristic.notifications()) seen.push(value[0]);
      })();
      await flushPromises();

      notify(Buffer.from([1]));
      session.disconnected.emit('remote');

      await expect(consumer).rejects.toBeInstanceOf(DisconnectedError);
      expect(seen).toEqual([1]);
    });

    test('throws when subscribing fails, and cleans up its listeners', async () => {
      bindings.notify.mockRejectedValueOnce(new Error('cccd write failed'));
      const stream = characteristic.notifications();

      await expect(stream.next()).rejects.toThrow('cccd write failed');

      expect(session.notifications(SERVICE, UUID).hasListeners).toBe(false);
      await expect(stream.next()).resolves.toEqual({ value: undefined, done: true });
    });

    test('reuses a subscription that already exists', async () => {
      await characteristic.subscribe();
      const stream = characteristic.notifications();

      const first = stream.next();
      await flushPromises();
      notify(Buffer.from([1]));
      await first;

      expect(bindings.notify).toHaveBeenCalledTimes(1);
      await stream.return();
    });

    test('with two streams started together, notifications stay on until the last one stops', async () => {
      const a = characteristic.notifications();
      const b = characteristic.notifications();
      const firstA = a.next();
      const firstB = b.next();
      await flushPromises();
      notify(Buffer.from([1]));
      await expect(firstA).resolves.toMatchObject({ done: false });
      await expect(firstB).resolves.toMatchObject({ done: false });

      await a.return();
      expect(characteristic.isNotifying).toBe(true);

      await b.return();
      expect(characteristic.isNotifying).toBe(false);
      expect(bindings.notify.mock.calls.map(call => call[3])).toEqual([true, false]);
    });

    // "Already enabled before the loop started" is read from the notifying
    // state, which cannot tell an explicit subscribe() from another stream's
    // subscription. A stream opened while an earlier one is running therefore
    // believes the subscription is not its to undo; when the earlier one has
    // left first, nobody switches the notifications off.
    test('with a second stream started later, notifications are switched off when the last one stops', async () => {
      const a = characteristic.notifications();
      const firstA = a.next();
      await flushPromises();
      const b = characteristic.notifications();
      const firstB = b.next();
      await flushPromises();
      notify(Buffer.from([1]));
      await firstA;
      await firstB;

      await a.return();
      expect(characteristic.isNotifying).toBe(true);
      await b.return();

      expect(characteristic.isNotifying).toBe(false);
      expect(bindings.notify.mock.calls.map(call => call[3])).toEqual([true, false]);
    });

    test('leaving a stream keeps a subscription the caller made explicitly beforehand', async () => {
      await characteristic.subscribe();
      const stream = characteristic.notifications();
      const first = stream.next();
      await flushPromises();
      notify(Buffer.from([1]));
      await first;

      await stream.return();

      expect(characteristic.isNotifying).toBe(true);
      expect(bindings.notify).toHaveBeenCalledTimes(1);
    });

    test('unsubscribe() ends every stream on the characteristic', async () => {
      const a = characteristic.notifications();
      const b = characteristic.notifications();
      const firstA = a.next();
      const firstB = b.next();
      await flushPromises();

      await characteristic.unsubscribe();

      await expect(firstA).resolves.toEqual({ value: undefined, done: true });
      await expect(firstB).resolves.toEqual({ value: undefined, done: true });
      expect(bindings.notify.mock.calls.map(call => call[3])).toEqual([true, false]);
    });

    test('a disconnect ends every stream with DisconnectedError', async () => {
      const a = characteristic.notifications();
      const b = new Characteristic(session, SERVICE, '2a1a', ['notify']).notifications();
      const firstA = a.next();
      const firstB = b.next();
      await flushPromises();

      session.disconnected.emit('remote');

      await expect(firstA).rejects.toBeInstanceOf(DisconnectedError);
      await expect(firstB).rejects.toBeInstanceOf(DisconnectedError);
    });

    test('a stream started after a reconnect subscribes again', async () => {
      const lost = characteristic.notifications();
      const first = lost.next();
      await flushPromises();
      session.disconnected.emit('remote');
      await expect(first).rejects.toBeInstanceOf(DisconnectedError);

      const stream = characteristic.notifications();
      const next = stream.next();
      await flushPromises();
      notify(Buffer.from([7]));

      await expect(next).resolves.toEqual({ value: Buffer.from([7]), done: false });
      expect(bindings.notify.mock.calls.map(call => call[3])).toEqual([true, true]);
      await stream.return();
    });

    test('a failing unsubscribe on the way out does not surface to the consumer', async () => {
      const stream = characteristic.notifications();
      const first = stream.next();
      await flushPromises();
      notify(Buffer.from([1]));
      await first;
      bindings.notify.mockRejectedValueOnce(new Error('already gone'));

      await expect(stream.return()).resolves.toEqual({ value: undefined, done: true });
    });

    // Discovering characteristics again creates new objects for the same
    // characteristic; streams and notifying state are shared through the session.
    describe('with a second object for the same characteristic (after a re-discovery)', () => {
      let rediscovered: Characteristic;

      beforeEach(() => {
        rediscovered = new Characteristic(session, SERVICE, UUID, ['read', 'notify']);
      });

      test('unsubscribe() through the other object ends the stream', async () => {
        const stream = characteristic.notifications();
        const first = stream.next();
        await flushPromises();

        await rediscovered.unsubscribe();

        expect(bindings.notify).toHaveBeenLastCalledWith(ID, SERVICE, UUID, false);
        await expect(first).resolves.toEqual({ value: undefined, done: true });
      });

      test('leaving one stream does not switch notifications off under the other object\'s stream', async () => {
        const mine = characteristic.notifications();
        const theirs = rediscovered.notifications();
        const myFirst = mine.next();
        const theirFirst = theirs.next();
        await flushPromises();
        notify(Buffer.from([1]));
        await myFirst;
        await theirFirst;

        await mine.return();

        expect(bindings.notify).not.toHaveBeenCalledWith(ID, SERVICE, UUID, false);
        expect(rediscovered.isNotifying).toBe(true);

        await theirs.return();
        expect(bindings.notify).toHaveBeenLastCalledWith(ID, SERVICE, UUID, false);
      });
    });
  });

  describe('discoverDescriptors', () => {
    test('builds Descriptor objects addressed through this characteristic', async () => {
      bindings.discoverDescriptors.mockResolvedValueOnce(['2901', '2902']);

      const descriptors = await characteristic.discoverDescriptors();

      expect(bindings.discoverDescriptors).toHaveBeenCalledWith(ID, SERVICE, UUID);
      expect(descriptors).toHaveLength(2);
      expect(descriptors[0]).toBeInstanceOf(Descriptor);
      expect(descriptors.map(d => d.uuid)).toEqual(['2901', '2902']);
      expect(characteristic.descriptors).toBe(descriptors);

      await descriptors[1].readValue();
      expect(bindings.readValue).toHaveBeenCalledWith(ID, SERVICE, UUID, '2902');
    });

    test('descriptors are null before the first discovery', () => {
      expect(characteristic.descriptors).toBeNull();
    });

    test('rejects with DisconnectedError when the link drops mid-request', async () => {
      bindings.discoverDescriptors.mockReturnValueOnce(new Deferred<string[]>().promise);

      const discovering = characteristic.discoverDescriptors();
      session.disconnected.emit('remote');

      await expect(discovering).rejects.toBeInstanceOf(DisconnectedError);
      expect(characteristic.descriptors).toBeNull();
    });
  });

  describe('broadcast', () => {
    test('forwards to bindings that support it', async () => {
      await expect(characteristic.broadcast(true)).resolves.toBeUndefined();

      expect(bindings.broadcast).toHaveBeenCalledWith(ID, SERVICE, UUID, true);
    });

    test('rejects with NotSupportedError when the bindings cannot broadcast', async () => {
      delete bindings.broadcast;

      const broadcasting = characteristic.broadcast(true);

      await expect(broadcasting).rejects.toBeInstanceOf(NotSupportedError);
      await expect(broadcasting).rejects.toThrow('Broadcast is not supported by the current bindings');
    });

    test('rejects with DisconnectedError when the link drops mid-request', async () => {
      bindings.broadcast!.mockReturnValueOnce(new Deferred<void>().promise);

      const broadcasting = characteristic.broadcast(false);
      session.disconnected.emit('remote');

      await expect(broadcasting).rejects.toBeInstanceOf(DisconnectedError);
    });
  });

  describe('serialisation', () => {
    test('toJSON', () => {
      expect(characteristic.toJSON()).toEqual({
        uuid: '2a19',
        name: 'Battery Level',
        type: 'org.bluetooth.characteristic.battery_level',
        properties: ['read', 'notify']
      });
    });

    test('toString is the JSON form', () => {
      expect(characteristic.toString()).toBe(
        '{"uuid":"2a19","name":"Battery Level","type":"org.bluetooth.characteristic.battery_level","properties":["read","notify"]}');
    });
  });
});
