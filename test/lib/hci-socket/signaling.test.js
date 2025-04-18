// Mock the os module
jest.mock('os', () => ({
  platform: jest.fn()
}));

const os = require('os');
const Signaling = require('../../../lib/hci-socket/signaling');

describe('hci-socket signaling', () => {
  let signaling;
  let aclStream;
  const handle = 'handle';

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Setup aclStream mock
    aclStream = {
      on: jest.fn(),
      removeListener: jest.fn(),
      write: jest.fn()
    };

    signaling = new Signaling(handle, aclStream);
  });

  test('construct', () => {
    expect(aclStream.on).toHaveBeenCalledTimes(2);
    expect(aclStream.on).toHaveBeenCalledWith('data', expect.any(Function));
    expect(aclStream.on).toHaveBeenCalledWith('end', expect.any(Function));

    expect(signaling._handle).toBe(handle);
    expect(signaling._aclStream).toBe(aclStream);
  });

  describe('onAclStreamData', () => {
    beforeEach(() => {
      signaling.processConnectionParameterUpdateRequest = jest.fn();
    });

    test('should do nothing as not SIGNALING_CID', () => {
      signaling.onAclStreamData(0, 'data');
      expect(signaling.processConnectionParameterUpdateRequest).not.toHaveBeenCalled();
    });

    test('should do nothing as not CONNECTION_PARAMETER_UPDATE_REQUEST', () => {
      const data = Buffer.from([0, 1, 2, 3, 4]);
      signaling.onAclStreamData(5, data);
      expect(signaling.processConnectionParameterUpdateRequest).not.toHaveBeenCalled();
    });

    test('should call processConnectionParameterUpdateRequest', () => {
      const data = Buffer.from([18, 1, 2, 3, 4, 5]);
      signaling.onAclStreamData(5, data);
      expect(signaling.processConnectionParameterUpdateRequest).toHaveBeenCalledWith(1, Buffer.from([4, 5]));
    });
  });

  test('onAclStreamEnd', () => {
    signaling.onAclStreamEnd();

    expect(aclStream.removeListener).toHaveBeenCalledTimes(2);
    expect(aclStream.removeListener).toHaveBeenCalledWith('data', expect.any(Function));
    expect(aclStream.removeListener).toHaveBeenCalledWith('end', expect.any(Function));
  });

  describe('processConnectionParameterUpdateRequest', () => {
    test('should not write on linux', () => {
      os.platform.mockReturnValue('linux');
      const callback = jest.fn();

      signaling.on('connectionParameterUpdateRequest', callback);
      signaling.processConnectionParameterUpdateRequest(1, Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]));

      expect(callback).not.toHaveBeenCalled();
      expect(aclStream.write).not.toHaveBeenCalled();
    });

    test('should write on !linux', () => {
      os.platform.mockReturnValue('!linux');
      const callback = jest.fn();

      signaling.on('connectionParameterUpdateRequest', callback);
      signaling.processConnectionParameterUpdateRequest(1, Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]));

      expect(callback).toHaveBeenCalledWith(handle, 1.25, 2.5, 3, 40);
      expect(aclStream.write).toHaveBeenCalledWith(5, Buffer.from([0x13, 0x01, 0x02, 0x00, 0x00, 0x00]));
    });
  });
});