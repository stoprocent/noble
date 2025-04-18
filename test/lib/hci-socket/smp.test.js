// Mock the crypto module
jest.mock('../../../lib/hci-socket/crypto', () => ({
  r: jest.fn(),
  c1: jest.fn(),
  s1: jest.fn()
}));

// Import the mocked modules
const crypto = require('../../../lib/hci-socket/crypto');
const Smp = require('../../../lib/hci-socket/smp');

describe('hci-socket smp', () => {
  let smp;
  let aclStream;
  
  const localAddressType = 'public';
  const localAddress = 'aa:bb:cc:dd:ee:ff';
  const remoteAddressType = 'random';
  const remoteAddress = '00:11:22:33:44:55';

  beforeEach(() => {
    aclStream = {
      on: jest.fn(),
      removeListener: jest.fn(),
      write: jest.fn()
    };

    smp = new Smp(aclStream, localAddressType, localAddress, remoteAddressType, remoteAddress);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('construct 1', () => {
    expect(aclStream.on).toHaveBeenCalledTimes(2);
    expect(aclStream.on).toHaveBeenCalledWith('data', expect.any(Function));
    expect(aclStream.on).toHaveBeenCalledWith('end', expect.any(Function));

    expect(smp._iat).toEqual(Buffer.from([0x00]));
    expect(smp._ia).toEqual(Buffer.from([0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa]));
    expect(smp._rat).toEqual(Buffer.from([0x01]));
    expect(smp._ra).toEqual(Buffer.from([0x55, 0x44, 0x33, 0x22, 0x11, 0x00]));
  });

  test('construct 2', () => {
    jest.clearAllMocks();
    const smp = new Smp(aclStream, remoteAddressType, remoteAddress, localAddressType, localAddress);

    expect(aclStream.on).toHaveBeenCalledTimes(2);
    expect(aclStream.on).toHaveBeenCalledWith('data', expect.any(Function));
    expect(aclStream.on).toHaveBeenCalledWith('end', expect.any(Function));

    expect(smp._iat).toEqual(Buffer.from([0x01]));
    expect(smp._ia).toEqual(Buffer.from([0x55, 0x44, 0x33, 0x22, 0x11, 0x00]));
    expect(smp._rat).toEqual(Buffer.from([0x00]));
    expect(smp._ra).toEqual(Buffer.from([0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa]));
  });

  test('should write sendPairingRequest', () => {
    smp.write = jest.fn();

    smp.sendPairingRequest();

    expect(smp.write).toHaveBeenCalledWith(Buffer.from([0x01, 0x03, 0x00, 0x01, 0x10, 0x00, 0x01]));
  });

  describe('onAclStreamData', () => {
    beforeEach(() => {
      smp.handlePairingResponse = jest.fn();
      smp.handlePairingConfirm = jest.fn();
      smp.handlePairingRandom = jest.fn();
      smp.handlePairingFailed = jest.fn();
      smp.handleEncryptInfo = jest.fn();
      smp.handleMasterIdent = jest.fn();
    });

    test('should do nothing with !SMP_CID', () => {
      smp.onAclStreamData(0);

      expect(smp.handlePairingResponse).not.toHaveBeenCalled();
      expect(smp.handlePairingConfirm).not.toHaveBeenCalled();
      expect(smp.handlePairingRandom).not.toHaveBeenCalled();
      expect(smp.handlePairingFailed).not.toHaveBeenCalled();
      expect(smp.handleEncryptInfo).not.toHaveBeenCalled();
      expect(smp.handleMasterIdent).not.toHaveBeenCalled();
    });

    test('should handlePairingResponse', () => {
      const data = Buffer.from([0x02, 0x33, 0x44]);
      smp.onAclStreamData(6, data);

      expect(smp.handlePairingResponse).toHaveBeenCalledWith(data);
      expect(smp.handlePairingConfirm).not.toHaveBeenCalled();
      expect(smp.handlePairingRandom).not.toHaveBeenCalled();
      expect(smp.handlePairingFailed).not.toHaveBeenCalled();
      expect(smp.handleEncryptInfo).not.toHaveBeenCalled();
      expect(smp.handleMasterIdent).not.toHaveBeenCalled();
    });

    test('should handlePairingConfirm', () => {
      const data = Buffer.from([0x03, 0x33, 0x44]);
      smp.onAclStreamData(6, data);

      expect(smp.handlePairingResponse).not.toHaveBeenCalled();
      expect(smp.handlePairingConfirm).toHaveBeenCalledWith(data);
      expect(smp.handlePairingRandom).not.toHaveBeenCalled();
      expect(smp.handlePairingFailed).not.toHaveBeenCalled();
      expect(smp.handleEncryptInfo).not.toHaveBeenCalled();
      expect(smp.handleMasterIdent).not.toHaveBeenCalled();
    });

    test('should handlePairingRandom', () => {
      const data = Buffer.from([0x04, 0x33, 0x44]);
      smp.onAclStreamData(6, data);

      expect(smp.handlePairingResponse).not.toHaveBeenCalled();
      expect(smp.handlePairingConfirm).not.toHaveBeenCalled();
      expect(smp.handlePairingRandom).toHaveBeenCalledWith(data);
      expect(smp.handlePairingFailed).not.toHaveBeenCalled();
      expect(smp.handleEncryptInfo).not.toHaveBeenCalled();
      expect(smp.handleMasterIdent).not.toHaveBeenCalled();
    });

    test('should handlePairingFailed', () => {
      const data = Buffer.from([0x05, 0x33, 0x44]);
      smp.onAclStreamData(6, data);

      expect(smp.handlePairingResponse).not.toHaveBeenCalled();
      expect(smp.handlePairingConfirm).not.toHaveBeenCalled();
      expect(smp.handlePairingRandom).not.toHaveBeenCalled();
      expect(smp.handlePairingFailed).toHaveBeenCalledWith(data);
      expect(smp.handleEncryptInfo).not.toHaveBeenCalled();
      expect(smp.handleMasterIdent).not.toHaveBeenCalled();
    });

    test('should handleEncryptInfo', () => {
      const data = Buffer.from([0x06, 0x33, 0x44]);
      smp.onAclStreamData(6, data);

      expect(smp.handlePairingResponse).not.toHaveBeenCalled();
      expect(smp.handlePairingConfirm).not.toHaveBeenCalled();
      expect(smp.handlePairingRandom).not.toHaveBeenCalled();
      expect(smp.handlePairingFailed).not.toHaveBeenCalled();
      expect(smp.handleEncryptInfo).toHaveBeenCalledWith(data);
      expect(smp.handleMasterIdent).not.toHaveBeenCalled();
    });

    test('should handleMasterIdent', () => {
      const data = Buffer.from([0x07, 0x33, 0x44]);
      smp.onAclStreamData(6, data);

      expect(smp.handlePairingResponse).not.toHaveBeenCalled();
      expect(smp.handlePairingConfirm).not.toHaveBeenCalled();
      expect(smp.handlePairingRandom).not.toHaveBeenCalled();
      expect(smp.handlePairingFailed).not.toHaveBeenCalled();
      expect(smp.handleEncryptInfo).not.toHaveBeenCalled();
      expect(smp.handleMasterIdent).toHaveBeenCalledWith(data);
    });

    test('should do nothing on bad code', () => {
      const data = Buffer.from([0x08, 0x33, 0x44]);
      smp.onAclStreamData(6, data);

      expect(smp.handlePairingResponse).not.toHaveBeenCalled();
      expect(smp.handlePairingConfirm).not.toHaveBeenCalled();
      expect(smp.handlePairingRandom).not.toHaveBeenCalled();
      expect(smp.handlePairingFailed).not.toHaveBeenCalled();
      expect(smp.handleEncryptInfo).not.toHaveBeenCalled();
      expect(smp.handleMasterIdent).not.toHaveBeenCalled();
    });
  });

  test('onAclStreamEnd', () => {
    const callback = jest.fn();
    smp.on('end', callback);
    smp.onAclStreamEnd();

    expect(aclStream.removeListener).toHaveBeenCalledTimes(2);
    expect(aclStream.removeListener).toHaveBeenCalledWith('data', expect.any(Function));
    expect(aclStream.removeListener).toHaveBeenCalledWith('end', expect.any(Function));
    expect(callback).toHaveBeenCalled();
  });

  test('handlePairingResponse', () => {
    smp.write = jest.fn();
    crypto.c1.mockReturnValue(Buffer.from([0x99]));

    smp.handlePairingResponse('data');

    expect(smp._pres).toBe('data');
    expect(crypto.r).toHaveBeenCalled();
    expect(crypto.c1).toHaveBeenCalled();
    expect(smp.write).toHaveBeenCalledWith(Buffer.from([0x03, 0x99]));
  });

  test('handlePairingConfirm', () => {
    smp.write = jest.fn();
    smp._r = Buffer.from([0x99]);

    smp.handlePairingConfirm('data');

    expect(smp._pcnf).toBe('data');
    expect(smp.write).toHaveBeenCalledWith(Buffer.from([0x04, 0x99]));
  });

  describe('handlePairingRandom', () => {
    test('should emit stk', () => {
      crypto.c1.mockReturnValue(Buffer.from([0x99]));
      crypto.s1.mockReturnValue('stk_answer');

      const data = Buffer.from([0, 1]);
      const callback = jest.fn();
      const failCallback = jest.fn();

      smp._pcnf = Buffer.from([3, 153]);
      smp.on('stk', callback);
      smp.on('fail', failCallback);
      smp.handlePairingRandom(data);

      expect(callback).toHaveBeenCalledWith('stk_answer');
      expect(failCallback).not.toHaveBeenCalled();
    });

    test('should write and emit fail stk', () => {
      crypto.c1.mockReturnValue(Buffer.from([0x99]));
      crypto.s1.mockReturnValue('stk_answer');

      const data = Buffer.from([0, 1]);
      const callback = jest.fn();
      const failCallback = jest.fn();

      smp.write = jest.fn();
      smp._pcnf = Buffer.from([0]);
      smp.on('stk', callback);
      smp.on('fail', failCallback);
      smp.handlePairingRandom(data);

      expect(smp.write).toHaveBeenCalledWith(Buffer.from([4, 3]));
      expect(callback).not.toHaveBeenCalled();
      expect(failCallback).toHaveBeenCalled();
    });
  });

  test('should emit fail on handlePairingFailed', () => {
    const callback = jest.fn();
    smp.on('fail', callback);
    smp.handlePairingFailed();
    expect(callback).toHaveBeenCalled();
  });

  test('should emit ltk on handleEncryptInfo', () => {
    const callback = jest.fn();
    smp.on('ltk', callback);
    smp.handleEncryptInfo(Buffer.from([0x02, 0x03, 0x04]));
    expect(callback).toHaveBeenCalledWith(Buffer.from([0x03, 0x04]));
  });

  test('should emit masterIdent on handleMasterIdent', () => {
    const callback = jest.fn();
    smp.on('masterIdent', callback);
    smp.handleMasterIdent(Buffer.from([0x02, 0x03, 0x04, 0x05, 0x06]));
    expect(callback).toHaveBeenCalledWith(Buffer.from([0x03, 0x04]), Buffer.from([0x05, 0x06]));
  });

  test('should write on aclStream', () => {
    smp.write('data');
    expect(aclStream.write).toHaveBeenCalledWith(6, 'data');
  });
});