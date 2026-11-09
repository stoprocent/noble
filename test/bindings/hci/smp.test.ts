import * as crypto from '../../../src/bindings/hci/crypto';
import { Smp } from '../../../src/bindings/hci/smp';

// Mock the crypto module
jest.mock('../../../src/bindings/hci/crypto', () => ({
  r: jest.fn(),
  c1: jest.fn(),
  s1: jest.fn()
}));

describe('hci smp', () => {
  let smp: any;
  let aclStream: any;
  let delegate: any;
  let push: (data: Buffer) => void;

  const localAddressType = 'public';
  const localAddress = 'aa:bb:cc:dd:ee:ff';
  const remoteAddressType = 'random';
  const remoteAddress = '00:11:22:33:44:55';

  beforeEach(() => {
    aclStream = {
      registerChannel: jest.fn(),
      write: jest.fn()
    };
    delegate = {
      onStk: jest.fn(),
      onFail: jest.fn(),
      onLtk: jest.fn(),
      onMasterIdent: jest.fn()
    };

    smp = new Smp(aclStream, localAddressType, localAddress, remoteAddressType, remoteAddress, delegate);
    push = aclStream.registerChannel.mock.calls[0][1];
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('construct 1', () => {
    expect(aclStream.registerChannel).toHaveBeenCalledTimes(1);
    expect(aclStream.registerChannel).toHaveBeenCalledWith(6, expect.any(Function));

    expect(smp.iat).toEqual(Buffer.from([0x00]));
    expect(smp.ia).toEqual(Buffer.from([0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa]));
    expect(smp.rat).toEqual(Buffer.from([0x01]));
    expect(smp.ra).toEqual(Buffer.from([0x55, 0x44, 0x33, 0x22, 0x11, 0x00]));
  });

  test('construct 2', () => {
    jest.clearAllMocks();
    const smp: any = new Smp(aclStream, remoteAddressType, remoteAddress, localAddressType, localAddress, delegate);

    expect(aclStream.registerChannel).toHaveBeenCalledTimes(1);
    expect(aclStream.registerChannel).toHaveBeenCalledWith(6, expect.any(Function));

    expect(smp.iat).toEqual(Buffer.from([0x01]));
    expect(smp.ia).toEqual(Buffer.from([0x55, 0x44, 0x33, 0x22, 0x11, 0x00]));
    expect(smp.rat).toEqual(Buffer.from([0x00]));
    expect(smp.ra).toEqual(Buffer.from([0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa]));
  });

  test('should write sendPairingRequest', () => {
    smp.sendPairingRequest();

    expect(aclStream.write).toHaveBeenCalledTimes(1);
    expect(aclStream.write).toHaveBeenCalledWith(6, Buffer.from([0x01, 0x03, 0x00, 0x01, 0x10, 0x00, 0x01]));
  });

  describe('inbound data dispatch', () => {
    const handlers = [
      'handlePairingResponse',
      'handlePairingConfirm',
      'handlePairingRandom',
      'handlePairingFailed',
      'handleEncryptInfo',
      'handleMasterIdent',
      'handleSecurityRequest'
    ];

    beforeEach(() => {
      handlers.forEach((name) => {
        smp[name] = jest.fn();
      });
    });

    const expectOnly = (called: string | null, data?: Buffer) => {
      handlers.forEach((name) => {
        if (name === called) {
          expect(smp[name]).toHaveBeenCalledTimes(1);
          if (name !== 'handlePairingFailed' && name !== 'handleSecurityRequest') {
            expect(smp[name]).toHaveBeenCalledWith(data);
          }
        } else {
          expect(smp[name]).not.toHaveBeenCalled();
        }
      });
    };

    test.each([
      [0x02, 'handlePairingResponse'],
      [0x03, 'handlePairingConfirm'],
      [0x04, 'handlePairingRandom'],
      [0x05, 'handlePairingFailed'],
      [0x06, 'handleEncryptInfo'],
      [0x07, 'handleMasterIdent'],
      [0x0b, 'handleSecurityRequest']
    ])('code 0x%s should call %s', (code, handler) => {
      const data = Buffer.from([code, 0x33, 0x44]);
      push(data);

      expectOnly(handler, data);
    });

    test('should do nothing on bad code', () => {
      push(Buffer.from([0x08, 0x33, 0x44]));

      expectOnly(null);
    });
  });

  describe('security request (Core Spec Vol 3 Part H 3.6.7)', () => {
    test('is answered with pairing failed, pairing not supported', () => {
      push(Buffer.from([0x0b, 0x01]));

      expect(aclStream.write).toHaveBeenCalledTimes(1);
      expect(aclStream.write).toHaveBeenCalledWith(6, Buffer.from([0x05, 0x05]));
    });

    test('is not reported as a pairing failure', () => {
      push(Buffer.from([0x0b, 0x01]));

      expect(delegate.onFail).not.toHaveBeenCalled();
      expect(delegate.onStk).not.toHaveBeenCalled();
    });

    test('is answered whatever the requested authentication, also when it is missing', () => {
      push(Buffer.from([0x0b, 0x0d]));
      push(Buffer.from([0x0b]));

      expect(aclStream.write.mock.calls).toEqual([
        [6, Buffer.from([0x05, 0x05])],
        [6, Buffer.from([0x05, 0x05])]
      ]);
    });

    test('is answered every time it is repeated', () => {
      push(Buffer.from([0x0b, 0x01]));
      push(Buffer.from([0x0b, 0x01]));

      expect(aclStream.write).toHaveBeenCalledTimes(2);
    });

    test('is ignored once our own pairing request is out, so the pairing is not aborted', () => {
      smp.sendPairingRequest();
      aclStream.write.mockClear();

      push(Buffer.from([0x0b, 0x01]));

      expect(aclStream.write).not.toHaveBeenCalled();
      expect(delegate.onFail).not.toHaveBeenCalled();
    });

    test('is answered again after our own pairing failed', () => {
      smp.sendPairingRequest();
      push(Buffer.from([0x05, 0x03]));
      aclStream.write.mockClear();
      delegate.onFail.mockClear();

      push(Buffer.from([0x0b, 0x01]));

      expect(aclStream.write).toHaveBeenCalledTimes(1);
      expect(aclStream.write).toHaveBeenCalledWith(6, Buffer.from([0x05, 0x05]));
      expect(delegate.onFail).not.toHaveBeenCalled();
    });
  });

  test('handlePairingResponse', () => {
    (crypto.r as jest.Mock).mockReturnValue(Buffer.from([0x77]));
    (crypto.c1 as jest.Mock).mockReturnValue(Buffer.from([0x99]));

    smp.sendPairingRequest();
    aclStream.write.mockClear();

    const data = Buffer.from([0x02, 0x33, 0x44]);
    push(data);

    expect(smp.pres).toBe(data);
    expect(crypto.r).toHaveBeenCalled();
    expect(crypto.c1).toHaveBeenCalledWith(
      Buffer.alloc(16),
      Buffer.from([0x77]),
      data,
      Buffer.from([0x01, 0x03, 0x00, 0x01, 0x10, 0x00, 0x01]),
      Buffer.from([0x00]),
      Buffer.from([0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa]),
      Buffer.from([0x01]),
      Buffer.from([0x55, 0x44, 0x33, 0x22, 0x11, 0x00])
    );
    expect(aclStream.write).toHaveBeenCalledTimes(1);
    expect(aclStream.write).toHaveBeenCalledWith(6, Buffer.from([0x03, 0x99]));
  });

  test('handlePairingConfirm', () => {
    smp.r = Buffer.from([0x99]);

    const data = Buffer.from([0x03, 0x01]);
    push(data);

    expect(smp.pcnf).toBe(data);
    expect(aclStream.write).toHaveBeenCalledTimes(1);
    expect(aclStream.write).toHaveBeenCalledWith(6, Buffer.from([0x04, 0x99]));
  });

  describe('handlePairingRandom', () => {
    beforeEach(() => {
      smp.preq = Buffer.from([0x01]);
      smp.pres = Buffer.from([0x02]);
      smp.tk = Buffer.alloc(16);
      smp.r = Buffer.from([0x55]);
    });

    test('should report stk', () => {
      (crypto.c1 as jest.Mock).mockReturnValue(Buffer.from([0x99]));
      (crypto.s1 as jest.Mock).mockReturnValue('stk_answer');

      smp.pcnf = Buffer.from([3, 153]);
      push(Buffer.from([4, 1]));

      expect(crypto.s1).toHaveBeenCalledWith(Buffer.alloc(16), Buffer.from([1]), Buffer.from([0x55]));
      expect(delegate.onStk).toHaveBeenCalledTimes(1);
      expect(delegate.onStk).toHaveBeenCalledWith('stk_answer');
      expect(delegate.onFail).not.toHaveBeenCalled();
      expect(aclStream.write).not.toHaveBeenCalled();
    });

    test('should write and report fail on confirm mismatch', () => {
      (crypto.c1 as jest.Mock).mockReturnValue(Buffer.from([0x99]));
      (crypto.s1 as jest.Mock).mockReturnValue('stk_answer');

      smp.pcnf = Buffer.from([0]);
      push(Buffer.from([4, 1]));

      expect(aclStream.write).toHaveBeenCalledTimes(1);
      expect(aclStream.write).toHaveBeenCalledWith(6, Buffer.from([4, 3]));
      expect(delegate.onStk).not.toHaveBeenCalled();
      expect(delegate.onFail).toHaveBeenCalledTimes(1);
    });
  });

  test('out-of-sequence pairing PDUs are ignored', () => {
    push(Buffer.from([0x02, 0x33, 0x44])); // response without request
    push(Buffer.from([0x03, 0x33, 0x44])); // confirm without response
    push(Buffer.from([0x04, 0x33, 0x44])); // random without confirm

    expect(aclStream.write).not.toHaveBeenCalled();
    expect(delegate.onStk).not.toHaveBeenCalled();
    expect(delegate.onFail).not.toHaveBeenCalled();
  });

  test('should report fail on pairing failed', () => {
    push(Buffer.from([0x05, 0x03]));

    expect(delegate.onFail).toHaveBeenCalledTimes(1);
    expect(delegate.onStk).not.toHaveBeenCalled();
  });

  test('should report ltk on encrypt info', () => {
    push(Buffer.from([0x06, 0x03, 0x04]));

    expect(delegate.onLtk).toHaveBeenCalledWith(Buffer.from([0x03, 0x04]));
  });

  test('should report masterIdent on master ident', () => {
    push(Buffer.from([0x07, 0x03, 0x04, 0x05, 0x06]));

    expect(delegate.onMasterIdent).toHaveBeenCalledWith(Buffer.from([0x03, 0x04]), Buffer.from([0x05, 0x06]));
  });

  test('optional delegate methods may be omitted', () => {
    const minimal = { onStk: jest.fn(), onFail: jest.fn() };
    aclStream.registerChannel.mockClear();
    // eslint-disable-next-line no-new
    new Smp(aclStream, localAddressType, localAddress, remoteAddressType, remoteAddress, minimal);
    const pushMinimal = aclStream.registerChannel.mock.calls[0][1];

    expect(() => pushMinimal(Buffer.from([0x06, 0x03, 0x04]))).not.toThrow();
    expect(() => pushMinimal(Buffer.from([0x07, 0x03, 0x04, 0x05, 0x06]))).not.toThrow();
  });
});
