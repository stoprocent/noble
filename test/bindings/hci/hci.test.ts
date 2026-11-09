import { Hci, HCI_STATUS } from '../../../src/bindings/hci/hci';

// Stands in for the driver class returned by loadDriver(); its prototype is re-stubbed before every test.
const mockSocket: any = function () {};

jest.mock('@stoprocent/bluetooth-hci-socket', () => ({
  loadDriver: () => mockSocket
}));

const createDelegate = () => ({
  onStateChange: jest.fn(),
  onAddressChange: jest.fn(),
  onError: jest.fn(),
  onLeScanParametersSet: jest.fn(),
  onLeScanEnableSet: jest.fn(),
  onLeScanEnableSetCmd: jest.fn(),
  onLeAdvertisingReport: jest.fn(),
  onLeExtendedAdvertisingReport: jest.fn(),
  onLeConnComplete: jest.fn(),
  onLeConnUpdateComplete: jest.fn(),
  onDisconnComplete: jest.fn(),
  onEncryptChange: jest.fn(),
  onAclDataPkt: jest.fn(),
  onRssiRead: jest.fn(),
  onLeFeatures: jest.fn(),
  onLeDataLengthChange: jest.fn(),
  onReadLocalVersion: jest.fn()
});

// Command Complete for HCI_Reset: what makes Hci run its after-reset callbacks.
const RESET_CMD = 3075;

describe('hci-socket hci', () => {
  const deviceId = 'deviceId';

  // Private state is inspected and methods are stubbed per instance, hence `any`.
  let hci: any;
  let delegate: any;

  const newHci = (options = {}): any => new Hci(options, createDelegate());

  beforeEach(() => {
    mockSocket.prototype.on = jest.fn();
    mockSocket.prototype.bindUser = jest.fn();
    mockSocket.prototype.bindRaw = jest.fn();
    mockSocket.prototype.start = jest.fn();
    mockSocket.prototype.stop = jest.fn();
    mockSocket.prototype.isDevUp = jest.fn();
    mockSocket.prototype.removeAllListeners = jest.fn();
    mockSocket.prototype.setFilter = jest.fn();
    mockSocket.prototype.setAddress = jest.fn();
    mockSocket.prototype.write = jest.fn();

    delegate = createDelegate();
    hci = new Hci({}, delegate);
    hci.deviceId = deviceId;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('user channel configuration', () => {
    const originalUserChannel = process.env.HCI_CHANNEL_USER;

    afterEach(() => {
      if (typeof originalUserChannel === 'undefined') {
        delete process.env.HCI_CHANNEL_USER;
      } else {
        process.env.HCI_CHANNEL_USER = originalUserChannel;
      }
    });

    it('uses the userChannel option', () => {
      delete process.env.HCI_CHANNEL_USER;

      const configuredHci = newHci({ userChannel: true });

      expect(configuredHci.userChannel).toBe(true);
    });

    it('allows the option to disable an environment setting', () => {
      process.env.HCI_CHANNEL_USER = '1';

      const configuredHci = newHci({ userChannel: false });

      expect(configuredHci.userChannel).toBe(false);
    });

    it('uses HCI_CHANNEL_USER when the option is omitted', () => {
      process.env.HCI_CHANNEL_USER = '1';

      const configuredHci = newHci({});

      expect(configuredHci.userChannel).toBe(true);
    });
  });

  describe('coded phy configuration', () => {
    let originalCodedPhy;

    beforeEach(() => {
      originalCodedPhy = process.env.NOBLE_CODED_PHY;
    });

    afterEach(() => {
      if (originalCodedPhy === undefined) {
        delete process.env.NOBLE_CODED_PHY;
      } else {
        process.env.NOBLE_CODED_PHY = originalCodedPhy;
      }
    });

    it('is off by default', () => {
      delete process.env.NOBLE_CODED_PHY;

      expect(newHci({}).codedPhy).toBe(false);
    });

    it('treats controller support as unknown until features are read', () => {
      expect(newHci({ codedPhy: true }).supportsCodedPhy).toBe(false);
    });

    it('uses the codedPhy option', () => {
      delete process.env.NOBLE_CODED_PHY;

      expect(newHci({ codedPhy: true }).codedPhy).toBe(true);
    });

    it('allows the option to disable an environment setting', () => {
      process.env.NOBLE_CODED_PHY = '1';

      expect(newHci({ codedPhy: false }).codedPhy).toBe(false);
    });

    it('uses NOBLE_CODED_PHY when the option is omitted', () => {
      process.env.NOBLE_CODED_PHY = '1';

      expect(newHci({}).codedPhy).toBe(true);
    });

    it('is independent of extended mode', () => {
      delete process.env.NOBLE_CODED_PHY;

      expect(newHci({ extended: true }).codedPhy).toBe(false);
      expect(newHci({ codedPhy: true }).isExtended).toBe(false);
    });
  });

  describe('extended mode configuration', () => {
    it('keeps an explicit true value when capability replies disagree', () => {
      const configuredHci = newHci({ extended: true });
      const noLeExtendedAdvertising = Buffer.alloc(8);
      const noExtendedScanCommands = Buffer.alloc(64);

      configuredHci.processCmdCompleteEvent(8195, 0, noLeExtendedAdvertising);
      configuredHci.processCmdCompleteEvent(4098, 0, noExtendedScanCommands);

      expect(configuredHci.isExtended).toBe(true);
    });

    it('keeps an explicit false value when capabilities advertise extended support', () => {
      const configuredHci = newHci({ extended: false });
      const leExtendedAdvertising = Buffer.alloc(8);
      const extendedScanCommands = Buffer.alloc(64);
      leExtendedAdvertising[1] = 0x10;
      extendedScanCommands[37] = 0x30;

      configuredHci.processCmdCompleteEvent(8195, 0, leExtendedAdvertising);
      configuredHci.processCmdCompleteEvent(4098, 0, extendedScanCommands);

      expect(configuredHci.isExtended).toBe(false);
    });

    it('auto-detects from LE features only and always stores a boolean', () => {
      const detectedHci = newHci({});
      const leExtendedAdvertising = Buffer.alloc(8);
      const noExtendedScanCommands = Buffer.alloc(64);
      leExtendedAdvertising[1] = 0x10;

      detectedHci.processCmdCompleteEvent(8195, 0, leExtendedAdvertising);
      detectedHci.processCmdCompleteEvent(4098, 0, noExtendedScanCommands);

      expect(typeof detectedHci.isExtended).toBe('boolean');
      expect(detectedHci.isExtended).toBe(true);
    });
  });

  describe('init', () => {
    it('should reset', () => {
      hci.reset = jest.fn();

      hci.userChannel = 'userChannel';
      hci.init();

      expect(hci.socket.on).toHaveBeenCalledTimes(3);
      expect(hci.socket.on).toHaveBeenCalledWith('data', expect.any(Function));
      expect(hci.socket.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(hci.socket.on).toHaveBeenCalledWith('state', expect.any(Function));

      expect(hci.socket.bindUser).toHaveBeenCalledTimes(1);

      expect(hci.socket.bindUser).toHaveBeenCalledWith(deviceId, undefined);
      expect(hci.socket.start).toHaveBeenCalledTimes(1);
      expect(hci.socket.start).toHaveBeenCalledWith();

      expect(hci.reset).toHaveBeenCalledTimes(1);

      expect(hci.reset).toHaveBeenCalledWith();
    });

    it('should bindRaw', () => {
      hci.pollIsDevUp = jest.fn();
      hci.readLeSupportedFeatures = jest.fn();

      hci.userChannel = undefined;
      hci.bound = false;
      hci.init();

      expect(hci.socket.on).toHaveBeenCalledTimes(3);
      expect(hci.socket.on).toHaveBeenCalledWith('data', expect.any(Function));
      expect(hci.socket.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(hci.socket.on).toHaveBeenCalledWith('state', expect.any(Function));

      expect(hci.socket.bindRaw).toHaveBeenCalledTimes(1);

      expect(hci.socket.bindRaw).toHaveBeenCalledWith(deviceId, undefined);
      expect(hci.socket.start).toHaveBeenCalledTimes(1);
      expect(hci.socket.start).toHaveBeenCalledWith();

      expect(hci.pollIsDevUp).toHaveBeenCalledTimes(1);

      expect(hci.pollIsDevUp).toHaveBeenCalledWith();
      expect(hci.readLeSupportedFeatures).not.toHaveBeenCalled();

      expect(hci.bound).toBe(true);
      expect(hci.isStarted).toBe(true);
    });

    it('should not bindRaw', () => {
      hci.pollIsDevUp = jest.fn();

      hci.userChannel = undefined;
      hci.bound = true;
      hci.init();

      expect(hci.socket.on).toHaveBeenCalledTimes(3);
      expect(hci.socket.on).toHaveBeenCalledWith('data', expect.any(Function));
      expect(hci.socket.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(hci.socket.on).toHaveBeenCalledWith('state', expect.any(Function));

      expect(hci.socket.bindRaw).not.toHaveBeenCalled();
      expect(hci.socket.start).toHaveBeenCalledTimes(1);
      expect(hci.socket.start).toHaveBeenCalledWith();

      expect(hci.pollIsDevUp).toHaveBeenCalledTimes(1);

      expect(hci.pollIsDevUp).toHaveBeenCalledWith();

      expect(hci.bound).toBe(true);
    });

    it('should defer LE Read Local Supported Features until reset completes, and skip pollIsDevUp, for user channel', () => {
      hci.pollIsDevUp = jest.fn();
      hci.readLeSupportedFeatures = jest.fn();
      hci.setSocketFilter = jest.fn();

      hci.userChannel = true;
      hci.init();

      expect(hci.socket.bindUser).toHaveBeenCalledTimes(1);

      expect(hci.socket.bindUser).toHaveBeenCalledWith(deviceId, undefined);
      expect(hci.socket.start).toHaveBeenCalledTimes(1);
      expect(hci.socket.start).toHaveBeenCalledWith();

      expect(hci.readLeSupportedFeatures).not.toHaveBeenCalled();
      expect(hci.pollIsDevUp).not.toHaveBeenCalled();
      expect(hci.setSocketFilter).not.toHaveBeenCalled();
      expect(hci.isStarted).toBe(true);

      hci.processCmdCompleteEvent(RESET_CMD, 0, Buffer.alloc(0));

      expect(hci.readLeSupportedFeatures).toHaveBeenCalledTimes(1);

      expect(hci.readLeSupportedFeatures).toHaveBeenCalledWith();
    });
  });

  describe('pollIsDevUp', () => {
    let callback;

    beforeEach(() => {
      jest.useFakeTimers();

      callback = jest.fn();

      hci.setSocketFilter = jest.fn();
      hci.setEventMask = jest.fn();
      hci.setLeEventMask = jest.fn();
      hci.readLocalVersion = jest.fn();
      hci.writeLeHostSupported = jest.fn();
      hci.readLeHostSupported = jest.fn();
      hci.readLeBufferSize = jest.fn();
      hci.readBdAddr = jest.fn();
      hci.init = jest.fn();
      hci.readLeSupportedFeatures = jest.fn();
      hci.setCodedPhySupport = jest.fn();

      delegate.onStateChange = callback;
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should only register timeout', () => {
      hci.socket.isDevUp.mockReturnValue(true);
      hci.isDevUp = true;

      hci.pollIsDevUp();

      expect(hci.setSocketFilter).not.toHaveBeenCalled();
      expect(hci.setEventMask).not.toHaveBeenCalled();
      expect(hci.setLeEventMask).not.toHaveBeenCalled();
      expect(hci.readLocalVersion).not.toHaveBeenCalled();
      expect(hci.writeLeHostSupported).not.toHaveBeenCalled();
      expect(hci.readLeHostSupported).not.toHaveBeenCalled();
      expect(hci.readLeBufferSize).not.toHaveBeenCalled();
      expect(hci.readBdAddr).not.toHaveBeenCalled();
      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
      expect(hci.init).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
    });

    it('should re-init', () => {
      hci.socket.isDevUp.mockReturnValue(true);
      hci.isDevUp = false;
      hci.state = 'poweredOff';

      hci.pollIsDevUp();

      expect(hci.state).toBe(null);

      expect(hci.socket.removeAllListeners).toHaveBeenCalledTimes(1);

      expect(hci.socket.removeAllListeners).toHaveBeenCalledWith();
      expect(hci.init).toHaveBeenCalledTimes(1);
      expect(hci.init).toHaveBeenCalledWith();

      expect(hci.setSocketFilter).not.toHaveBeenCalled();
      expect(hci.setEventMask).not.toHaveBeenCalled();
      expect(hci.setLeEventMask).not.toHaveBeenCalled();
      expect(hci.readLocalVersion).not.toHaveBeenCalled();
      expect(hci.writeLeHostSupported).not.toHaveBeenCalled();
      expect(hci.readLeHostSupported).not.toHaveBeenCalled();
      expect(hci.readLeBufferSize).not.toHaveBeenCalled();
      expect(hci.readBdAddr).not.toHaveBeenCalled();
      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
    });

    it('should init all', () => {
      hci.socket.isDevUp.mockReturnValue(true);
      hci.isDevUp = false;
      hci.state = undefined;

      hci.pollIsDevUp();

      expect(hci.setSocketFilter).toHaveBeenCalledTimes(1);

      expect(hci.setSocketFilter).toHaveBeenCalledWith();
      expect(hci.readLeSupportedFeatures).toHaveBeenCalledTimes(1);
      expect(hci.readLeSupportedFeatures).toHaveBeenCalledWith();

      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
      expect(hci.socket.removeAllListeners).not.toHaveBeenCalled();
      expect(hci.init).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
    });

    it('should init all with extended option', () => {
      hci.socket.isDevUp.mockReturnValue(true);
      hci.isDevUp = false;
      hci.state = undefined;
      hci.isExtended = true;

      hci.pollIsDevUp();

      expect(hci.setSocketFilter).toHaveBeenCalledTimes(1);

      expect(hci.setSocketFilter).toHaveBeenCalledWith();
      expect(hci.readLeSupportedFeatures).toHaveBeenCalledTimes(1);
      expect(hci.readLeSupportedFeatures).toHaveBeenCalledWith();

      expect(hci.socket.removeAllListeners).not.toHaveBeenCalled();
      expect(hci.init).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
    });

    it('should keep exactly one pending timer no matter how many times it is invoked within the same tick', () => {
      hci.isStarted = true;
      hci.socket.isDevUp.mockReturnValue(true);
      hci.isDevUp = true;

      for (let i = 0; i < 10; i++) {
        hci.pollIsDevUp();
      }

      expect(jest.getTimerCount()).toBe(1);
    });

    it('should keep polling normally across ticks with a single timer', () => {
      hci.isStarted = true;
      hci.socket.isDevUp.mockReturnValue(true);
      hci.isDevUp = true;

      hci.pollIsDevUp();
      expect(jest.getTimerCount()).toBe(1);

      jest.advanceTimersByTime(1000);
      expect(jest.getTimerCount()).toBe(1);

      jest.advanceTimersByTime(1000);
      expect(jest.getTimerCount()).toBe(1);
    });

    it('should not re-arm the poll timer after stop()', () => {
      hci.socket.stop = jest.fn();
      hci.isStarted = true;
      hci.socket.isDevUp.mockReturnValue(true);
      hci.isDevUp = true;

      hci.pollIsDevUp();
      expect(jest.getTimerCount()).toBe(1);

      hci.stop();
      expect(jest.getTimerCount()).toBe(0);

      jest.advanceTimersByTime(1000);
      expect(jest.getTimerCount()).toBe(0);
      expect(hci.init).not.toHaveBeenCalled();
    });

    it('should re-initialise after a genuine power-off followed by power-on', () => {
      hci.state = 'poweredOn';
      hci.isDevUp = true;

      hci.socket.isDevUp.mockReturnValue(false);
      hci.pollIsDevUp();

      expect(callback).toHaveBeenCalledTimes(1);

      expect(callback).toHaveBeenCalledWith('poweredOff');
      expect(hci.state).toBe('poweredOff');

      hci.socket.isDevUp.mockReturnValue(true);
      hci.pollIsDevUp();

      expect(hci.socket.removeAllListeners).toHaveBeenCalledTimes(1);

      expect(hci.socket.removeAllListeners).toHaveBeenCalledWith();
      expect(hci.init).toHaveBeenCalledTimes(1);
      expect(hci.init).toHaveBeenCalledWith();
      expect(hci.state).toBe(null);
    });

    it('should end up with exactly one pending timer once init() re-enters pollIsDevUp during recovery', () => {
      hci.init = Hci.prototype.init;
      hci.isStarted = true;
      hci.state = 'poweredOff';
      hci.isDevUp = false;
      hci.socket.isDevUp.mockReturnValue(true);

      hci.pollIsDevUp();

      expect(jest.getTimerCount()).toBe(1);
    });

    it('should still leave a pending poll timer when init() throws during recovery', () => {
      hci.init = Hci.prototype.init;
      hci.isStarted = true;
      hci.state = 'poweredOff';
      hci.isDevUp = false;
      hci.socket.isDevUp.mockReturnValue(true);
      hci.socket.start = jest.fn(() => { throw new Error('boom'); });

      hci.pollIsDevUp();

      expect(jest.getTimerCount()).toBe(1);
    });

    it('should not reschedule itself for user channel', () => {
      hci.userChannel = true;
      hci.isStarted = true;
      hci.socket.isDevUp.mockReturnValue(true);
      hci.isDevUp = true;

      hci.pollIsDevUp();

      expect(jest.getTimerCount()).toBe(0);
    });
  });

  it('should write codedPhySupport command', () => {
    hci.setCodedPhySupport();
    expect(hci.socket.write).toHaveBeenCalledTimes(1);
    expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([0x01, 0x31, 0x20, 0x03, 0x00, 0x05, 0x05]));
  });

  it('should setSocketFilter', () => {
    hci.setSocketFilter();
    expect(hci.socket.setFilter).toHaveBeenCalledTimes(1);
    expect(hci.socket.setFilter).toHaveBeenCalledWith(Buffer.from([0x16, 0, 0, 0, 0x20, 0xc1, 0x08, 0, 0, 0, 0, 0x40, 0, 0]));
  });

  it('should setEventMask', () => {
    hci.setEventMask();
    expect(hci.socket.write).toHaveBeenCalledTimes(1);
    expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([1, 1, 0x0c, 0x08, 0xff, 0xff, 0xfb, 0xff, 0x07, 0xf8, 0xbf, 0x3d]));
  });

  describe('reset', () => {
    it('should write the reset command when no ACL connections are active', () => {
      hci.reset();
      expect(hci.socket.write).toHaveBeenCalledTimes(1);
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([1, 3, 0x0c, 0]));
    });

    it('should not write the reset command while an ACL connection is active, but still run the after-reset callbacks and the post-reset chain', () => {
      hci.setEventMask = jest.fn();
      hci.setLeEventMask = jest.fn();
      hci.readLocalVersion = jest.fn();
      hci.readBdAddr = jest.fn();
      const resetCallback = jest.fn();
      hci.afterResetCallbacks.push(resetCallback);

      hci.aclConnections.set(4404, { pending: 0 });

      hci.reset();

      expect(hci.socket.write).not.toHaveBeenCalled();
      expect(hci.setEventMask).toHaveBeenCalledTimes(1);
      expect(hci.setEventMask).toHaveBeenCalledWith();
      expect(hci.setLeEventMask).toHaveBeenCalledTimes(1);
      expect(hci.setLeEventMask).toHaveBeenCalledWith();
      expect(hci.readLocalVersion).toHaveBeenCalledTimes(1);
      expect(hci.readLocalVersion).toHaveBeenCalledWith();
      expect(hci.readBdAddr).toHaveBeenCalledTimes(1);
      expect(hci.readBdAddr).toHaveBeenCalledWith();
      expect(resetCallback).toHaveBeenCalledTimes(1);
    });

    it('should still reach createLeConnAfterReset via createLeConn while an ACL connection is active', () => {
      hci.setEventMask = jest.fn();
      hci.setLeEventMask = jest.fn();
      hci.readLocalVersion = jest.fn();
      hci.readBdAddr = jest.fn();
      hci.createLeConnAfterReset = jest.fn();
      hci.aclConnections.set(4404, { pending: 0 });

      const address = 'aa:bb:cc:dd:ee:ff';
      const addressType = 'random';
      const parameters = { minInterval: 0x0060, maxInterval: 0x00c0 };

      hci.createLeConn(address, addressType, parameters, true);

      expect(hci.socket.write).not.toHaveBeenCalled();
      expect(hci.createLeConnAfterReset).toHaveBeenCalledTimes(1);
      expect(hci.createLeConnAfterReset).toHaveBeenCalledWith(address, addressType, parameters, undefined);
    });

    it('should resume writing the reset command once the ACL connections are gone', () => {
      hci.setEventMask = jest.fn();
      hci.setLeEventMask = jest.fn();
      hci.readLocalVersion = jest.fn();
      hci.readBdAddr = jest.fn();

      hci.aclConnections.set(4404, { pending: 0 });
      hci.reset();
      expect(hci.socket.write).not.toHaveBeenCalled();

      hci.aclConnections.delete(4404);
      hci.reset();

      expect(hci.socket.write).toHaveBeenCalledTimes(1);

      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([1, 3, 0x0c, 0]));
    });
  });

  describe('stop', () => {
    it('should clear ACL bookkeeping so a subsequent reset() is not left permanently refused', () => {
      hci.socket.stop = jest.fn();
      hci.aclConnections.set(4404, { pending: 0 });
      hci.aclQueue.push({ handle: 4404, packet: Buffer.from([0x00]) });

      hci.stop();

      expect(hci.aclConnections.size).toBe(0);
      expect(hci.aclQueue).toHaveLength(0);

      hci.reset();
      expect(hci.socket.write).toHaveBeenCalledTimes(1);
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([1, 3, 0x0c, 0]));
    });
  });

  it('should readSupportedCommands', () => {
    hci.readSupportedCommands();
    expect(hci.socket.write).toHaveBeenCalledTimes(1);
    expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([0x01, 0x02, 0x10, 0x00]));
  });

  it('should readLocalVersion', () => {
    hci.readLocalVersion();
    expect(hci.socket.write).toHaveBeenCalledTimes(1);
    expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([1, 1, 0x10, 0]));
  });

  it('should readBufferSize', () => {
    hci.readBufferSize();
    expect(hci.socket.write).toHaveBeenCalledTimes(1);
    expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([1, 5, 0x10, 0]));
  });

  it('should readBdAddr', () => {
    hci.readBdAddr();
    expect(hci.socket.write).toHaveBeenCalledTimes(1);
    expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([1, 9, 0x10, 0]));
  });

  describe('setAddress', () => {
    it('should write vendor specific (Linux Foundation) command based on read local version response', () => {
      hci.readBdAddr = jest.fn();
      hci.setScanEnabled = jest.fn();
      hci.setScanParameters = jest.fn();

      const cmd = 4097;
      const status = 0;
      // hciVer=12, hciRev=0, lmpVer=12, manufacturer=1521, lmpSubVer=65535
      const result = Buffer.from([0x0C, 0x00, 0x00, 0x0C, 0xF1, 0x05, 0xFF, 0xFF]);

      hci.processCmdCompleteEvent(cmd, status, result);

      hci.setAddress('11:22:33:44:55:66');
      expect(hci.socket.write).toHaveBeenCalledTimes(1);
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([0x01, 0x06, 0xfc, 0x06, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11]));
    });

    it('should write vendor specific (Ericsson) command based on manufacturer value (', () => {
      hci.manufacturer = 0;
      hci.readBdAddr = jest.fn();
      hci.setAddress('11:22:33:44:55:66');
      expect(hci.socket.write).toHaveBeenCalledTimes(1);
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([0x01, 0x0d, 0xfc, 0x06, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11]));
    });

    it('should write vendor specific (Texas Instrument) command based on manufacturer value', () => {
      hci.manufacturer = 13;
      hci.readBdAddr = jest.fn();
      hci.setAddress('11:22:33:44:55:66');
      expect(hci.socket.write).toHaveBeenCalledTimes(1);
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([0x01, 0x06, 0xfc, 0x06, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11]));
    });

    it('should write vendor specific (BCM) command based on manufacturer value', () => {
      hci.manufacturer = 15;
      hci.readBdAddr = jest.fn();
      hci.setAddress('11:22:33:44:55:66');
      expect(hci.socket.write).toHaveBeenCalledTimes(1);
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([0x01, 0x01, 0xfc, 0x06, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11]));
    });

    it('should not write vendor specific command', () => {
      hci.setAddress('11:22:33:44:55:66');
      expect(hci.socket.write).not.toHaveBeenCalled();
    });
  });

  describe('setLeEventMask', () => {
    it('should setLeEventMask', () => {
      hci.setLeEventMask();
      expect(hci.socket.write).toHaveBeenCalledTimes(1);
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([1, 1, 0x20, 8, 0x5f, 0, 0, 0, 0, 0, 0, 0]));
    });

    it('should setLeEventMask for BLE5 (extended)', () => {
      hci.isExtended = true;
      hci.setLeEventMask();
      expect(hci.socket.write).toHaveBeenCalledTimes(1);
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([1, 1, 0x20, 8, 0x5f, 0xff, 0, 0, 0, 0, 0, 0]));
    });

    it('should enable the data length change subevent in both modes', () => {
      hci.setLeEventMask();
      expect(hci.socket.write.mock.calls[0][0].readUInt8(4) & 0x40).toBe(0x40);

      hci.socket.write.mockClear();
      hci.isExtended = true;
      hci.setLeEventMask();
      expect(hci.socket.write.mock.calls[0][0].readUInt8(4) & 0x40).toBe(0x40);
    });
  });

  describe('data length extension', () => {
    const LE_READ_LOCAL_SUPPORTED_FEATURES = 0x2003;
    const LE_READ_MAX_DATA_LENGTH_CMD = 0x202f;
    const LE_SET_DATA_LENGTH_OPCODE = 0x2022;

    const writesOf = (opcode) => hci.socket.write.mock.calls
      .map((call) => call[0])
      .filter((buffer) => buffer.length >= 3 && buffer.readUInt16LE(1) === opcode);

    // The address byte keeps the buffer from being all zero, which both handlers discard.
    const connCompleteData = (handle = 0x0040) => {
      const data = Buffer.alloc(17);
      data.writeUInt16LE(handle, 0);
      data.writeUInt8(0x01, 9);
      return data;
    };

    const enhancedConnCompleteData = (handle = 0x0040) => {
      const data = Buffer.alloc(29);
      data.writeUInt16LE(handle, 0);
      data.writeUInt8(0x01, 9);
      return data;
    };

    const maxDataLengthResult = (txOctets, txTime, rxOctets = 251, rxTime = 17040) => {
      const result = Buffer.alloc(8);
      result.writeUInt16LE(txOctets, 0);
      result.writeUInt16LE(txTime, 2);
      result.writeUInt16LE(rxOctets, 4);
      result.writeUInt16LE(rxTime, 6);
      return result;
    };

    const withNegotiatedMax = (txOctets = 251, txTime = 2120) => {
      hci.supportsDataLengthExtension = true;
      hci.maxDataLength = { txOctets, txTime };
    };

    it('treats the controller as unsupported until features are read', () => {
      expect(hci.supportsDataLengthExtension).toBe(false);
      expect(hci.maxDataLength).toBeNull();
    });

    it('reads the controller maximum when the feature bit is set', () => {
      // result[0] bit 5 is the LE Data Packet Length Extension feature bit
      hci.processCmdCompleteEvent(LE_READ_LOCAL_SUPPORTED_FEATURES, 0, Buffer.from([0x20, 0x00, 0x00, 0x00]));

      expect(hci.supportsDataLengthExtension).toBe(true);
      expect(writesOf(LE_READ_MAX_DATA_LENGTH_CMD)).toHaveLength(1);
    });

    it('leaves an unsupported controller alone', () => {
      hci.processCmdCompleteEvent(LE_READ_LOCAL_SUPPORTED_FEATURES, 0, Buffer.from([0x00, 0x00, 0x00, 0x00]));

      expect(hci.supportsDataLengthExtension).toBe(false);
      expect(writesOf(LE_READ_MAX_DATA_LENGTH_CMD)).toHaveLength(0);
    });

    it('does not read the maximum when the feature read fails', () => {
      hci.processCmdCompleteEvent(LE_READ_LOCAL_SUPPORTED_FEATURES, 0x0c, Buffer.from([0x20, 0x00, 0x00, 0x00]));

      expect(hci.supportsDataLengthExtension).toBe(false);
      expect(writesOf(LE_READ_MAX_DATA_LENGTH_CMD)).toHaveLength(0);
    });

    it('forgets a stored maximum when a later feature read reports no support', () => {
      withNegotiatedMax();

      hci.processCmdCompleteEvent(LE_READ_LOCAL_SUPPORTED_FEATURES, 0, Buffer.from([0x00, 0x00, 0x00, 0x00]));

      expect(hci.maxDataLength).toBeNull();
    });

    it('stores the reported maximum tx octets and time', () => {
      hci.processCmdCompleteEvent(LE_READ_MAX_DATA_LENGTH_CMD, 0, maxDataLengthResult(251, 2120));

      expect(hci.maxDataLength).toEqual({ txOctets: 251, txTime: 2120 });
    });

    it('clamps a reported maximum above the spec range', () => {
      hci.processCmdCompleteEvent(LE_READ_MAX_DATA_LENGTH_CMD, 0, maxDataLengthResult(0xffff, 0xffff));

      expect(hci.maxDataLength).toEqual({ txOctets: 251, txTime: 17040 });
    });

    it('rejects a reported maximum below the spec range', () => {
      hci.processCmdCompleteEvent(LE_READ_MAX_DATA_LENGTH_CMD, 0, maxDataLengthResult(26, 2120));
      expect(hci.maxDataLength).toBeNull();

      hci.processCmdCompleteEvent(LE_READ_MAX_DATA_LENGTH_CMD, 0, maxDataLengthResult(251, 327));
      expect(hci.maxDataLength).toBeNull();
    });

    it('ignores a failed maximum read', () => {
      hci.processCmdCompleteEvent(LE_READ_MAX_DATA_LENGTH_CMD, 0x0c, maxDataLengthResult(251, 2120));

      expect(hci.maxDataLength).toBeNull();
    });

    it('ignores a short maximum read result', () => {
      hci.processCmdCompleteEvent(LE_READ_MAX_DATA_LENGTH_CMD, 0, Buffer.from([0xfb, 0x00, 0x48, 0x08]));

      expect(hci.maxDataLength).toBeNull();
    });

    it('requests the data length once per connection', () => {
      withNegotiatedMax(251, 2120);

      hci.processLeConnComplete(0, connCompleteData(0x0040));

      const writes = writesOf(LE_SET_DATA_LENGTH_OPCODE);
      expect(writes).toHaveLength(1);
      expect(writes[0]).toEqual(Buffer.from([1, 0x22, 0x20, 6, 0x40, 0x00, 0xfb, 0x00, 0x48, 0x08]));
    });

    it('requests the data length for an enhanced connection', () => {
      withNegotiatedMax(251, 2120);

      hci.processLeEnhancedConnComplete(0, enhancedConnCompleteData(0x0041));

      const writes = writesOf(LE_SET_DATA_LENGTH_OPCODE);
      expect(writes).toHaveLength(1);
      expect(writes[0].readUInt16LE(4)).toBe(0x0041);
    });

    it('requests the data length again on reconnect', () => {
      withNegotiatedMax();

      hci.processLeConnComplete(0, connCompleteData(0x0040));
      hci.processLeConnComplete(0, connCompleteData(0x0041));

      expect(writesOf(LE_SET_DATA_LENGTH_OPCODE)).toHaveLength(2);
    });

    it('does not request the data length on an unsupported controller', () => {
      hci.maxDataLength = { txOctets: 251, txTime: 2120 };

      hci.processLeConnComplete(0, connCompleteData());

      expect(writesOf(LE_SET_DATA_LENGTH_OPCODE)).toHaveLength(0);
    });

    it('does not request the data length before the maximum is known', () => {
      hci.supportsDataLengthExtension = true;

      hci.processLeConnComplete(0, connCompleteData());

      expect(writesOf(LE_SET_DATA_LENGTH_OPCODE)).toHaveLength(0);
    });

    it('does not request the data length for a failed connection', () => {
      withNegotiatedMax();

      hci.processLeConnComplete(0x3e, connCompleteData());

      expect(writesOf(LE_SET_DATA_LENGTH_OPCODE)).toHaveLength(0);
    });

    it('still completes the connection when the request cannot be written', () => {
      withNegotiatedMax();
      hci.socket.write.mockImplementation(() => { throw new Error('ENOBUFS'); });
      const callback = jest.fn();
      delegate.onLeConnComplete = callback;

      hci.processLeConnComplete(0, connCompleteData(0x0040));

      expect(callback).toHaveBeenCalledTimes(1);
      expect(hci.aclConnections.has(0x0040)).toBe(true);
    });

    // Characterization: a rejected request is logged and otherwise ignored, so the stored
    // controller maximum stays usable for the next connection and no retry is attempted.
    it('keeps the stored maximum when the controller rejects the request', () => {
      withNegotiatedMax(251, 2120);

      hci.processCmdCompleteEvent(LE_SET_DATA_LENGTH_OPCODE, 0x11, Buffer.from([0x40, 0x00]));

      expect(hci.maxDataLength).toEqual({ txOctets: 251, txTime: 2120 });
      expect(writesOf(LE_SET_DATA_LENGTH_OPCODE)).toHaveLength(0);
    });

    it('emits the negotiated length from the data length change event', () => {
      const callback = jest.fn();
      delegate.onLeDataLengthChange = callback;

      // subevent parameters: handle 0x0140, max tx octets/time, max rx octets/time
      hci.processLeMetaEvent(0x07, 0x40, Buffer.from([0x01, 0xfb, 0x00, 0x48, 0x08, 0xfb, 0x00, 0x48, 0x08]));

      expect(callback).toHaveBeenCalledTimes(1);

      expect(callback.mock.calls[0]).toStrictEqual([{ handle: 0x0140, maxTxOctets: 251, maxTxTime: 2120, maxRxOctets: 251, maxRxTime: 2120 }]);
    });

    it('ignores a short data length change event', () => {
      const callback = jest.fn();
      delegate.onLeDataLengthChange = callback;

      hci.processLeMetaEvent(0x07, 0x40, Buffer.from([0x01, 0xfb, 0x00, 0x48]));

      expect(callback).not.toHaveBeenCalled();
    });
  });

  it('should readLeBufferSize', () => {
    hci.readLeBufferSize();
    expect(hci.socket.write).toHaveBeenCalledTimes(1);
    expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([1, 2, 0x20, 0]));
  });

  it('should readLeHostSupported', () => {
    hci.readLeHostSupported();
    expect(hci.socket.write).toHaveBeenCalledTimes(1);
    expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([1, 0x6c, 0x0c, 0]));
  });

  it('should writeLeHostSupported', () => {
    hci.writeLeHostSupported();
    expect(hci.socket.write).toHaveBeenCalledTimes(1);
    expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([1, 0x6d, 0x0c, 2, 1, 0]));
  });

  describe('setScanParameters', () => {
    it('should keep default parameters', () => {
      hci.setScanParameters();
      expect(hci.socket.write).toHaveBeenCalledTimes(1);
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([1, 0x0b, 0x20, 7, 1, 0x12, 0, 0x12, 0, 0, 0]));
    });

    it('should keep default parameters (extended with coded phy support)', () => {
      hci.isExtended = true;
      hci.supportsCodedPhy = true;
      hci.setScanParameters();
      expect(hci.socket.write).toHaveBeenCalledTimes(1);
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([1, 0x41, 0x20, 0x0d, 0x00, 0x00, 0x05, 0x01, 0x12, 0x00, 0x12, 0x00, 0x01, 0x12, 0x00, 0x12, 0x00]));
    });

    it('should omit coded phy parameters when the controller does not support it', () => {
      hci.isExtended = true;
      hci.supportsCodedPhy = false;
      hci.setScanParameters();
      expect(hci.socket.write).toHaveBeenCalledTimes(1);
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([1, 0x41, 0x20, 0x08, 0x00, 0x00, 0x01, 0x01, 0x12, 0x00, 0x12, 0x00]));
    });

    it('should force parameters', () => {
      hci.setScanParameters(0x2222, 0x3333);
      expect(hci.socket.write).toHaveBeenCalledTimes(1);
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([1, 0x0b, 0x20, 7, 1, 0x22, 0x022, 0x33, 0x33, 0, 0]));
    });

    it('should force parameters (extended with coded phy support)', () => {
      hci.isExtended = true;
      hci.supportsCodedPhy = true;
      hci.setScanParameters(0x2222, 0x3333);
      expect(hci.socket.write).toHaveBeenCalledTimes(1);
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([1, 0x41, 0x20, 0x0d, 0x00, 0x00, 0x05, 0x01, 0x22, 0x22, 0x33, 0x33, 0x01, 0x22, 0x22, 0x33, 0x33]));
    });
  });

  describe('setScanEnabled', () => {
    it('should keep default parameters', () => {
      hci.setScanEnabled();
      expect(hci.socket.write).toHaveBeenCalledTimes(1);
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([1, 0x0c, 0x20, 2, 0, 0]));
    });

    it('should keep default parameters (extended)', () => {
      hci.isExtended = true;
      hci.setScanEnabled();
      expect(hci.socket.write).toHaveBeenCalledTimes(1);
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([1, 0x42, 0x20, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
    });

    it('should force parameters', () => {
      hci.setScanEnabled(true, true);
      expect(hci.socket.write).toHaveBeenCalledTimes(1);
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([1, 0x0c, 0x20, 2, 1, 1]));
    });

    it('should force parameters (extended)', () => {
      hci.isExtended = true;
      hci.setScanEnabled(true, true);
      expect(hci.socket.write).toHaveBeenCalledTimes(1);
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([1, 0x42, 0x20, 0x06, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00]));
    });
  });

  describe('createLeConn', () => {
    it('should reset and call createLeConnAfterReset once the reset completes', () => {
      const address = 'aa:bb:cc:dd:ee:ff';
      const addressType = 'random';
      const parameters = { minInterval: 0x0060, maxInterval: 0x00c0 };
      const attemptToken = {};
      
      hci.createLeConnAfterReset = jest.fn();      
      hci.createLeConn(address, addressType, parameters, true, attemptToken);
      hci.processCmdCompleteEvent(RESET_CMD, 0, Buffer.alloc(0));

      expect(hci.createLeConnAfterReset).toHaveBeenCalledWith(
        address, addressType, parameters, attemptToken
      );
    });
  });

  describe('createLeConnAfterReset', () => {
    it('should keep default parameters', () => {
      const address = 'aa:bb:cc:dd:ee';
      const addressType = 'random';
      hci.createLeConnAfterReset(address, addressType);
      expect(hci.socket.write).toHaveBeenCalledTimes(1);
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([0x01, 0x0d, 0x20, 0x19, 0x60, 0x00, 0x30, 0x00, 0x00, 0x01, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 0x00, 0x00, 0x06, 0x00, 0x12, 0x00, 0x00, 0x00, 0x2a, 0x00, 0x04, 0x00, 0x06, 0x00]));
    });

    it('should keep default parameters (extended with coded phy support)', () => {
      const address = 'aa:bb:cc:dd:ee';
      const addressType = 'random';
      hci.isExtended = true;
      hci.supportsCodedPhy = true;
      hci.createLeConnAfterReset(address, addressType);
      expect(hci.socket.write).toHaveBeenCalledTimes(1);
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([0x01, 0x43, 0x20, 0x2a, 0x00, 0x00, 0x01, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 0x00, 0x05, 0x60, 0x00, 0x60, 0x00, 0x06, 0x00, 0x12, 0x00, 0x00, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x60, 0x00, 0x60, 0x00, 0x06, 0x00, 0x12, 0x00, 0x00, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x00, 0x00]));
    });

    it('should omit coded phy parameters when the controller does not support it', () => {
      const address = 'aa:bb:cc:dd:ee';
      const addressType = 'random';
      hci.isExtended = true;
      hci.supportsCodedPhy = false;
      hci.createLeConnAfterReset(address, addressType);
      expect(hci.socket.write).toHaveBeenCalledTimes(1);
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([0x01, 0x43, 0x20, 0x1a, 0x00, 0x00, 0x01, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 0x00, 0x01, 0x60, 0x00, 0x60, 0x00, 0x06, 0x00, 0x12, 0x00, 0x00, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x00, 0x00]));
    });

    it('should override default parameters', () => {
      const address = 'ee:dd:cc:bb:aa';
      const addressType = 'not_random';
      const parameters = { minInterval: 0x0060, maxInterval: 0x00c0, latency: 0x0010, timeout: 0x0c80 };
      hci.createLeConnAfterReset(address, addressType, parameters);
      expect(hci.socket.write).toHaveBeenCalledTimes(1);
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([0x01, 0x0d, 0x20, 0x19, 0x60, 0x00, 0x30, 0x00, 0x00, 0x00, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0x00, 0x00, 0x60, 0x00, 0xc0, 0x00, 0x10, 0x00, 0x80, 0x0c, 0x04, 0x00, 0x06, 0x00]));
    });

    it('should override default parameters (extended with coded phy support)', () => {
      const address = 'ee:dd:cc:bb:aa';
      const addressType = 'not_random';
      const parameters = { minInterval: 0x0060, maxInterval: 0x00c0, latency: 0x0010, timeout: 0x0c80 };
      hci.isExtended = true;
      hci.supportsCodedPhy = true;
      hci.createLeConnAfterReset(address, addressType, parameters);
      expect(hci.socket.write).toHaveBeenCalledTimes(1);
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([0x01, 0x43, 0x20, 0x2a, 0x00, 0x00, 0x00, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0x00, 0x05, 0x60, 0x00, 0x60, 0x00, 0x60, 0x00, 0xc0, 0x00, 0x10, 0x00, 0x80, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x60, 0x00, 0x60, 0x00, 0x60, 0x00, 0xc0, 0x00, 0x10, 0x00, 0x80, 0x0c, 0x00, 0x00, 0x00, 0x00]));
    });
  });

  it('should write connUpdateLe', () => {
    const handle = 0x1234;
    const minInterval = 5;
    const maxInterval = 15;
    const latency = 12;
    const supervisionTimeout = 25;
    hci.connUpdateLe(handle, minInterval, maxInterval, latency, supervisionTimeout);
    expect(hci.socket.write).toHaveBeenCalledTimes(1);
    expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([0x01, 0x13, 0x20, 0x0e, 0x34, 0x12, 0x04, 0x00, 0x0c, 0x00, 0x0c, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00]));
  });

  it('should write cancelConnect', () => {
    hci.cancelConnect();
    expect(hci.socket.write).toHaveBeenCalledTimes(1);
    expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([0x01, 0x0e, 0x20, 0x00]));
  });

  it('should write startLeEncryption', () => {
    const handle = 0x1234;
    const random = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const diversifier = Buffer.from([11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 23, 24, 25]);
    const key = Buffer.from([31, 32, 33, 34, 35, 36, 37, 38, 39, 30, 31, 32, 33, 33, 34, 35]);
    hci.startLeEncryption(handle, random, diversifier, key);
    expect(hci.socket.write).toHaveBeenCalledTimes(1);
    expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([0x01, 0x19, 0x20, 0x1c, 0x34, 0x12, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0b, 0x0c, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x1e, 0x1f, 0x20, 0x21, 0x21, 0x22, 0x23]));
  });

  describe('disconnect', () => {
    it('should write disconnect with defaults', () => {
      const handle = 0x1234;
      const reason = undefined;
      hci.disconnect(handle, reason);
      expect(hci.socket.write).toHaveBeenCalledTimes(1);
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([0x01, 0x06, 0x04, 0x03, 0x34, 0x12, 0x13]));
    });

    it('should write disconnect with reason', () => {
      const handle = 0x1234;
      const reason = 17;
      hci.disconnect(handle, reason);
      expect(hci.socket.write).toHaveBeenCalledTimes(1);
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([0x01, 0x06, 0x04, 0x03, 0x34, 0x12, 0x11]));
    });
  });

  it('should write readRssi', () => {
    const handle = 0x1234;
    hci.readRssi(handle);
    expect(hci.socket.write).toHaveBeenCalledTimes(1);
    expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([0x01, 0x05, 0x14, 0x02, 0x34, 0x12]));
  });

  it('should writeAclDataPkt - push in aclQueue and flushAcl', async () => {
    hci.flushAcl = jest.fn();
    hci.aclBuffers = [1, 2, 3, 4, 5, 6, 7, 8];

    const handle = 0x1234;
    const cid = 345;
    const data = Buffer.from([5, 6, 7, 8, 9, 10, 11]);
    await hci.writeAclDataPkt(handle, cid, data);

    expect(hci.flushAcl).toHaveBeenCalledTimes(1);

    expect(hci.flushAcl).toHaveBeenCalledWith();

    expect(hci.aclQueue).toEqual([
      {
        handle: 4660,
        packet: Buffer.from([0x02, 0x34, 0x12, 0x08, 0x00, 0x07, 0x00, 0x59, 0x01, 0x05, 0x06, 0x07, 0x08])
      },
      {
        handle: 4660,
        packet: Buffer.from([0x02, 0x34, 0x12, 0x03, 0x00, 0x09, 0x0a, 0x0b])
      }
    ]);
  });

  it('should not produce an unhandled rejection when stop() clears _aclConnections while writeAclDataPkt is in flight', async () => {
    const handle = 4404;
    const cid = 4;
    const data = Buffer.from([1, 2, 3]);

    hci.socket.stop = jest.fn();
    hci.aclConnections.set(handle, { pending: 0 });
    jest.spyOn(hci, 'flushAcl');

    const writePromise = hci.writeAclDataPkt(handle, cid, data);

    hci.stop();
    hci.setAclBuffers(20, 4);

    await writePromise;

    await expect(hci.flushAcl.mock.results[0].value).resolves.toBeUndefined();
    expect(hci.aclConnections.size).toBe(0);
  });

  it('should resolve getAclBuffers after LE_READ_BUFFER_SIZE_CMD command complete', async () => {
    const aclBuffersPromise = hci.getAclBuffers();

    hci.processCmdCompleteEvent(8194, 0, Buffer.from([0x10, 0x00, 5]));

    expect(await aclBuffersPromise).toEqual({ length: 0x10, num: 5 });
  });

  it('should resolve getAclBuffers when LE Read Buffer Size reports zero and BR/EDR succeeds', async () => {
    const LE_READ_BUFFER_SIZE_CMD = 8194;
    const READ_BUFFER_SIZE_CMD = 4101;
    const aclBuffersPromise = hci.getAclBuffers();

    hci.processCmdCompleteEvent(LE_READ_BUFFER_SIZE_CMD, 0, Buffer.from([0, 0, 0]));
    hci.processCmdCompleteEvent(READ_BUFFER_SIZE_CMD, 0, Buffer.from([0x40, 0x00, 3, 0x0a, 0x00]));

    expect(await aclBuffersPromise).toEqual({ length: 0x40, num: 10 });
  });

  it('should resolve getAclBuffers with the LE minimum and still write ACL data when both buffer-size commands fail', async () => {
    const LE_READ_BUFFER_SIZE_CMD = 8194;
    const READ_BUFFER_SIZE_CMD = 4101;
    const aclBuffersPromise = hci.getAclBuffers();

    hci.processCmdCompleteEvent(LE_READ_BUFFER_SIZE_CMD, 0x0c, Buffer.from([]));
    hci.processCmdCompleteEvent(READ_BUFFER_SIZE_CMD, 0x0c, Buffer.from([]));

    const timedOut = Symbol('timedOut');
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(timedOut), 300);
    });
    const aclBuffers = await Promise.race([aclBuffersPromise, timeout]);
    clearTimeout(timer);

    expect(aclBuffers).toEqual({ length: 27, num: 1 });

    const handle = 0x1234;
    hci.aclConnections.set(4660, { pending: 0 });

    const writePromise = hci.writeAclDataPkt(handle, 345, Buffer.from([1, 2, 3]));
    let writeTimer;
    const writeTimeout = new Promise((resolve) => {
      writeTimer = setTimeout(() => resolve(timedOut), 300);
    });
    const outcome = await Promise.race([writePromise.then(() => 'resolved'), writeTimeout]);
    clearTimeout(writeTimer);

    expect(outcome).toBe('resolved');
    expect(hci.socket.write.mock.calls.some(([buf]) => buf[0] === 0x02 /* HCI_ACLDATA_PKT */)).toBe(true);
  });

  it('should write ACL data after init drives the LE buffer size chain in user channel mode (issue #109)', async () => {
    const buildCmdCompleteEvent = (cmd, status, result) => {
      const header = Buffer.from([0x04 /* HCI_EVENT_PKT */, 0x0e /* EVT_CMD_COMPLETE */, 3 + result.length, 1]);
      const cmdBuf = Buffer.alloc(2);
      cmdBuf.writeUInt16LE(cmd, 0);
      return Buffer.concat([header, cmdBuf, Buffer.from([status]), result]);
    };
    const wroteCmd = (cmd) => hci.socket.write.mock.calls.some(([buf]) => buf.readUInt16LE(1) === cmd);
    const RESET_CMD = 3075;
    const LE_READ_LOCAL_SUPPORTED_FEATURES = 8195;
    const LE_READ_BUFFER_SIZE_CMD = 8194;

    hci.userChannel = true;
    hci.init();

    expect(wroteCmd(LE_READ_LOCAL_SUPPORTED_FEATURES)).toBe(false);
    hci.onSocketData(buildCmdCompleteEvent(RESET_CMD, 0, Buffer.alloc(0)));

    expect(wroteCmd(LE_READ_LOCAL_SUPPORTED_FEATURES)).toBe(true);
    hci.onSocketData(buildCmdCompleteEvent(LE_READ_LOCAL_SUPPORTED_FEATURES, 0, Buffer.alloc(8)));

    expect(wroteCmd(LE_READ_BUFFER_SIZE_CMD)).toBe(true);
    hci.onSocketData(buildCmdCompleteEvent(LE_READ_BUFFER_SIZE_CMD, 0, Buffer.from([0x10, 0x00, 5])));

    const handle = 0x1234;
    hci.aclConnections.set(handle, { pending: 0 });

    const writePromise = hci.writeAclDataPkt(handle, 345, Buffer.from([5, 6, 7]));
    const timedOut = Symbol('timedOut');
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(timedOut), 300);
    });
    const outcome = await Promise.race([writePromise.then(() => 'resolved'), timeout]);
    clearTimeout(timer);

    expect(outcome).toBe('resolved');
    expect(hci.socket.write.mock.calls.some(([buf]) => buf[0] === 0x02 /* HCI_ACLDATA_PKT */)).toBe(true);
  });

  describe('flushAcl', () => {
    it('should not write flush on no pending connections', () => {
      const queue = [
        {
          handle: 4660,
          packet: Buffer.from([0x02, 0x34, 0x12, 0x08, 0x00, 0x07, 0x00, 0x59, 0x01, 0x05, 0x06, 0x07, 0x08])
        },
        {
          handle: 4660,
          packet: Buffer.from([0x02, 0x34, 0x12, 0x03, 0x00, 0x09, 0x0a, 0x0b])
        }
      ];
      hci.aclQueue = [...queue];

      hci.flushAcl();

      expect(hci.socket.write).not.toHaveBeenCalled();
      expect(hci.aclQueue).toEqual(queue);
    });

    it('should not write flush on empty queue', () => {
      hci.aclQueue = [];
      hci.aclConnections.set(4660, { pending: 3 });
      hci.aclConnections.set(4661, { pending: 2 });
      hci.aclBuffers = { num: 12 };

      hci.flushAcl();

      expect(hci.socket.write).not.toHaveBeenCalled();

      expect(hci.aclQueue).toHaveLength(0);
    });

    it('should not write flush on not enough pending connections', () => {
      const queue = [
        {
          handle: 4660,
          packet: Buffer.from([0x02, 0x34, 0x12, 0x08, 0x00, 0x07, 0x00, 0x59, 0x01, 0x05, 0x06, 0x07, 0x08])
        },
        {
          handle: 4660,
          packet: Buffer.from([0x02, 0x34, 0x12, 0x03, 0x00, 0x09, 0x0a, 0x0b])
        }
      ];
      hci.aclQueue = [...queue];
      hci.aclConnections.set(4660, { pending: 3 });
      hci.aclConnections.set(4661, { pending: 2 });
      hci.aclBuffers = { num: 1 };

      hci.flushAcl();

      expect(hci.socket.write).not.toHaveBeenCalled();
      expect(hci.aclQueue).toEqual(queue);
    });

    it('should write flush', async () => {
      const queue = [
        {
          handle: 4660,
          packet: Buffer.from([0x02, 0x34, 0x12, 0x08, 0x00, 0x07, 0x00, 0x59, 0x01, 0x05, 0x06, 0x07, 0x08])
        },
        {
          handle: 4660,
          packet: Buffer.from([0x02, 0x34, 0x12, 0x03, 0x00, 0x09, 0x0a, 0x0b])
        },
        {
          handle: 4661,
          packet: Buffer.from([0x02])
        }
      ];
      hci.aclQueue = [...queue];
      hci.aclConnections.set(4660, { pending: 3 });
      hci.aclConnections.set(4661, { pending: 2 });
      hci.aclBuffers = { num: 12 };

      await hci.flushAcl();

      expect(hci.socket.write).toHaveBeenCalledTimes(3);
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([0x02, 0x34, 0x12, 0x08, 0x00, 0x07, 0x00, 0x59, 0x01, 0x05, 0x06, 0x07, 0x08]));
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([0x02, 0x34, 0x12, 0x03, 0x00, 0x09, 0x0a, 0x0b]));
      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([0x02]));

      expect(hci.aclQueue).toHaveLength(0);
      expect(hci.aclConnections.get(4660).pending).toBe(5);
      expect(hci.aclConnections.get(4661).pending).toBe(3);
    });

    it('should skip a queued packet whose connection is gone, without throwing, and keep flushing the rest', async () => {
      const queue = [
        { handle: 4660, packet: Buffer.from([0x02, 0xaa]) },
        { handle: 4661, packet: Buffer.from([0x02, 0xbb]) }
      ];
      hci.aclQueue = [...queue];
      hci.aclConnections.set(4661, { pending: 0 });
      hci.aclBuffers = { num: 12 };

      await hci.flushAcl();

      expect(hci.socket.write).toHaveBeenCalledTimes(1);

      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([0x02, 0xbb]));
      expect(hci.aclQueue).toHaveLength(0);
      expect(hci.aclConnections.get(4661).pending).toBe(1);
    });

    it('should not throw when a disconnect completes for the handle while writeAclDataPkt is awaiting acl buffers', async () => {
      const handle = 0x1234;
      hci.aclConnections.set(4660, { pending: 0 });

      const flushAclPromises = [];
      const originalFlushAcl = hci.flushAcl.bind(hci);
      hci.flushAcl = (...args) => {
        const promise = originalFlushAcl(...args);
        flushAclPromises.push(promise);
        return promise;
      };

      const writePromise = hci.writeAclDataPkt(handle, 345, Buffer.from([1, 2, 3]));

      // EVT_DISCONN_COMPLETE for the same handle, landing before writeAclDataPkt resumes from its acl-buffers await
      hci.onSocketData(Buffer.from([0x04, 0x05, 0, 0, 0x34, 0x12, 0x13]));

      hci.setAclBuffers(20, 5);

      await writePromise;
      await Promise.all(flushAclPromises);

      expect(hci.aclConnections.has(4660)).toBe(false);
    });

    it('should skip a queued packet whose connection is gone, without throwing, and keep draining the rest', async () => {
      const queue = [
        {
          handle: 9999, // e.g. removed from _aclConnections by stop() while this was queued
          packet: Buffer.from([0xff])
        },
        {
          handle: 4660,
          packet: Buffer.from([0x02, 0x34, 0x12, 0x08, 0x00, 0x07, 0x00, 0x59, 0x01, 0x05, 0x06, 0x07, 0x08])
        }
      ];
      hci.aclQueue = [...queue];
      hci.aclConnections.set(4660, { pending: 0 });
      hci.aclBuffers = { num: 12 };

      await hci.flushAcl();

      expect(hci.socket.write).toHaveBeenCalledTimes(1);

      expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([0x02, 0x34, 0x12, 0x08, 0x00, 0x07, 0x00, 0x59, 0x01, 0x05, 0x06, 0x07, 0x08]));
      expect(hci.aclQueue).toHaveLength(0);
    });
  });

  describe('onSocketData', () => {
    // Define the standard ACL queue used in tests
    const aclQueue = [
      {
        handle: 4660,
        packet: Buffer.from([0x02, 0x34, 0x12, 0x08, 0x00, 0x07, 0x00, 0x59, 0x01, 0x05, 0x06, 0x07, 0x08])
      },
      {
        handle: 4660,
        packet: Buffer.from([0x02, 0x34, 0x12, 0x03, 0x00, 0x09, 0x0a, 0x0b])
      },
      {
        handle: 4661,
        packet: Buffer.from([0x02])
      }
    ];
  
    // Event callback mocks
    let disconnCompleteCallback;
    let encryptChangeCallback;
    let aclDataPktCallback;
    let leScanEnableSetCmdCallback;
  
    beforeEach(() => {
      // Setup spies on HCI methods - preserve actual implementation
      jest.spyOn(hci, 'flushAcl');
      jest.spyOn(hci, 'processCmdCompleteEvent');
      jest.spyOn(hci, 'processCmdStatusEvent');
      
      hci.processLeMetaEvent = jest.fn();
      
      // Suppress console.warn
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      
      // Setup HCI's internal state for testing
      hci.aclQueue = [...aclQueue];
      hci.aclConnections = new Map();
      hci.aclConnections.set(4660, { pending: 3 });
      hci.aclConnections.set(4661, { pending: 2 });
      hci.handleBuffers = {};
  
      // Setup event listener callbacks as mocks
      disconnCompleteCallback = jest.fn();
      encryptChangeCallback = jest.fn();
      aclDataPktCallback = jest.fn();
      leScanEnableSetCmdCallback = jest.fn();
      
      // Register event handlers
      delegate.onDisconnComplete = disconnCompleteCallback;
      delegate.onEncryptChange = encryptChangeCallback;
      delegate.onAclDataPkt = aclDataPktCallback;
      delegate.onLeScanEnableSetCmd = leScanEnableSetCmdCallback;
    });
  
    afterEach(() => {
      // Clear all mocks between tests
      jest.restoreAllMocks();
    });
  
    test('should flushAcl - HCI_EVENT_PKT / EVT_DISCONN_COMPLETE', () => {
      const eventType = 4;
      const subEventType = 5;
      const data = Buffer.from([eventType, subEventType, 0, 0, 0x34, 0x12, 3]);
  
      hci.onSocketData(data);
  
      // Called
      expect(hci.flushAcl).toHaveBeenCalledTimes(1);
      expect(disconnCompleteCallback).toHaveBeenCalledWith(4660, 3);
  
      // Not called
      expect(hci.processCmdCompleteEvent).not.toHaveBeenCalled();
      expect(hci.processLeMetaEvent).not.toHaveBeenCalled();
      expect(encryptChangeCallback).not.toHaveBeenCalled();
      expect(aclDataPktCallback).not.toHaveBeenCalled();
      expect(leScanEnableSetCmdCallback).not.toHaveBeenCalled();
  
      // HCI state checks
      expect(hci.aclQueue).toEqual([
        {
          handle: 4661,
          packet: Buffer.from([0x02])
        }
      ]);
      expect(Array.from(hci.aclConnections.keys())).toEqual([4661]);
      expect(hci.aclConnections.get(4661)).toEqual({ pending: 2 });
    });
  
    test('should only emit encryptChange - HCI_EVENT_PKT / EVT_ENCRYPT_CHANGE', () => {
      const eventType = 4;
      const subEventType = 8;
      const data = Buffer.from([eventType, subEventType, 0, 0, 0x34, 0x12, 3]);
      hci.onSocketData(data);
  
      // Called
      expect(encryptChangeCallback).toHaveBeenCalledWith(4660, 3);
  
      // Not called
      expect(hci.flushAcl).not.toHaveBeenCalled();
      expect(hci.processCmdCompleteEvent).not.toHaveBeenCalled();
      expect(hci.processLeMetaEvent).not.toHaveBeenCalled();
      expect(disconnCompleteCallback).not.toHaveBeenCalled();
      expect(aclDataPktCallback).not.toHaveBeenCalled();
      expect(leScanEnableSetCmdCallback).not.toHaveBeenCalled();
  
      // HCI state checks
      expect(hci.aclQueue).toEqual(aclQueue);
      expect(Array.from(hci.aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
      expect(hci.aclConnections.get(4660)).toEqual({ pending: 3 });
      expect(hci.aclConnections.get(4661)).toEqual({ pending: 2 });
    });
  
    test('should only processCmdCompleteEvent - HCI_EVENT_PKT / EVT_CMD_COMPLETE', () => {
      const eventType = 4;
      const subEventType = 14;
      const data = Buffer.from([eventType, subEventType, 0, 0, 0x34, 0x12, 3, 9, 9]);
      
      hci.onSocketData(data);
  
      // Called
      expect(hci.processCmdCompleteEvent).toHaveBeenCalledWith(4660, 3, Buffer.from([9, 9]));
  
      // Not called
      expect(hci.flushAcl).not.toHaveBeenCalled();
      expect(encryptChangeCallback).not.toHaveBeenCalled();
      expect(hci.processLeMetaEvent).not.toHaveBeenCalled();
      expect(disconnCompleteCallback).not.toHaveBeenCalled();
      expect(aclDataPktCallback).not.toHaveBeenCalled();
      expect(leScanEnableSetCmdCallback).not.toHaveBeenCalled();
  
      // HCI state checks
      expect(hci.aclQueue).toEqual(aclQueue);
      expect(Array.from(hci.aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
      expect(hci.aclConnections.get(4660)).toEqual({ pending: 3 });
      expect(hci.aclConnections.get(4661)).toEqual({ pending: 2 });
    });
  
    test('should only processCmdStatusEvent - HCI_EVENT_PKT / EVT_CMD_STATUS', () => {
      const eventType = 4;
      const subEventType = 15;
      const data = Buffer.from([eventType, subEventType, 4, 2, 0x34, 0x12, 3, 9, 9]);
      hci.onSocketData(data);
  
      // Called
      expect(hci.processCmdStatusEvent).toHaveBeenCalledWith(786, 2);
  
      // Not called
      expect(hci.flushAcl).not.toHaveBeenCalled();
      expect(encryptChangeCallback).not.toHaveBeenCalled();
      expect(hci.processCmdCompleteEvent).not.toHaveBeenCalled();
      expect(hci.processLeMetaEvent).not.toHaveBeenCalled();
      expect(disconnCompleteCallback).not.toHaveBeenCalled();
      expect(aclDataPktCallback).not.toHaveBeenCalled();
      expect(leScanEnableSetCmdCallback).not.toHaveBeenCalled();
  
      // HCI state checks
      expect(hci.aclQueue).toEqual(aclQueue);
      expect(Array.from(hci.aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
      expect(hci.aclConnections.get(4660)).toEqual({ pending: 3 });
      expect(hci.aclConnections.get(4661)).toEqual({ pending: 2 });
    });
  
    test('should only processLeMetaEvent - HCI_EVENT_PKT / EVT_LE_META_EVENT', () => {
      const eventType = 4;
      const subEventType = 62;
      const data = Buffer.from([eventType, subEventType, 0, 1, 0x34, 0x12, 3, 9, 9]);

      hci.onSocketData(data);
  
      // Called
      expect(hci.processLeMetaEvent).toHaveBeenCalledWith(1, 52, Buffer.from([0x12, 3, 9, 9]));
  
      // Not called
      expect(hci.flushAcl).not.toHaveBeenCalled();
      expect(encryptChangeCallback).not.toHaveBeenCalled();
      expect(hci.processCmdCompleteEvent).not.toHaveBeenCalled();
      expect(disconnCompleteCallback).not.toHaveBeenCalled();
      expect(aclDataPktCallback).not.toHaveBeenCalled();
      expect(leScanEnableSetCmdCallback).not.toHaveBeenCalled();
  
      // HCI state checks
      expect(hci.aclQueue).toEqual(aclQueue);
      expect(Array.from(hci.aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
      expect(hci.aclConnections.get(4660)).toEqual({ pending: 3 });
      expect(hci.aclConnections.get(4661)).toEqual({ pending: 2 });
    });
  
    test('should only flushAcl - HCI_EVENT_PKT / EVT_NUMBER_OF_COMPLETED_PACKETS', () => {
      const eventType = 4;
      const subEventType = 19;
      const data = Buffer.from([eventType, subEventType, 0, 1, 0x34, 0x12, 3, 9, 9]);
      hci.onSocketData(data);
  
      // Called
      expect(hci.flushAcl).toHaveBeenCalled();
  
      // Not called
      expect(hci.processLeMetaEvent).not.toHaveBeenCalled();
      expect(encryptChangeCallback).not.toHaveBeenCalled();
      expect(hci.processCmdCompleteEvent).not.toHaveBeenCalled();
      expect(disconnCompleteCallback).not.toHaveBeenCalled();
      expect(aclDataPktCallback).not.toHaveBeenCalled();
      expect(leScanEnableSetCmdCallback).not.toHaveBeenCalled();
  
      // HCI state checks
      expect(hci.aclQueue).toEqual(aclQueue);
      expect(Array.from(hci.aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
      expect(hci.aclConnections.get(4660)).toEqual({ pending: 0 });
      expect(hci.aclConnections.get(4661)).toEqual({ pending: 2 });
    });
  
    test('should do nothing - HCI_EVENT_PKT / unknown subEventType', () => {
      const eventType = 4;
      const subEventType = 122;
      const data = Buffer.from([eventType, subEventType, 0, 1, 0x34, 0x12, 3, 9, 9]);
      hci.onSocketData(data);
  
      // Not called - nothing should happen
      expect(hci.flushAcl).not.toHaveBeenCalled();
      expect(hci.processLeMetaEvent).not.toHaveBeenCalled();
      expect(encryptChangeCallback).not.toHaveBeenCalled();
      expect(hci.processCmdCompleteEvent).not.toHaveBeenCalled();
      expect(disconnCompleteCallback).not.toHaveBeenCalled();
      expect(aclDataPktCallback).not.toHaveBeenCalled();
      expect(leScanEnableSetCmdCallback).not.toHaveBeenCalled();
  
      // HCI state checks
      expect(hci.aclQueue).toEqual(aclQueue);
      expect(Array.from(hci.aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
      expect(hci.aclConnections.get(4660)).toEqual({ pending: 3 });
      expect(hci.aclConnections.get(4661)).toEqual({ pending: 2 });
    });
  
    test('should only emit aclDataPkt - HCI_ACLDATA_PKT / ACL_START', () => {
      const eventType = 2;
      const subEventTypeP1 = 0xf2;
      const subEventTypeP2 = 0x24;
      const data = Buffer.from([eventType, subEventTypeP1, subEventTypeP2, 0x34, 0x12, 0x03, 0x00, 3, 9, 9, 8, 7]);
      hci.onSocketData(data);
  
      // Called
      expect(aclDataPktCallback).toHaveBeenCalledWith(1266, 2307, Buffer.from([9, 8, 7]));
  
      // Not called
      expect(hci.flushAcl).not.toHaveBeenCalled();
      expect(hci.processLeMetaEvent).not.toHaveBeenCalled();
      expect(encryptChangeCallback).not.toHaveBeenCalled();
      expect(hci.processCmdCompleteEvent).not.toHaveBeenCalled();
      expect(disconnCompleteCallback).not.toHaveBeenCalled();
      expect(leScanEnableSetCmdCallback).not.toHaveBeenCalled();
  
      // HCI state checks
      expect(hci.aclQueue).toEqual(aclQueue);
      expect(Array.from(hci.aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
      expect(hci.aclConnections.get(4660)).toEqual({ pending: 3 });
      expect(hci.aclConnections.get(4661)).toEqual({ pending: 2 });
      expect(hci.handleBuffers).toEqual({});
    });
  
    test('should register handle buffer - HCI_ACLDATA_PKT / ACL_START with incomplete data', () => {
      const eventType = 2;
      const subEventTypeP1 = 0xf2;
      const subEventTypeP2 = 0x24;
      const data = Buffer.from([eventType, subEventTypeP1, subEventTypeP2, 0x34, 0x12, 0x03, 0x00, 3, 9, 9, 8]);
      hci.onSocketData(data);
  
      // Not called
      expect(aclDataPktCallback).not.toHaveBeenCalled();
      expect(hci.flushAcl).not.toHaveBeenCalled();
      expect(hci.processLeMetaEvent).not.toHaveBeenCalled();
      expect(encryptChangeCallback).not.toHaveBeenCalled();
      expect(hci.processCmdCompleteEvent).not.toHaveBeenCalled();
      expect(disconnCompleteCallback).not.toHaveBeenCalled();
      expect(leScanEnableSetCmdCallback).not.toHaveBeenCalled();
  
      // HCI state checks
      expect(hci.aclQueue).toEqual(aclQueue);
      expect(Array.from(hci.aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
      expect(hci.aclConnections.get(4660)).toEqual({ pending: 3 });
      expect(hci.aclConnections.get(4661)).toEqual({ pending: 2 });
      
      // Check buffer was created properly
      expect(hci.handleBuffers[1266]).toEqual({
        length: 3,
        cid: 2307,
        data: expect.any(Buffer)
      });
      expect(Buffer.from(hci.handleBuffers[1266].data)).toEqual(Buffer.from([9, 8]));
    });
  
    test('should do nothing - HCI_ACLDATA_PKT / ACL_CONT without existing buffer', () => {
      const eventType = 2;
      const subEventTypeP1 = 0xf2;
      const subEventTypeP2 = 0x14;
      const data = Buffer.from([eventType, subEventTypeP1, subEventTypeP2, 0x34, 0x12, 0x03, 0x00, 3, 9, 9, 8]);
      hci.onSocketData(data);
  
      // Not called
      expect(aclDataPktCallback).not.toHaveBeenCalled();
      expect(hci.flushAcl).not.toHaveBeenCalled();
      expect(hci.processLeMetaEvent).not.toHaveBeenCalled();
      expect(encryptChangeCallback).not.toHaveBeenCalled();
      expect(hci.processCmdCompleteEvent).not.toHaveBeenCalled();
      expect(disconnCompleteCallback).not.toHaveBeenCalled();
      expect(leScanEnableSetCmdCallback).not.toHaveBeenCalled();
  
      // HCI state checks
      expect(hci.aclQueue).toEqual(aclQueue);
      expect(Array.from(hci.aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
      expect(hci.aclConnections.get(4660)).toEqual({ pending: 3 });
      expect(hci.aclConnections.get(4661)).toEqual({ pending: 2 });
      expect(hci.handleBuffers).toEqual({});
    });
  
    test('should concat data - HCI_ACLDATA_PKT / ACL_CONT with existing buffer', () => {
      const eventType = 2;
      const subEventTypeP1 = 0xf2;
      const subEventTypeP2 = 0x14;
      const data = Buffer.from([eventType, subEventTypeP1, subEventTypeP2, 0x34, 0x12, 0x03, 0x00, 3, 9, 9, 8]);
  
      // Setup pre-existing buffer
      hci.handleBuffers = {
        1266: {
          length: 3,
          cid: 2307,
          data: Buffer.from([3, 4])
        }
      };
  
      hci.onSocketData(data);
  
      // Not called
      expect(aclDataPktCallback).not.toHaveBeenCalled();
      expect(hci.flushAcl).not.toHaveBeenCalled();
      expect(hci.processLeMetaEvent).not.toHaveBeenCalled();
      expect(encryptChangeCallback).not.toHaveBeenCalled();
      expect(hci.processCmdCompleteEvent).not.toHaveBeenCalled();
      expect(disconnCompleteCallback).not.toHaveBeenCalled();
      expect(leScanEnableSetCmdCallback).not.toHaveBeenCalled();
  
      // HCI state checks
      expect(hci.aclQueue).toEqual(aclQueue);
      expect(Array.from(hci.aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
      expect(hci.aclConnections.get(4660)).toEqual({ pending: 3 });
      expect(hci.aclConnections.get(4661)).toEqual({ pending: 2 });
      
      // Check buffer was updated properly
      expect(hci.handleBuffers).toEqual({
        1266: {
          length: 3,
          cid: 2307,
          data: expect.any(Buffer)
        }
      });
      
      // Check buffer contents
      const bufferData = hci.handleBuffers[1266].data;
      expect(Buffer.from(bufferData)).toEqual(Buffer.from([3, 4, 3, 0, 3, 9, 9, 8]));
    });
  
    test('should concat data and emit aclDataPkt - HCI_ACLDATA_PKT / ACL_CONT when complete', () => {
      const eventType = 2;
      const subEventTypeP1 = 0xf2;
      const subEventTypeP2 = 0x14;
      const data = Buffer.from([eventType, subEventTypeP1, subEventTypeP2, 0x34, 0x12, 0x03, 0x00, 3, 9, 9, 8]);
  
      // Setup pre-existing buffer with enough expected length to trigger completion
      hci.handleBuffers = {
        1266: {
          length: 8,
          cid: 2307,
          data: Buffer.from([3, 4])
        }
      };
  
      hci.onSocketData(data);
  
      // Called
      expect(aclDataPktCallback).toHaveBeenCalledWith(
        1266, 
        2307, 
        expect.any(Buffer)
      );
      
      // Verify buffer contents in the callback
      const callData = aclDataPktCallback.mock.calls[0][2];
      expect(Buffer.from(callData)).toEqual(Buffer.from([3, 4, 3, 0, 3, 9, 9, 8]));
  
      // Not called
      expect(hci.flushAcl).not.toHaveBeenCalled();
      expect(hci.processLeMetaEvent).not.toHaveBeenCalled();
      expect(encryptChangeCallback).not.toHaveBeenCalled();
      expect(hci.processCmdCompleteEvent).not.toHaveBeenCalled();
      expect(disconnCompleteCallback).not.toHaveBeenCalled();
      expect(leScanEnableSetCmdCallback).not.toHaveBeenCalled();
  
      // HCI state checks
      expect(hci.aclQueue).toEqual(aclQueue);
      expect(Array.from(hci.aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
      expect(hci.aclConnections.get(4660)).toEqual({ pending: 3 });
      expect(hci.aclConnections.get(4661)).toEqual({ pending: 2 });
      
      // Buffer should be emptied after processing
      expect(hci.handleBuffers).toEqual({});
    });
  
    test('should emit leScanEnableSetCmd - HCI_COMMAND_PKT / LE_SET_SCAN_ENABLE_CMD', () => {
      const eventType = 1;
      const subEventTypeP1 = 0x0c;
      const subEventTypeP2 = 0x20;
      const data = Buffer.from([eventType, subEventTypeP1, subEventTypeP2, 0x34, 0x01, 0]);
  
      hci.onSocketData(data);
  
      // Called
      expect(leScanEnableSetCmdCallback).toHaveBeenCalledWith(true, false);
  
      // Not called
      expect(hci.flushAcl).not.toHaveBeenCalled();
      expect(hci.processLeMetaEvent).not.toHaveBeenCalled();
      expect(encryptChangeCallback).not.toHaveBeenCalled();
      expect(hci.processCmdCompleteEvent).not.toHaveBeenCalled();
      expect(disconnCompleteCallback).not.toHaveBeenCalled();
      expect(aclDataPktCallback).not.toHaveBeenCalled();
  
      // HCI state checks
      expect(hci.aclQueue).toEqual(aclQueue);
      expect(Array.from(hci.aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
    });
  
    test('should not emit leScanEnableSetCmd - HCI_COMMAND_PKT / unknown command', () => {
      const eventType = 1;
      const subEventTypeP1 = 0x0c;
      const subEventTypeP2 = 0x21;  // Different command code
      const data = Buffer.from([eventType, subEventTypeP1, subEventTypeP2, 0x34, 0x01, 0]);
  
      hci.onSocketData(data);
  
      // Not called
      expect(leScanEnableSetCmdCallback).not.toHaveBeenCalled();
      expect(hci.flushAcl).not.toHaveBeenCalled();
      expect(hci.processLeMetaEvent).not.toHaveBeenCalled();
      expect(encryptChangeCallback).not.toHaveBeenCalled();
      expect(hci.processCmdCompleteEvent).not.toHaveBeenCalled();
      expect(disconnCompleteCallback).not.toHaveBeenCalled();
      expect(aclDataPktCallback).not.toHaveBeenCalled();
  
      // HCI state checks
      expect(hci.aclQueue).toEqual(aclQueue);
      expect(Array.from(hci.aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
    });
  
    test('should do nothing - unknown event type', () => {
      const eventType = 122;  // Unknown event type
      const subEventTypeP1 = 0x0c;
      const subEventTypeP2 = 0x21;
      const data = Buffer.from([eventType, subEventTypeP1, subEventTypeP2, 0x34, 0x01, 0]);
  
      hci.onSocketData(data);
  
      // Not called
      expect(leScanEnableSetCmdCallback).not.toHaveBeenCalled();
      expect(hci.flushAcl).not.toHaveBeenCalled();
      expect(hci.processLeMetaEvent).not.toHaveBeenCalled();
      expect(encryptChangeCallback).not.toHaveBeenCalled();
      expect(hci.processCmdCompleteEvent).not.toHaveBeenCalled();
      expect(disconnCompleteCallback).not.toHaveBeenCalled();
      expect(aclDataPktCallback).not.toHaveBeenCalled();
  
      // HCI state checks
      expect(hci.aclQueue).toEqual(aclQueue);
      expect(Array.from(hci.aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
    });
  });
  
  // LE_READ_LOCAL_SUPPORTED_FEATURES tests
  describe('LE_READ_LOCAL_SUPPORTED_FEATURES', () => {
    beforeEach(() => {
      // Spy on methods rather than replacing them
      jest.spyOn(hci, 'setCodedPhySupport');
      jest.spyOn(hci, 'setEventMask');
      jest.spyOn(hci, 'setLeEventMask');
      jest.spyOn(hci, 'readLocalVersion');
      jest.spyOn(hci, 'writeLeHostSupported');
      jest.spyOn(hci, 'readLeHostSupported');
      jest.spyOn(hci, 'readLeBufferSize');
      jest.spyOn(hci, 'readBdAddr');
      
      // Reset _isExtended flag
      hci.isExtended = false;
    });
    
    afterEach(() => {
      jest.clearAllMocks();
    });
    
    test('should still complete the init chain on error status, but skip leFeatures and isExtended', () => {
      const cmd = 8195;
      const status = 1;
      const result = Buffer.from([0x00, 0x00, 0x00, 0x00]);
      const leFeaturesCallback = jest.fn();
      delegate.onLeFeatures = leFeaturesCallback;

      hci.processCmdCompleteEvent(cmd, status, result);

      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
      expect(leFeaturesCallback).not.toHaveBeenCalled();
      expect(hci.isExtended).toBe(false);

      // The rest of the chain must still run, or ACL writes hang forever (issue #109).
      expect(hci.setEventMask).toHaveBeenCalled();
      expect(hci.setLeEventMask).toHaveBeenCalled();
      expect(hci.readLocalVersion).toHaveBeenCalled();
      expect(hci.writeLeHostSupported).toHaveBeenCalled();
      expect(hci.readLeHostSupported).toHaveBeenCalled();
      expect(hci.readLeBufferSize).toHaveBeenCalled();
      expect(hci.readBdAddr).toHaveBeenCalled();
    });

    test('should resolve getAclBuffers after a failed status once LE Read Buffer Size completes', async () => {
      const aclBuffersPromise = hci.getAclBuffers();

      hci.processCmdCompleteEvent(8195, 0x0c, Buffer.from([0x00, 0x00, 0x00, 0x00]));

      expect(hci.readLeBufferSize).toHaveBeenCalled();

      hci.processCmdCompleteEvent(8194, 0, Buffer.from([0x10, 0x00, 5]));

      expect(await aclBuffersPromise).toEqual({ length: 0x10, num: 5 });
    });

    test('should process without extended features', () => {
      const cmd = 8195;
      const status = 0;
      const result = Buffer.from([0x00, 0x00, 0x00, 0x00]); // No bits set
  
      hci.processCmdCompleteEvent(cmd, status, result);
  
      // Verify extended-specific method not called
      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
  
      // Verify other methods were called
      expect(hci.setEventMask).toHaveBeenCalled();
      expect(hci.setLeEventMask).toHaveBeenCalled();
      expect(hci.readLocalVersion).toHaveBeenCalled();
      expect(hci.writeLeHostSupported).toHaveBeenCalled();
      expect(hci.readLeHostSupported).toHaveBeenCalled();
      expect(hci.readLeBufferSize).toHaveBeenCalled();
      expect(hci.readBdAddr).toHaveBeenCalled();
  
      expect(hci.isExtended).toBe(false);
    });

    test('should detect extended features without offering coded phy', () => {
      // result[1] bit 4 is the LE extended advertising feature bit
      hci.processCmdCompleteEvent(8195, 0, Buffer.from([0x00, 0x10, 0x00, 0x00]));

      expect(hci.isExtended).toBe(true);
      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
    });

    test('should not offer coded phy on a capable controller unless opted in', () => {
      // result[1] bit 3 is the LE Coded PHY feature bit
      hci.processCmdCompleteEvent(8195, 0, Buffer.from([0x00, 0x08, 0x00, 0x00]));

      expect(hci.supportsCodedPhy).toBe(true);
      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
    });

    test('should offer coded phy exactly once when opted in and supported', () => {
      hci.codedPhy = true;

      hci.processCmdCompleteEvent(8195, 0, Buffer.from([0x00, 0x08, 0x00, 0x00]));

      expect(hci.isExtended).toBe(false);
      expect(hci.supportsCodedPhy).toBe(true);
      expect(hci.setCodedPhySupport).toHaveBeenCalledTimes(1);
    });

    test('should not offer coded phy when opted in on an unsupported controller', () => {
      hci.codedPhy = true;

      hci.processCmdCompleteEvent(8195, 0, Buffer.from([0x00, 0x10, 0x00, 0x00]));

      expect(hci.supportsCodedPhy).toBe(false);
      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
    });

    test('should offer coded phy once at discovery and once per later reset', () => {
      hci.codedPhy = true;

      hci.processCmdCompleteEvent(8195, 0, Buffer.from([0x00, 0x08, 0x00, 0x00]));
      expect(hci.setCodedPhySupport).toHaveBeenCalledTimes(1);

      hci.processCmdCompleteEvent(3075, 0, Buffer.from([]));
      expect(hci.setCodedPhySupport).toHaveBeenCalledTimes(2);
    });

    test('should not offer coded phy when the feature read fails', () => {
      hci.codedPhy = true;

      hci.processCmdCompleteEvent(8195, 0x0c, Buffer.from([0x00, 0x08, 0x00, 0x00]));

      expect(hci.supportsCodedPhy).toBe(false);
      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
    });
  });

  describe('onSocketError', () => {
    it('should emit stateChange', () => {
      const callback = jest.fn();

      delegate.onStateChange = callback;
      hci.onSocketError({ code: 'EPERM', message: 'Network is down' });

      expect(callback).toHaveBeenCalledTimes(1);

      expect(callback).toHaveBeenCalledWith('unauthorized');
    });

    it('should do nothing with message', () => {
      const callback = jest.fn();

      delegate.onStateChange = callback;
      hci.onSocketError({ message: 'Network is down' });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should do nothing', () => {
      const callback = jest.fn();

      delegate.onStateChange = callback;
      hci.onSocketError({ });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('processCmdCompleteEvent', () => {
    const aclBuffers = {
      length: 99,
      num: 88
    };

    let rssiReadCallback;
    let leScanEnableSetCallback;
    let leScanParametersSetCallback;
    let stateChangeCallback;
    let addressChangeCallback;
    let readLocalVersionCallback;

    beforeEach(() => {
      hci.setEventMask = jest.fn();
      hci.setLeEventMask = jest.fn();
      hci.readLocalVersion = jest.fn();
      hci.readBdAddr = jest.fn();
      hci.setScanEnabled = jest.fn();
      hci.setScanParameters = jest.fn();
      hci.readBufferSize = jest.fn();
      hci.setCodedPhySupport = jest.fn();

      hci.aclBuffers = { ...aclBuffers };

      rssiReadCallback = jest.fn();
      leScanEnableSetCallback = jest.fn();
      leScanParametersSetCallback = jest.fn();
      stateChangeCallback = jest.fn();
      addressChangeCallback = jest.fn();
      readLocalVersionCallback = jest.fn();

      delegate.onRssiRead = rssiReadCallback;
      delegate.onLeScanEnableSet = leScanEnableSetCallback;
      delegate.onLeScanParametersSet = leScanParametersSetCallback;
      delegate.onStateChange = stateChangeCallback;
      delegate.onAddressChange = addressChangeCallback;
      delegate.onReadLocalVersion = readLocalVersionCallback;
    });

    it.each([
      ['READ_LOCAL_VERSION_CMD', 4097],
      ['READ_SUPPORTED_COMMANDS_CMD', 4098],
      ['READ_BD_ADDR_CMD', 4105]
    ])('does not read absent return parameters after a failed %s', (_name, cmd) => {
      expect(() => hci.processCmdCompleteEvent(cmd, 0x0c, Buffer.alloc(0))).not.toThrow();

      expect(stateChangeCallback).not.toHaveBeenCalled();
      expect(addressChangeCallback).not.toHaveBeenCalled();
      expect(readLocalVersionCallback).not.toHaveBeenCalled();
    });

    it.each([
      ['READ_LOCAL_VERSION_CMD', 4097, 8],
      ['READ_SUPPORTED_COMMANDS_CMD', 4098, 38],
      ['READ_BD_ADDR_CMD', 4105, 6]
    ])('does not read a truncated successful %s reply', (_name, cmd, minimumLength) => {
      expect(() => hci.processCmdCompleteEvent(cmd, 0, Buffer.alloc(minimumLength - 1))).not.toThrow();

      expect(stateChangeCallback).not.toHaveBeenCalled();
      expect(addressChangeCallback).not.toHaveBeenCalled();
      expect(readLocalVersionCallback).not.toHaveBeenCalled();
    });

    it('should do nothing', () => {
      const cmd = 0;
      const status = 0;
      const result = Buffer.from([]);

      hci.processCmdCompleteEvent(cmd, status, result);

      // called

      // not called
      expect(hci.setEventMask).not.toHaveBeenCalled();
      expect(hci.setLeEventMask).not.toHaveBeenCalled();
      expect(hci.readLocalVersion).not.toHaveBeenCalled();
      expect(hci.readBdAddr).not.toHaveBeenCalled();
      expect(hci.setScanEnabled).not.toHaveBeenCalled();
      expect(hci.setScanParameters).not.toHaveBeenCalled();
      expect(hci.readBufferSize).not.toHaveBeenCalled();
      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
      expect(rssiReadCallback).not.toHaveBeenCalled();
      expect(leScanEnableSetCallback).not.toHaveBeenCalled();
      expect(leScanParametersSetCallback).not.toHaveBeenCalled();
      expect(stateChangeCallback).not.toHaveBeenCalled();
      expect(addressChangeCallback).not.toHaveBeenCalled();
      expect(readLocalVersionCallback).not.toHaveBeenCalled();

      // hci checks
      expect(hci.aclBuffers).toEqual(aclBuffers);
      expect(hci.isExtended).toBe(false);
    });

    it('should reset', () => {
      const cmd = 3075;
      const status = 0;
      const result = Buffer.from([]);

      hci.processCmdCompleteEvent(cmd, status, result);

      // called
      expect(hci.setEventMask).toHaveBeenCalledTimes(1);
      expect(hci.setEventMask).toHaveBeenCalledWith();
      expect(hci.setLeEventMask).toHaveBeenCalledTimes(1);
      expect(hci.setLeEventMask).toHaveBeenCalledWith();
      expect(hci.readLocalVersion).toHaveBeenCalledTimes(1);
      expect(hci.readLocalVersion).toHaveBeenCalledWith();
      expect(hci.readBdAddr).toHaveBeenCalledTimes(1);
      expect(hci.readBdAddr).toHaveBeenCalledWith();

      // not called
      expect(hci.setScanEnabled).not.toHaveBeenCalled();
      expect(hci.setScanParameters).not.toHaveBeenCalled();
      expect(hci.readBufferSize).not.toHaveBeenCalled();
      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
      expect(rssiReadCallback).not.toHaveBeenCalled();
      expect(leScanEnableSetCallback).not.toHaveBeenCalled();
      expect(leScanParametersSetCallback).not.toHaveBeenCalled();
      expect(stateChangeCallback).not.toHaveBeenCalled();
      expect(addressChangeCallback).not.toHaveBeenCalled();
      expect(readLocalVersionCallback).not.toHaveBeenCalled();

      // hci checks
      expect(hci.aclBuffers).toEqual(aclBuffers);
      expect(hci.isExtended).toBe(false);
    });

    it('should reset (extended) without offering coded phy', () => {
      const cmd = 3075;
      const status = 0;
      const result = Buffer.from([]);

      hci.isExtended = true;
      hci.processCmdCompleteEvent(cmd, status, result);

      // called
      expect(hci.setEventMask).toHaveBeenCalledTimes(1);
      expect(hci.setEventMask).toHaveBeenCalledWith();
      expect(hci.setLeEventMask).toHaveBeenCalledTimes(1);
      expect(hci.setLeEventMask).toHaveBeenCalledWith();
      expect(hci.readLocalVersion).toHaveBeenCalledTimes(1);
      expect(hci.readLocalVersion).toHaveBeenCalledWith();
      expect(hci.readBdAddr).toHaveBeenCalledTimes(1);
      expect(hci.readBdAddr).toHaveBeenCalledWith();
      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();

      // not called
      expect(hci.setScanEnabled).not.toHaveBeenCalled();
      expect(hci.setScanParameters).not.toHaveBeenCalled();
      expect(hci.readBufferSize).not.toHaveBeenCalled();
      expect(rssiReadCallback).not.toHaveBeenCalled();
      expect(leScanEnableSetCallback).not.toHaveBeenCalled();
      expect(leScanParametersSetCallback).not.toHaveBeenCalled();
      expect(stateChangeCallback).not.toHaveBeenCalled();
      expect(addressChangeCallback).not.toHaveBeenCalled();
      expect(readLocalVersionCallback).not.toHaveBeenCalled();

      // hci checks
      expect(hci.aclBuffers).toEqual(aclBuffers);
      expect(hci.isExtended).toBe(true);
    });

    it('should reset without offering coded phy before support is known', () => {
      hci.codedPhy = true;

      hci.processCmdCompleteEvent(3075, 0, Buffer.from([]));

      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
      expect(hci.setEventMask).toHaveBeenCalledTimes(1);
      expect(hci.setEventMask).toHaveBeenCalledWith();
      expect(hci.setLeEventMask).toHaveBeenCalledTimes(1);
      expect(hci.setLeEventMask).toHaveBeenCalledWith();
    });

    it('should reapply coded phy on a later reset once support is known', () => {
      hci.codedPhy = true;
      hci.supportsCodedPhy = true;
      hci.isExtended = false;

      hci.processCmdCompleteEvent(3075, 0, Buffer.from([]));

      expect(hci.setCodedPhySupport).toHaveBeenCalledTimes(1);

      expect(hci.setCodedPhySupport).toHaveBeenCalledWith();
      expect(hci.setEventMask).toHaveBeenCalledTimes(1);
      expect(hci.setEventMask).toHaveBeenCalledWith();
      expect(hci.setLeEventMask).toHaveBeenCalledTimes(1);
      expect(hci.setLeEventMask).toHaveBeenCalledWith();
    });

    it('should not reapply coded phy on a later reset when not opted in', () => {
      hci.supportsCodedPhy = true;

      hci.processCmdCompleteEvent(3075, 0, Buffer.from([]));

      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
    });

    it('should only log debug - READ_LE_HOST_SUPPORTED_CMD', () => {
      const cmd = 3180;
      const status = 0;
      const result = Buffer.from([0, 1]);

      hci.processCmdCompleteEvent(cmd, status, result);

      // called

      // not called
      expect(hci.setEventMask).not.toHaveBeenCalled();
      expect(hci.setLeEventMask).not.toHaveBeenCalled();
      expect(hci.readLocalVersion).not.toHaveBeenCalled();
      expect(hci.readBdAddr).not.toHaveBeenCalled();
      expect(hci.setScanEnabled).not.toHaveBeenCalled();
      expect(hci.setScanParameters).not.toHaveBeenCalled();
      expect(hci.readBufferSize).not.toHaveBeenCalled();
      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
      expect(rssiReadCallback).not.toHaveBeenCalled();
      expect(leScanEnableSetCallback).not.toHaveBeenCalled();
      expect(leScanParametersSetCallback).not.toHaveBeenCalled();
      expect(stateChangeCallback).not.toHaveBeenCalled();
      expect(addressChangeCallback).not.toHaveBeenCalled();
      expect(readLocalVersionCallback).not.toHaveBeenCalled();

      // hci checks
      expect(hci.aclBuffers).toEqual(aclBuffers);
      expect(hci.isExtended).toBe(false);
    });

    it('should do nothing - READ_LE_HOST_SUPPORTED_CMD', () => {
      const cmd = 3180;
      const status = 1;
      const result = Buffer.from([]);

      hci.processCmdCompleteEvent(cmd, status, result);

      // called

      // not called
      expect(hci.setEventMask).not.toHaveBeenCalled();
      expect(hci.setLeEventMask).not.toHaveBeenCalled();
      expect(hci.readLocalVersion).not.toHaveBeenCalled();
      expect(hci.readBdAddr).not.toHaveBeenCalled();
      expect(hci.setScanEnabled).not.toHaveBeenCalled();
      expect(hci.setScanParameters).not.toHaveBeenCalled();
      expect(hci.readBufferSize).not.toHaveBeenCalled();
      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
      expect(rssiReadCallback).not.toHaveBeenCalled();
      expect(leScanEnableSetCallback).not.toHaveBeenCalled();
      expect(leScanParametersSetCallback).not.toHaveBeenCalled();
      expect(stateChangeCallback).not.toHaveBeenCalled();
      expect(addressChangeCallback).not.toHaveBeenCalled();
      expect(readLocalVersionCallback).not.toHaveBeenCalled();

      // hci checks
      expect(hci.aclBuffers).toEqual(aclBuffers);
      expect(hci.isExtended).toBe(false);
    });

    it('should emit stateChange - READ_LOCAL_VERSION_CMD', () => {
      const cmd = 4097;
      const status = 0;
      const result = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]);

      hci.processCmdCompleteEvent(cmd, status, result);

      // called
      expect(stateChangeCallback).toHaveBeenCalledTimes(1);
      expect(stateChangeCallback).toHaveBeenCalledWith('unsupported');
      expect(readLocalVersionCallback).toHaveBeenCalledTimes(1);
      expect(readLocalVersionCallback.mock.calls[0]).toStrictEqual([{ hciVer: 0, hciRev: 513, lmpVer: 3, manufacturer: 1284, lmpSubVer: 1798 }]);

      // not called
      expect(hci.setEventMask).not.toHaveBeenCalled();
      expect(hci.setLeEventMask).not.toHaveBeenCalled();
      expect(hci.readLocalVersion).not.toHaveBeenCalled();
      expect(hci.readBdAddr).not.toHaveBeenCalled();
      expect(hci.setScanEnabled).not.toHaveBeenCalled();
      expect(hci.setScanParameters).not.toHaveBeenCalled();
      expect(hci.readBufferSize).not.toHaveBeenCalled();
      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
      expect(rssiReadCallback).not.toHaveBeenCalled();
      expect(leScanEnableSetCallback).not.toHaveBeenCalled();
      expect(leScanParametersSetCallback).not.toHaveBeenCalled();
      expect(addressChangeCallback).not.toHaveBeenCalled();

      // hci checks
      expect(hci.aclBuffers).toEqual(aclBuffers);
      expect(hci.isExtended).toBe(false);
    });

    it('should not emit stateChange - READ_LOCAL_VERSION_CMD', () => {
      const cmd = 4097;
      const status = 0;
      const result = Buffer.from([9, 1, 2, 3, 4, 5, 6, 7]);

      hci.processCmdCompleteEvent(cmd, status, result);

      // called
      expect(readLocalVersionCallback).toHaveBeenCalledTimes(1);
      expect(readLocalVersionCallback.mock.calls[0]).toStrictEqual([{ hciVer: 9, hciRev: 513, lmpVer: 3, manufacturer: 1284, lmpSubVer: 1798 }]);
      expect(hci.setScanEnabled).toHaveBeenCalledTimes(1);
      expect(hci.setScanEnabled).toHaveBeenCalledWith(false, true);
      expect(hci.setScanParameters).toHaveBeenCalledTimes(1);
      expect(hci.setScanParameters).toHaveBeenCalledWith();

      // not called
      expect(hci.setEventMask).not.toHaveBeenCalled();
      expect(hci.setLeEventMask).not.toHaveBeenCalled();
      expect(hci.readLocalVersion).not.toHaveBeenCalled();
      expect(hci.readBdAddr).not.toHaveBeenCalled();
      expect(hci.readBufferSize).not.toHaveBeenCalled();
      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
      expect(rssiReadCallback).not.toHaveBeenCalled();
      expect(stateChangeCallback).not.toHaveBeenCalled();
      expect(leScanEnableSetCallback).not.toHaveBeenCalled();
      expect(leScanParametersSetCallback).not.toHaveBeenCalled();
      expect(addressChangeCallback).not.toHaveBeenCalled();

      // hci checks
      expect(hci.aclBuffers).toEqual(aclBuffers);
      expect(hci.isExtended).toBe(false);
    });

    it('should not scan - READ_LOCAL_VERSION_CMD', () => {
      const cmd = 4097;
      const status = 0;
      const result = Buffer.from([9, 1, 2, 3, 4, 5, 6, 7]);

      hci.state = 'poweredOn';
      hci.processCmdCompleteEvent(cmd, status, result);

      // called
      expect(readLocalVersionCallback).toHaveBeenCalledTimes(1);
      expect(readLocalVersionCallback.mock.calls[0]).toStrictEqual([{ hciVer: 9, hciRev: 513, lmpVer: 3, manufacturer: 1284, lmpSubVer: 1798 }]);

      // not called
      expect(hci.setEventMask).not.toHaveBeenCalled();
      expect(hci.setLeEventMask).not.toHaveBeenCalled();
      expect(hci.readLocalVersion).not.toHaveBeenCalled();
      expect(hci.readBdAddr).not.toHaveBeenCalled();
      expect(hci.setScanEnabled).not.toHaveBeenCalled();
      expect(hci.setScanParameters).not.toHaveBeenCalled();
      expect(hci.readBufferSize).not.toHaveBeenCalled();
      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
      expect(rssiReadCallback).not.toHaveBeenCalled();
      expect(stateChangeCallback).not.toHaveBeenCalled();
      expect(leScanEnableSetCallback).not.toHaveBeenCalled();
      expect(leScanParametersSetCallback).not.toHaveBeenCalled();
      expect(addressChangeCallback).not.toHaveBeenCalled();

      // hci checks
      expect(hci.aclBuffers).toEqual(aclBuffers);
      expect(hci.isExtended).toBe(false);
    });

    it('should report extended commands without changing mode - READ_SUPPORTED_COMMANDS_CMD', () => {
      const cmd = 4098;
      const status = 0;
      const result = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 28, 30, 31, 32, 33, 34, 35, 35, 36, 0xff]);

      hci.state = 'poweredOn';
      hci.processCmdCompleteEvent(cmd, status, result);

      // called

      // not called
      expect(readLocalVersionCallback).not.toHaveBeenCalled();
      expect(hci.setEventMask).not.toHaveBeenCalled();
      expect(hci.setLeEventMask).not.toHaveBeenCalled();
      expect(hci.readLocalVersion).not.toHaveBeenCalled();
      expect(hci.readBdAddr).not.toHaveBeenCalled();
      expect(hci.setScanEnabled).not.toHaveBeenCalled();
      expect(hci.setScanParameters).not.toHaveBeenCalled();
      expect(hci.readBufferSize).not.toHaveBeenCalled();
      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
      expect(rssiReadCallback).not.toHaveBeenCalled();
      expect(stateChangeCallback).not.toHaveBeenCalled();
      expect(leScanEnableSetCallback).not.toHaveBeenCalled();
      expect(leScanParametersSetCallback).not.toHaveBeenCalled();
      expect(addressChangeCallback).not.toHaveBeenCalled();

      // hci checks
      expect(hci.aclBuffers).toEqual(aclBuffers);
      expect(hci.isExtended).toBe(false);
    });

    it('should emit addressChange - READ_BD_ADDR_CMD', () => {
      const cmd = 4105;
      const status = 0;
      const result = Buffer.from([9, 1, 2, 3, 4, 5, 6, 7]);

      hci.addressType = 'addressType';
      hci.address = 'address';
      hci.processCmdCompleteEvent(cmd, status, result);

      // called
      expect(addressChangeCallback).toHaveBeenCalledTimes(1);
      expect(addressChangeCallback).toHaveBeenCalledWith('07:06:05:04:03:02:01:09');

      // not called
      expect(hci.setEventMask).not.toHaveBeenCalled();
      expect(hci.setLeEventMask).not.toHaveBeenCalled();
      expect(hci.readLocalVersion).not.toHaveBeenCalled();
      expect(hci.readBdAddr).not.toHaveBeenCalled();
      expect(hci.setScanEnabled).not.toHaveBeenCalled();
      expect(hci.setScanParameters).not.toHaveBeenCalled();
      expect(hci.readBufferSize).not.toHaveBeenCalled();
      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
      expect(rssiReadCallback).not.toHaveBeenCalled();
      expect(stateChangeCallback).not.toHaveBeenCalled();
      expect(leScanEnableSetCallback).not.toHaveBeenCalled();
      expect(leScanParametersSetCallback).not.toHaveBeenCalled();
      expect(readLocalVersionCallback).not.toHaveBeenCalled();

      // hci checks
      expect(hci.aclBuffers).toEqual(aclBuffers);
      expect(hci.isExtended).toBe(false);
      expect(hci.addressType).toBe('public');
      expect(hci.address).toBe('07:06:05:04:03:02:01:09');
    });

    [8203, 8257].forEach((cmd) => {
      it(`should emit stateChange - LE_SET_SCAN_PARAMETERS_CMD - ${cmd}`, () => {
        const status = 0;
        const result = Buffer.from([9, 1, 2, 3, 4, 5, 6, 7]);

        hci.processCmdCompleteEvent(cmd, status, result);

        // called
        expect(stateChangeCallback).toHaveBeenCalledTimes(1);
        expect(stateChangeCallback).toHaveBeenCalledWith('poweredOn');
        expect(leScanParametersSetCallback).toHaveBeenCalledTimes(1);
        expect(leScanParametersSetCallback).toHaveBeenCalledWith();

        // not called
        expect(addressChangeCallback).not.toHaveBeenCalled();
        expect(hci.setEventMask).not.toHaveBeenCalled();
        expect(hci.setLeEventMask).not.toHaveBeenCalled();
        expect(hci.readLocalVersion).not.toHaveBeenCalled();
        expect(hci.readBdAddr).not.toHaveBeenCalled();
        expect(hci.setScanEnabled).not.toHaveBeenCalled();
        expect(hci.setScanParameters).not.toHaveBeenCalled();
        expect(hci.readBufferSize).not.toHaveBeenCalled();
        expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
        expect(rssiReadCallback).not.toHaveBeenCalled();
        expect(leScanEnableSetCallback).not.toHaveBeenCalled();
        expect(readLocalVersionCallback).not.toHaveBeenCalled();

        // hci checks
        expect(hci.aclBuffers).toEqual(aclBuffers);
        expect(hci.isExtended).toBe(false);
      });
    });

    [8204, 8258].forEach((cmd) => {
      it(`should emit leScanEnableSet - LE_SET_SCAN_ENABLE_CMD - ${cmd}`, () => {
        const status = 4;
        const result = Buffer.from([9, 1, 2, 3, 4, 5, 6, 7]);

        hci.processCmdCompleteEvent(cmd, status, result);

        // called
        expect(leScanEnableSetCallback).toHaveBeenCalledTimes(1);
        expect(leScanEnableSetCallback).toHaveBeenCalledWith(status);

        // not called
        expect(addressChangeCallback).not.toHaveBeenCalled();
        expect(hci.setEventMask).not.toHaveBeenCalled();
        expect(hci.setLeEventMask).not.toHaveBeenCalled();
        expect(hci.readLocalVersion).not.toHaveBeenCalled();
        expect(hci.readBdAddr).not.toHaveBeenCalled();
        expect(hci.setScanEnabled).not.toHaveBeenCalled();
        expect(hci.setScanParameters).not.toHaveBeenCalled();
        expect(hci.readBufferSize).not.toHaveBeenCalled();
        expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
        expect(rssiReadCallback).not.toHaveBeenCalled();
        expect(stateChangeCallback).not.toHaveBeenCalled();
        expect(leScanParametersSetCallback).not.toHaveBeenCalled();
        expect(readLocalVersionCallback).not.toHaveBeenCalled();

        // hci checks
        expect(hci.aclBuffers).toEqual(aclBuffers);
        expect(hci.isExtended).toBe(false);
      });
    });

    it('should emit rssiRead - READ_RSSI_CMD', () => {
      const cmd = 5125;
      const status = 4;
      const result = Buffer.from([9, 1, 2, 3, 4, 5, 6, 7]);

      hci.processCmdCompleteEvent(cmd, status, result);

      // called
      expect(rssiReadCallback).toHaveBeenCalledTimes(1);
      expect(rssiReadCallback).toHaveBeenCalledWith(265, 2);

      // not called
      expect(addressChangeCallback).not.toHaveBeenCalled();
      expect(hci.setEventMask).not.toHaveBeenCalled();
      expect(hci.setLeEventMask).not.toHaveBeenCalled();
      expect(hci.readLocalVersion).not.toHaveBeenCalled();
      expect(hci.readBdAddr).not.toHaveBeenCalled();
      expect(hci.setScanEnabled).not.toHaveBeenCalled();
      expect(hci.setScanParameters).not.toHaveBeenCalled();
      expect(hci.readBufferSize).not.toHaveBeenCalled();
      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
      expect(leScanEnableSetCallback).not.toHaveBeenCalled();
      expect(stateChangeCallback).not.toHaveBeenCalled();
      expect(leScanParametersSetCallback).not.toHaveBeenCalled();
      expect(readLocalVersionCallback).not.toHaveBeenCalled();

      // hci checks
      expect(hci.aclBuffers).toEqual(aclBuffers);
      expect(hci.isExtended).toBe(false);
    });

    it('should read buffer size - LE_READ_BUFFER_SIZE_CMD', () => {
      const cmd = 8194;
      const status = 0;
      const result = Buffer.from([0, 0, 0]);

      hci.processCmdCompleteEvent(cmd, status, result);

      // called
      expect(hci.readBufferSize).toHaveBeenCalledTimes(1);
      expect(hci.readBufferSize).toHaveBeenCalledWith();

      // not called
      expect(rssiReadCallback).not.toHaveBeenCalled();
      expect(addressChangeCallback).not.toHaveBeenCalled();
      expect(hci.setEventMask).not.toHaveBeenCalled();
      expect(hci.setLeEventMask).not.toHaveBeenCalled();
      expect(hci.readLocalVersion).not.toHaveBeenCalled();
      expect(hci.readBdAddr).not.toHaveBeenCalled();
      expect(hci.setScanEnabled).not.toHaveBeenCalled();
      expect(hci.setScanParameters).not.toHaveBeenCalled();
      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
      expect(leScanEnableSetCallback).not.toHaveBeenCalled();
      expect(stateChangeCallback).not.toHaveBeenCalled();
      expect(leScanParametersSetCallback).not.toHaveBeenCalled();
      expect(readLocalVersionCallback).not.toHaveBeenCalled();

      // hci checks
      expect(hci.aclBuffers).toEqual(aclBuffers);
      expect(hci.isExtended).toBe(false);
    });

    it('should change buffers - LE_READ_BUFFER_SIZE_CMD', () => {
      const cmd = 8194;
      const status = 0;
      const result = Buffer.from([1, 0, 2]);

      hci.processCmdCompleteEvent(cmd, status, result);

      // called

      // not called
      expect(hci.readBufferSize).not.toHaveBeenCalled();
      expect(rssiReadCallback).not.toHaveBeenCalled();
      expect(addressChangeCallback).not.toHaveBeenCalled();
      expect(hci.setEventMask).not.toHaveBeenCalled();
      expect(hci.setLeEventMask).not.toHaveBeenCalled();
      expect(hci.readLocalVersion).not.toHaveBeenCalled();
      expect(hci.readBdAddr).not.toHaveBeenCalled();
      expect(hci.setScanEnabled).not.toHaveBeenCalled();
      expect(hci.setScanParameters).not.toHaveBeenCalled();
      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
      expect(leScanEnableSetCallback).not.toHaveBeenCalled();
      expect(stateChangeCallback).not.toHaveBeenCalled();
      expect(leScanParametersSetCallback).not.toHaveBeenCalled();
      expect(readLocalVersionCallback).not.toHaveBeenCalled();

      // hci checks
      expect(hci.aclBuffers).toEqual({
        length: 1,
        num: 2
      });
      expect(hci.isExtended).toBe(false);
    });

    it('should do nothing - READ_BUFFER_SIZE_CMD', () => {
      const cmd = 4101;
      const status = 0;
      const result = Buffer.from([1, 0, 3, 2, 0]);

      hci.processCmdCompleteEvent(cmd, status, result);

      // called

      // not called
      expect(hci.readBufferSize).not.toHaveBeenCalled();
      expect(rssiReadCallback).not.toHaveBeenCalled();
      expect(addressChangeCallback).not.toHaveBeenCalled();
      expect(hci.setEventMask).not.toHaveBeenCalled();
      expect(hci.setLeEventMask).not.toHaveBeenCalled();
      expect(hci.readLocalVersion).not.toHaveBeenCalled();
      expect(hci.readBdAddr).not.toHaveBeenCalled();
      expect(hci.setScanEnabled).not.toHaveBeenCalled();
      expect(hci.setScanParameters).not.toHaveBeenCalled();
      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
      expect(leScanEnableSetCallback).not.toHaveBeenCalled();
      expect(stateChangeCallback).not.toHaveBeenCalled();
      expect(leScanParametersSetCallback).not.toHaveBeenCalled();
      expect(readLocalVersionCallback).not.toHaveBeenCalled();

      // hci checks
      expect(hci.aclBuffers).toEqual({
        length: 1,
        num: 2
      });
      expect(hci.isExtended).toBe(false);
    });

    it('should not throw and delegate to READ_BUFFER_SIZE - LE_READ_BUFFER_SIZE_CMD with error status', () => {
      const cmd = 8194;
      const status = 0x0c;
      const result = Buffer.from([]);

      expect(() => hci.processCmdCompleteEvent(cmd, status, result)).not.toThrow();

      expect(hci.readBufferSize).toHaveBeenCalledTimes(1);

      expect(hci.readBufferSize).toHaveBeenCalledWith();
      expect(hci.aclBuffers).toEqual(aclBuffers);
    });

    it('should not throw and fall back to the LE minimum - READ_BUFFER_SIZE_CMD with error status', () => {
      const cmd = 4101;
      const status = 0x0c;
      const result = Buffer.from([]);

      expect(() => hci.processCmdCompleteEvent(cmd, status, result)).not.toThrow();

      expect(hci.aclBuffers).toEqual({ length: 27, num: 1 });
    });

    it('should fall back to the LE minimum - READ_BUFFER_SIZE_CMD with zero acl length', () => {
      const cmd = 4101;
      const status = 0;
      const result = Buffer.from([0, 0, 3, 2, 0]);

      hci.processCmdCompleteEvent(cmd, status, result);

      expect(hci.aclBuffers).toEqual({ length: 27, num: 1 });
    });

    it('should fall back to the LE minimum - READ_BUFFER_SIZE_CMD with zero acl num', () => {
      const cmd = 4101;
      const status = 0;
      const result = Buffer.from([1, 0, 0, 0, 0]);

      hci.processCmdCompleteEvent(cmd, status, result);

      expect(hci.aclBuffers).toEqual({ length: 27, num: 1 });
    });

    it('should do nothing - ??', () => {
      const cmd = 1;
      const status = 0;
      const result = Buffer.from([1, 0, 3, 2, 0]);

      hci.processCmdCompleteEvent(cmd, status, result);

      // called

      // not called
      expect(hci.readBufferSize).not.toHaveBeenCalled();
      expect(rssiReadCallback).not.toHaveBeenCalled();
      expect(addressChangeCallback).not.toHaveBeenCalled();
      expect(hci.setEventMask).not.toHaveBeenCalled();
      expect(hci.setLeEventMask).not.toHaveBeenCalled();
      expect(hci.readLocalVersion).not.toHaveBeenCalled();
      expect(hci.readBdAddr).not.toHaveBeenCalled();
      expect(hci.setScanEnabled).not.toHaveBeenCalled();
      expect(hci.setScanParameters).not.toHaveBeenCalled();
      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
      expect(leScanEnableSetCallback).not.toHaveBeenCalled();
      expect(stateChangeCallback).not.toHaveBeenCalled();
      expect(leScanParametersSetCallback).not.toHaveBeenCalled();
      expect(readLocalVersionCallback).not.toHaveBeenCalled();

      // hci checks
      expect(hci.aclBuffers).toEqual(aclBuffers);
      expect(hci.isExtended).toBe(false);
    });
  });

  describe('processLeMetaEvent', () => {
    beforeEach(() => {
      hci.processLeConnComplete = jest.fn();
      hci.processLeAdvertisingReport = jest.fn();
      hci.processLeConnUpdateComplete = jest.fn();
    });

    it('should do nothing', () => {
      const eventType = 0;
      const status = 'status';
      const data = 'data';

      hci.processLeMetaEvent(eventType, status, data);

      expect(hci.processLeConnComplete).not.toHaveBeenCalled();
      expect(hci.processLeAdvertisingReport).not.toHaveBeenCalled();
      expect(hci.processLeConnUpdateComplete).not.toHaveBeenCalled();
    });

    it('should processLeConnComplete', () => {
      const eventType = 1;
      const status = 'status';
      const data = 'data';

      hci.processLeMetaEvent(eventType, status, data);

      expect(hci.processLeConnComplete).toHaveBeenCalledTimes(1);

      expect(hci.processLeConnComplete).toHaveBeenCalledWith(status, data);
      expect(hci.processLeAdvertisingReport).not.toHaveBeenCalled();
      expect(hci.processLeConnUpdateComplete).not.toHaveBeenCalled();
    });

    it('should processLeAdvertisingReport', () => {
      const eventType = 2;
      const status = 'status';
      const data = 'data';

      hci.processLeMetaEvent(eventType, status, data);

      expect(hci.processLeAdvertisingReport).toHaveBeenCalledTimes(1);

      expect(hci.processLeAdvertisingReport).toHaveBeenCalledWith(status, data);
      expect(hci.processLeConnComplete).not.toHaveBeenCalled();
      expect(hci.processLeConnUpdateComplete).not.toHaveBeenCalled();
    });

    it('should processLeConnUpdateComplete', () => {
      const eventType = 3;
      const status = 'status';
      const data = 'data';

      hci.processLeMetaEvent(eventType, status, data);

      expect(hci.processLeConnUpdateComplete).toHaveBeenCalledTimes(1);

      expect(hci.processLeConnUpdateComplete).toHaveBeenCalledWith(status, data);
      expect(hci.processLeConnComplete).not.toHaveBeenCalled();
      expect(hci.processLeAdvertisingReport).not.toHaveBeenCalled();
    });
  });

  it('should emit leConnComplete', () => {
    const status = 0;
    const data = Buffer.from([0x34, 0x11, 4, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 2, 1, 4, 3, 7, 8, 9]);
    const callback = jest.fn();

    delegate.onLeConnComplete = callback;
    hci.processLeConnComplete(status, data);

    expect(callback).toHaveBeenCalledTimes(1);

    expect(callback.mock.calls[0]).toStrictEqual([{ status, handle: 4404, role: 4, addressType: 'random', address: 'ff:ee:dd:cc:bb:aa', interval: 322.5, latency: 772, supervisionTimeout: 20550, masterClockAccuracy: 9 }]);
    expect(Array.from(hci.aclConnections.keys())).toEqual([4404]);
    expect(hci.aclConnections.get(4404)).toEqual({ pending: 0 });
  });

  it('should emit leConnComplete but not record the connection on failed status', () => {
    const status = 1;
    const data = Buffer.from([0x34, 0x11, 4, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 2, 1, 4, 3, 7, 8, 9]);
    const callback = jest.fn();

    delegate.onLeConnComplete = callback;
    hci.processLeConnComplete(status, data);

    expect(callback).toHaveBeenCalledTimes(1);

    expect(callback.mock.calls[0]).toStrictEqual([{ status, handle: 4404, role: 4, addressType: 'random', address: 'ff:ee:dd:cc:bb:aa', interval: 322.5, latency: 772, supervisionTimeout: 20550, masterClockAccuracy: 9 }]);
    expect(hci.aclConnections.size).toBe(0);
  });

  it('should emit leConnComplete on processLeEnhancedConnComplete', () => {
    const status = 0;
    const data = Buffer.from([0x34, 0x11, 4, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 2, 1, 4, 3, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
    const callback = jest.fn();

    delegate.onLeConnComplete = callback;
    hci.processLeEnhancedConnComplete(status, data);

    expect(callback).toHaveBeenCalledTimes(1);

    expect(callback.mock.calls[0]).toStrictEqual([{ status, handle: 4404, role: 4, addressType: 'random', address: 'ff:ee:dd:cc:bb:aa', interval: 5138.75, latency: 4625, supervisionTimeout: 51390, masterClockAccuracy: 21, peerResolvablePrivateAddress: '0e:0d:0c:0b:0a:09' }]);
    expect(Array.from(hci.aclConnections.keys())).toEqual([4404]);
    expect(hci.aclConnections.get(4404)).toEqual({ pending: 0 });
  });

  it('should not emit leConnComplete for an all-zero payload (garbage/truncated event guard)', () => {
    const status = 0;
    const data = Buffer.alloc(17);
    const callback = jest.fn();

    delegate.onLeConnComplete = callback;
    hci.processLeConnComplete(status, data);

    expect(callback).not.toHaveBeenCalled();
    expect(hci.aclConnections.size).toBe(0);
  });

  it('emits a non-zero-status all-zero connection completion with its attempt token', () => {
    const status = 0x02;
    const data = Buffer.alloc(17);
    const callback = jest.fn();
    const attemptToken = {};
    hci.pendingLeConn = {
      address: '11:22:33:44:55:66',
      addressType: 'random',
      token: attemptToken
    };

    delegate.onLeConnComplete = callback;
    hci.processLeConnComplete(status, data);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]).toStrictEqual([{
      status,
      handle: 0,
      role: 0,
      addressType: 'public',
      address: '00:00:00:00:00:00',
      interval: 0,
      latency: 0,
      supervisionTimeout: 0,
      masterClockAccuracy: 0,
      attemptToken
    }]);
    expect(callback.mock.calls[0][0].attemptToken).toBe(attemptToken);
    expect(hci.pendingLeConn).toBe(null);
  });

  it('should not emit leConnComplete on processLeEnhancedConnComplete for an all-zero payload (garbage/truncated event guard)', () => {
    const status = 0;
    const data = Buffer.alloc(29);
    const callback = jest.fn();

    delegate.onLeConnComplete = callback;
    hci.processLeEnhancedConnComplete(status, data);

    expect(callback).not.toHaveBeenCalled();
    expect(hci.aclConnections.size).toBe(0);
  });

  it('emits a non-zero-status all-zero enhanced completion with its attempt token', () => {
    const status = 0x02;
    const data = Buffer.alloc(29);
    const callback = jest.fn();
    const attemptToken = {};
    hci.pendingLeConn = {
      address: '11:22:33:44:55:66',
      addressType: 'random',
      token: attemptToken
    };

    delegate.onLeConnComplete = callback;
    hci.processLeEnhancedConnComplete(status, data);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0]).toStrictEqual([{
      status,
      handle: 0,
      role: 0,
      addressType: 'public',
      address: '00:00:00:00:00:00',
      interval: 0,
      latency: 0,
      supervisionTimeout: 0,
      masterClockAccuracy: 0,
      peerResolvablePrivateAddress: '00:00:00:00:00:00',
      attemptToken
    }]);
    expect(callback.mock.calls[0][0].attemptToken).toBe(attemptToken);
    expect(hci.pendingLeConn).toBe(null);
  });

  it('should not register an ACL connection when the completion reports a failure status', () => {
    const status = 0x02;
    const data = Buffer.from([0x34, 0x11, 4, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 2, 1, 4, 3, 7, 8, 9]);
    const callback = jest.fn();

    delegate.onLeConnComplete = callback;
    hci.processLeConnComplete(status, data);

    expect(callback).toHaveBeenCalledTimes(1);

    expect(callback.mock.calls[0]).toStrictEqual([{ status, handle: 4404, role: 4, addressType: 'random', address: 'ff:ee:dd:cc:bb:aa', interval: 322.5, latency: 772, supervisionTimeout: 20550, masterClockAccuracy: 9 }]);
    expect(hci.aclConnections.size).toBe(0);
  });

  it('should not register an ACL connection on processLeEnhancedConnComplete when the completion reports a failure status', () => {
    const status = 0x02;
    const data = Buffer.from([0x34, 0x11, 4, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 2, 1, 4, 3, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
    const callback = jest.fn();

    delegate.onLeConnComplete = callback;
    hci.processLeEnhancedConnComplete(status, data);

    expect(callback).toHaveBeenCalledTimes(1);

    expect(callback.mock.calls[0]).toStrictEqual([{ status, handle: 4404, role: 4, addressType: 'random', address: 'ff:ee:dd:cc:bb:aa', interval: 5138.75, latency: 4625, supervisionTimeout: 51390, masterClockAccuracy: 21, peerResolvablePrivateAddress: '0e:0d:0c:0b:0a:09' }]);
    expect(hci.aclConnections.size).toBe(0);
  });

  it('should not throw and should reject a too-short payload for processLeConnComplete', () => {
    // Non-zero payload, one byte short of the 17 the field reads require - the all-zero
    // guard must not be the only thing standing between this and a RangeError.
    const status = 0;
    const data = Buffer.from([0x34, 0x11, 4, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 2, 1, 4, 3, 7, 8]);
    const callback = jest.fn();
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    delegate.onLeConnComplete = callback;

    expect(() => hci.processLeConnComplete(status, data)).not.toThrow();

    expect(callback).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('too short'));
    consoleSpy.mockRestore();
  });

  it('should not throw and should reject a too-short payload for processLeEnhancedConnComplete', () => {
    // Non-zero payload, one byte short of the 29 the field reads require - the all-zero
    // guard must not be the only thing standing between this and a RangeError.
    const status = 0;
    const data = Buffer.from([0x34, 0x11, 4, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 2, 1, 4, 3, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    const callback = jest.fn();
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    delegate.onLeConnComplete = callback;

    expect(() => hci.processLeEnhancedConnComplete(status, data)).not.toThrow();

    expect(callback).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('too short'));
    consoleSpy.mockRestore();
  });

  it('should still write reset after a failed connection-complete recorded no connection (regression: guard must not jam)', () => {
    const status = 1;
    const data = Buffer.from([0x34, 0x11, 4, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 2, 1, 4, 3, 7, 8, 9]);

    hci.processLeConnComplete(status, data);
    expect(hci.aclConnections.size).toBe(0);

    hci.reset();

    expect(hci.socket.write).toHaveBeenCalledTimes(1);

    expect(hci.socket.write).toHaveBeenCalledWith(Buffer.from([1, 3, 0x0c, 0]));
  });

  describe('processLeAdvertisingReport', () => {
    it('should emit without error', () => {
      const count = 2;
      const data1 = Buffer.from([0, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 2, 3, 4, 0]);
      const data2 = Buffer.from([1, 0, 0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 4, 3, 4, 5, 6, 7]);
      const data = Buffer.concat([data1, data2]);
      const callback = jest.fn();

      delegate.onLeAdvertisingReport = callback;
      hci.processLeAdvertisingReport(count, data);

      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should emit only once with random address', () => {
      const count = 1;
      const data = Buffer.from([0, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 2, 3, 4, 0]);
      const callback = jest.fn();

      delegate.onLeAdvertisingReport = callback;
      hci.processLeAdvertisingReport(count, data);

      expect(callback).toHaveBeenCalledTimes(1);

      expect(callback.mock.calls[0]).toStrictEqual([{ status: 0, type: 0, address: 'ff:ee:dd:cc:bb:aa', addressType: 'random', eir: Buffer.from([0x03, 0x04]), rssi: 0 }]);
    });

    it('should emit only once with public address', () => {
      const count = 1;
      const data = Buffer.from([1, 0, 0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 4, 3, 4, 5, 6, 7]);
      const callback = jest.fn();

      delegate.onLeAdvertisingReport = callback;
      hci.processLeAdvertisingReport(count, data);

      expect(callback).toHaveBeenCalledTimes(1);

      expect(callback.mock.calls[0]).toStrictEqual([{ status: 0, type: 1, address: 'aa:bb:cc:dd:ee:ff', addressType: 'public', eir: Buffer.from([0x03, 0x04, 0x05, 0x06]), rssi: 7 }]);
    });

    it('should catch error', () => {
      const count = 1;
      const data = Buffer.from([1, 0, 0xff, 0xee]);
      const callback = jest.fn();

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      delegate.onLeAdvertisingReport = callback;
      hci.processLeAdvertisingReport(count, data);

      expect(callback).not.toHaveBeenCalled();
      
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('illegal packet'));
    });
  });

  describe('processLeExtendedAdvertisingReport', () => {
    it('should emit without error', () => {
      const count = 2;
      const eir1 = Buffer.from([0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17]);
      const header1 = Buffer.from([0, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, eir1.length]);
      const data1 = Buffer.concat([header1, eir1]);
      const eir2 = Buffer.from([0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27]);
      const header2 = Buffer.from([1, 0, 0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 4, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, eir2.length]);
      const data2 = Buffer.concat([header2, eir2]);
      const data = Buffer.concat([data1, data2]);
      const callback = jest.fn();

      delegate.onLeExtendedAdvertisingReport = callback;
      hci.processLeExtendedAdvertisingReport(count, data);

      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should emit only once with random address', () => {
      const count = 1;
      const eir = Buffer.from([0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17]);
      const header = Buffer.from([0, 1, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, eir.length]);
      const data = Buffer.concat([header, eir]);
      const callback = jest.fn();

      delegate.onLeExtendedAdvertisingReport = callback;
      hci.processLeExtendedAdvertisingReport(count, data);

      expect(callback).toHaveBeenCalledTimes(1);

      expect(callback.mock.calls[0]).toStrictEqual([{ status: 0, type: 256, address: 'ff:ee:dd:cc:bb:aa', addressType: 'random', eir: Buffer.from([0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17]), rssi: 6, txpower: 5 }]);
    });

    it('should emit only once with public address', () => {
      const count = 1;
      const eir = Buffer.from([0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17]);
      const header = Buffer.from([0, 1, 2, 0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, eir.length]);
      const data = Buffer.concat([header, eir]);
      const callback = jest.fn();

      delegate.onLeExtendedAdvertisingReport = callback;
      hci.processLeExtendedAdvertisingReport(count, data);

      expect(callback).toHaveBeenCalledTimes(1);

      expect(callback.mock.calls[0]).toStrictEqual([{ status: 0, type: 256, address: 'aa:bb:cc:dd:ee:ff', addressType: 'public', eir: Buffer.from([0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17]), rssi: 6, txpower: 5 }]);
    });

    it('should catch error', () => {
      const count = 1;
      const data = Buffer.from([1, 0, 0xff, 0xee]);
      const callback = jest.fn();

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      delegate.onLeExtendedAdvertisingReport = callback;
      hci.processLeExtendedAdvertisingReport(count, data);

      expect(callback).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('illegal packet'));
    });

    it('should ignore too-short extended report without throwing', () => {
      const count = 1;
      const data = Buffer.alloc(10);
      const callback = jest.fn();

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      delegate.onLeExtendedAdvertisingReport = callback;
      hci.processLeExtendedAdvertisingReport(count, data);

      expect(callback).not.toHaveBeenCalled();
      expect(consoleSpy.mock.calls.some((call) => String(call[0]).includes('too short'))).toBe(true);
      consoleSpy.mockRestore();
    });

    it('should ignore extended report with oversized eir length', () => {
      const count = 1;
      const data = Buffer.from([
        0, 1, 2, 0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa,
        2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
        200, // eirLength larger than remaining bytes
        0x01, 0x02, 0x03,
      ]);
      const callback = jest.fn();

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      delegate.onLeExtendedAdvertisingReport = callback;
      hci.processLeExtendedAdvertisingReport(count, data);

      expect(callback).not.toHaveBeenCalled();
      expect(consoleSpy.mock.calls.some((call) => String(call[0]).includes('eir length'))).toBe(true);
      consoleSpy.mockRestore();
    });
  });

  it('processLeConnUpdateComplete', () => {
    const callback = jest.fn();
    delegate.onLeConnUpdateComplete = callback;
    hci.processLeConnUpdateComplete('status', Buffer.from(([1, 0, 2, 0, 3, 0, 4, 0])));

    expect(callback).toHaveBeenCalledTimes(1);

    expect(callback).toHaveBeenCalledWith('status', 1, 2.5, 3, 40);
  });

  describe('processCmdStatusEvent', () => {
    it('should do nothing on bad cmd', () => {
      const callback = jest.fn();
      delegate.onLeConnComplete = callback;
      hci.processCmdStatusEvent(8206, 'status');

      expect(callback).not.toHaveBeenCalled();
    });

    [8205, 8259].forEach((cmd) => {
      it(`should do nothing on bad status - cmd = ${cmd}`, () => {
        const callback = jest.fn();
        delegate.onLeConnComplete = callback;
        hci.processCmdStatusEvent(cmd, 0);

        expect(callback).not.toHaveBeenCalled();
      });

      it(`should emit event - cmd = ${cmd}`, () => {
        const callback = jest.fn();
        const attemptToken = {};
        hci.pendingLeConn = {
          address: '11:22:33:44:55:66',
          addressType: 'random',
          token: attemptToken
        };
        delegate.onLeConnComplete = callback;
        hci.processCmdStatusEvent(cmd, 'status');

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback.mock.calls[0]).toStrictEqual([{
          status: 'status',
          addressType: 'random',
          address: '11:22:33:44:55:66',
          attemptToken
        }]);
        expect(callback.mock.calls[0][0].attemptToken).toBe(attemptToken);
        expect(hci.pendingLeConn).toBe(null);
      });
    });
  });

  it('should change state and notify the delegate', () => {
    hci.setState('newState');
    expect(hci.state).toBe('newState');
    expect(delegate.onStateChange).toHaveBeenCalledTimes(1);
    expect(delegate.onStateChange).toHaveBeenCalledWith('newState');
  });

  it('should clear ACL bookkeeping before reporting a power-off from poweredOn', () => {
    hci.state = 'poweredOn';
    hci.aclConnections.set(4404, { pending: 1 });
    hci.aclQueue.push({ handle: 4404, packet: Buffer.from([0x02]) });
    hci.pendingLeConn = { address: '11:22:33:44:55:66', addressType: 'random' };

    let connectionsSeenByDelegate;
    delegate.onStateChange = jest.fn(() => {
      connectionsSeenByDelegate = hci.aclConnections.size;
    });

    hci.setState('poweredOff');

    expect(connectionsSeenByDelegate).toBe(0);
    expect(hci.aclQueue).toHaveLength(0);
    expect(hci.pendingLeConn).toBeNull();
    expect(hci.state).toBe('poweredOff');
  });

  describe('after-reset callbacks', () => {
    it('should run a callback only for the first reset that follows it', () => {
      hci.createLeConnAfterReset = jest.fn();

      hci.createLeConn('aa:bb:cc:dd:ee:ff', 'random', {}, true);
      expect(hci.createLeConnAfterReset).not.toHaveBeenCalled();

      hci.processCmdCompleteEvent(RESET_CMD, 0, Buffer.alloc(0));
      hci.processCmdCompleteEvent(RESET_CMD, 0, Buffer.alloc(0));

      expect(hci.createLeConnAfterReset).toHaveBeenCalledTimes(1);
    });

    it('should not run a callback registered while the callbacks are being drained until the next reset', () => {
      const late = jest.fn();
      const early = jest.fn(() => {
        hci.afterResetCallbacks.push(late);
      });
      hci.afterResetCallbacks.push(early);

      hci.processCmdCompleteEvent(RESET_CMD, 0, Buffer.alloc(0));
      expect(early).toHaveBeenCalledTimes(1);
      expect(late).not.toHaveBeenCalled();

      hci.processCmdCompleteEvent(RESET_CMD, 0, Buffer.alloc(0));
      expect(early).toHaveBeenCalledTimes(1);
      expect(late).toHaveBeenCalledTimes(1);
    });

    it('should connect without a reset when asked to', () => {
      hci.createLeConnAfterReset = jest.fn();
      const attemptToken = {};

      hci.createLeConn('aa:bb:cc:dd:ee:ff', 'random', { minInterval: 6 }, false, attemptToken);

      expect(hci.socket.write).not.toHaveBeenCalled();
      expect(hci.createLeConnAfterReset).toHaveBeenCalledWith('aa:bb:cc:dd:ee:ff', 'random', { minInterval: 6 }, attemptToken);
    });
  });

  describe('delegate', () => {
    it('should tolerate a delegate without the informational methods', () => {
      delete delegate.onLeFeatures;
      delete delegate.onLeDataLengthChange;
      delete delegate.onReadLocalVersion;

      expect(() => {
        hci.processCmdCompleteEvent(8195, 0, Buffer.alloc(8));
        hci.processCmdCompleteEvent(4097, 0, Buffer.from([9, 1, 2, 3, 4, 5, 6, 7]));
        hci.processLeMetaEvent(0x07, 0x40, Buffer.from([0x01, 0xfb, 0x00, 0x48, 0x08, 0xfb, 0x00, 0x48, 0x08]));
      }).not.toThrow();
    });

    it('should report the LE features to the delegate', () => {
      const features = Buffer.from([0x20, 0x18, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

      hci.processCmdCompleteEvent(8195, 0, features);

      expect(delegate.onLeFeatures).toHaveBeenCalledTimes(1);
      expect(delegate.onLeFeatures).toHaveBeenCalledWith(features);
    });

    it('should carry the attempt token of a matching successful connection and consume the attempt', () => {
      const attemptToken = {};
      hci.createLeConnAfterReset('FF:EE:DD:CC:BB:AA', 'random', {}, attemptToken);

      hci.processLeConnComplete(0, Buffer.from([0x34, 0x11, 4, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 2, 1, 4, 3, 7, 8, 9]));

      expect(delegate.onLeConnComplete).toHaveBeenCalledTimes(1);
      expect(delegate.onLeConnComplete.mock.calls[0][0].attemptToken).toBe(attemptToken);
      expect(hci.pendingLeConn).toBeNull();
    });

    it('should not attribute a connection from another address to the pending attempt', () => {
      const attemptToken = {};
      hci.createLeConnAfterReset('11:22:33:44:55:66', 'random', {}, attemptToken);

      hci.processLeConnComplete(0, Buffer.from([0x34, 0x11, 4, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 2, 1, 4, 3, 7, 8, 9]));

      expect(delegate.onLeConnComplete).toHaveBeenCalledTimes(1);
      expect(delegate.onLeConnComplete.mock.calls[0][0]).not.toHaveProperty('attemptToken');
      expect(hci.pendingLeConn).not.toBeNull();
    });

    it('should match the pending attempt against the peer resolvable private address of an enhanced completion', () => {
      const attemptToken = {};
      hci.createLeConnAfterReset('0e:0d:0c:0b:0a:09', 'random', {}, attemptToken);

      hci.processLeEnhancedConnComplete(0, Buffer.from([0x34, 0x11, 4, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 2, 1, 4, 3, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]));

      expect(delegate.onLeConnComplete.mock.calls[0][0].attemptToken).toBe(attemptToken);
      expect(hci.pendingLeConn).toBeNull();
    });

    it('should report a failed Command Status with only the status when no attempt is pending', () => {
      hci.processCmdStatusEvent(8205, 0x0c);

      expect(delegate.onLeConnComplete.mock.calls).toStrictEqual([[{ status: 0x0c }]]);
    });
  });

  it('should expose the HCI status table', () => {
    expect(HCI_STATUS[0]).toBe('Success');
    expect(HCI_STATUS[0x3e]).toBe(require('../../../src/bindings/hci/hci-status.json')[0x3e]);
    expect(HCI_STATUS[0xffff]).toBeUndefined();
  });
});
