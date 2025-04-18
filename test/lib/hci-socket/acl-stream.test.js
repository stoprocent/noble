const { jest: jestFn } = require('@jest/globals');

// Use jest.mock instead of proxyquire
jest.mock('../../../lib/hci-socket/smp', () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn().mockResolvedValue(null),
    removeListener: jest.fn().mockResolvedValue(null),
    sendPairingRequest: jest.fn().mockResolvedValue(null)
  }));
});

const Smp = require('../../../lib/hci-socket/smp');
const AclStream = require('../../../lib/hci-socket/acl-stream');

describe('hci-socket acl-stream', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('constructor', () => {
    const hci = jest.fn().mockResolvedValue();
    const handle = jest.fn().mockResolvedValue();
    const localAddressType = jest.fn().mockResolvedValue();
    const localAddress = jest.fn().mockResolvedValue();
    const remoteAddressType = jest.fn().mockResolvedValue();
    const remoteAddress = jest.fn().mockResolvedValue();

    const aclStream = new AclStream(hci, handle, localAddressType, localAddress, remoteAddressType, remoteAddress);

    expect(aclStream._hci).toBe(hci);
    expect(aclStream._handle).toBe(handle);

    expect(Smp).toHaveBeenCalledTimes(1);
    expect(Smp).toHaveBeenCalledWith(aclStream, localAddressType, localAddress, remoteAddressType, remoteAddress);

    expect(aclStream._smp.on).toHaveBeenCalledTimes(3);
    expect(aclStream._smp.on).toHaveBeenCalledWith('stk', expect.any(Function));
    expect(aclStream._smp.on).toHaveBeenCalledWith('fail', expect.any(Function));
    expect(aclStream._smp.on).toHaveBeenCalledWith('end', expect.any(Function));
  });

  it('encrypt', () => {
    const hci = jest.fn().mockResolvedValue();
    const handle = jest.fn().mockResolvedValue();
    const localAddressType = jest.fn().mockResolvedValue();
    const localAddress = jest.fn().mockResolvedValue();
    const remoteAddressType = jest.fn().mockResolvedValue();
    const remoteAddress = jest.fn().mockResolvedValue();

    const aclStream = new AclStream(hci, handle, localAddressType, localAddress, remoteAddressType, remoteAddress);

    aclStream.encrypt();

    expect(aclStream._smp.sendPairingRequest).toHaveBeenCalledTimes(1);
    expect(aclStream._smp.sendPairingRequest).toHaveBeenCalledWith();
  });

  it('write', () => {
    const hci = jest.fn().mockResolvedValue();
    const handle = jest.fn().mockResolvedValue();
    const localAddressType = jest.fn().mockResolvedValue();
    const localAddress = jest.fn().mockResolvedValue();
    const remoteAddressType = jest.fn().mockResolvedValue();
    const remoteAddress = jest.fn().mockResolvedValue();

    hci.writeAclDataPkt = jest.fn().mockResolvedValue(null);

    const aclStream = new AclStream(hci, handle, localAddressType, localAddress, remoteAddressType, remoteAddress);

    aclStream.write('cid', 'data');

    expect(hci.writeAclDataPkt).toHaveBeenCalledTimes(1);
    expect(hci.writeAclDataPkt).toHaveBeenCalledWith(handle, 'cid', 'data');
  });

  it('push data', () => {
    const hci = jest.fn().mockResolvedValue();
    const handle = jest.fn().mockResolvedValue();
    const localAddressType = jest.fn().mockResolvedValue();
    const localAddress = jest.fn().mockResolvedValue();
    const remoteAddressType = jest.fn().mockResolvedValue();
    const remoteAddress = jest.fn().mockResolvedValue();

    const aclStream = new AclStream(hci, handle, localAddressType, localAddress, remoteAddressType, remoteAddress);

    const eventEmitted = jest.fn().mockResolvedValue(null);
    aclStream.on('data', eventEmitted);

    aclStream.push('cid', 'data');

    expect(eventEmitted).toHaveBeenCalledTimes(1);
    expect(eventEmitted).toHaveBeenCalledWith('cid', 'data');
  });

  it('push no data', () => {
    const hci = jest.fn().mockResolvedValue();
    const handle = jest.fn().mockResolvedValue();
    const localAddressType = jest.fn().mockResolvedValue();
    const localAddress = jest.fn().mockResolvedValue();
    const remoteAddressType = jest.fn().mockResolvedValue();
    const remoteAddress = jest.fn().mockResolvedValue();

    const aclStream = new AclStream(hci, handle, localAddressType, localAddress, remoteAddressType, remoteAddress);

    const eventEmitted = jest.fn().mockResolvedValue(null);
    aclStream.on('end', eventEmitted);

    aclStream.push('cid');

    expect(eventEmitted).toHaveBeenCalledTimes(1);
    expect(eventEmitted).toHaveBeenCalledWith();
  });

  it('pushEncrypt', () => {
    const hci = jest.fn().mockResolvedValue();
    const handle = jest.fn().mockResolvedValue();
    const localAddressType = jest.fn().mockResolvedValue();
    const localAddress = jest.fn().mockResolvedValue();
    const remoteAddressType = jest.fn().mockResolvedValue();
    const remoteAddress = jest.fn().mockResolvedValue();

    const aclStream = new AclStream(hci, handle, localAddressType, localAddress, remoteAddressType, remoteAddress);

    const eventEmitted = jest.fn().mockResolvedValue(null);
    aclStream.on('encrypt', eventEmitted);

    aclStream.pushEncrypt('cid');

    expect(eventEmitted).toHaveBeenCalledTimes(1);
    expect(eventEmitted).toHaveBeenCalledWith('cid');
  });

  it('onSmpStk', () => {
    const hci = jest.fn().mockResolvedValue();
    const handle = jest.fn().mockResolvedValue();
    const localAddressType = jest.fn().mockResolvedValue();
    const localAddress = jest.fn().mockResolvedValue();
    const remoteAddressType = jest.fn().mockResolvedValue();
    const remoteAddress = jest.fn().mockResolvedValue();

    hci.startLeEncryption = jest.fn().mockResolvedValue(null);

    const aclStream = new AclStream(hci, handle, localAddressType, localAddress, remoteAddressType, remoteAddress);

    aclStream.onSmpStk('stk');

    expect(hci.startLeEncryption).toHaveBeenCalledTimes(1);
    expect(hci.startLeEncryption).toHaveBeenCalledWith(
      handle, 
      Buffer.from('0000000000000000', 'hex'), 
      Buffer.from('0000', 'hex'), 
      'stk'
    );
  });

  it('onSmpFail', () => {
    const hci = jest.fn().mockResolvedValue();
    const handle = jest.fn().mockResolvedValue();
    const localAddressType = jest.fn().mockResolvedValue();
    const localAddress = jest.fn().mockResolvedValue();
    const remoteAddressType = jest.fn().mockResolvedValue();
    const remoteAddress = jest.fn().mockResolvedValue();

    const aclStream = new AclStream(hci, handle, localAddressType, localAddress, remoteAddressType, remoteAddress);

    const eventEmitted = jest.fn().mockResolvedValue(null);
    aclStream.on('encryptFail', eventEmitted);

    aclStream.onSmpFail();

    expect(eventEmitted).toHaveBeenCalledTimes(1);
    expect(eventEmitted).toHaveBeenCalledWith();
  });

  it('onSmpEnd', () => {
    const hci = jest.fn().mockResolvedValue();
    const handle = jest.fn().mockResolvedValue();
    const localAddressType = jest.fn().mockResolvedValue();
    const localAddress = jest.fn().mockResolvedValue();
    const remoteAddressType = jest.fn().mockResolvedValue();
    const remoteAddress = jest.fn().mockResolvedValue();

    const aclStream = new AclStream(hci, handle, localAddressType, localAddress, remoteAddressType, remoteAddress);

    aclStream.onSmpEnd();

    expect(aclStream._smp.removeListener).toHaveBeenCalledTimes(3);
    expect(aclStream._smp.removeListener).toHaveBeenCalledWith('stk', expect.any(Function));
    expect(aclStream._smp.removeListener).toHaveBeenCalledWith('fail', expect.any(Function));
    expect(aclStream._smp.removeListener).toHaveBeenCalledWith('end', expect.any(Function));
  });
});