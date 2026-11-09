import * as os from 'os';

import { Signaling } from '../../../src/bindings/hci/signaling';

// Mock the os module
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  platform: jest.fn()
}));

describe('hci signaling', () => {
  let signaling: any;
  let aclStream: any;
  let callback: jest.Mock;
  let push: (data: Buffer) => void;
  const handle = 0x0040;

  // identifier 1, length 8: min interval 1, max interval 2, latency 3, supervision timeout 4
  const updateRequest = Buffer.from([0x12, 0x01, 0x08, 0x00, 1, 0, 2, 0, 3, 0, 4, 0]);

  const create = (userChannel: boolean) => {
    aclStream = {
      registerChannel: jest.fn(),
      write: jest.fn()
    };
    callback = jest.fn();

    signaling = new Signaling(handle, aclStream, userChannel, callback);
    push = aclStream.registerChannel.mock.calls[0][1];
  };

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    create(false);
  });

  test('construct', () => {
    expect(aclStream.registerChannel).toHaveBeenCalledTimes(1);
    expect(aclStream.registerChannel).toHaveBeenCalledWith(5, expect.any(Function));

    expect(signaling.handle).toBe(handle);
    expect(signaling.aclStream).toBe(aclStream);
  });

  describe('inbound data dispatch', () => {
    beforeEach(() => {
      signaling.processConnectionParameterUpdateRequest = jest.fn();
    });

    test('should do nothing as not CONNECTION_PARAMETER_UPDATE_REQUEST', () => {
      push(Buffer.from([0, 1, 2, 3, 4]));
      expect(signaling.processConnectionParameterUpdateRequest).not.toHaveBeenCalled();
    });

    test('should call processConnectionParameterUpdateRequest', () => {
      push(Buffer.from([18, 1, 2, 3, 4, 5]));
      expect(signaling.processConnectionParameterUpdateRequest).toHaveBeenCalledWith(1, Buffer.from([4, 5]));
    });
  });

  describe('connection parameter update request', () => {
    test('should not write on linux', () => {
      (os.platform as jest.Mock).mockReturnValue('linux');

      push(updateRequest);

      expect(callback).not.toHaveBeenCalled();
      expect(aclStream.write).not.toHaveBeenCalled();
    });

    test('should write on !linux', () => {
      (os.platform as jest.Mock).mockReturnValue('!linux');

      push(updateRequest);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith({
        handle,
        minInterval: 1.25,
        maxInterval: 2.5,
        latency: 3,
        supervisionTimeout: 40
      });
      expect(aclStream.write).toHaveBeenCalledTimes(1);
      expect(aclStream.write).toHaveBeenCalledWith(5, Buffer.from([0x13, 0x01, 0x02, 0x00, 0x00, 0x00]));
    });

    test('should write on linux when userChannel option is true', () => {
      (os.platform as jest.Mock).mockReturnValue('linux');
      create(true);

      push(updateRequest);

      expect(callback).toHaveBeenCalledWith({
        handle,
        minInterval: 1.25,
        maxInterval: 2.5,
        latency: 3,
        supervisionTimeout: 40
      });
      expect(aclStream.write).toHaveBeenCalledWith(5, Buffer.from([0x13, 0x01, 0x02, 0x00, 0x00, 0x00]));
    });

    test('should not write on linux when userChannel option is false, even if HCI_CHANNEL_USER is set', () => {
      const originalEnv = process.env.HCI_CHANNEL_USER;
      process.env.HCI_CHANNEL_USER = '1';

      try {
        (os.platform as jest.Mock).mockReturnValue('linux');
        create(false);

        push(updateRequest);

        expect(callback).not.toHaveBeenCalled();
        expect(aclStream.write).not.toHaveBeenCalled();
      } finally {
        if (typeof originalEnv === 'undefined') {
          delete process.env.HCI_CHANNEL_USER;
        } else {
          process.env.HCI_CHANNEL_USER = originalEnv;
        }
      }
    });
  });
});
