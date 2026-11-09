import { AclStream } from '../../../src/bindings/hci/acl-stream';
import { Smp } from '../../../src/bindings/hci/smp';
import { NobleError } from '../../../src/common/errors';

jest.mock('../../../src/bindings/hci/smp', () => ({
  Smp: jest.fn().mockImplementation(() => ({
    sendPairingRequest: jest.fn()
  }))
}));

describe('hci acl-stream', () => {
  const handle = 0x0040;
  const localAddressType = 'public';
  const localAddress = 'aa:bb:cc:dd:ee:ff';
  const remoteAddressType = 'random';
  const remoteAddress = '00:11:22:33:44:55';

  let hci: any;
  let aclStream: any;
  let smp: any;
  let smpDelegate: any;

  beforeEach(() => {
    jest.clearAllMocks();

    hci = {
      writeAclDataPkt: jest.fn(),
      startLeEncryption: jest.fn()
    };

    aclStream = new AclStream(hci, handle, localAddressType, localAddress, remoteAddressType, remoteAddress);
    smp = (Smp as unknown as jest.Mock).mock.results[0].value;
    smpDelegate = (Smp as unknown as jest.Mock).mock.calls[0][5];
  });

  it('constructor', () => {
    expect(Smp).toHaveBeenCalledTimes(1);
    expect(Smp).toHaveBeenCalledWith(aclStream, localAddressType, localAddress, remoteAddressType, remoteAddress, {
      onStk: expect.any(Function),
      onFail: expect.any(Function)
    });
  });

  it('write', () => {
    const data = Buffer.from([0x01, 0x02]);

    aclStream.write(4, data);

    expect(hci.writeAclDataPkt).toHaveBeenCalledTimes(1);
    expect(hci.writeAclDataPkt).toHaveBeenCalledWith(handle, 4, data);
  });

  describe('push', () => {
    it('delivers data to the handler registered for the cid', () => {
      const attHandler = jest.fn();
      const signalingHandler = jest.fn();
      const data = Buffer.from([0x01, 0x02]);

      aclStream.registerChannel(4, attHandler);
      aclStream.registerChannel(5, signalingHandler);
      aclStream.push(4, data);

      expect(attHandler).toHaveBeenCalledTimes(1);
      expect(attHandler).toHaveBeenCalledWith(data);
      expect(signalingHandler).not.toHaveBeenCalled();
    });

    it('drops data for a cid without handler', () => {
      const attHandler = jest.fn();

      aclStream.registerChannel(4, attHandler);

      expect(() => aclStream.push(0x40, Buffer.from([0x01]))).not.toThrow();
      expect(attHandler).not.toHaveBeenCalled();
    });

    it('keeps one handler per cid', () => {
      const first = jest.fn();
      const second = jest.fn();

      aclStream.registerChannel(4, first);
      aclStream.registerChannel(4, second);
      aclStream.push(4, Buffer.from([0x01]));

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });
  });

  describe('encrypt', () => {
    it('sends a pairing request', () => {
      aclStream.encrypt().catch(() => {});

      expect(smp.sendPairingRequest).toHaveBeenCalledTimes(1);
      expect(smp.sendPairingRequest).toHaveBeenCalledWith();
    });

    it('resolves on a truthy encryption change', async () => {
      const settled = jest.fn();
      const promise = aclStream.encrypt().then(settled);

      aclStream.pushEncrypt(0);
      await new Promise(setImmediate);
      expect(settled).not.toHaveBeenCalled();

      aclStream.pushEncrypt(1);
      await expect(promise).resolves.toBeUndefined();
      expect(settled).toHaveBeenCalledTimes(1);
    });

    it('shares one attempt between concurrent callers', async () => {
      const first = aclStream.encrypt();
      const second = aclStream.encrypt();

      expect(smp.sendPairingRequest).toHaveBeenCalledTimes(1);

      aclStream.pushEncrypt(1);

      await expect(first).resolves.toBeUndefined();
      await expect(second).resolves.toBeUndefined();
    });

    it('starts a new attempt once the previous one settled', async () => {
      const first = aclStream.encrypt();
      smpDelegate.onFail();
      await expect(first).rejects.toBeInstanceOf(NobleError);

      const second = aclStream.encrypt();
      expect(smp.sendPairingRequest).toHaveBeenCalledTimes(2);

      aclStream.pushEncrypt(1);
      await expect(second).resolves.toBeUndefined();
    });

    it('rejects on SMP failure', async () => {
      const promise = aclStream.encrypt();

      smpDelegate.onFail();

      await expect(promise).rejects.toBeInstanceOf(NobleError);
    });

    it('rejects on close', async () => {
      const promise = aclStream.encrypt();

      aclStream.close();

      await expect(promise).rejects.toBeInstanceOf(NobleError);
    });

    it('rejects after close without pairing', async () => {
      aclStream.close();

      await expect(aclStream.encrypt()).rejects.toBeInstanceOf(NobleError);
      expect(smp.sendPairingRequest).not.toHaveBeenCalled();
    });
  });

  it('pushEncrypt without a pending encrypt does nothing', () => {
    expect(() => aclStream.pushEncrypt(1)).not.toThrow();
    expect(() => aclStream.pushEncrypt(0)).not.toThrow();
  });

  it('SMP failure without a pending encrypt does nothing', () => {
    expect(() => smpDelegate.onFail()).not.toThrow();
  });

  it('starts LE encryption on STK', () => {
    const stk = Buffer.from('00112233445566778899aabbccddeeff', 'hex');

    smpDelegate.onStk(stk);

    expect(hci.startLeEncryption).toHaveBeenCalledTimes(1);
    expect(hci.startLeEncryption).toHaveBeenCalledWith(
      handle,
      Buffer.from('0000000000000000', 'hex'),
      Buffer.from('0000', 'hex'),
      stk
    );
  });

  it('close drops the channel handlers', () => {
    const attHandler = jest.fn();

    aclStream.registerChannel(4, attHandler);
    aclStream.close();
    aclStream.push(4, Buffer.from([0x01]));

    expect(attHandler).not.toHaveBeenCalled();
  });
});
