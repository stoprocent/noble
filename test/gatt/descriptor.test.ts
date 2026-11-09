import { DisconnectedError } from '../../src/common/errors';
import { Descriptor } from '../../src/gatt/descriptor';
import { PeripheralSession } from '../../src/gatt/session';
import { Deferred, FakeBindings, createSession } from '../helpers/fake-bindings';

const ID = 'aabbccddeeff';

describe('Descriptor', () => {
  let bindings: FakeBindings;
  let session: PeripheralSession;
  let descriptor: Descriptor;

  beforeEach(() => {
    ({ bindings, session } = createSession(ID));
    descriptor = new Descriptor(session, '180f', '2a19', '2901');
  });

  describe('assigned numbers', () => {
    test('resolves name and type of a Bluetooth SIG descriptor', () => {
      expect(descriptor.uuid).toBe('2901');
      expect(descriptor.name).toBe('Characteristic User Description');
      expect(descriptor.type).toBe('org.bluetooth.descriptor.gatt.characteristic_user_description');
    });

    test('leaves name and type null for an unknown descriptor', () => {
      const vendor = new Descriptor(session, '180f', '2a19', 'ff99');

      expect(vendor.name).toBeNull();
      expect(vendor.type).toBeNull();
    });
  });

  describe('readValue', () => {
    test('addresses the descriptor through service and characteristic and resolves with the data', async () => {
      const data = Buffer.from('level');
      bindings.readValue.mockResolvedValueOnce(data);

      await expect(descriptor.readValue()).resolves.toBe(data);

      expect(bindings.readValue).toHaveBeenCalledWith(ID, '180f', '2a19', '2901');
    });

    test('propagates a failure', async () => {
      bindings.readValue.mockRejectedValueOnce(new Error('read not permitted'));

      await expect(descriptor.readValue()).rejects.toThrow('read not permitted');
    });

    test('rejects with DisconnectedError when the link drops mid-request', async () => {
      bindings.readValue.mockReturnValueOnce(new Deferred<Buffer>().promise);

      const reading = descriptor.readValue();
      session.disconnected.emit(0x13);

      await expect(reading).rejects.toBeInstanceOf(DisconnectedError);
      await expect(reading).rejects.toMatchObject({ reason: 0x13 });
    });
  });

  describe('writeValue', () => {
    test('forwards the buffer', async () => {
      const data = Buffer.from([1, 0]);

      await expect(descriptor.writeValue(data)).resolves.toBeUndefined();

      expect(bindings.writeValue).toHaveBeenCalledWith(ID, '180f', '2a19', '2901', data);
    });

    test.each([
      ['a string', 'data'],
      ['an array', [1, 0]],
      ['a Uint8Array', new Uint8Array([1, 0])],
      ['undefined', undefined]
    ])('refuses %s', (_label, data) => {
      expect(() => descriptor.writeValue(data as any)).toThrow(new TypeError('data must be a Buffer'));
      expect(bindings.writeValue).not.toHaveBeenCalled();
    });

    test('propagates a failure', async () => {
      bindings.writeValue.mockRejectedValueOnce(new Error('write not permitted'));

      await expect(descriptor.writeValue(Buffer.alloc(1))).rejects.toThrow('write not permitted');
    });

    test('rejects with DisconnectedError when the link drops mid-request', async () => {
      bindings.writeValue.mockReturnValueOnce(new Deferred<void>().promise);

      const writing = descriptor.writeValue(Buffer.alloc(1));
      session.disconnected.emit('remote');

      await expect(writing).rejects.toBeInstanceOf(DisconnectedError);
    });
  });

  describe('serialisation', () => {
    test('toJSON', () => {
      expect(descriptor.toJSON()).toEqual({
        uuid: '2901',
        name: 'Characteristic User Description',
        type: 'org.bluetooth.descriptor.gatt.characteristic_user_description'
      });
    });

    test('toString is the JSON form', () => {
      expect(`${descriptor}`).toBe(JSON.stringify(descriptor.toJSON()));
    });
  });
});
