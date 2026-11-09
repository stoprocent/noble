import { AttError, Gatt } from '../../../src/bindings/hci/gatt';
import { Deferred } from '../../../src/common/deferred';
import { NobleError } from '../../../src/common/errors';

const ALL_PROPERTIES = [
  'broadcast',
  'read',
  'writeWithoutResponse',
  'write',
  'notify',
  'indicate',
  'authenticatedSignedWrites',
  'extendedProperties'
];

/** Lets every pending promise continuation run. */
const tick = () => new Promise(setImmediate);

describe('hci gatt', () => {
  const address = 'address';
  // ATT_CID
  const cid = 0x0004;

  let gatt: any;
  let aclStream: any;
  let delegate: any;
  let encryptDeferred: Deferred<void>;
  /** Delivers an inbound ATT PDU. */
  let push: (data: Buffer | number[]) => void;

  /** Every ATT PDU written so far, in order. */
  const written = (): Buffer[] => aclStream.write.mock.calls.map((call: [number, Buffer]) => call[1]);

  /** Tracks how a promise settles without awaiting it. */
  const track = (promise: Promise<unknown>) => {
    const state: { status: 'pending' | 'resolved' | 'rejected'; value?: any; error?: any } = { status: 'pending' };
    promise.then((value) => {
      state.status = 'resolved';
      state.value = value;
    }, (error) => {
      state.status = 'rejected';
      state.error = error;
    });
    return state;
  };

  const setService = (service: { uuid: string; startHandle: number; endHandle: number }) => {
    gatt.services.set(service.uuid, service);
  };

  const setCharacteristic = (serviceUuid: string, characteristic: any) => {
    if (!gatt.services.has(serviceUuid)) {
      gatt.services.set(serviceUuid, { uuid: serviceUuid, startHandle: 0x0001, endHandle: 0xffff });
    }
    if (!gatt.characteristics.has(serviceUuid)) {
      gatt.characteristics.set(serviceUuid, new Map());
    }
    if (!gatt.descriptors.has(serviceUuid)) {
      gatt.descriptors.set(serviceUuid, new Map());
    }
    gatt.characteristics.get(serviceUuid).set(characteristic.uuid, characteristic);
  };

  const setDescriptor = (serviceUuid: string, characteristicUuid: string, descriptor: { uuid: string; handle: number }) => {
    if (!gatt.descriptors.has(serviceUuid)) {
      gatt.descriptors.set(serviceUuid, new Map());
    }
    if (!gatt.descriptors.get(serviceUuid).has(characteristicUuid)) {
      gatt.descriptors.get(serviceUuid).set(characteristicUuid, new Map());
    }
    gatt.descriptors.get(serviceUuid).get(characteristicUuid).set(descriptor.uuid, descriptor);
  };

  const expectUntouched = () => {
    expect(gatt.services.size).toBe(0);
    expect(gatt.characteristics.size).toBe(0);
    expect(gatt.descriptors.size).toBe(0);
    expect(gatt.currentCommand).toBe(null);
    expect(gatt.commandQueue).toEqual([]);
    expect(gatt.mtu).toBe(23);
    expect(gatt.security).toBe('low');
  };

  const expectNoDelegateCalls = () => {
    expect(delegate.onHandleNotify).not.toHaveBeenCalled();
    expect(delegate.onNotification).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    encryptDeferred = new Deferred<void>();
    aclStream = {
      registerChannel: jest.fn(),
      write: jest.fn(),
      encrypt: jest.fn(() => encryptDeferred.promise)
    };
    delegate = {
      onNotification: jest.fn(),
      onHandleNotify: jest.fn()
    };

    gatt = new Gatt(address, aclStream, delegate);

    const handler = aclStream.registerChannel.mock.calls[0][1];
    push = (data) => handler(Buffer.from(data));
  });

  afterEach(() => {
    delete process.env.NOBLE_MULTI_ROLE;
  });

  it('constructor', () => {
    expect(gatt.address).toBe(address);
    expect(gatt.aclStream).toBe(aclStream);
    expect(gatt.desiredMtu).toBe(256);
    expectUntouched();

    expect(aclStream.registerChannel).toHaveBeenCalledTimes(1);
    expect(aclStream.registerChannel).toHaveBeenCalledWith(cid, expect.any(Function));
  });

  it('constructor with desired MTU', () => {
    const custom: any = new Gatt(address, aclStream, delegate, 100);

    expect(custom.desiredMtu).toBe(100);
    expect(custom.mtu).toBe(23);
  });

  describe('inbound data', () => {
    it('send same current command (echo)', async () => {
      const result = track(gatt.readHandle(0x0003));
      const currentCommand = gatt.currentCommand;

      push([0x0a, 0x03, 0x00]);
      await tick();

      // No changes
      expect(gatt.currentCommand).toBe(currentCommand);
      expect(gatt.commandQueue).toEqual([]);
      expect(result.status).toBe('pending');
      expectNoDelegateCalls();
      expect(aclStream.write).toHaveBeenCalledTimes(1);
    });

    it('REQ_NOT_SUPP - request from the peer, no current command', () => {
      push([0x00]);

      expectUntouched();
      expectNoDelegateCalls();

      expect(aclStream.write).toHaveBeenCalledTimes(1);
      expect(aclStream.write).toHaveBeenCalledWith(4, Buffer.from([0x01, 0x00, 0x00, 0x00, 0x06]));
    });

    it('REQ_NOT_SUPP - not same as current', async () => {
      const result = track(gatt.readHandle(0x0003));
      const currentCommand = gatt.currentCommand;
      aclStream.write.mockClear();

      push([0x0a, 0x04, 0x00]);
      await tick();

      // No changes
      expect(gatt.currentCommand).toBe(currentCommand);
      expect(gatt.commandQueue).toEqual([]);
      expect(result.status).toBe('pending');
      expectNoDelegateCalls();

      expect(aclStream.write).toHaveBeenCalledTimes(1);
      expect(aclStream.write).toHaveBeenCalledWith(4, Buffer.from([0x01, 0x0a, 0x00, 0x00, 0x06]));
    });

    it('MTU request is answered with the desired MTU', () => {
      push([0x02, 0x17, 0x00]);

      expectUntouched();
      expectNoDelegateCalls();

      expect(aclStream.write).toHaveBeenCalledTimes(1);
      expect(aclStream.write).toHaveBeenCalledWith(4, Buffer.from([0x03, 0x00, 0x01]));
    });

    it('requests from the peer are ignored with NOBLE_MULTI_ROLE', () => {
      process.env.NOBLE_MULTI_ROLE = '1';

      push([0x02, 0x17, 0x00]);
      push([0x0a, 0x04, 0x00]);

      expectUntouched();
      expectNoDelegateCalls();
      expect(aclStream.write).not.toHaveBeenCalled();
    });

    const setNotifyFixture = () => {
      gatt.services.set('service1', { uuid: 'service1', startHandle: 1, endHandle: 10 });
      gatt.services.set('service2', { uuid: 'service2', startHandle: 11, endHandle: 20 });
      setCharacteristic('service1', { uuid: 'char1', valueHandle: 0 });
      setCharacteristic('service1', { uuid: 'char2', valueHandle: 513 });
      setCharacteristic('service2', { uuid: 'char3', valueHandle: 513 });
    };

    it('ATT_OP_HANDLE_NOTIFY', () => {
      setNotifyFixture();

      push([0x1b, 0x01, 0x02, 0x03, 0x04]);

      expect(gatt.currentCommand).toBe(null);
      expect(gatt.commandQueue).toEqual([]);
      expect(gatt.mtu).toBe(23);
      expect(gatt.security).toBe('low');

      expect(delegate.onHandleNotify).toHaveBeenCalledTimes(1);
      expect(delegate.onHandleNotify).toHaveBeenCalledWith(513, Buffer.from([0x03, 0x04]));
      expect(delegate.onNotification).toHaveBeenCalledTimes(2);
      expect(delegate.onNotification).toHaveBeenNthCalledWith(1, 'service1', 'char2', Buffer.from([0x03, 0x04]));
      expect(delegate.onNotification).toHaveBeenNthCalledWith(2, 'service2', 'char3', Buffer.from([0x03, 0x04]));
      expect(aclStream.write).not.toHaveBeenCalled();
    });

    it('ATT_OP_HANDLE_NOTIFY for an unknown handle', () => {
      setNotifyFixture();

      push([0x1b, 0x09, 0x09, 0x03, 0x04]);

      expect(delegate.onHandleNotify).toHaveBeenCalledTimes(1);
      expect(delegate.onHandleNotify).toHaveBeenCalledWith(0x0909, Buffer.from([0x03, 0x04]));
      expect(delegate.onNotification).not.toHaveBeenCalled();
    });

    it('ATT_OP_HANDLE_IND - confirmation is written at once without a current command', () => {
      setNotifyFixture();

      push([0x1d, 0x01, 0x02, 0x03, 0x04]);

      expect(gatt.currentCommand).toBe(null);
      expect(gatt.commandQueue).toEqual([]);

      expect(delegate.onHandleNotify).toHaveBeenCalledTimes(1);
      expect(delegate.onHandleNotify).toHaveBeenCalledWith(513, Buffer.from([0x03, 0x04]));
      expect(delegate.onNotification).toHaveBeenCalledTimes(2);
      expect(delegate.onNotification).toHaveBeenCalledWith('service1', 'char2', Buffer.from([0x03, 0x04]));
      expect(delegate.onNotification).toHaveBeenCalledWith('service2', 'char3', Buffer.from([0x03, 0x04]));

      expect(aclStream.write).toHaveBeenCalledTimes(1);
      expect(aclStream.write).toHaveBeenCalledWith(4, Buffer.from([0x1e]));
    });

    it('ATT_OP_HANDLE_IND - confirmation is queued behind the current command', async () => {
      setNotifyFixture();

      const result = track(gatt.readHandle(0x0003));
      const currentCommand = gatt.currentCommand;

      push([0x1d, 0x01, 0x02, 0x03, 0x04]);

      expect(gatt.currentCommand).toBe(currentCommand);
      expect(gatt.commandQueue).toHaveLength(1);
      expect(delegate.onHandleNotify).toHaveBeenCalledTimes(1);
      expect(delegate.onNotification).toHaveBeenCalledTimes(2);
      expect(written()).toEqual([Buffer.from([0x0a, 0x03, 0x00])]);

      // the response releases the queue
      push([0x0b, 0x01]);
      await tick();

      expect(result).toEqual({ status: 'resolved', value: Buffer.from([0x01]) });
      expect(written()).toEqual([Buffer.from([0x0a, 0x03, 0x00]), Buffer.from([0x1e])]);
      expect(gatt.currentCommand).toBe(null);
      expect(gatt.commandQueue).toEqual([]);
    });

    it('no current command', () => {
      push([0xff, 0x01, 0x02, 0x03, 0x04]);

      expectUntouched();
      expectNoDelegateCalls();
      expect(aclStream.write).not.toHaveBeenCalled();
    });

    it('ATT_OP_ERROR invalid PDU is ignored', async () => {
      const result = track(gatt.exchangeMtu());
      const currentCommand = gatt.currentCommand;

      push([0x01, 0x02, 0x00, 0x00, 0x04]);
      await tick();

      expect(result.status).toBe('pending');
      expect(gatt.currentCommand).toBe(currentCommand);
      expect(aclStream.write).toHaveBeenCalledTimes(1);
    });

    [0x05, 0x08, 0x0f].forEach((errorCode) => {
      it(`ATT_OP_ERROR ${errorCode} and security low`, async () => {
        const result = track(gatt.readHandle(0x0003));
        const currentCommand = gatt.currentCommand;

        push([0x01, 0x0a, 0x03, 0x00, errorCode]);
        await tick();

        // No changes
        expect(gatt.currentCommand).toBe(currentCommand);
        expect(gatt.commandQueue).toEqual([]);
        expect(gatt.mtu).toBe(23);
        expect(gatt.security).toBe('low');
        expect(result.status).toBe('pending');
        expectNoDelegateCalls();

        expect(aclStream.encrypt).toHaveBeenCalledTimes(1);
        expect(aclStream.encrypt).toHaveBeenCalledWith();
        expect(aclStream.write).toHaveBeenCalledTimes(1);
      });

      it(`ATT_OP_ERROR ${errorCode} and security medium`, async () => {
        gatt.security = 'medium';
        const result = track(gatt.readHandle(0x0003));

        push([0x01, 0x0a, 0x03, 0x00, errorCode]);
        await tick();

        expect(gatt.currentCommand).toBe(null);
        expect(gatt.commandQueue).toEqual([]);
        expect(gatt.security).toBe('medium');
        expectNoDelegateCalls();
        expect(aclStream.encrypt).not.toHaveBeenCalled();

        expect(result.status).toBe('rejected');
        expect(result.error).toBeInstanceOf(AttError);
        expect(result.error.code).toBe(errorCode);
      });
    });

    it('data after close is ignored', async () => {
      const result = track(gatt.readHandle(0x0003));
      gatt.close(new Error('gone'));
      aclStream.write.mockClear();

      push([0x0b, 0x01]);
      push([0x02, 0x17, 0x00]);
      push([0x1d, 0x01, 0x02, 0x03, 0x04]);
      await tick();

      expect(result.status).toBe('rejected');
      expect(aclStream.write).not.toHaveBeenCalled();
      expectNoDelegateCalls();
    });
  });

  describe('security upgrade', () => {
    it('re-writes the current command once the link is encrypted', async () => {
      const result = track(gatt.readHandle(0x0003));
      const queued = track(gatt.readHandle(0x0004));

      push([0x01, 0x0a, 0x03, 0x00, 0x05]);
      await tick();
      expect(written()).toEqual([Buffer.from([0x0a, 0x03, 0x00])]);

      encryptDeferred.resolve();
      await tick();

      expect(gatt.security).toBe('medium');
      expect(written()).toEqual([Buffer.from([0x0a, 0x03, 0x00]), Buffer.from([0x0a, 0x03, 0x00])]);
      expect(result.status).toBe('pending');

      push([0x0b, 0x2a]);
      await tick();

      expect(result).toEqual({ status: 'resolved', value: Buffer.from([0x2a]) });
      expect(written()).toEqual([
        Buffer.from([0x0a, 0x03, 0x00]),
        Buffer.from([0x0a, 0x03, 0x00]),
        Buffer.from([0x0a, 0x04, 0x00])
      ]);
      expect(queued.status).toBe('pending');
    });

    it('starts only one encryption for repeated errors', async () => {
      track(gatt.readHandle(0x0003));

      push([0x01, 0x0a, 0x03, 0x00, 0x05]);
      push([0x01, 0x0a, 0x03, 0x00, 0x05]);
      await tick();

      expect(aclStream.encrypt).toHaveBeenCalledTimes(1);
    });

    it('rejects the current command and continues the queue when encryption fails', async () => {
      const result = track(gatt.readHandle(0x0003));
      const queued = track(gatt.readHandle(0x0004));

      push([0x01, 0x0a, 0x03, 0x00, 0x0f]);
      await tick();

      encryptDeferred.reject(new NobleError('Encryption failed'));
      await tick();

      expect(gatt.security).toBe('low');
      expect(result.status).toBe('rejected');
      expect(result.error).toBeInstanceOf(AttError);
      expect(result.error.opcode).toBe(0x0a);
      expect(result.error.handle).toBe(0x0003);
      expect(result.error.code).toBe(0x0f);

      // the queue goes on
      expect(written()).toEqual([Buffer.from([0x0a, 0x03, 0x00]), Buffer.from([0x0a, 0x04, 0x00])]);

      push([0x0b, 0x07]);
      await tick();

      expect(queued).toEqual({ status: 'resolved', value: Buffer.from([0x07]) });
    });

    it('a later command may trigger a new encryption attempt after a failed one', async () => {
      const first = track(gatt.readHandle(0x0003));
      push([0x01, 0x0a, 0x03, 0x00, 0x05]);
      encryptDeferred.reject(new NobleError('Encryption failed'));
      await tick();
      expect(first.status).toBe('rejected');

      encryptDeferred = new Deferred<void>();
      const second = track(gatt.readHandle(0x0003));
      push([0x01, 0x0a, 0x03, 0x00, 0x05]);
      await tick();

      expect(aclStream.encrypt).toHaveBeenCalledTimes(2);
      expect(second.status).toBe('pending');
    });

    it('does not write anything when the link closes while encrypting', async () => {
      const result = track(gatt.readHandle(0x0003));
      push([0x01, 0x0a, 0x03, 0x00, 0x05]);

      const error = new Error('gone');
      gatt.close(error);
      encryptDeferred.resolve();
      await tick();

      expect(result).toEqual({ status: 'rejected', error });
      expect(aclStream.write).toHaveBeenCalledTimes(1);
      expect(gatt.security).toBe('low');
    });
  });

  describe('command queue', () => {
    it('only one request is outstanding at a time', async () => {
      const first = track(gatt.readHandle(0x0001));
      const second = track(gatt.readHandle(0x0002));
      const third = track(gatt.readHandle(0x0003));

      expect(written()).toEqual([Buffer.from([0x0a, 0x01, 0x00])]);
      expect(gatt.commandQueue).toHaveLength(2);

      push([0x0b, 0x11]);
      await tick();

      expect(first).toEqual({ status: 'resolved', value: Buffer.from([0x11]) });
      expect(second.status).toBe('pending');
      expect(written()).toEqual([Buffer.from([0x0a, 0x01, 0x00]), Buffer.from([0x0a, 0x02, 0x00])]);

      push([0x0b, 0x22]);
      await tick();

      expect(second).toEqual({ status: 'resolved', value: Buffer.from([0x22]) });
      expect(third.status).toBe('pending');
      expect(written()).toHaveLength(3);
      expect(written()[2]).toEqual(Buffer.from([0x0a, 0x03, 0x00]));

      push([0x0b, 0x33]);
      await tick();

      expect(third).toEqual({ status: 'resolved', value: Buffer.from([0x33]) });
      expect(gatt.currentCommand).toBe(null);
      expect(gatt.commandQueue).toEqual([]);
    });

    it('command callback with queue: request then write command', async () => {
      const current = track(gatt.readHandle(0x0001));
      const queuedRequest = track(gatt.readHandle(0x0098));
      const queuedWrite = track(gatt.writeHandle(0x0099, Buffer.from([0x01]), true));

      push([0x0b, 0x11]);
      await tick();

      expect(current.status).toBe('resolved');
      expect(queuedRequest.status).toBe('pending');
      expect(queuedWrite.status).toBe('pending');
      expect(gatt.commandQueue).toHaveLength(1);

      expect(written()).toEqual([Buffer.from([0x0a, 0x01, 0x00]), Buffer.from([0x0a, 0x98, 0x00])]);
    });

    it('write command callback with queue: write command then request', async () => {
      const current = track(gatt.readHandle(0x0001));
      const queuedWrite = track(gatt.writeHandle(0x0099, Buffer.from([0x01]), true));
      const queuedRequest = track(gatt.readHandle(0x0098));

      push([0x0b, 0x11]);
      await tick();

      expect(current.status).toBe('resolved');
      expect(queuedWrite).toEqual({ status: 'resolved', value: undefined });
      expect(queuedRequest.status).toBe('pending');
      expect(gatt.commandQueue).toEqual([]);

      expect(written()).toEqual([
        Buffer.from([0x0a, 0x01, 0x00]),
        Buffer.from([0x52, 0x99, 0x00, 0x01]),
        Buffer.from([0x0a, 0x98, 0x00])
      ]);
    });

    it('write commands do not block the queue', async () => {
      const first = track(gatt.writeHandle(0x0001, Buffer.from([0x01]), true));
      const second = track(gatt.writeHandle(0x0002, Buffer.from([0x02]), true));
      const third = track(gatt.readHandle(0x0003));
      await tick();

      expect(first.status).toBe('resolved');
      expect(second.status).toBe('resolved');
      expect(third.status).toBe('pending');
      expect(written()).toEqual([
        Buffer.from([0x52, 0x01, 0x00, 0x01]),
        Buffer.from([0x52, 0x02, 0x00, 0x02]),
        Buffer.from([0x0a, 0x03, 0x00])
      ]);
    });

    it('a follow-up request of a procedure is queued behind what is already queued', async () => {
      gatt.currentMtu = 4;
      const longRead = track(gatt.readHandle(0x0001));
      const other = track(gatt.readHandle(0x0002));

      // fills the MTU: the read continues with a read blob, behind the queued read
      push([0x0b, 0x01, 0x02, 0x03]);
      await tick();

      expect(written()).toEqual([Buffer.from([0x0a, 0x01, 0x00]), Buffer.from([0x0a, 0x02, 0x00])]);
      expect(gatt.commandQueue).toHaveLength(1);

      push([0x0b, 0x09]);
      await tick();

      expect(other).toEqual({ status: 'resolved', value: Buffer.from([0x09]) });
      expect(written()[2]).toEqual(Buffer.from([0x0c, 0x01, 0x00, 0x03, 0x00]));

      push([0x0d, 0x04]);
      await tick();

      expect(longRead).toEqual({ status: 'resolved', value: Buffer.from([0x01, 0x02, 0x03, 0x04]) });
    });
  });

  describe('close', () => {
    it('rejects the in-flight and all queued commands', async () => {
      const error = new Error('link gone');
      const current = track(gatt.readHandle(0x0001));
      const queuedRequest = track(gatt.readHandle(0x0002));
      const queuedWrite = track(gatt.writeHandle(0x0003, Buffer.from([0x01]), true));
      const queuedDiscovery = track(gatt.discoverServices([]));

      gatt.close(error);
      await tick();

      expect(current).toEqual({ status: 'rejected', error });
      expect(queuedRequest).toEqual({ status: 'rejected', error });
      expect(queuedWrite).toEqual({ status: 'rejected', error });
      expect(queuedDiscovery).toEqual({ status: 'rejected', error });

      expect(gatt.currentCommand).toBe(null);
      expect(gatt.commandQueue).toEqual([]);
      expect(aclStream.write).toHaveBeenCalledTimes(1);
    });

    it('rejects commands issued after close without writing', async () => {
      const error = new Error('link gone');
      gatt.close(error);

      await expect(gatt.readHandle(0x0001)).rejects.toBe(error);
      await expect(gatt.writeHandle(0x0001, Buffer.from([0x01]), true)).rejects.toBe(error);
      await expect(gatt.exchangeMtu()).rejects.toBe(error);
      expect(aclStream.write).not.toHaveBeenCalled();
    });

    it('keeps the first error when closed twice', async () => {
      const error = new Error('link gone');
      gatt.close(error);
      gatt.close(new Error('again'));

      await expect(gatt.readHandle(0x0001)).rejects.toBe(error);
    });

    it('rejects a multi-step procedure in the middle', async () => {
      const error = new Error('link gone');
      const discovery = track(gatt.discoverServices([]));

      push([0x11, 0x06, 0x01, 0x00, 0x05, 0x00, 0x00, 0x18]);
      await tick();
      expect(aclStream.write).toHaveBeenCalledTimes(2);

      gatt.close(error);
      await tick();

      expect(discovery).toEqual({ status: 'rejected', error });
    });
  });

  describe('AttError', () => {
    it('is built from an ATT Error Response PDU', () => {
      const error = new AttError(Buffer.from([0x01, 0x12, 0x34, 0x12, 0x03]));

      expect(error).toBeInstanceOf(NobleError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('AttError');
      expect(error.opcode).toBe(0x12);
      expect(error.handle).toBe(0x1234);
      expect(error.code).toBe(0x03);
      expect(error.message).toContain('0x03');
      expect(error.message).toContain('Write Not Permitted');
    });

    it('tolerates a truncated PDU', () => {
      const error = new AttError(Buffer.from([0x01]));

      expect(error.opcode).toBe(0);
      expect(error.handle).toBe(0);
      expect(error.code).toBe(0);
    });
  });

  it('writeAtt should call acl write', () => {
    const data = Buffer.from([0x01]);

    gatt.writeAtt(data);

    expect(aclStream.write).toHaveBeenCalledTimes(1);
    expect(aclStream.write).toHaveBeenCalledWith(4, data);
  });

  describe('PDU builders', () => {
    it('errorResponse', () => {
      expect(gatt.errorResponse(8, 3000, 7)).toEqual(Buffer.from([0x01, 0x08, 0xb8, 0x0b, 0x07]));
    });

    it('mtuRequest', () => {
      expect(gatt.mtuRequest(67)).toEqual(Buffer.from([0x02, 0x43, 0x00]));
    });

    it('mtuResponse', () => {
      expect(gatt.mtuResponse(67)).toEqual(Buffer.from([0x03, 0x43, 0x00]));
    });

    it('readByGroupRequest', () => {
      expect(gatt.readByGroupRequest(8, 3000, 7)).toEqual(Buffer.from([0x10, 0x08, 0x00, 0xb8, 0x0b, 0x07, 0x00]));
    });

    it('readByTypeRequest', () => {
      expect(gatt.readByTypeRequest(8, 3000, 7)).toEqual(Buffer.from([0x08, 0x08, 0x00, 0xb8, 0x0b, 0x07, 0x00]));
    });

    it('readRequest', () => {
      expect(gatt.readRequest(67)).toEqual(Buffer.from([0x0a, 0x43, 0x00]));
    });

    it('readBlobRequest', () => {
      expect(gatt.readBlobRequest(67, 68)).toEqual(Buffer.from([0x0c, 0x43, 0x00, 0x44, 0x00]));
    });

    it('findInfoRequest', () => {
      expect(gatt.findInfoRequest(67, 68)).toEqual(Buffer.from([0x04, 0x43, 0x00, 0x44, 0x00]));
    });

    it('writeRequest withoutResponse', () => {
      expect(gatt.writeRequest(67, Buffer.from([0x05, 0x06, 0x07]), true)).toEqual(Buffer.from([0x52, 0x43, 0x00, 0x05, 0x06, 0x07]));
    });

    it('writeRequest withResponse', () => {
      expect(gatt.writeRequest(67, Buffer.from([0x05, 0x06, 0x07]), false)).toEqual(Buffer.from([0x12, 0x43, 0x00, 0x05, 0x06, 0x07]));
    });

    it('prepareWriteRequest', () => {
      expect(gatt.prepareWriteRequest(67, 68, Buffer.from([0x05, 0x06, 0x07]))).toEqual(Buffer.from([0x16, 0x43, 0x00, 0x44, 0x00, 0x05, 0x06, 0x07]));
    });

    it('executeWriteRequest cancelPreparedWrites', () => {
      expect(gatt.executeWriteRequest(67, true)).toEqual(Buffer.from([0x18, 0x00]));
    });

    it('executeWriteRequest preparedWrites', () => {
      expect(gatt.executeWriteRequest(67, false)).toEqual(Buffer.from([0x18, 0x01]));
    });

    it('handleConfirmation', () => {
      expect(gatt.handleConfirmation()).toEqual(Buffer.from([0x1e]));
    });
  });

  describe('exchangeMtu', () => {
    it('writes an MTU request with the desired MTU', () => {
      track(gatt.exchangeMtu());

      expect(written()).toEqual([Buffer.from([0x02, 0x00, 0x01])]);
    });

    it('resolves with the current MTU when the response is not an MTU response', async () => {
      gatt.currentMtu = 22;
      const promise = gatt.exchangeMtu();

      push([0x65, 0x61, 0x74, 0x61]);

      await expect(promise).resolves.toBe(22);
      expect(gatt.mtu).toBe(22);
    });

    it('resolves with the current MTU on an error response', async () => {
      const promise = gatt.exchangeMtu();

      push([0x01, 0x02, 0x00, 0x00, 0x06]);

      await expect(promise).resolves.toBe(23);
      expect(gatt.mtu).toBe(23);
    });

    it('ATT_OP_MTU_RESP', async () => {
      gatt.currentMtu = 22;
      const promise = gatt.exchangeMtu();

      push([0x03, 0x12, 0x33]);

      await expect(promise).resolves.toBe(13074);
      expect(gatt.mtu).toBe(13074);
    });
  });

  describe('discoverServices', () => {
    const firstRequest = Buffer.from([0x10, 0x01, 0x00, 0xff, 0xff, 0x00, 0x28]);

    // 8 records of 7 bytes, all 0xff: mis-sized on purpose, the trailing uuids come out truncated
    const allFfData = () => {
      const data = [17, 7];
      for (let i = 0; i < data[1]; i++) {
        for (let j = 0; j < 8; j++) {
          data.push(255);
        }
      }
      return data;
    };

    const allFfServices = {
      ffffffffffffffffffffffffffffffff: {
        startHandle: 65535,
        endHandle: 65535,
        uuid: 'ffffffffffffffffffffffffffffffff'
      },
      ffffffffffffffffffff: {
        startHandle: 65535,
        endHandle: 65535,
        uuid: 'ffffffffffffffffffff'
      },
      ffffff: {
        startHandle: 65535,
        endHandle: 65535,
        uuid: 'ffffff'
      }
    };

    it('not ATT_OP_READ_BY_GROUP_RESP > non discovered', async () => {
      const promise = gatt.discoverServices(['service1']);

      push([0x01, 0x10, 0x01, 0x00, 0x0a]);

      await expect(promise).resolves.toEqual([]);
      expect(written()).toEqual([firstRequest]);
      expect(gatt.services.size).toBe(0);
    });

    it('ATT_OP_READ_BY_GROUP_RESP > queue', async () => {
      const result = track(gatt.discoverServices(['service1']));

      // Build data
      const data = [17, 6];
      for (let i = 0; i < data[1]; i++) {
        for (let j = 0; j < 8; j++) {
          data.push(i * 10 + j);
        }
      }

      push(data);
      await tick();

      expect(result.status).toBe('pending');
      // continues after the last end handle (14134)
      expect(written()).toEqual([firstRequest, Buffer.from([0x10, 0x37, 0x37, 0xff, 0xff, 0x00, 0x28])]);
    });

    it('ATT_OP_READ_BY_GROUP_RESP > event', async () => {
      const promise = gatt.discoverServices([]);

      push(allFfData());

      await expect(promise).resolves.toEqual([
        'ffffffffffffffffffffffffffffffff',
        'ffffffffffffffffffff',
        'ffffff'
      ]);
      expect(written()).toEqual([firstRequest]);
      expect(Object.fromEntries(gatt.services)).toEqual(allFfServices);
    });

    it('ATT_OP_READ_BY_GROUP_RESP > event matching uuid', async () => {
      const promise = gatt.discoverServices(['ffffffffffffffffffff']);

      push(allFfData());

      await expect(promise).resolves.toEqual(['ffffffffffffffffffff']);
      expect(written()).toEqual([firstRequest]);
      expect(Object.fromEntries(gatt.services)).toEqual(allFfServices);
    });

    it('ATT_OP_READ_BY_GROUP_RESP > event not matching uuid', async () => {
      const promise = gatt.discoverServices(['bbbbbbbbbbbbbbbbbbbbbbbbbbb']);

      push(allFfData());

      await expect(promise).resolves.toEqual([]);
      expect(written()).toEqual([firstRequest]);
      expect(Object.fromEntries(gatt.services)).toEqual(allFfServices);
    });

    it('16-bit and 128-bit services over several responses', async () => {
      const promise = gatt.discoverServices([]);

      push([0x11, 0x06, 0x01, 0x00, 0x05, 0x00, 0x00, 0x18, 0x06, 0x00, 0x09, 0x00, 0x0a, 0x18]);
      await tick();
      expect(written()[1]).toEqual(Buffer.from([0x10, 0x0a, 0x00, 0xff, 0xff, 0x00, 0x28]));

      push([0x11, 0x14, 0x0a, 0x00, 0x10, 0x00, ...Buffer.from('f0debc9a785634127856341278563412', 'hex')]);
      await tick();
      expect(written()[2]).toEqual(Buffer.from([0x10, 0x11, 0x00, 0xff, 0xff, 0x00, 0x28]));

      // attribute not found ends the discovery
      push([0x01, 0x10, 0x11, 0x00, 0x0a]);

      await expect(promise).resolves.toEqual(['1800', '180a', '1234567812345678123456789abcdef0']);
      expect(written()).toHaveLength(3);
      expect(Object.fromEntries(gatt.services)).toEqual({
        1800: { startHandle: 1, endHandle: 5, uuid: '1800' },
        '180a': { startHandle: 6, endHandle: 9, uuid: '180a' },
        '1234567812345678123456789abcdef0': { startHandle: 10, endHandle: 16, uuid: '1234567812345678123456789abcdef0' }
      });
    });

    it('an empty ATT_OP_READ_BY_GROUP_RESP ends the discovery', async () => {
      const promise = gatt.discoverServices([]);

      push([0x11, 0x06]);

      await expect(promise).resolves.toEqual([]);
      expect(written()).toEqual([firstRequest]);
    });
  });

  describe('discoverIncludedServices', () => {
    const service = {
      startHandle: 0xaaaa,
      endHandle: 0xdddd,
      uuid: 'uuid'
    };
    const firstRequest = Buffer.from([0x08, 0xaa, 0xaa, 0xdd, 0xdd, 0x02, 0x28]);

    const allFfData = () => {
      const data = [9, 7];
      for (let i = 0; i < data[1]; i++) {
        for (let j = 0; j < 10; j++) {
          data.push(255);
        }
      }
      return data;
    };

    it('rejects for an unknown service', async () => {
      const promise = gatt.discoverIncludedServices('nope', []);

      await expect(promise).rejects.toBeInstanceOf(NobleError);
      await expect(promise).rejects.not.toBeInstanceOf(AttError);
      expect(aclStream.write).not.toHaveBeenCalled();
    });

    it('not ATT_OP_READ_BY_TYPE_RESP > non discovered', async () => {
      setService(service);
      const promise = gatt.discoverIncludedServices(service.uuid, []);

      push([0x01, 0x08, 0xaa, 0xaa, 0x0a]);

      await expect(promise).resolves.toEqual([]);
      expect(written()).toEqual([firstRequest]);
    });

    it('ATT_OP_READ_BY_TYPE_RESP > queue', async () => {
      setService(service);
      const result = track(gatt.discoverIncludedServices(service.uuid, []));

      // Build data
      const data = [9, 8];
      for (let i = 0; i < data[1]; i++) {
        for (let j = 0; j < 10; j++) {
          data.push(i * 10 + j);
        }
      }

      push(data);
      await tick();

      expect(result.status).toBe('pending');
      // continues at 18761, up to the end of the service (56797)
      expect(written()).toEqual([firstRequest, Buffer.from([0x08, 0x49, 0x49, 0xdd, 0xdd, 0x02, 0x28])]);
    });

    it('ATT_OP_READ_BY_TYPE_RESP > event', async () => {
      setService({ ...service, endHandle: 0xffff });
      const promise = gatt.discoverIncludedServices(service.uuid, []);

      push(allFfData());

      await expect(promise).resolves.toEqual([
        'ffffffffffffffffffffffffffffffff',
        'ffffffffffffffffffffffffffffffff',
        'ffffffffffffffffffffffffffffffff',
        'ffffffffffffffffffffffffffffffff',
        'ffffffffffffffffffffffffffffffff',
        'ffffffffffffffffffffffffffffffff',
        'ffffffffffffffffffffffffffffffff',
        'ffffffffffffffffffffffffffffff',
        'ffffffffffffffff',
        'ff'
      ]);
      expect(written()).toEqual([Buffer.from([0x08, 0xaa, 0xaa, 0xff, 0xff, 0x02, 0x28])]);
    });

    it('ATT_OP_READ_BY_TYPE_RESP > event matching uuid', async () => {
      setService({ ...service, endHandle: 0xffff });
      const promise = gatt.discoverIncludedServices(service.uuid, ['ff']);

      push(allFfData());

      await expect(promise).resolves.toEqual(['ff']);
      expect(aclStream.write).toHaveBeenCalledTimes(1);
    });

    it('16-bit included services, continued until the error response', async () => {
      setService({ uuid: 'uuid', startHandle: 0x0010, endHandle: 0x0020 });
      const promise = gatt.discoverIncludedServices('uuid', ['180f']);

      // two records of 8 bytes: handle, included start, included end, uuid
      push([0x09, 0x08, 0x11, 0x00, 0x30, 0x00, 0x35, 0x00, 0x0a, 0x18, 0x12, 0x00, 0x40, 0x00, 0x45, 0x00, 0x0f, 0x18]);
      await tick();
      expect(written()).toEqual([
        Buffer.from([0x08, 0x10, 0x00, 0x20, 0x00, 0x02, 0x28]),
        Buffer.from([0x08, 0x13, 0x00, 0x20, 0x00, 0x02, 0x28])
      ]);

      push([0x01, 0x08, 0x13, 0x00, 0x0a]);

      await expect(promise).resolves.toEqual(['180f']);
    });
  });

  describe('discoverCharacteristics', () => {
    const service = {
      startHandle: 0xaaaa,
      endHandle: 0xdddd,
      uuid: 'uuid'
    };
    const firstRequest = Buffer.from([0x08, 0xaa, 0xaa, 0xdd, 0xdd, 0x03, 0x28]);

    // 7 records of 8 bytes, all 0xff: mis-sized on purpose, the trailing uuids come out truncated
    const allFfData = () => {
      const data = [9, 8];
      for (let i = 0; i < data[1]; i++) {
        for (let j = 0; j < 7; j++) {
          data.push(255);
        }
      }
      return data;
    };

    it('rejects for an unknown service', async () => {
      const promise = gatt.discoverCharacteristics('nope', []);

      await expect(promise).rejects.toBeInstanceOf(NobleError);
      expect(aclStream.write).not.toHaveBeenCalled();
    });

    it('not ATT_OP_READ_BY_TYPE_RESP > non discovered', async () => {
      setService(service);
      const promise = gatt.discoverCharacteristics(service.uuid, []);

      push([0x01, 0x08, 0xaa, 0xaa, 0x0a]);

      await expect(promise).resolves.toEqual([]);
      expect(written()).toEqual([firstRequest]);
      expect(gatt.characteristics.get(service.uuid).size).toBe(0);
      expect(gatt.descriptors.get(service.uuid).size).toBe(0);
    });

    it('ATT_OP_READ_BY_TYPE_RESP > queue', async () => {
      setService(service);
      const result = track(gatt.discoverCharacteristics(service.uuid, []));

      // Build data
      const data = [9, 8];
      for (let i = 0; i < data[1]; i++) {
        for (let j = 0; j < 10; j++) {
          data.push(i * 10 + j);
        }
      }

      push(data);
      await tick();

      expect(result.status).toBe('pending');
      // continues at 19532, up to the end of the service (56797)
      expect(written()).toEqual([firstRequest, Buffer.from([0x08, 0x4c, 0x4c, 0xdd, 0xdd, 0x03, 0x28])]);
    });

    it('ATT_OP_READ_BY_TYPE_RESP > event', async () => {
      setService({ ...service, endHandle: 0xffff });
      const promise = gatt.discoverCharacteristics(service.uuid, []);

      push(allFfData());

      const uuids = [
        'ffffffffffffffffffffffffffffffff',
        'ffffffffffffffffffffffffffffffff',
        'ffffffffffffffffffffffffffffffff',
        'ffffffffffffffffffffffffffffffff',
        'ffffffffffffffffffffffffffffffff',
        'ffffffffffffffffffffff',
        'ffffff'
      ];

      await expect(promise).resolves.toEqual(uuids.map((uuid) => ({ properties: ALL_PROPERTIES, uuid })));
      expect(written()).toEqual([Buffer.from([0x08, 0xaa, 0xaa, 0xff, 0xff, 0x03, 0x28])]);

      // internal handle table (same uuid: the last one wins)
      expect(Object.fromEntries(gatt.characteristics.get(service.uuid))).toEqual({
        ffffffffffffffffffffffffffffffff: {
          startHandle: 65535,
          properties: 255,
          valueHandle: 65535,
          uuid: 'ffffffffffffffffffffffffffffffff',
          endHandle: 65534
        },
        ffffffffffffffffffffff: {
          startHandle: 65535,
          properties: 255,
          valueHandle: 65535,
          uuid: 'ffffffffffffffffffffff',
          endHandle: 65534
        },
        ffffff: {
          startHandle: 65535,
          properties: 255,
          valueHandle: 65535,
          uuid: 'ffffff',
          endHandle: 65535
        }
      });
    });

    it('ATT_OP_READ_BY_TYPE_RESP > event not matching uuid', async () => {
      setService({ ...service, endHandle: 0xffff });
      const promise = gatt.discoverCharacteristics(service.uuid, ['ffffff']);

      push(allFfData());

      await expect(promise).resolves.toEqual([{ properties: ALL_PROPERTIES, uuid: 'ffffff' }]);
      expect(aclStream.write).toHaveBeenCalledTimes(1);
    });

    [{ prop: 'broadcast', byte: 1 }, { prop: 'read', byte: 2 }, { prop: 'writeWithoutResponse', byte: 4 }, { prop: 'write', byte: 8 }, { prop: 'notify', byte: 16 }, { prop: 'indicate', byte: 32 }, { prop: 'authenticatedSignedWrites', byte: 64 }, { prop: 'extendedProperties', byte: 128 }].forEach(({ prop, byte }) => {
      it(`ATT_OP_READ_BY_TYPE_RESP > event - ${prop}`, async () => {
        setService({ ...service, endHandle: 0xffff });
        const promise = gatt.discoverCharacteristics(service.uuid, []);

        // Build data
        const data = [9, 7];
        for (let i = 0; i < data[1]; i++) {
          data.push(255);
          data.push(255);
          data.push(byte);
          data.push(255);
          data.push(255);
          data.push(255);
          data.push(255);
        }

        push(data);

        const characteristics = await promise;
        expect(characteristics).toHaveLength(7);
        characteristics.forEach((characteristic: any) => {
          expect(characteristic).toEqual({ properties: [prop], uuid: 'ffff' });
        });
      });
    });

    it('computes the handle ranges over several responses', async () => {
      setService({ uuid: '180d', startHandle: 0x0010, endHandle: 0x0020 });
      const promise = gatt.discoverCharacteristics('180d', []);

      push([0x09, 0x07, 0x11, 0x00, 0x12, 0x12, 0x00, 0x37, 0x2a, 0x14, 0x00, 0x02, 0x15, 0x00, 0x38, 0x2a]);
      await tick();
      expect(written()[1]).toEqual(Buffer.from([0x08, 0x16, 0x00, 0x20, 0x00, 0x03, 0x28]));

      push([0x09, 0x15, 0x16, 0x00, 0x08, 0x17, 0x00, ...Buffer.from('f0debc9a785634127856341278563412', 'hex')]);
      await tick();
      expect(written()[2]).toEqual(Buffer.from([0x08, 0x18, 0x00, 0x20, 0x00, 0x03, 0x28]));

      push([0x01, 0x08, 0x18, 0x00, 0x0a]);

      await expect(promise).resolves.toEqual([
        { uuid: '2a37', properties: ['read', 'notify'] },
        { uuid: '2a38', properties: ['read'] },
        { uuid: '1234567812345678123456789abcdef0', properties: ['write'] }
      ]);

      expect(Object.fromEntries(gatt.characteristics.get('180d'))).toEqual({
        '2a37': { uuid: '2a37', startHandle: 0x11, properties: 0x12, valueHandle: 0x12, endHandle: 0x13 },
        '2a38': { uuid: '2a38', startHandle: 0x14, properties: 0x02, valueHandle: 0x15, endHandle: 0x15 },
        '1234567812345678123456789abcdef0': { uuid: '1234567812345678123456789abcdef0', startHandle: 0x16, properties: 0x08, valueHandle: 0x17, endHandle: 0x20 }
      });
    });
  });

  describe('read', () => {
    const serviceUuid = 'serviceUuid';
    const characteristic = {
      valueHandle: 0xaaaa,
      uuid: 'cUuid'
    };
    const readRequest = Buffer.from([0x0a, 0xaa, 0xaa]);

    beforeEach(() => {
      setCharacteristic(serviceUuid, characteristic);
    });

    it('rejects for an unknown service or characteristic', async () => {
      await expect(gatt.read('nope', characteristic.uuid)).rejects.toBeInstanceOf(NobleError);
      await expect(gatt.read(serviceUuid, 'nope')).rejects.toBeInstanceOf(NobleError);
      expect(aclStream.write).not.toHaveBeenCalled();
    });

    it('not ATT_OP_READ_RESP not ATT_OP_READ_BLOB_RESP resolves with an empty buffer', async () => {
      const promise = gatt.read(serviceUuid, characteristic.uuid);

      push([0x7f]);

      await expect(promise).resolves.toEqual(Buffer.alloc(0));
      expect(written()).toEqual([readRequest]);
    });

    it('rejects when the first response is an error response', async () => {
      const promise = gatt.read(serviceUuid, characteristic.uuid);

      push([0x01, 0x0a, 0xaa, 0xaa, 0x02]);

      await expect(promise).rejects.toBeInstanceOf(AttError);
      await expect(promise).rejects.toMatchObject({ opcode: 0x0a, handle: 0xaaaa, code: 0x02 });
      expect(written()).toEqual([readRequest]);
    });

    [11, 13].forEach(opcode => {
      it(`opcode = ${opcode} should resolve`, async () => {
        const promise = gatt.read(serviceUuid, characteristic.uuid);

        push([opcode, 1, 2, 3]);

        await expect(promise).resolves.toEqual(Buffer.from([1, 2, 3]));
        expect(written()).toEqual([readRequest]);
      });

      it(`opcode = ${opcode} should continue with a read blob request`, async () => {
        gatt.currentMtu = 4;
        const result = track(gatt.read(serviceUuid, characteristic.uuid));

        push([opcode, 1, 2, 3]);
        await tick();

        expect(result.status).toBe('pending');
        expect(written()).toEqual([readRequest, Buffer.from([0x0c, 0xaa, 0xaa, 0x03, 0x00])]);
      });
    });

    it('long read returns everything', async () => {
      gatt.currentMtu = 4;
      const promise = gatt.read(serviceUuid, characteristic.uuid);

      push([0x0b, 1, 2, 3]);
      await tick();
      push([0x0d, 4, 5, 6]);
      await tick();
      push([0x0d, 7]);

      await expect(promise).resolves.toEqual(Buffer.from([1, 2, 3, 4, 5, 6, 7]));
      expect(written()).toEqual([
        readRequest,
        Buffer.from([0x0c, 0xaa, 0xaa, 0x03, 0x00]),
        Buffer.from([0x0c, 0xaa, 0xaa, 0x06, 0x00])
      ]);
    });

    it('an error on a later read blob returns what was read so far', async () => {
      gatt.currentMtu = 4;
      const promise = gatt.read(serviceUuid, characteristic.uuid);

      push([0x0b, 1, 2, 3]);
      await tick();
      push([0x01, 0x0c, 0xaa, 0xaa, 0x0b]);

      await expect(promise).resolves.toEqual(Buffer.from([1, 2, 3]));
    });
  });

  describe('write', () => {
    const serviceUuid = 'serviceUuid';
    const characteristic = {
      valueHandle: 0xaaaa,
      uuid: 'cUuid'
    };

    beforeEach(() => {
      setCharacteristic(serviceUuid, characteristic);
    });

    it('rejects for an unknown service or characteristic', async () => {
      await expect(gatt.write('nope', characteristic.uuid, Buffer.from([1]), false)).rejects.toBeInstanceOf(NobleError);
      await expect(gatt.write(serviceUuid, 'nope', Buffer.from([1]), true)).rejects.toBeInstanceOf(NobleError);
      expect(aclStream.write).not.toHaveBeenCalled();
    });

    it('withoutResponse should write and resolve', async () => {
      const data = Buffer.from([1, 2, 3]);

      // would need a long write if it was a request
      gatt.currentMtu = data.length;
      await expect(gatt.write(serviceUuid, characteristic.uuid, data, true)).resolves.toBeUndefined();

      expect(written()).toEqual([Buffer.from([0x52, 0xaa, 0xaa, 1, 2, 3])]);
      expect(gatt.currentCommand).toBe(null);
    });

    it('should delegate to longWrite', async () => {
      const data = Buffer.from([1, 2, 3]);

      gatt.currentMtu = data.length;
      gatt.longWrite = jest.fn().mockResolvedValue(undefined);

      await expect(gatt.write(serviceUuid, characteristic.uuid, data, false)).resolves.toBeUndefined();

      expect(aclStream.write).not.toHaveBeenCalled();
      expect(gatt.longWrite).toHaveBeenCalledTimes(1);
      expect(gatt.longWrite).toHaveBeenCalledWith(characteristic.valueHandle, data);
    });

    it('withResponse should reject on an unexpected response', async () => {
      const data = Buffer.from([1, 2, 3]);

      gatt.currentMtu = data.length + 5;
      const promise = gatt.write(serviceUuid, characteristic.uuid, data, false);

      push([0x7f, 2, 3]);

      await expect(promise).rejects.toBeInstanceOf(NobleError);
      await expect(promise).rejects.not.toBeInstanceOf(AttError);
      expect(written()).toEqual([Buffer.from([0x12, 0xaa, 0xaa, 1, 2, 3])]);
    });

    it('withResponse should reject on an error response', async () => {
      const data = Buffer.from([1, 2, 3]);

      const promise = gatt.write(serviceUuid, characteristic.uuid, data, false);

      push([0x01, 0x12, 0xaa, 0xaa, 0x03]);

      await expect(promise).rejects.toBeInstanceOf(AttError);
      await expect(promise).rejects.toMatchObject({ opcode: 0x12, handle: 0xaaaa, code: 0x03 });
    });

    it('withResponse should resolve', async () => {
      const data = Buffer.from([19, 2, 3]);

      gatt.currentMtu = data.length + 5;
      const promise = gatt.write(serviceUuid, characteristic.uuid, data, false);

      push([19, 2, 3]);

      await expect(promise).resolves.toBeUndefined();
      expect(written()).toEqual([Buffer.from([0x12, 0xaa, 0xaa, 19, 2, 3])]);
    });
  });

  describe('longWrite', () => {
    const serviceUuid = 'serviceUuid';
    const characteristic = {
      valueHandle: 0xaaaa,
      uuid: 'cUuid'
    };
    const data = Buffer.from([19, 2, 3, 4, 5, 6]);
    const prepare1 = Buffer.from([0x16, 0xaa, 0xaa, 0x00, 0x00, 19, 2, 3, 4, 5]);
    const prepare2 = Buffer.from([0x16, 0xaa, 0xaa, 0x05, 0x00, 6]);
    const execute = Buffer.from([0x18, 0x01]);

    beforeEach(() => {
      setCharacteristic(serviceUuid, characteristic);
      gatt.currentMtu = 10;
    });

    it('should queue all prepare writes and the execute at once', async () => {
      const result = track(gatt.longWrite(characteristic.valueHandle, data));
      // queued behind the whole long write
      track(gatt.readHandle(0x0001));

      expect(written()).toEqual([prepare1]);
      expect(gatt.commandQueue.map((command: any) => command.buffer)).toEqual([prepare2, execute, Buffer.from([0x0a, 0x01, 0x00])]);

      // echo of the request is not a response
      push(prepare1);
      push([0x17, 0xaa, 0xaa, 0x00, 0x00, 19, 2, 3, 4, 5]);
      await tick();
      expect(written()).toEqual([prepare1, prepare2]);

      push([0x17, 0xaa, 0xaa, 0x05, 0x00, 6]);
      await tick();
      expect(written()).toEqual([prepare1, prepare2, execute]);
      expect(result.status).toBe('pending');

      push([0x19]);
      await tick();

      expect(result).toEqual({ status: 'resolved', value: undefined });
      expect(written()).toEqual([prepare1, prepare2, execute, Buffer.from([0x0a, 0x01, 0x00])]);
    });

    it('should resolve despite an unexpected prepare write response length', async () => {
      const result = track(gatt.longWrite(characteristic.valueHandle, data));

      push([0x17, 0xaa]);
      await tick();
      push([0x17]);
      await tick();
      push([0x19]);
      await tick();

      expect(result).toEqual({ status: 'resolved', value: undefined });
    });

    it('should reject when the execute write is not confirmed', async () => {
      const result = track(gatt.longWrite(characteristic.valueHandle, data));

      push([0x17, 0xaa, 0xaa, 0x00, 0x00, 19, 2, 3, 4, 5]);
      await tick();
      push([0x17, 0xaa, 0xaa, 0x05, 0x00, 6]);
      await tick();
      push([0x7f]);
      await tick();

      expect(result.status).toBe('rejected');
      expect(result.error).toBeInstanceOf(NobleError);
      expect(result.error).not.toBeInstanceOf(AttError);
    });

    it('should reject when the execute write fails', async () => {
      const result = track(gatt.longWrite(characteristic.valueHandle, data));

      push([0x17, 0xaa, 0xaa, 0x00, 0x00, 19, 2, 3, 4, 5]);
      await tick();
      push([0x17, 0xaa, 0xaa, 0x05, 0x00, 6]);
      await tick();
      push([0x01, 0x18, 0x00, 0x00, 0x0d]);
      await tick();

      expect(result.status).toBe('rejected');
      expect(result.error).toBeInstanceOf(AttError);
      expect(result.error.code).toBe(0x0d);
    });

    it('should still send everything, then reject, when a prepare write fails', async () => {
      const result = track(gatt.longWrite(characteristic.valueHandle, data));

      push([0x01, 0x16, 0xaa, 0xaa, 0x03]);
      await tick();
      expect(result.status).toBe('pending');
      expect(written()).toEqual([prepare1, prepare2]);

      push([0x01, 0x16, 0xaa, 0xaa, 0x09]);
      await tick();
      expect(written()).toEqual([prepare1, prepare2, execute]);

      push([0x19]);
      await tick();

      expect(result.status).toBe('rejected');
      expect(result.error).toBeInstanceOf(AttError);
      // the first failure is reported
      expect(result.error.code).toBe(0x03);
    });

    it('write over the MTU goes out as a long write', async () => {
      gatt.currentMtu = 23;
      const value = Buffer.alloc(21, 0x07);
      const result = track(gatt.write(serviceUuid, characteristic.uuid, value, false));

      // 18 bytes per chunk
      expect(written()).toEqual([Buffer.from([0x16, 0xaa, 0xaa, 0x00, 0x00, ...value.slice(0, 18)])]);
      expect(gatt.commandQueue.map((command: any) => command.buffer)).toEqual([
        Buffer.from([0x16, 0xaa, 0xaa, 0x12, 0x00, 0x07, 0x07, 0x07]),
        execute
      ]);

      push([0x17, 0xaa, 0xaa, 0x00, 0x00, ...value.slice(0, 18)]);
      await tick();
      push([0x17, 0xaa, 0xaa, 0x12, 0x00, 0x07, 0x07, 0x07]);
      await tick();
      push([0x19]);
      await tick();

      expect(result).toEqual({ status: 'resolved', value: undefined });
    });

    it('write at the MTU limit is a plain write request', () => {
      gatt.currentMtu = 23;
      const value = Buffer.alloc(20, 0x07);
      track(gatt.write(serviceUuid, characteristic.uuid, value, false));

      expect(written()).toEqual([Buffer.from([0x12, 0xaa, 0xaa, ...value])]);
      expect(gatt.commandQueue).toEqual([]);
    });
  });

  describe('broadcast', () => {
    const serviceUuid = 'serviceUuid';
    const characteristic = {
      startHandle: 0xaaaa,
      endHandle: 0xcccc,
      valueHandle: 0xbbbb,
      uuid: 'cUuid'
    };
    const readRequest = Buffer.from([0x08, 0xaa, 0xaa, 0xcc, 0xcc, 0x03, 0x29]);

    beforeEach(() => {
      setCharacteristic(serviceUuid, characteristic);
    });

    it('rejects for an unknown characteristic', async () => {
      await expect(gatt.broadcast(serviceUuid, 'nope', true)).rejects.toBeInstanceOf(NobleError);
      expect(aclStream.write).not.toHaveBeenCalled();
    });

    it('rejects without writing when the configuration cannot be read', async () => {
      const promise = gatt.broadcast(serviceUuid, characteristic.uuid, true);

      push([0x01, 0x08, 0xaa, 0xaa, 0x0a]);

      await expect(promise).rejects.toBeInstanceOf(AttError);
      expect(written()).toEqual([readRequest]);
    });

    it('rejects when the write is not confirmed', async () => {
      const result = track(gatt.broadcast(serviceUuid, characteristic.uuid, true));

      push([9, 2, 3, 4, 5, 6, 7, 8]);
      await tick();

      // handle 1027, value 0x0605 | 0x0001
      expect(written()).toEqual([readRequest, Buffer.from([0x12, 0x03, 0x04, 5, 6])]);

      push([9, 2, 3, 4]);
      await tick();

      expect(result.status).toBe('rejected');
      expect(result.error).toBeInstanceOf(NobleError);
    });

    it('writes the configuration and resolves', async () => {
      const result = track(gatt.broadcast(serviceUuid, characteristic.uuid, false));

      push([9, 2, 3, 4, 5, 6, 7, 8]);
      await tick();

      // handle 1027, value 0x0605 & 0xfffe
      expect(written()).toEqual([readRequest, Buffer.from([0x12, 0x03, 0x04, 4, 6])]);

      push([19, 2, 3, 4]);
      await tick();

      expect(result).toEqual({ status: 'resolved', value: undefined });
    });
  });

  describe('notify', () => {
    const serviceUuid = 'serviceUuid';
    let characteristic: any;
    const readRequest = Buffer.from([0x08, 0xaa, 0xaa, 0xdd, 0xdd, 0x02, 0x29]);

    beforeEach(() => {
      characteristic = {
        uuid: 'cUuid',
        startHandle: 0xaaaa,
        endHandle: 0xdddd
      };

      setCharacteristic(serviceUuid, characteristic);
    });

    it('rejects for an unknown characteristic', async () => {
      await expect(gatt.notify(serviceUuid, 'nope', true)).rejects.toBeInstanceOf(NobleError);
      expect(aclStream.write).not.toHaveBeenCalled();
    });

    it('not ATT_OP_READ_BY_TYPE_RESP, no write, rejects', async () => {
      const promise = gatt.notify(serviceUuid, characteristic.uuid, true);

      push([0x01, 0x08, 0xaa, 0xaa, 0x0a]);

      await expect(promise).rejects.toBeInstanceOf(AttError);
      await expect(promise).rejects.toMatchObject({ opcode: 0x08, handle: 0xaaaa, code: 0x0a });
      expect(written()).toEqual([readRequest]);
    });

    [
      { name: 'notify, no properties', notify: true, properties: 0x0, expectedValue: [4, 5] },
      { name: 'notify, useNotify', notify: true, properties: 0x10, expectedValue: [5, 5] },
      { name: 'notify, useIndicate', notify: true, properties: 0x20, expectedValue: [6, 5] },
      { name: 'notify, useNotify and useIndicate', notify: true, properties: 0x30, expectedValue: [5, 5] },
      { name: 'not notify, no properties', notify: false, properties: 0x0, expectedValue: [4, 5] },
      { name: 'not notify, useNotify', notify: false, properties: 0x10, expectedValue: [4, 5] },
      { name: 'not notify, useIndicate', notify: false, properties: 0x20, expectedValue: [4, 5] }
    ].forEach(({ name, notify, expectedValue, properties }) => {
      it(`rejects on an unconfirmed write with ${name}`, async () => {
        characteristic.properties = properties;

        const result = track(gatt.notify(serviceUuid, characteristic.uuid, notify));

        const data = [9, 1, 2, 3, 4, 5];
        push(data);
        await tick();

        // handle 770
        expect(written()).toEqual([readRequest, Buffer.from([0x12, 0x02, 0x03, ...expectedValue])]);

        push(data);
        await tick();

        expect(result.status).toBe('rejected');
        expect(result.error).toBeInstanceOf(NobleError);
      });
    });

    it('clears the indicate bit', async () => {
      characteristic.properties = 0x20;

      track(gatt.notify(serviceUuid, characteristic.uuid, false));

      push([9, 1, 2, 3, 0x07, 5]);
      await tick();

      expect(written()[1]).toEqual(Buffer.from([0x12, 0x02, 0x03, 0x05, 5]));
    });

    it('should resolve', async () => {
      const result = track(gatt.notify(serviceUuid, characteristic.uuid, true));

      push([9, 1, 2, 3, 4, 5]);
      await tick();
      push([19]);
      await tick();

      expect(written()).toEqual([readRequest, Buffer.from([0x12, 0x02, 0x03, 4, 5])]);
      expect(result).toEqual({ status: 'resolved', value: undefined });
    });

    it('rejects when the write gets an error response', async () => {
      const result = track(gatt.notify(serviceUuid, characteristic.uuid, true));

      push([9, 1, 2, 3, 4, 5]);
      await tick();
      push([0x01, 0x12, 0x02, 0x03, 0x03]);
      await tick();

      expect(result.status).toBe('rejected');
      expect(result.error).toBeInstanceOf(AttError);
      expect(result.error.handle).toBe(770);
    });
  });

  describe('discoverDescriptors', () => {
    const serviceUuid = 'serviceUuid';
    const characteristic = {
      uuid: 'cUuid',
      valueHandle: 0xcccc,
      endHandle: 0xeeee
    };
    const firstRequest = Buffer.from([0x04, 0xcd, 0xcc, 0xee, 0xee]);

    beforeEach(() => {
      setCharacteristic(serviceUuid, characteristic);
    });

    it('rejects for an unknown characteristic', async () => {
      await expect(gatt.discoverDescriptors(serviceUuid, 'nope')).rejects.toBeInstanceOf(NobleError);
      expect(aclStream.write).not.toHaveBeenCalled();
    });

    it('should continue after the last handle', async () => {
      const result = track(gatt.discoverDescriptors(serviceUuid, characteristic.uuid));

      // Build data
      const data = [5, 1];
      for (let i = 0; i < data[1]; i++) {
        for (let j = 0; j < 4; j++) {
          data.push(i * 10 + j);
        }
      }
      push(data);
      await tick();

      expect(result.status).toBe('pending');
      // continues at 257
      expect(written()).toEqual([firstRequest, Buffer.from([0x04, 0x01, 0x01, 0xee, 0xee])]);

      // attribute not found ends the discovery
      push([0x01, 0x04, 0x01, 0x01, 0x0a]);
      await tick();

      expect(result).toEqual({ status: 'resolved', value: ['302'] });
      expect(Object.fromEntries(gatt.descriptors.get(serviceUuid).get(characteristic.uuid))).toEqual({
        302: { handle: 256, uuid: '302' }
      });
    });

    it('should resolve at the end handle', async () => {
      const promise = gatt.discoverDescriptors(serviceUuid, characteristic.uuid);

      // Build data
      const data = [5, 1];
      for (let i = 0; i < data[1]; i++) {
        for (let j = 0; j < 4; j++) {
          data.push(238);
        }
      }
      push(data);

      await expect(promise).resolves.toEqual(['eeee']);
      expect(written()).toEqual([firstRequest]);
      expect(Object.fromEntries(gatt.descriptors.get(serviceUuid).get(characteristic.uuid))).toEqual({
        eeee: { handle: 0xeeee, uuid: 'eeee' }
      });
    });

    it('128-bit descriptors', async () => {
      const promise = gatt.discoverDescriptors(serviceUuid, characteristic.uuid);

      push([0x05, 0x02, 0xee, 0xee, ...Buffer.from('f0debc9a785634127856341278563412', 'hex')]);

      await expect(promise).resolves.toEqual(['1234567812345678123456789abcdef0']);
    });

    it('forgets the descriptors of a previous discovery', async () => {
      setDescriptor(serviceUuid, characteristic.uuid, { uuid: 'old', handle: 1 });
      const promise = gatt.discoverDescriptors(serviceUuid, characteristic.uuid);

      push([0x01, 0x04, 0xcd, 0xcc, 0x0a]);

      await expect(promise).resolves.toEqual([]);
      expect(gatt.descriptors.get(serviceUuid).get(characteristic.uuid).size).toBe(0);
    });
  });

  describe('readValue', () => {
    const serviceUuid = 'serviceUuid';
    const characteristicUuid = 'characteristicUuid';
    const descriptor = {
      uuid: 'descriptorUuid',
      handle: 0x3344
    };
    const readRequest = Buffer.from([0x0a, 0x44, 0x33]);

    beforeEach(() => {
      setDescriptor(serviceUuid, characteristicUuid, descriptor);
    });

    it('rejects for an unknown descriptor', async () => {
      await expect(gatt.readValue(serviceUuid, characteristicUuid, 'nope')).rejects.toBeInstanceOf(NobleError);
      await expect(gatt.readValue(serviceUuid, 'nope', descriptor.uuid)).rejects.toBeInstanceOf(NobleError);
      await expect(gatt.readValue('nope', characteristicUuid, descriptor.uuid)).rejects.toBeInstanceOf(NobleError);
      expect(aclStream.write).not.toHaveBeenCalled();
    });

    it('should resolve with an empty buffer on an unexpected response', async () => {
      const promise = gatt.readValue(serviceUuid, characteristicUuid, descriptor.uuid);

      push([0x7f]);

      await expect(promise).resolves.toEqual(Buffer.alloc(0));
      expect(written()).toEqual([readRequest]);
    });

    it('should reject when the first response is an error response', async () => {
      const promise = gatt.readValue(serviceUuid, characteristicUuid, descriptor.uuid);

      push([0x01, 0x0a, 0x44, 0x33, 0x02]);

      await expect(promise).rejects.toBeInstanceOf(AttError);
    });

    it('should resolve on different data.length/mtu', async () => {
      gatt.currentMtu = 80;
      const promise = gatt.readValue(serviceUuid, characteristicUuid, descriptor.uuid);

      push([11]);

      await expect(promise).resolves.toEqual(Buffer.alloc(0));
      expect(written()).toEqual([readRequest]);
    });

    it('should continue on same data.length/mtu', async () => {
      gatt.currentMtu = 7;
      const result = track(gatt.readValue(serviceUuid, characteristicUuid, descriptor.uuid));

      push([13, 1, 2, 3, 4, 5, 6]);
      await tick();

      expect(result.status).toBe('pending');
      expect(written()).toEqual([readRequest, Buffer.from([0x0c, 0x44, 0x33, 0x06, 0x00])]);
    });
  });

  describe('writeValue', () => {
    const serviceUuid = 'serviceUuid';
    const characteristicUuid = 'characteristicUuid';
    const descriptor = {
      uuid: 'descriptorUuid',
      handle: 0x3344
    };

    beforeEach(() => {
      setDescriptor(serviceUuid, characteristicUuid, descriptor);
    });

    it('rejects for an unknown descriptor', async () => {
      await expect(gatt.writeValue(serviceUuid, characteristicUuid, 'nope', Buffer.from([0]))).rejects.toBeInstanceOf(NobleError);
      expect(aclStream.write).not.toHaveBeenCalled();
    });

    it('should reject on an unexpected response', async () => {
      const promise = gatt.writeValue(serviceUuid, characteristicUuid, descriptor.uuid, Buffer.from([0]));

      push([0x7f]);

      await expect(promise).rejects.toBeInstanceOf(NobleError);
      expect(written()).toEqual([Buffer.from([0x12, 0x44, 0x33, 0x00])]);
    });

    it('should reject on an error response', async () => {
      const promise = gatt.writeValue(serviceUuid, characteristicUuid, descriptor.uuid, Buffer.from([0]));

      push([0x01, 0x12, 0x44, 0x33, 0x03]);

      await expect(promise).rejects.toBeInstanceOf(AttError);
    });

    it('should resolve', async () => {
      const promise = gatt.writeValue(serviceUuid, characteristicUuid, descriptor.uuid, Buffer.from([19]));

      push([19]);

      await expect(promise).resolves.toBeUndefined();
      expect(written()).toEqual([Buffer.from([0x12, 0x44, 0x33, 19])]);
    });
  });

  describe('readHandle', () => {
    const handle = 0x1234;
    const readRequest = Buffer.from([0x0a, 0x34, 0x12]);

    it('should resolve with an empty buffer on an unexpected response', async () => {
      const promise = gatt.readHandle(handle);

      push([0x7f]);

      await expect(promise).resolves.toEqual(Buffer.alloc(0));
      expect(written()).toEqual([readRequest]);
    });

    it('should reject when the first response is an error response', async () => {
      const promise = gatt.readHandle(handle);

      push([0x01, 0x0a, 0x34, 0x12, 0x01]);

      await expect(promise).rejects.toBeInstanceOf(AttError);
      await expect(promise).rejects.toMatchObject({ opcode: 0x0a, handle, code: 0x01 });
    });

    it('should resolve on different data.length/mtu', async () => {
      gatt.currentMtu = 80;
      const promise = gatt.readHandle(handle);

      push([11]);

      await expect(promise).resolves.toEqual(Buffer.alloc(0));
      expect(written()).toEqual([readRequest]);
    });

    it('should continue on same data.length/mtu', async () => {
      gatt.currentMtu = 7;
      const result = track(gatt.readHandle(handle));

      push([13, 1, 2, 3, 4, 5, 6]);
      await tick();

      expect(result.status).toBe('pending');
      expect(written()).toEqual([readRequest, Buffer.from([0x0c, 0x34, 0x12, 0x06, 0x00])]);
    });
  });

  describe('writeHandle', () => {
    const handle = 0x1234;

    it('should reject on an unexpected response', async () => {
      const promise = gatt.writeHandle(handle, Buffer.from([0]), false);

      push([0x7f]);

      await expect(promise).rejects.toBeInstanceOf(NobleError);
      expect(written()).toEqual([Buffer.from([0x12, 0x34, 0x12, 0x00])]);
    });

    it('should reject on an error response', async () => {
      const promise = gatt.writeHandle(handle, Buffer.from([0]), false);

      push([0x01, 0x12, 0x34, 0x12, 0x03]);

      await expect(promise).rejects.toBeInstanceOf(AttError);
    });

    it('should resolve', async () => {
      const promise = gatt.writeHandle(handle, Buffer.from([19]), false);

      push([19]);

      await expect(promise).resolves.toBeUndefined();
      expect(written()).toEqual([Buffer.from([0x12, 0x34, 0x12, 19])]);
    });

    it('does not use a long write for data over the MTU', async () => {
      const data = Buffer.alloc(30, 0x01);
      track(gatt.writeHandle(handle, data, false));

      expect(written()).toEqual([Buffer.from([0x12, 0x34, 0x12, ...data])]);
    });

    it('should resolve on withoutResponse', async () => {
      await expect(gatt.writeHandle(handle, Buffer.from([0]), true)).resolves.toBeUndefined();

      expect(written()).toEqual([Buffer.from([0x52, 0x34, 0x12, 0x00])]);
      expect(gatt.currentCommand).toBe(null);
    });
  });
});
