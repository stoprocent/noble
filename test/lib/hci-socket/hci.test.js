const should = require('should');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const { assert } = sinon;

describe('hci-socket hci', () => {
  const deviceId = 'deviceId';
  const mockSocket = sinon.stub();

  // Mock the crypto module
  jest.mock('os', () => ({
    platform: () => 'linux',
    release: () => '5.10.0-11-amd64'
  }));

  jest.mock('@stoprocent/bluetooth-hci-socket', () => ({
    loadDriver: () => mockSocket
  }));

  const Hci = require('../../../lib/hci-socket/hci');

  let hci;

  beforeEach(() => {
    mockSocket.prototype.on = sinon.stub();
    mockSocket.prototype.bindUser = sinon.stub();
    mockSocket.prototype.bindRaw = sinon.stub();
    mockSocket.prototype.start = sinon.stub();
    mockSocket.prototype.isDevUp = sinon.stub();
    mockSocket.prototype.removeAllListeners = sinon.stub();
    mockSocket.prototype.setFilter = sinon.stub();
    mockSocket.prototype.setAddress = sinon.stub();
    mockSocket.prototype.write = sinon.stub();
    
    hci = new Hci({});
    hci._deviceId = deviceId;
  });

  afterEach(() => {
    sinon.reset();
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

      const configuredHci = new Hci({ userChannel: true });

      should(configuredHci._userChannel).be.true();
    });

    it('allows the option to disable an environment setting', () => {
      process.env.HCI_CHANNEL_USER = '1';

      const configuredHci = new Hci({ userChannel: false });

      should(configuredHci._userChannel).be.false();
    });

    it('uses HCI_CHANNEL_USER when the option is omitted', () => {
      process.env.HCI_CHANNEL_USER = '1';

      const configuredHci = new Hci({});

      should(configuredHci._userChannel).be.true();
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

      should(new Hci({})._codedPhy).be.false();
    });

    it('treats controller support as unknown until features are read', () => {
      should(new Hci({ codedPhy: true })._supportsCodedPhy).be.false();
    });

    it('uses the codedPhy option', () => {
      delete process.env.NOBLE_CODED_PHY;

      should(new Hci({ codedPhy: true })._codedPhy).be.true();
    });

    it('allows the option to disable an environment setting', () => {
      process.env.NOBLE_CODED_PHY = '1';

      should(new Hci({ codedPhy: false })._codedPhy).be.false();
    });

    it('uses NOBLE_CODED_PHY when the option is omitted', () => {
      process.env.NOBLE_CODED_PHY = '1';

      should(new Hci({})._codedPhy).be.true();
    });

    it('is independent of extended mode', () => {
      delete process.env.NOBLE_CODED_PHY;

      should(new Hci({ extended: true })._codedPhy).be.false();
      should(new Hci({ codedPhy: true })._isExtended).be.false();
    });
  });

  describe('extended mode configuration', () => {
    it('keeps an explicit true value when capability replies disagree', () => {
      const configuredHci = new Hci({ extended: true });
      const noLeExtendedAdvertising = Buffer.alloc(8);
      const noExtendedScanCommands = Buffer.alloc(64);

      configuredHci.processCmdCompleteEvent(8195, 0, noLeExtendedAdvertising);
      configuredHci.processCmdCompleteEvent(4098, 0, noExtendedScanCommands);

      should(configuredHci._isExtended).be.true();
    });

    it('keeps an explicit false value when capabilities advertise extended support', () => {
      const configuredHci = new Hci({ extended: false });
      const leExtendedAdvertising = Buffer.alloc(8);
      const extendedScanCommands = Buffer.alloc(64);
      leExtendedAdvertising[1] = 0x10;
      extendedScanCommands[37] = 0x30;

      configuredHci.processCmdCompleteEvent(8195, 0, leExtendedAdvertising);
      configuredHci.processCmdCompleteEvent(4098, 0, extendedScanCommands);

      should(configuredHci._isExtended).be.false();
    });

    it('auto-detects from LE features only and always stores a boolean', () => {
      const detectedHci = new Hci({});
      const leExtendedAdvertising = Buffer.alloc(8);
      const noExtendedScanCommands = Buffer.alloc(64);
      leExtendedAdvertising[1] = 0x10;

      detectedHci.processCmdCompleteEvent(8195, 0, leExtendedAdvertising);
      detectedHci.processCmdCompleteEvent(4098, 0, noExtendedScanCommands);

      should(detectedHci._isExtended).be.a.Boolean();
      should(detectedHci._isExtended).be.true();
    });
  });

  describe('init', () => {
    it('should reset', () => {
      hci.reset = sinon.spy();

      hci._userChannel = 'userChannel';
      hci.init();

      assert.callCount(hci._socket.on, 3);
      assert.calledWithMatch(hci._socket.on, 'data', sinon.match.func);
      assert.calledWithMatch(hci._socket.on, 'error', sinon.match.func);
      assert.calledWithMatch(hci._socket.on, 'state', sinon.match.func);

      assert.calledOnceWithExactly(hci._socket.bindUser, deviceId, undefined);
      assert.calledOnceWithExactly(hci._socket.start);

      assert.calledOnceWithExactly(hci.reset);
    });

    it('should bindRaw', () => {
      hci.pollIsDevUp = sinon.spy();
      hci.readLeSupportedFeatures = sinon.spy();

      hci._userChannel = undefined;
      hci._bound = false;
      hci.init();

      assert.callCount(hci._socket.on, 3);
      assert.calledWithMatch(hci._socket.on, 'data', sinon.match.func);
      assert.calledWithMatch(hci._socket.on, 'error', sinon.match.func);
      assert.calledWithMatch(hci._socket.on, 'state', sinon.match.func);

      assert.calledOnceWithExactly(hci._socket.bindRaw, deviceId, undefined);
      assert.calledOnceWithExactly(hci._socket.start);

      assert.calledOnceWithExactly(hci.pollIsDevUp);
      assert.notCalled(hci.readLeSupportedFeatures);

      should(hci._bound).be.true();
      should(hci._isStarted).be.true();
    });

    it('should not bindRaw', () => {
      hci.pollIsDevUp = sinon.spy();

      hci._userChannel = undefined;
      hci._bound = true;
      hci.init();

      assert.callCount(hci._socket.on, 3);
      assert.calledWithMatch(hci._socket.on, 'data', sinon.match.func);
      assert.calledWithMatch(hci._socket.on, 'error', sinon.match.func);
      assert.calledWithMatch(hci._socket.on, 'state', sinon.match.func);

      assert.notCalled(hci._socket.bindRaw);
      assert.calledOnceWithExactly(hci._socket.start);

      assert.calledOnceWithExactly(hci.pollIsDevUp);

      should(hci._bound).be.true();
    });

    it('should defer LE Read Local Supported Features until reset completes, and skip pollIsDevUp, for user channel', () => {
      hci.pollIsDevUp = sinon.spy();
      hci.readLeSupportedFeatures = sinon.spy();
      hci.setSocketFilter = sinon.spy();

      hci._userChannel = true;
      hci.init();

      assert.calledOnceWithExactly(hci._socket.bindUser, deviceId, undefined);
      assert.calledOnceWithExactly(hci._socket.start);

      assert.notCalled(hci.readLeSupportedFeatures);
      assert.notCalled(hci.pollIsDevUp);
      assert.notCalled(hci.setSocketFilter);
      should(hci._isStarted).be.true();

      hci.emit('reset');

      assert.calledOnceWithExactly(hci.readLeSupportedFeatures);
    });
  });

  describe('pollIsDevUp', () => {
    let callback;

    beforeEach(() => {
      sinon.useFakeTimers();

      callback = sinon.spy();

      hci.setSocketFilter = sinon.spy();
      hci.setEventMask = sinon.spy();
      hci.setLeEventMask = sinon.spy();
      hci.readLocalVersion = sinon.spy();
      hci.writeLeHostSupported = sinon.spy();
      hci.readLeHostSupported = sinon.spy();
      hci.readLeBufferSize = sinon.spy();
      hci.readBdAddr = sinon.spy();
      hci.init = sinon.spy();
      hci.readLeSupportedFeatures = sinon.spy();
      hci.setCodedPhySupport = sinon.spy();

      hci.on('stateChange', callback);
    });

    afterEach(() => {
      sinon.restore();
      sinon.reset();
    });

    it('should only register timeout', () => {
      hci._socket.isDevUp.returns(true);
      hci._isDevUp = true;

      hci.pollIsDevUp();

      assert.notCalled(hci.setSocketFilter);
      assert.notCalled(hci.setEventMask);
      assert.notCalled(hci.setLeEventMask);
      assert.notCalled(hci.readLocalVersion);
      assert.notCalled(hci.writeLeHostSupported);
      assert.notCalled(hci.readLeHostSupported);
      assert.notCalled(hci.readLeBufferSize);
      assert.notCalled(hci.readBdAddr);
      assert.notCalled(hci.setCodedPhySupport);
      assert.notCalled(hci.init);
      assert.notCalled(callback);
    });

    it('should re-init', () => {
      hci._socket.isDevUp.returns(true);
      hci._isDevUp = false;
      hci._state = 'poweredOff';

      hci.pollIsDevUp();

      should(hci._state).equal(null);

      assert.calledOnceWithExactly(hci._socket.removeAllListeners);
      assert.calledOnceWithExactly(hci.init);

      assert.notCalled(hci.setSocketFilter);
      assert.notCalled(hci.setEventMask);
      assert.notCalled(hci.setLeEventMask);
      assert.notCalled(hci.readLocalVersion);
      assert.notCalled(hci.writeLeHostSupported);
      assert.notCalled(hci.readLeHostSupported);
      assert.notCalled(hci.readLeBufferSize);
      assert.notCalled(hci.readBdAddr);
      assert.notCalled(hci.setCodedPhySupport);
      assert.notCalled(callback);
    });

    it('should init all', () => {
      hci._socket.isDevUp.returns(true);
      hci._isDevUp = false;
      hci._state = undefined;

      hci.pollIsDevUp();

      assert.calledOnceWithExactly(hci.setSocketFilter);
      assert.calledOnceWithExactly(hci.readLeSupportedFeatures);

      assert.notCalled(hci.setCodedPhySupport);
      assert.notCalled(hci._socket.removeAllListeners);
      assert.notCalled(hci.init);
      assert.notCalled(callback);
    });

    it('should init all with extended option', () => {
      hci._socket.isDevUp.returns(true);
      hci._isDevUp = false;
      hci._state = undefined;
      hci._isExtended = true;

      hci.pollIsDevUp();

      assert.calledOnceWithExactly(hci.setSocketFilter);
      assert.calledOnceWithExactly(hci.readLeSupportedFeatures);

      assert.notCalled(hci._socket.removeAllListeners);
      assert.notCalled(hci.init);
      assert.notCalled(callback);
    });

    it('should keep exactly one pending timer no matter how many times it is invoked within the same tick', () => {
      hci._isStarted = true;
      hci._socket.isDevUp.returns(true);
      hci._isDevUp = true;

      for (let i = 0; i < 10; i++) {
        hci.pollIsDevUp();
      }

      should(sinon.clock.countTimers()).equal(1);
    });

    it('should keep polling normally across ticks with a single timer', () => {
      hci._isStarted = true;
      hci._socket.isDevUp.returns(true);
      hci._isDevUp = true;

      hci.pollIsDevUp();
      should(sinon.clock.countTimers()).equal(1);

      sinon.clock.tick(1000);
      should(sinon.clock.countTimers()).equal(1);

      sinon.clock.tick(1000);
      should(sinon.clock.countTimers()).equal(1);
    });

    it('should not re-arm the poll timer after stop()', () => {
      hci._socket.stop = sinon.spy();
      hci._isStarted = true;
      hci._socket.isDevUp.returns(true);
      hci._isDevUp = true;

      hci.pollIsDevUp();
      should(sinon.clock.countTimers()).equal(1);

      hci.stop();
      should(sinon.clock.countTimers()).equal(0);

      sinon.clock.tick(1000);
      should(sinon.clock.countTimers()).equal(0);
      assert.notCalled(hci.init);
    });

    it('should re-initialise after a genuine power-off followed by power-on', () => {
      hci._state = 'poweredOn';
      hci._isDevUp = true;

      hci._socket.isDevUp.returns(false);
      hci.pollIsDevUp();

      assert.calledOnceWithExactly(callback, 'poweredOff');
      should(hci._state).equal('poweredOff');

      hci._socket.isDevUp.returns(true);
      hci.pollIsDevUp();

      assert.calledOnceWithExactly(hci._socket.removeAllListeners);
      assert.calledOnceWithExactly(hci.init);
      should(hci._state).equal(null);
    });

    it('should end up with exactly one pending timer once init() re-enters pollIsDevUp during recovery', () => {
      hci.init = Hci.prototype.init;
      hci._isStarted = true;
      hci._state = 'poweredOff';
      hci._isDevUp = false;
      hci._socket.isDevUp.returns(true);

      hci.pollIsDevUp();

      should(sinon.clock.countTimers()).equal(1);
    });

    it('should still leave a pending poll timer when init() throws during recovery', () => {
      hci.init = Hci.prototype.init;
      hci._isStarted = true;
      hci._state = 'poweredOff';
      hci._isDevUp = false;
      hci._socket.isDevUp.returns(true);
      hci._socket.start = sinon.stub().throws(new Error('boom'));

      hci.pollIsDevUp();

      should(sinon.clock.countTimers()).equal(1);
    });

    it('should not reschedule itself for user channel', () => {
      hci._userChannel = true;
      hci._isStarted = true;
      hci._socket.isDevUp.returns(true);
      hci._isDevUp = true;

      hci.pollIsDevUp();

      should(sinon.clock.countTimers()).equal(0);
    });
  });

  it('should write codedPhySupport command', () => {
    hci.setCodedPhySupport();
    assert.calledOnceWithExactly(hci._socket.write, Buffer.from([0x01, 0x31, 0x20, 0x03, 0x00, 0x05, 0x05]));
  });

  it('should setSocketFilter', () => {
    hci.setSocketFilter();
    assert.calledOnceWithExactly(hci._socket.setFilter, Buffer.from([0x16, 0, 0, 0, 0x20, 0xc1, 0x08, 0, 0, 0, 0, 0x40, 0, 0]));
  });

  it('should setEventMask', () => {
    hci.setEventMask();
    assert.calledOnceWithExactly(hci._socket.write, Buffer.from([1, 1, 0x0c, 0x08, 0xff, 0xff, 0xfb, 0xff, 0x07, 0xf8, 0xbf, 0x3d]));
  });

  describe('reset', () => {
    it('should write the reset command when no ACL connections are active', () => {
      hci.reset();
      assert.calledOnceWithExactly(hci._socket.write, Buffer.from([1, 3, 0x0c, 0]));
    });

    it('should not write the reset command while an ACL connection is active, but still emit reset and run the post-reset chain', () => {
      hci.setEventMask = sinon.spy();
      hci.setLeEventMask = sinon.spy();
      hci.readLocalVersion = sinon.spy();
      hci.readBdAddr = sinon.spy();
      const resetCallback = sinon.spy();
      hci.on('reset', resetCallback);

      hci._aclConnections.set(4404, { pending: 0 });

      hci.reset();

      assert.notCalled(hci._socket.write);
      assert.calledOnceWithExactly(hci.setEventMask);
      assert.calledOnceWithExactly(hci.setLeEventMask);
      assert.calledOnceWithExactly(hci.readLocalVersion);
      assert.calledOnceWithExactly(hci.readBdAddr);
      assert.calledOnce(resetCallback);
    });

    it('should still reach createLeConnAfterReset via createLeConn while an ACL connection is active', () => {
      hci.setEventMask = sinon.spy();
      hci.setLeEventMask = sinon.spy();
      hci.readLocalVersion = sinon.spy();
      hci.readBdAddr = sinon.spy();
      hci.createLeConnAfterReset = sinon.spy();
      hci._aclConnections.set(4404, { pending: 0 });

      const address = 'aa:bb:cc:dd:ee:ff';
      const addressType = 'random';
      const parameters = { minInterval: 0x0060, maxInterval: 0x00c0 };

      hci.createLeConn(address, addressType, parameters, true);

      assert.notCalled(hci._socket.write);
      assert.calledOnceWithExactly(hci.createLeConnAfterReset, address, addressType, parameters, undefined);
    });

    it('should resume writing the reset command once the ACL connections are gone', () => {
      hci.setEventMask = sinon.spy();
      hci.setLeEventMask = sinon.spy();
      hci.readLocalVersion = sinon.spy();
      hci.readBdAddr = sinon.spy();

      hci._aclConnections.set(4404, { pending: 0 });
      hci.reset();
      assert.notCalled(hci._socket.write);

      hci._aclConnections.delete(4404);
      hci.reset();

      assert.calledOnceWithExactly(hci._socket.write, Buffer.from([1, 3, 0x0c, 0]));
    });
  });

  describe('stop', () => {
    it('should clear ACL bookkeeping so a subsequent reset() is not left permanently refused', () => {
      hci._socket.stop = sinon.spy();
      hci._aclConnections.set(4404, { pending: 0 });
      hci._aclQueue.push({ handle: 4404, packet: Buffer.from([0x00]) });

      hci.stop();

      should(hci._aclConnections.size).equal(0);
      should(hci._aclQueue).be.empty();

      hci.reset();
      assert.calledOnceWithExactly(hci._socket.write, Buffer.from([1, 3, 0x0c, 0]));
    });
  });

  it('should readSupportedCommands', () => {
    hci.readSupportedCommands();
    assert.calledOnceWithExactly(hci._socket.write, Buffer.from([0x01, 0x02, 0x10, 0x00]));
  });

  it('should readLocalVersion', () => {
    hci.readLocalVersion();
    assert.calledOnceWithExactly(hci._socket.write, Buffer.from([1, 1, 0x10, 0]));
  });

  it('should readBufferSize', () => {
    hci.readBufferSize();
    assert.calledOnceWithExactly(hci._socket.write, Buffer.from([1, 5, 0x10, 0]));
  });

  it('should readBdAddr', () => {
    hci.readBdAddr();
    assert.calledOnceWithExactly(hci._socket.write, Buffer.from([1, 9, 0x10, 0]));
  });

  describe('setAddress', () => {
    it('should write vendor specific (Linux Foundation) command based on read local version response', () => {
      hci.readBdAddr = sinon.spy();
      hci.setScanEnabled = sinon.spy();
      hci.setScanParameters = sinon.spy();

      const cmd = 4097;
      const status = 0;
      // hciVer=12, hciRev=0, lmpVer=12, manufacturer=1521, lmpSubVer=65535
      const result = Buffer.from([0x0C, 0x00, 0x00, 0x0C, 0xF1, 0x05, 0xFF, 0xFF]);

      hci.processCmdCompleteEvent(cmd, status, result);

      hci.setAddress('11:22:33:44:55:66');
      assert.calledOnceWithExactly(hci._socket.write, Buffer.from([0x01, 0x06, 0xfc, 0x06, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11]));
    });

    it('should write vendor specific (Ericsson) command based on manufacturer value (', () => {
      hci._manufacturer = 0;
      hci.readBdAddr = sinon.spy();
      hci.setAddress('11:22:33:44:55:66');
      assert.calledOnceWithExactly(hci._socket.write, Buffer.from([0x01, 0x0d, 0xfc, 0x06, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11]));
    });

    it('should write vendor specific (Texas Instrument) command based on manufacturer value', () => {
      hci._manufacturer = 13;
      hci.readBdAddr = sinon.spy();
      hci.setAddress('11:22:33:44:55:66');
      assert.calledOnceWithExactly(hci._socket.write, Buffer.from([0x01, 0x06, 0xfc, 0x06, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11]));
    });

    it('should write vendor specific (BCM) command based on manufacturer value', () => {
      hci._manufacturer = 15;
      hci.readBdAddr = sinon.spy();
      hci.setAddress('11:22:33:44:55:66');
      assert.calledOnceWithExactly(hci._socket.write, Buffer.from([0x01, 0x01, 0xfc, 0x06, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11]));
    });

    it('should not write vendor specific command', () => {
      hci.setAddress('11:22:33:44:55:66');
      assert.notCalled(hci._socket.write);
    });
  });

  describe('setLeEventMask', () => {
    it('should setLeEventMask', () => {
      hci.setLeEventMask();
      assert.calledOnceWithExactly(hci._socket.write, Buffer.from([1, 1, 0x20, 8, 0x5f, 0, 0, 0, 0, 0, 0, 0]));
    });

    it('should setLeEventMask for BLE5 (extended)', () => {
      hci._isExtended = true;
      hci.setLeEventMask();
      assert.calledOnceWithExactly(hci._socket.write, Buffer.from([1, 1, 0x20, 8, 0x5f, 0xff, 0, 0, 0, 0, 0, 0]));
    });

    it('should enable the data length change subevent in both modes', () => {
      hci.setLeEventMask();
      should(hci._socket.write.firstCall.args[0].readUInt8(4) & 0x40).equal(0x40);

      hci._socket.write.resetHistory();
      hci._isExtended = true;
      hci.setLeEventMask();
      should(hci._socket.write.firstCall.args[0].readUInt8(4) & 0x40).equal(0x40);
    });
  });

  describe('data length extension', () => {
    const LE_READ_LOCAL_SUPPORTED_FEATURES = 0x2003;
    const LE_READ_MAX_DATA_LENGTH_CMD = 0x202f;
    const LE_SET_DATA_LENGTH_OPCODE = 0x2022;

    const writesOf = (opcode) => hci._socket.write.getCalls()
      .map((call) => call.args[0])
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
      hci._supportsDataLengthExtension = true;
      hci._maxDataLength = { txOctets, txTime };
    };

    it('treats the controller as unsupported until features are read', () => {
      should(hci._supportsDataLengthExtension).be.false();
      should(hci._maxDataLength).be.null();
    });

    it('reads the controller maximum when the feature bit is set', () => {
      // result[0] bit 5 is the LE Data Packet Length Extension feature bit
      hci.processCmdCompleteEvent(LE_READ_LOCAL_SUPPORTED_FEATURES, 0, Buffer.from([0x20, 0x00, 0x00, 0x00]));

      should(hci._supportsDataLengthExtension).be.true();
      should(writesOf(LE_READ_MAX_DATA_LENGTH_CMD)).have.length(1);
    });

    it('leaves an unsupported controller alone', () => {
      hci.processCmdCompleteEvent(LE_READ_LOCAL_SUPPORTED_FEATURES, 0, Buffer.from([0x00, 0x00, 0x00, 0x00]));

      should(hci._supportsDataLengthExtension).be.false();
      should(writesOf(LE_READ_MAX_DATA_LENGTH_CMD)).be.empty();
    });

    it('does not read the maximum when the feature read fails', () => {
      hci.processCmdCompleteEvent(LE_READ_LOCAL_SUPPORTED_FEATURES, 0x0c, Buffer.from([0x20, 0x00, 0x00, 0x00]));

      should(hci._supportsDataLengthExtension).be.false();
      should(writesOf(LE_READ_MAX_DATA_LENGTH_CMD)).be.empty();
    });

    it('forgets a stored maximum when a later feature read reports no support', () => {
      withNegotiatedMax();

      hci.processCmdCompleteEvent(LE_READ_LOCAL_SUPPORTED_FEATURES, 0, Buffer.from([0x00, 0x00, 0x00, 0x00]));

      should(hci._maxDataLength).be.null();
    });

    it('stores the reported maximum tx octets and time', () => {
      hci.processCmdCompleteEvent(LE_READ_MAX_DATA_LENGTH_CMD, 0, maxDataLengthResult(251, 2120));

      should(hci._maxDataLength).deepEqual({ txOctets: 251, txTime: 2120 });
    });

    it('clamps a reported maximum above the spec range', () => {
      hci.processCmdCompleteEvent(LE_READ_MAX_DATA_LENGTH_CMD, 0, maxDataLengthResult(0xffff, 0xffff));

      should(hci._maxDataLength).deepEqual({ txOctets: 251, txTime: 17040 });
    });

    it('rejects a reported maximum below the spec range', () => {
      hci.processCmdCompleteEvent(LE_READ_MAX_DATA_LENGTH_CMD, 0, maxDataLengthResult(26, 2120));
      should(hci._maxDataLength).be.null();

      hci.processCmdCompleteEvent(LE_READ_MAX_DATA_LENGTH_CMD, 0, maxDataLengthResult(251, 327));
      should(hci._maxDataLength).be.null();
    });

    it('ignores a failed maximum read', () => {
      hci.processCmdCompleteEvent(LE_READ_MAX_DATA_LENGTH_CMD, 0x0c, maxDataLengthResult(251, 2120));

      should(hci._maxDataLength).be.null();
    });

    it('ignores a short maximum read result', () => {
      hci.processCmdCompleteEvent(LE_READ_MAX_DATA_LENGTH_CMD, 0, Buffer.from([0xfb, 0x00, 0x48, 0x08]));

      should(hci._maxDataLength).be.null();
    });

    it('requests the data length once per connection', () => {
      withNegotiatedMax(251, 2120);

      hci.processLeConnComplete(0, connCompleteData(0x0040));

      const writes = writesOf(LE_SET_DATA_LENGTH_OPCODE);
      should(writes).have.length(1);
      should(writes[0]).deepEqual(Buffer.from([1, 0x22, 0x20, 6, 0x40, 0x00, 0xfb, 0x00, 0x48, 0x08]));
    });

    it('requests the data length for an enhanced connection', () => {
      withNegotiatedMax(251, 2120);

      hci.processLeEnhancedConnComplete(0, enhancedConnCompleteData(0x0041));

      const writes = writesOf(LE_SET_DATA_LENGTH_OPCODE);
      should(writes).have.length(1);
      should(writes[0].readUInt16LE(4)).equal(0x0041);
    });

    it('requests the data length again on reconnect', () => {
      withNegotiatedMax();

      hci.processLeConnComplete(0, connCompleteData(0x0040));
      hci.processLeConnComplete(0, connCompleteData(0x0041));

      should(writesOf(LE_SET_DATA_LENGTH_OPCODE)).have.length(2);
    });

    it('does not request the data length on an unsupported controller', () => {
      hci._maxDataLength = { txOctets: 251, txTime: 2120 };

      hci.processLeConnComplete(0, connCompleteData());

      should(writesOf(LE_SET_DATA_LENGTH_OPCODE)).be.empty();
    });

    it('does not request the data length before the maximum is known', () => {
      hci._supportsDataLengthExtension = true;

      hci.processLeConnComplete(0, connCompleteData());

      should(writesOf(LE_SET_DATA_LENGTH_OPCODE)).be.empty();
    });

    it('does not request the data length for a failed connection', () => {
      withNegotiatedMax();

      hci.processLeConnComplete(0x3e, connCompleteData());

      should(writesOf(LE_SET_DATA_LENGTH_OPCODE)).be.empty();
    });

    it('still completes the connection when the request cannot be written', () => {
      withNegotiatedMax();
      hci._socket.write.throws(new Error('ENOBUFS'));
      const callback = sinon.spy();
      hci.on('leConnComplete', callback);

      hci.processLeConnComplete(0, connCompleteData(0x0040));

      assert.calledOnce(callback);
      should(hci._aclConnections.has(0x0040)).be.true();
    });

    // Characterization: a rejected request is logged and otherwise ignored, so the stored
    // controller maximum stays usable for the next connection and no retry is attempted.
    it('keeps the stored maximum when the controller rejects the request', () => {
      withNegotiatedMax(251, 2120);

      hci.processCmdCompleteEvent(LE_SET_DATA_LENGTH_OPCODE, 0x11, Buffer.from([0x40, 0x00]));

      should(hci._maxDataLength).deepEqual({ txOctets: 251, txTime: 2120 });
      should(writesOf(LE_SET_DATA_LENGTH_OPCODE)).be.empty();
    });

    it('emits the negotiated length from the data length change event', () => {
      const callback = sinon.spy();
      hci.on('leDataLengthChange', callback);

      // subevent parameters: handle 0x0140, max tx octets/time, max rx octets/time
      hci.processLeMetaEvent(0x07, 0x40, Buffer.from([0x01, 0xfb, 0x00, 0x48, 0x08, 0xfb, 0x00, 0x48, 0x08]));

      assert.calledOnceWithExactly(callback, 0x0140, 251, 2120, 251, 2120);
    });

    it('ignores a short data length change event', () => {
      const callback = sinon.spy();
      hci.on('leDataLengthChange', callback);

      hci.processLeMetaEvent(0x07, 0x40, Buffer.from([0x01, 0xfb, 0x00, 0x48]));

      assert.notCalled(callback);
    });
  });

  it('should readLeBufferSize', () => {
    hci.readLeBufferSize();
    assert.calledOnceWithExactly(hci._socket.write, Buffer.from([1, 2, 0x20, 0]));
  });

  it('should readLeHostSupported', () => {
    hci.readLeHostSupported();
    assert.calledOnceWithExactly(hci._socket.write, Buffer.from([1, 0x6c, 0x0c, 0]));
  });

  it('should writeLeHostSupported', () => {
    hci.writeLeHostSupported();
    assert.calledOnceWithExactly(hci._socket.write, Buffer.from([1, 0x6d, 0x0c, 2, 1, 0]));
  });

  describe('setScanParameters', () => {
    it('should keep default parameters', () => {
      hci.setScanParameters();
      assert.calledOnceWithExactly(hci._socket.write, Buffer.from([1, 0x0b, 0x20, 7, 1, 0x12, 0, 0x12, 0, 0, 0]));
    });

    it('should keep default parameters (extended)', () => {
      hci._isExtended = true;
      hci.setScanParameters();
      assert.calledOnceWithExactly(hci._socket.write, Buffer.from([1, 0x41, 0x20, 0x0d, 0x00, 0x00, 0x05, 0x01, 0x12, 0x00, 0x12, 0x00, 0x01, 0x12, 0x00, 0x12, 0x00]));
    });

    it('should force parameters', () => {
      hci.setScanParameters(0x2222, 0x3333);
      assert.calledOnceWithExactly(hci._socket.write, Buffer.from([1, 0x0b, 0x20, 7, 1, 0x22, 0x022, 0x33, 0x33, 0, 0]));
    });

    it('should force parameters (extended)', () => {
      hci._isExtended = true;
      hci.setScanParameters(0x2222, 0x3333);
      assert.calledOnceWithExactly(hci._socket.write, Buffer.from([1, 0x41, 0x20, 0x0d, 0x00, 0x00, 0x05, 0x01, 0x22, 0x22, 0x33, 0x33, 0x01, 0x22, 0x22, 0x33, 0x33]));
    });
  });

  describe('setScanEnabled', () => {
    it('should keep default parameters', () => {
      hci.setScanEnabled();
      assert.calledOnceWithExactly(hci._socket.write, Buffer.from([1, 0x0c, 0x20, 2, 0, 0]));
    });

    it('should keep default parameters (extended)', () => {
      hci._isExtended = true;
      hci.setScanEnabled();
      assert.calledOnceWithExactly(hci._socket.write, Buffer.from([1, 0x42, 0x20, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
    });

    it('should force parameters', () => {
      hci.setScanEnabled(true, true);
      assert.calledOnceWithExactly(hci._socket.write, Buffer.from([1, 0x0c, 0x20, 2, 1, 1]));
    });

    it('should force parameters (extended)', () => {
      hci._isExtended = true;
      hci.setScanEnabled(true, true);
      assert.calledOnceWithExactly(hci._socket.write, Buffer.from([1, 0x42, 0x20, 0x06, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00]));
    });
  });

  describe('createLeConn', () => {
    it('should emit reset event and call createLeConnAfterReset', () => {
      const address = 'aa:bb:cc:dd:ee:ff';
      const addressType = 'random';
      const parameters = { minInterval: 0x0060, maxInterval: 0x00c0 };
      const attemptToken = {};
      
      hci.createLeConnAfterReset = jest.fn();      
      hci.createLeConn(address, addressType, parameters, true, attemptToken);
      hci.emit('reset');

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
      assert.calledOnceWithExactly(hci._socket.write, Buffer.from([0x01, 0x0d, 0x20, 0x19, 0x60, 0x00, 0x30, 0x00, 0x00, 0x01, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 0x00, 0x00, 0x06, 0x00, 0x12, 0x00, 0x00, 0x00, 0x2a, 0x00, 0x04, 0x00, 0x06, 0x00]));
    });

    it('should keep default parameters (extended)', () => {
      const address = 'aa:bb:cc:dd:ee';
      const addressType = 'random';
      hci._isExtended = true;
      hci.createLeConnAfterReset(address, addressType);
      assert.calledOnceWithExactly(hci._socket.write, Buffer.from([0x01, 0x43, 0x20, 0x2a, 0x00, 0x00, 0x01, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 0x00, 0x05, 0x60, 0x00, 0x60, 0x00, 0x06, 0x00, 0x12, 0x00, 0x00, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x60, 0x00, 0x60, 0x00, 0x06, 0x00, 0x12, 0x00, 0x00, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x00, 0x00]));
    });

    it('should override default parameters', () => {
      const address = 'ee:dd:cc:bb:aa';
      const addressType = 'not_random';
      const parameters = { minInterval: 0x0060, maxInterval: 0x00c0, latency: 0x0010, timeout: 0x0c80 };
      hci.createLeConnAfterReset(address, addressType, parameters);
      assert.calledOnceWithExactly(hci._socket.write, Buffer.from([0x01, 0x0d, 0x20, 0x19, 0x60, 0x00, 0x30, 0x00, 0x00, 0x00, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0x00, 0x00, 0x60, 0x00, 0xc0, 0x00, 0x10, 0x00, 0x80, 0x0c, 0x04, 0x00, 0x06, 0x00]));
    });

    it('should override default parameters (extended)', () => {
      const address = 'ee:dd:cc:bb:aa';
      const addressType = 'not_random';
      const parameters = { minInterval: 0x0060, maxInterval: 0x00c0, latency: 0x0010, timeout: 0x0c80 };
      hci._isExtended = true;
      hci.createLeConnAfterReset(address, addressType, parameters);
      assert.calledOnceWithExactly(hci._socket.write, Buffer.from([0x01, 0x43, 0x20, 0x2a, 0x00, 0x00, 0x00, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0x00, 0x05, 0x60, 0x00, 0x60, 0x00, 0x60, 0x00, 0xc0, 0x00, 0x10, 0x00, 0x80, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x60, 0x00, 0x60, 0x00, 0x60, 0x00, 0xc0, 0x00, 0x10, 0x00, 0x80, 0x0c, 0x00, 0x00, 0x00, 0x00]));
    });
  });

  it('should write connUpdateLe', () => {
    const handle = 0x1234;
    const minInterval = 5;
    const maxInterval = 15;
    const latency = 12;
    const supervisionTimeout = 25;
    hci.connUpdateLe(handle, minInterval, maxInterval, latency, supervisionTimeout);
    assert.calledOnceWithExactly(hci._socket.write, Buffer.from([0x01, 0x13, 0x20, 0x0e, 0x34, 0x12, 0x04, 0x00, 0x0c, 0x00, 0x0c, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00]));
  });

  it('should write cancelConnect', () => {
    hci.cancelConnect();
    assert.calledOnceWithExactly(hci._socket.write, Buffer.from([0x01, 0x0e, 0x20, 0x00]));
  });

  it('should write startLeEncryption', () => {
    const handle = 0x1234;
    const random = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const diversifier = Buffer.from([11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 23, 24, 25]);
    const key = Buffer.from([31, 32, 33, 34, 35, 36, 37, 38, 39, 30, 31, 32, 33, 33, 34, 35]);
    hci.startLeEncryption(handle, random, diversifier, key);
    assert.calledOnceWithExactly(hci._socket.write, Buffer.from([0x01, 0x19, 0x20, 0x1c, 0x34, 0x12, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0b, 0x0c, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x1e, 0x1f, 0x20, 0x21, 0x21, 0x22, 0x23]));
  });

  describe('disconnect', () => {
    it('should write disconnect with defaults', () => {
      const handle = 0x1234;
      const reason = undefined;
      hci.disconnect(handle, reason);
      assert.calledOnceWithExactly(hci._socket.write, Buffer.from([0x01, 0x06, 0x04, 0x03, 0x34, 0x12, 0x13]));
    });

    it('should write disconnect with reason', () => {
      const handle = 0x1234;
      const reason = 17;
      hci.disconnect(handle, reason);
      assert.calledOnceWithExactly(hci._socket.write, Buffer.from([0x01, 0x06, 0x04, 0x03, 0x34, 0x12, 0x11]));
    });
  });

  it('should write readRssi', () => {
    const handle = 0x1234;
    hci.readRssi(handle);
    assert.calledOnceWithExactly(hci._socket.write, Buffer.from([0x01, 0x05, 0x14, 0x02, 0x34, 0x12]));
  });

  it('should writeAclDataPkt - push in aclQueue and flushAcl', async () => {
    hci.flushAcl = sinon.spy();
    hci._aclBuffers = [1, 2, 3, 4, 5, 6, 7, 8];

    const handle = 0x1234;
    const cid = 345;
    const data = Buffer.from([5, 6, 7, 8, 9, 10, 11]);
    await hci.writeAclDataPkt(handle, cid, data);

    assert.calledOnceWithExactly(hci.flushAcl);

    should(hci._aclQueue).deepEqual([
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

    hci._socket.stop = sinon.spy();
    hci._aclConnections.set(handle, { pending: 0 });
    jest.spyOn(hci, 'flushAcl');

    const writePromise = hci.writeAclDataPkt(handle, cid, data);

    hci.stop();
    hci.setAclBuffers(20, 4);

    await writePromise;

    await expect(hci.flushAcl.mock.results[0].value).resolves.toBeUndefined();
    should(hci._aclConnections.size).equal(0);
  });

  it('should resolve getAclBuffers after LE_READ_BUFFER_SIZE_CMD command complete', async () => {
    const aclBuffersPromise = hci.getAclBuffers();

    hci.processCmdCompleteEvent(8194, 0, Buffer.from([0x10, 0x00, 5]));

    should(await aclBuffersPromise).deepEqual({ length: 0x10, num: 5 });
  });

  it('should resolve getAclBuffers when LE Read Buffer Size reports zero and BR/EDR succeeds', async () => {
    const LE_READ_BUFFER_SIZE_CMD = 8194;
    const READ_BUFFER_SIZE_CMD = 4101;
    const aclBuffersPromise = hci.getAclBuffers();

    hci.processCmdCompleteEvent(LE_READ_BUFFER_SIZE_CMD, 0, Buffer.from([0, 0, 0]));
    hci.processCmdCompleteEvent(READ_BUFFER_SIZE_CMD, 0, Buffer.from([0x40, 0x00, 3, 0x0a, 0x00]));

    should(await aclBuffersPromise).deepEqual({ length: 0x40, num: 10 });
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

    should(aclBuffers).deepEqual({ length: 27, num: 1 });

    const handle = 0x1234;
    hci._aclConnections.set(4660, { pending: 0 });

    const writePromise = hci.writeAclDataPkt(handle, 345, Buffer.from([1, 2, 3]));
    let writeTimer;
    const writeTimeout = new Promise((resolve) => {
      writeTimer = setTimeout(() => resolve(timedOut), 300);
    });
    const outcome = await Promise.race([writePromise.then(() => 'resolved'), writeTimeout]);
    clearTimeout(writeTimer);

    should(outcome).equal('resolved');
    should(hci._socket.write.args.some(([buf]) => buf[0] === 0x02 /* HCI_ACLDATA_PKT */)).be.true();
  });

  it('should write ACL data after init drives the LE buffer size chain in user channel mode (issue #109)', async () => {
    const buildCmdCompleteEvent = (cmd, status, result) => {
      const header = Buffer.from([0x04 /* HCI_EVENT_PKT */, 0x0e /* EVT_CMD_COMPLETE */, 3 + result.length, 1]);
      const cmdBuf = Buffer.alloc(2);
      cmdBuf.writeUInt16LE(cmd, 0);
      return Buffer.concat([header, cmdBuf, Buffer.from([status]), result]);
    };
    const wroteCmd = (cmd) => hci._socket.write.args.some(([buf]) => buf.readUInt16LE(1) === cmd);
    const RESET_CMD = 3075;
    const LE_READ_LOCAL_SUPPORTED_FEATURES = 8195;
    const LE_READ_BUFFER_SIZE_CMD = 8194;

    hci._userChannel = true;
    hci.init();

    should(wroteCmd(LE_READ_LOCAL_SUPPORTED_FEATURES)).be.false();
    hci.onSocketData(buildCmdCompleteEvent(RESET_CMD, 0, Buffer.alloc(0)));

    should(wroteCmd(LE_READ_LOCAL_SUPPORTED_FEATURES)).be.true();
    hci.onSocketData(buildCmdCompleteEvent(LE_READ_LOCAL_SUPPORTED_FEATURES, 0, Buffer.alloc(8)));

    should(wroteCmd(LE_READ_BUFFER_SIZE_CMD)).be.true();
    hci.onSocketData(buildCmdCompleteEvent(LE_READ_BUFFER_SIZE_CMD, 0, Buffer.from([0x10, 0x00, 5])));

    const handle = 0x1234;
    hci._aclConnections.set(handle, { pending: 0 });

    const writePromise = hci.writeAclDataPkt(handle, 345, Buffer.from([5, 6, 7]));
    const timedOut = Symbol('timedOut');
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(timedOut), 300);
    });
    const outcome = await Promise.race([writePromise.then(() => 'resolved'), timeout]);
    clearTimeout(timer);

    should(outcome).equal('resolved');
    should(hci._socket.write.args.some(([buf]) => buf[0] === 0x02 /* HCI_ACLDATA_PKT */)).be.true();
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
      hci._aclQueue = [...queue];

      hci.flushAcl();

      assert.notCalled(hci._socket.write);
      should(hci._aclQueue).deepEqual(queue);
    });

    it('should not write flush on empty queue', () => {
      hci._aclQueue = [];
      hci._aclConnections.set(4660, { pending: 3 });
      hci._aclConnections.set(4661, { pending: 2 });
      hci._aclBuffers = { num: 12 };

      hci.flushAcl();

      assert.notCalled(hci._socket.write);

      should(hci._aclQueue).be.empty();
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
      hci._aclQueue = [...queue];
      hci._aclConnections.set(4660, { pending: 3 });
      hci._aclConnections.set(4661, { pending: 2 });
      hci._aclBuffers = { num: 1 };

      hci.flushAcl();

      assert.notCalled(hci._socket.write);
      should(hci._aclQueue).deepEqual(queue);
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
      hci._aclQueue = [...queue];
      hci._aclConnections.set(4660, { pending: 3 });
      hci._aclConnections.set(4661, { pending: 2 });
      hci._aclBuffers = { num: 12 };

      await hci.flushAcl();

      assert.callCount(hci._socket.write, 3);
      assert.calledWithExactly(hci._socket.write, Buffer.from([0x02, 0x34, 0x12, 0x08, 0x00, 0x07, 0x00, 0x59, 0x01, 0x05, 0x06, 0x07, 0x08]));
      assert.calledWithExactly(hci._socket.write, Buffer.from([0x02, 0x34, 0x12, 0x03, 0x00, 0x09, 0x0a, 0x0b]));
      assert.calledWithExactly(hci._socket.write, Buffer.from([0x02]));

      should(hci._aclQueue).be.empty();
      should(hci._aclConnections.get(4660).pending).equal(5);
      should(hci._aclConnections.get(4661).pending).equal(3);
    });

    it('should skip a queued packet whose connection is gone, without throwing, and keep flushing the rest', async () => {
      const queue = [
        { handle: 4660, packet: Buffer.from([0x02, 0xaa]) },
        { handle: 4661, packet: Buffer.from([0x02, 0xbb]) }
      ];
      hci._aclQueue = [...queue];
      hci._aclConnections.set(4661, { pending: 0 });
      hci._aclBuffers = { num: 12 };

      await hci.flushAcl();

      assert.calledOnceWithExactly(hci._socket.write, Buffer.from([0x02, 0xbb]));
      should(hci._aclQueue).be.empty();
      should(hci._aclConnections.get(4661).pending).equal(1);
    });

    it('should not throw when a disconnect completes for the handle while writeAclDataPkt is awaiting acl buffers', async () => {
      const handle = 0x1234;
      hci._aclConnections.set(4660, { pending: 0 });

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

      should(hci._aclConnections.has(4660)).be.false();
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
      hci._aclQueue = [...queue];
      hci._aclConnections.set(4660, { pending: 0 });
      hci._aclBuffers = { num: 12 };

      await hci.flushAcl();

      assert.calledOnceWithExactly(hci._socket.write, Buffer.from([0x02, 0x34, 0x12, 0x08, 0x00, 0x07, 0x00, 0x59, 0x01, 0x05, 0x06, 0x07, 0x08]));
      should(hci._aclQueue).be.empty();
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
      hci._aclQueue = [...aclQueue];
      hci._aclConnections = new Map();
      hci._aclConnections.set(4660, { pending: 3 });
      hci._aclConnections.set(4661, { pending: 2 });
      hci._handleBuffers = {};
  
      // Setup event listener callbacks as mocks
      disconnCompleteCallback = jest.fn();
      encryptChangeCallback = jest.fn();
      aclDataPktCallback = jest.fn();
      leScanEnableSetCmdCallback = jest.fn();
      
      // Register event handlers
      hci.on('disconnComplete', disconnCompleteCallback);
      hci.on('encryptChange', encryptChangeCallback);
      hci.on('aclDataPkt', aclDataPktCallback);
      hci.on('leScanEnableSetCmd', leScanEnableSetCmdCallback);
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
      expect(hci._aclQueue).toEqual([
        {
          handle: 4661,
          packet: Buffer.from([0x02])
        }
      ]);
      expect(Array.from(hci._aclConnections.keys())).toEqual([4661]);
      expect(hci._aclConnections.get(4661)).toEqual({ pending: 2 });
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
      expect(hci._aclQueue).toEqual(aclQueue);
      expect(Array.from(hci._aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
      expect(hci._aclConnections.get(4660)).toEqual({ pending: 3 });
      expect(hci._aclConnections.get(4661)).toEqual({ pending: 2 });
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
      expect(hci._aclQueue).toEqual(aclQueue);
      expect(Array.from(hci._aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
      expect(hci._aclConnections.get(4660)).toEqual({ pending: 3 });
      expect(hci._aclConnections.get(4661)).toEqual({ pending: 2 });
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
      expect(hci._aclQueue).toEqual(aclQueue);
      expect(Array.from(hci._aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
      expect(hci._aclConnections.get(4660)).toEqual({ pending: 3 });
      expect(hci._aclConnections.get(4661)).toEqual({ pending: 2 });
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
      expect(hci._aclQueue).toEqual(aclQueue);
      expect(Array.from(hci._aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
      expect(hci._aclConnections.get(4660)).toEqual({ pending: 3 });
      expect(hci._aclConnections.get(4661)).toEqual({ pending: 2 });
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
      expect(hci._aclQueue).toEqual(aclQueue);
      expect(Array.from(hci._aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
      expect(hci._aclConnections.get(4660)).toEqual({ pending: 0 });
      expect(hci._aclConnections.get(4661)).toEqual({ pending: 2 });
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
      expect(hci._aclQueue).toEqual(aclQueue);
      expect(Array.from(hci._aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
      expect(hci._aclConnections.get(4660)).toEqual({ pending: 3 });
      expect(hci._aclConnections.get(4661)).toEqual({ pending: 2 });
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
      expect(hci._aclQueue).toEqual(aclQueue);
      expect(Array.from(hci._aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
      expect(hci._aclConnections.get(4660)).toEqual({ pending: 3 });
      expect(hci._aclConnections.get(4661)).toEqual({ pending: 2 });
      expect(hci._handleBuffers).toEqual({});
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
      expect(hci._aclQueue).toEqual(aclQueue);
      expect(Array.from(hci._aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
      expect(hci._aclConnections.get(4660)).toEqual({ pending: 3 });
      expect(hci._aclConnections.get(4661)).toEqual({ pending: 2 });
      
      // Check buffer was created properly
      expect(hci._handleBuffers[1266]).toEqual({
        length: 3,
        cid: 2307,
        data: expect.any(Buffer)
      });
      expect(Buffer.from(hci._handleBuffers[1266].data)).toEqual(Buffer.from([9, 8]));
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
      expect(hci._aclQueue).toEqual(aclQueue);
      expect(Array.from(hci._aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
      expect(hci._aclConnections.get(4660)).toEqual({ pending: 3 });
      expect(hci._aclConnections.get(4661)).toEqual({ pending: 2 });
      expect(hci._handleBuffers).toEqual({});
    });
  
    test('should concat data - HCI_ACLDATA_PKT / ACL_CONT with existing buffer', () => {
      const eventType = 2;
      const subEventTypeP1 = 0xf2;
      const subEventTypeP2 = 0x14;
      const data = Buffer.from([eventType, subEventTypeP1, subEventTypeP2, 0x34, 0x12, 0x03, 0x00, 3, 9, 9, 8]);
  
      // Setup pre-existing buffer
      hci._handleBuffers = {
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
      expect(hci._aclQueue).toEqual(aclQueue);
      expect(Array.from(hci._aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
      expect(hci._aclConnections.get(4660)).toEqual({ pending: 3 });
      expect(hci._aclConnections.get(4661)).toEqual({ pending: 2 });
      
      // Check buffer was updated properly
      expect(hci._handleBuffers).toEqual({
        1266: {
          length: 3,
          cid: 2307,
          data: expect.any(Buffer)
        }
      });
      
      // Check buffer contents
      const bufferData = hci._handleBuffers[1266].data;
      expect(Buffer.from(bufferData)).toEqual(Buffer.from([3, 4, 3, 0, 3, 9, 9, 8]));
    });
  
    test('should concat data and emit aclDataPkt - HCI_ACLDATA_PKT / ACL_CONT when complete', () => {
      const eventType = 2;
      const subEventTypeP1 = 0xf2;
      const subEventTypeP2 = 0x14;
      const data = Buffer.from([eventType, subEventTypeP1, subEventTypeP2, 0x34, 0x12, 0x03, 0x00, 3, 9, 9, 8]);
  
      // Setup pre-existing buffer with enough expected length to trigger completion
      hci._handleBuffers = {
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
      expect(hci._aclQueue).toEqual(aclQueue);
      expect(Array.from(hci._aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
      expect(hci._aclConnections.get(4660)).toEqual({ pending: 3 });
      expect(hci._aclConnections.get(4661)).toEqual({ pending: 2 });
      
      // Buffer should be emptied after processing
      expect(hci._handleBuffers).toEqual({});
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
      expect(hci._aclQueue).toEqual(aclQueue);
      expect(Array.from(hci._aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
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
      expect(hci._aclQueue).toEqual(aclQueue);
      expect(Array.from(hci._aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
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
      expect(hci._aclQueue).toEqual(aclQueue);
      expect(Array.from(hci._aclConnections.keys())).toEqual(expect.arrayContaining([4660, 4661]));
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
      hci._isExtended = false;
    });
    
    afterEach(() => {
      jest.clearAllMocks();
    });
    
    test('should still complete the init chain on error status, but skip leFeatures and isExtended', () => {
      const cmd = 8195;
      const status = 1;
      const result = Buffer.from([0x00, 0x00, 0x00, 0x00]);
      const leFeaturesCallback = jest.fn();
      hci.on('leFeatures', leFeaturesCallback);

      hci.processCmdCompleteEvent(cmd, status, result);

      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
      expect(leFeaturesCallback).not.toHaveBeenCalled();
      expect(hci._isExtended).toBe(false);

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

      should(await aclBuffersPromise).deepEqual({ length: 0x10, num: 5 });
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
  
      expect(hci._isExtended).toBe(false);
    });

    test('should detect extended features without offering coded phy', () => {
      // result[1] bit 4 is the LE extended advertising feature bit
      hci.processCmdCompleteEvent(8195, 0, Buffer.from([0x00, 0x10, 0x00, 0x00]));

      expect(hci._isExtended).toBe(true);
      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
    });

    test('should not offer coded phy on a capable controller unless opted in', () => {
      // result[1] bit 3 is the LE Coded PHY feature bit
      hci.processCmdCompleteEvent(8195, 0, Buffer.from([0x00, 0x08, 0x00, 0x00]));

      expect(hci._supportsCodedPhy).toBe(true);
      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
    });

    test('should offer coded phy exactly once when opted in and supported', () => {
      hci._codedPhy = true;

      hci.processCmdCompleteEvent(8195, 0, Buffer.from([0x00, 0x08, 0x00, 0x00]));

      expect(hci._isExtended).toBe(false);
      expect(hci._supportsCodedPhy).toBe(true);
      expect(hci.setCodedPhySupport).toHaveBeenCalledTimes(1);
    });

    test('should not offer coded phy when opted in on an unsupported controller', () => {
      hci._codedPhy = true;

      hci.processCmdCompleteEvent(8195, 0, Buffer.from([0x00, 0x10, 0x00, 0x00]));

      expect(hci._supportsCodedPhy).toBe(false);
      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
    });

    test('should offer coded phy once at discovery and once per later reset', () => {
      hci._codedPhy = true;

      hci.processCmdCompleteEvent(8195, 0, Buffer.from([0x00, 0x08, 0x00, 0x00]));
      expect(hci.setCodedPhySupport).toHaveBeenCalledTimes(1);

      hci.processCmdCompleteEvent(3075, 0, Buffer.from([]));
      expect(hci.setCodedPhySupport).toHaveBeenCalledTimes(2);
    });

    test('should not offer coded phy when the feature read fails', () => {
      hci._codedPhy = true;

      hci.processCmdCompleteEvent(8195, 0x0c, Buffer.from([0x00, 0x08, 0x00, 0x00]));

      expect(hci._supportsCodedPhy).toBe(false);
      expect(hci.setCodedPhySupport).not.toHaveBeenCalled();
    });
  });

  describe('onSocketError', () => {
    it('should emit stateChange', () => {
      const callback = sinon.spy();

      hci.on('stateChange', callback);
      hci.onSocketError({ code: 'EPERM', message: 'Network is down' });

      assert.calledOnceWithExactly(callback, 'unauthorized');
    });

    it('should do nothing with message', () => {
      const callback = sinon.spy();

      hci.on('stateChange', callback);
      hci.onSocketError({ message: 'Network is down' });

      assert.notCalled(callback);
    });

    it('should do nothing', () => {
      const callback = sinon.spy();

      hci.on('stateChange', callback);
      hci.onSocketError({ });

      assert.notCalled(callback);
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
      hci.setEventMask = sinon.spy();
      hci.setLeEventMask = sinon.spy();
      hci.readLocalVersion = sinon.spy();
      hci.readBdAddr = sinon.spy();
      hci.setScanEnabled = sinon.spy();
      hci.setScanParameters = sinon.spy();
      hci.readBufferSize = sinon.spy();
      hci.setCodedPhySupport = sinon.spy();

      hci._aclBuffers = { ...aclBuffers };

      rssiReadCallback = sinon.spy();
      leScanEnableSetCallback = sinon.spy();
      leScanParametersSetCallback = sinon.spy();
      stateChangeCallback = sinon.spy();
      addressChangeCallback = sinon.spy();
      readLocalVersionCallback = sinon.spy();

      hci.on('rssiRead', rssiReadCallback);
      hci.on('leScanEnableSet', leScanEnableSetCallback);
      hci.on('leScanParametersSet', leScanParametersSetCallback);
      hci.on('stateChange', stateChangeCallback);
      hci.on('addressChange', addressChangeCallback);
      hci.on('readLocalVersion', readLocalVersionCallback);
    });

    it.each([
      ['READ_LOCAL_VERSION_CMD', 4097],
      ['READ_SUPPORTED_COMMANDS_CMD', 4098],
      ['READ_BD_ADDR_CMD', 4105]
    ])('does not read absent return parameters after a failed %s', (_name, cmd) => {
      expect(() => hci.processCmdCompleteEvent(cmd, 0x0c, Buffer.alloc(0))).not.toThrow();

      assert.notCalled(stateChangeCallback);
      assert.notCalled(addressChangeCallback);
      assert.notCalled(readLocalVersionCallback);
    });

    it.each([
      ['READ_LOCAL_VERSION_CMD', 4097, 8],
      ['READ_SUPPORTED_COMMANDS_CMD', 4098, 38],
      ['READ_BD_ADDR_CMD', 4105, 6]
    ])('does not read a truncated successful %s reply', (_name, cmd, minimumLength) => {
      expect(() => hci.processCmdCompleteEvent(cmd, 0, Buffer.alloc(minimumLength - 1))).not.toThrow();

      assert.notCalled(stateChangeCallback);
      assert.notCalled(addressChangeCallback);
      assert.notCalled(readLocalVersionCallback);
    });

    it('should do nothing', () => {
      const cmd = 0;
      const status = 0;
      const result = Buffer.from([]);

      hci.processCmdCompleteEvent(cmd, status, result);

      // called

      // not called
      assert.notCalled(hci.setEventMask);
      assert.notCalled(hci.setLeEventMask);
      assert.notCalled(hci.readLocalVersion);
      assert.notCalled(hci.readBdAddr);
      assert.notCalled(hci.setScanEnabled);
      assert.notCalled(hci.setScanParameters);
      assert.notCalled(hci.readBufferSize);
      assert.notCalled(hci.setCodedPhySupport);
      assert.notCalled(rssiReadCallback);
      assert.notCalled(leScanEnableSetCallback);
      assert.notCalled(leScanParametersSetCallback);
      assert.notCalled(stateChangeCallback);
      assert.notCalled(addressChangeCallback);
      assert.notCalled(readLocalVersionCallback);

      // hci checks
      should(hci._aclBuffers).deepEqual(aclBuffers);
      should(hci._isExtended).equal(false);
    });

    it('should reset', () => {
      const cmd = 3075;
      const status = 0;
      const result = Buffer.from([]);

      hci.processCmdCompleteEvent(cmd, status, result);

      // called
      assert.calledOnceWithExactly(hci.setEventMask);
      assert.calledOnceWithExactly(hci.setLeEventMask);
      assert.calledOnceWithExactly(hci.readLocalVersion);
      assert.calledOnceWithExactly(hci.readBdAddr);

      // not called
      assert.notCalled(hci.setScanEnabled);
      assert.notCalled(hci.setScanParameters);
      assert.notCalled(hci.readBufferSize);
      assert.notCalled(hci.setCodedPhySupport);
      assert.notCalled(rssiReadCallback);
      assert.notCalled(leScanEnableSetCallback);
      assert.notCalled(leScanParametersSetCallback);
      assert.notCalled(stateChangeCallback);
      assert.notCalled(addressChangeCallback);
      assert.notCalled(readLocalVersionCallback);

      // hci checks
      should(hci._aclBuffers).deepEqual(aclBuffers);
      should(hci._isExtended).equal(false);
    });

    it('should reset (extended) without offering coded phy', () => {
      const cmd = 3075;
      const status = 0;
      const result = Buffer.from([]);

      hci._isExtended = true;
      hci.processCmdCompleteEvent(cmd, status, result);

      // called
      assert.calledOnceWithExactly(hci.setEventMask);
      assert.calledOnceWithExactly(hci.setLeEventMask);
      assert.calledOnceWithExactly(hci.readLocalVersion);
      assert.calledOnceWithExactly(hci.readBdAddr);
      assert.notCalled(hci.setCodedPhySupport);

      // not called
      assert.notCalled(hci.setScanEnabled);
      assert.notCalled(hci.setScanParameters);
      assert.notCalled(hci.readBufferSize);
      assert.notCalled(rssiReadCallback);
      assert.notCalled(leScanEnableSetCallback);
      assert.notCalled(leScanParametersSetCallback);
      assert.notCalled(stateChangeCallback);
      assert.notCalled(addressChangeCallback);
      assert.notCalled(readLocalVersionCallback);

      // hci checks
      should(hci._aclBuffers).deepEqual(aclBuffers);
      should(hci._isExtended).equal(true);
    });

    it('should reset without offering coded phy before support is known', () => {
      hci._codedPhy = true;

      hci.processCmdCompleteEvent(3075, 0, Buffer.from([]));

      assert.notCalled(hci.setCodedPhySupport);
      assert.calledOnceWithExactly(hci.setEventMask);
      assert.calledOnceWithExactly(hci.setLeEventMask);
    });

    it('should reapply coded phy on a later reset once support is known', () => {
      hci._codedPhy = true;
      hci._supportsCodedPhy = true;
      hci._isExtended = false;

      hci.processCmdCompleteEvent(3075, 0, Buffer.from([]));

      assert.calledOnceWithExactly(hci.setCodedPhySupport);
      assert.calledOnceWithExactly(hci.setEventMask);
      assert.calledOnceWithExactly(hci.setLeEventMask);
    });

    it('should not reapply coded phy on a later reset when not opted in', () => {
      hci._supportsCodedPhy = true;

      hci.processCmdCompleteEvent(3075, 0, Buffer.from([]));

      assert.notCalled(hci.setCodedPhySupport);
    });

    it('should only log debug - READ_LE_HOST_SUPPORTED_CMD', () => {
      const cmd = 3180;
      const status = 0;
      const result = Buffer.from([0, 1]);

      hci.processCmdCompleteEvent(cmd, status, result);

      // called

      // not called
      assert.notCalled(hci.setEventMask);
      assert.notCalled(hci.setLeEventMask);
      assert.notCalled(hci.readLocalVersion);
      assert.notCalled(hci.readBdAddr);
      assert.notCalled(hci.setScanEnabled);
      assert.notCalled(hci.setScanParameters);
      assert.notCalled(hci.readBufferSize);
      assert.notCalled(hci.setCodedPhySupport);
      assert.notCalled(rssiReadCallback);
      assert.notCalled(leScanEnableSetCallback);
      assert.notCalled(leScanParametersSetCallback);
      assert.notCalled(stateChangeCallback);
      assert.notCalled(addressChangeCallback);
      assert.notCalled(readLocalVersionCallback);

      // hci checks
      should(hci._aclBuffers).deepEqual(aclBuffers);
      should(hci._isExtended).equal(false);
    });

    it('should do nothing - READ_LE_HOST_SUPPORTED_CMD', () => {
      const cmd = 3180;
      const status = 1;
      const result = Buffer.from([]);

      hci.processCmdCompleteEvent(cmd, status, result);

      // called

      // not called
      assert.notCalled(hci.setEventMask);
      assert.notCalled(hci.setLeEventMask);
      assert.notCalled(hci.readLocalVersion);
      assert.notCalled(hci.readBdAddr);
      assert.notCalled(hci.setScanEnabled);
      assert.notCalled(hci.setScanParameters);
      assert.notCalled(hci.readBufferSize);
      assert.notCalled(hci.setCodedPhySupport);
      assert.notCalled(rssiReadCallback);
      assert.notCalled(leScanEnableSetCallback);
      assert.notCalled(leScanParametersSetCallback);
      assert.notCalled(stateChangeCallback);
      assert.notCalled(addressChangeCallback);
      assert.notCalled(readLocalVersionCallback);

      // hci checks
      should(hci._aclBuffers).deepEqual(aclBuffers);
      should(hci._isExtended).equal(false);
    });

    it('should emit stateChange - READ_LOCAL_VERSION_CMD', () => {
      const cmd = 4097;
      const status = 0;
      const result = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]);

      hci.processCmdCompleteEvent(cmd, status, result);

      // called
      assert.calledOnceWithExactly(stateChangeCallback, 'unsupported');
      assert.calledOnceWithExactly(readLocalVersionCallback, 0, 513, 3, 1284, 1798);

      // not called
      assert.notCalled(hci.setEventMask);
      assert.notCalled(hci.setLeEventMask);
      assert.notCalled(hci.readLocalVersion);
      assert.notCalled(hci.readBdAddr);
      assert.notCalled(hci.setScanEnabled);
      assert.notCalled(hci.setScanParameters);
      assert.notCalled(hci.readBufferSize);
      assert.notCalled(hci.setCodedPhySupport);
      assert.notCalled(rssiReadCallback);
      assert.notCalled(leScanEnableSetCallback);
      assert.notCalled(leScanParametersSetCallback);
      assert.notCalled(addressChangeCallback);

      // hci checks
      should(hci._aclBuffers).deepEqual(aclBuffers);
      should(hci._isExtended).equal(false);
    });

    it('should not emit stateChange - READ_LOCAL_VERSION_CMD', () => {
      const cmd = 4097;
      const status = 0;
      const result = Buffer.from([9, 1, 2, 3, 4, 5, 6, 7]);

      hci.processCmdCompleteEvent(cmd, status, result);

      // called
      assert.calledOnceWithExactly(readLocalVersionCallback, 9, 513, 3, 1284, 1798);
      assert.calledOnceWithExactly(hci.setScanEnabled, false, true);
      assert.calledOnceWithExactly(hci.setScanParameters);

      // not called
      assert.notCalled(hci.setEventMask);
      assert.notCalled(hci.setLeEventMask);
      assert.notCalled(hci.readLocalVersion);
      assert.notCalled(hci.readBdAddr);
      assert.notCalled(hci.readBufferSize);
      assert.notCalled(hci.setCodedPhySupport);
      assert.notCalled(rssiReadCallback);
      assert.notCalled(stateChangeCallback);
      assert.notCalled(leScanEnableSetCallback);
      assert.notCalled(leScanParametersSetCallback);
      assert.notCalled(addressChangeCallback);

      // hci checks
      should(hci._aclBuffers).deepEqual(aclBuffers);
      should(hci._isExtended).equal(false);
    });

    it('should not scan - READ_LOCAL_VERSION_CMD', () => {
      const cmd = 4097;
      const status = 0;
      const result = Buffer.from([9, 1, 2, 3, 4, 5, 6, 7]);

      hci._state = 'poweredOn';
      hci.processCmdCompleteEvent(cmd, status, result);

      // called
      assert.calledOnceWithExactly(readLocalVersionCallback, 9, 513, 3, 1284, 1798);

      // not called
      assert.notCalled(hci.setEventMask);
      assert.notCalled(hci.setLeEventMask);
      assert.notCalled(hci.readLocalVersion);
      assert.notCalled(hci.readBdAddr);
      assert.notCalled(hci.setScanEnabled);
      assert.notCalled(hci.setScanParameters);
      assert.notCalled(hci.readBufferSize);
      assert.notCalled(hci.setCodedPhySupport);
      assert.notCalled(rssiReadCallback);
      assert.notCalled(stateChangeCallback);
      assert.notCalled(leScanEnableSetCallback);
      assert.notCalled(leScanParametersSetCallback);
      assert.notCalled(addressChangeCallback);

      // hci checks
      should(hci._aclBuffers).deepEqual(aclBuffers);
      should(hci._isExtended).equal(false);
    });

    it('should report extended commands without changing mode - READ_SUPPORTED_COMMANDS_CMD', () => {
      const cmd = 4098;
      const status = 0;
      const result = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 28, 30, 31, 32, 33, 34, 35, 35, 36, 0xff]);

      hci._state = 'poweredOn';
      hci.processCmdCompleteEvent(cmd, status, result);

      // called

      // not called
      assert.notCalled(readLocalVersionCallback);
      assert.notCalled(hci.setEventMask);
      assert.notCalled(hci.setLeEventMask);
      assert.notCalled(hci.readLocalVersion);
      assert.notCalled(hci.readBdAddr);
      assert.notCalled(hci.setScanEnabled);
      assert.notCalled(hci.setScanParameters);
      assert.notCalled(hci.readBufferSize);
      assert.notCalled(hci.setCodedPhySupport);
      assert.notCalled(rssiReadCallback);
      assert.notCalled(stateChangeCallback);
      assert.notCalled(leScanEnableSetCallback);
      assert.notCalled(leScanParametersSetCallback);
      assert.notCalled(addressChangeCallback);

      // hci checks
      should(hci._aclBuffers).deepEqual(aclBuffers);
      should(hci._isExtended).equal(false);
    });

    it('should emit addressChange - READ_BD_ADDR_CMD', () => {
      const cmd = 4105;
      const status = 0;
      const result = Buffer.from([9, 1, 2, 3, 4, 5, 6, 7]);

      hci.addressType = 'addressType';
      hci.address = 'address';
      hci.processCmdCompleteEvent(cmd, status, result);

      // called
      assert.calledOnceWithExactly(addressChangeCallback, '07:06:05:04:03:02:01:09');

      // not called
      assert.notCalled(hci.setEventMask);
      assert.notCalled(hci.setLeEventMask);
      assert.notCalled(hci.readLocalVersion);
      assert.notCalled(hci.readBdAddr);
      assert.notCalled(hci.setScanEnabled);
      assert.notCalled(hci.setScanParameters);
      assert.notCalled(hci.readBufferSize);
      assert.notCalled(hci.setCodedPhySupport);
      assert.notCalled(rssiReadCallback);
      assert.notCalled(stateChangeCallback);
      assert.notCalled(leScanEnableSetCallback);
      assert.notCalled(leScanParametersSetCallback);
      assert.notCalled(readLocalVersionCallback);

      // hci checks
      should(hci._aclBuffers).deepEqual(aclBuffers);
      should(hci._isExtended).equal(false);
      should(hci.addressType).equal('public');
      should(hci.address).equal('07:06:05:04:03:02:01:09');
    });

    [8203, 8257].forEach((cmd) => {
      it(`should emit stateChange - LE_SET_SCAN_PARAMETERS_CMD - ${cmd}`, () => {
        const status = 0;
        const result = Buffer.from([9, 1, 2, 3, 4, 5, 6, 7]);

        hci.processCmdCompleteEvent(cmd, status, result);

        // called
        assert.calledOnceWithExactly(stateChangeCallback, 'poweredOn');
        assert.calledOnceWithExactly(leScanParametersSetCallback);

        // not called
        assert.notCalled(addressChangeCallback);
        assert.notCalled(hci.setEventMask);
        assert.notCalled(hci.setLeEventMask);
        assert.notCalled(hci.readLocalVersion);
        assert.notCalled(hci.readBdAddr);
        assert.notCalled(hci.setScanEnabled);
        assert.notCalled(hci.setScanParameters);
        assert.notCalled(hci.readBufferSize);
        assert.notCalled(hci.setCodedPhySupport);
        assert.notCalled(rssiReadCallback);
        assert.notCalled(leScanEnableSetCallback);
        assert.notCalled(readLocalVersionCallback);

        // hci checks
        should(hci._aclBuffers).deepEqual(aclBuffers);
        should(hci._isExtended).equal(false);
      });
    });

    [8204, 8258].forEach((cmd) => {
      it(`should emit leScanEnableSet - LE_SET_SCAN_ENABLE_CMD - ${cmd}`, () => {
        const status = 4;
        const result = Buffer.from([9, 1, 2, 3, 4, 5, 6, 7]);

        hci.processCmdCompleteEvent(cmd, status, result);

        // called
        assert.calledOnceWithExactly(leScanEnableSetCallback, status);

        // not called
        assert.notCalled(addressChangeCallback);
        assert.notCalled(hci.setEventMask);
        assert.notCalled(hci.setLeEventMask);
        assert.notCalled(hci.readLocalVersion);
        assert.notCalled(hci.readBdAddr);
        assert.notCalled(hci.setScanEnabled);
        assert.notCalled(hci.setScanParameters);
        assert.notCalled(hci.readBufferSize);
        assert.notCalled(hci.setCodedPhySupport);
        assert.notCalled(rssiReadCallback);
        assert.notCalled(stateChangeCallback);
        assert.notCalled(leScanParametersSetCallback);
        assert.notCalled(readLocalVersionCallback);

        // hci checks
        should(hci._aclBuffers).deepEqual(aclBuffers);
        should(hci._isExtended).equal(false);
      });
    });

    it('should emit rssiRead - READ_RSSI_CMD', () => {
      const cmd = 5125;
      const status = 4;
      const result = Buffer.from([9, 1, 2, 3, 4, 5, 6, 7]);

      hci.processCmdCompleteEvent(cmd, status, result);

      // called
      assert.calledOnceWithExactly(rssiReadCallback, 265, 2);

      // not called
      assert.notCalled(addressChangeCallback);
      assert.notCalled(hci.setEventMask);
      assert.notCalled(hci.setLeEventMask);
      assert.notCalled(hci.readLocalVersion);
      assert.notCalled(hci.readBdAddr);
      assert.notCalled(hci.setScanEnabled);
      assert.notCalled(hci.setScanParameters);
      assert.notCalled(hci.readBufferSize);
      assert.notCalled(hci.setCodedPhySupport);
      assert.notCalled(leScanEnableSetCallback);
      assert.notCalled(stateChangeCallback);
      assert.notCalled(leScanParametersSetCallback);
      assert.notCalled(readLocalVersionCallback);

      // hci checks
      should(hci._aclBuffers).deepEqual(aclBuffers);
      should(hci._isExtended).equal(false);
    });

    it('should read buffer size - LE_READ_BUFFER_SIZE_CMD', () => {
      const cmd = 8194;
      const status = 0;
      const result = Buffer.from([0, 0, 0]);

      hci.processCmdCompleteEvent(cmd, status, result);

      // called
      assert.calledOnceWithExactly(hci.readBufferSize);

      // not called
      assert.notCalled(rssiReadCallback);
      assert.notCalled(addressChangeCallback);
      assert.notCalled(hci.setEventMask);
      assert.notCalled(hci.setLeEventMask);
      assert.notCalled(hci.readLocalVersion);
      assert.notCalled(hci.readBdAddr);
      assert.notCalled(hci.setScanEnabled);
      assert.notCalled(hci.setScanParameters);
      assert.notCalled(hci.setCodedPhySupport);
      assert.notCalled(leScanEnableSetCallback);
      assert.notCalled(stateChangeCallback);
      assert.notCalled(leScanParametersSetCallback);
      assert.notCalled(readLocalVersionCallback);

      // hci checks
      should(hci._aclBuffers).deepEqual(aclBuffers);
      should(hci._isExtended).equal(false);
    });

    it('should change buffers - LE_READ_BUFFER_SIZE_CMD', () => {
      const cmd = 8194;
      const status = 0;
      const result = Buffer.from([1, 0, 2]);

      hci.processCmdCompleteEvent(cmd, status, result);

      // called

      // not called
      assert.notCalled(hci.readBufferSize);
      assert.notCalled(rssiReadCallback);
      assert.notCalled(addressChangeCallback);
      assert.notCalled(hci.setEventMask);
      assert.notCalled(hci.setLeEventMask);
      assert.notCalled(hci.readLocalVersion);
      assert.notCalled(hci.readBdAddr);
      assert.notCalled(hci.setScanEnabled);
      assert.notCalled(hci.setScanParameters);
      assert.notCalled(hci.setCodedPhySupport);
      assert.notCalled(leScanEnableSetCallback);
      assert.notCalled(stateChangeCallback);
      assert.notCalled(leScanParametersSetCallback);
      assert.notCalled(readLocalVersionCallback);

      // hci checks
      should(hci._aclBuffers).deepEqual({
        length: 1,
        num: 2
      });
      should(hci._isExtended).equal(false);
    });

    it('should do nothing - READ_BUFFER_SIZE_CMD', () => {
      const cmd = 4101;
      const status = 0;
      const result = Buffer.from([1, 0, 3, 2, 0]);

      hci.processCmdCompleteEvent(cmd, status, result);

      // called

      // not called
      assert.notCalled(hci.readBufferSize);
      assert.notCalled(rssiReadCallback);
      assert.notCalled(addressChangeCallback);
      assert.notCalled(hci.setEventMask);
      assert.notCalled(hci.setLeEventMask);
      assert.notCalled(hci.readLocalVersion);
      assert.notCalled(hci.readBdAddr);
      assert.notCalled(hci.setScanEnabled);
      assert.notCalled(hci.setScanParameters);
      assert.notCalled(hci.setCodedPhySupport);
      assert.notCalled(leScanEnableSetCallback);
      assert.notCalled(stateChangeCallback);
      assert.notCalled(leScanParametersSetCallback);
      assert.notCalled(readLocalVersionCallback);

      // hci checks
      should(hci._aclBuffers).deepEqual({
        length: 1,
        num: 2
      });
      should(hci._isExtended).equal(false);
    });

    it('should not throw and delegate to READ_BUFFER_SIZE - LE_READ_BUFFER_SIZE_CMD with error status', () => {
      const cmd = 8194;
      const status = 0x0c;
      const result = Buffer.from([]);

      should(() => hci.processCmdCompleteEvent(cmd, status, result)).not.throw();

      assert.calledOnceWithExactly(hci.readBufferSize);
      should(hci._aclBuffers).deepEqual(aclBuffers);
    });

    it('should not throw and fall back to the LE minimum - READ_BUFFER_SIZE_CMD with error status', () => {
      const cmd = 4101;
      const status = 0x0c;
      const result = Buffer.from([]);

      should(() => hci.processCmdCompleteEvent(cmd, status, result)).not.throw();

      should(hci._aclBuffers).deepEqual({ length: 27, num: 1 });
    });

    it('should fall back to the LE minimum - READ_BUFFER_SIZE_CMD with zero acl length', () => {
      const cmd = 4101;
      const status = 0;
      const result = Buffer.from([0, 0, 3, 2, 0]);

      hci.processCmdCompleteEvent(cmd, status, result);

      should(hci._aclBuffers).deepEqual({ length: 27, num: 1 });
    });

    it('should fall back to the LE minimum - READ_BUFFER_SIZE_CMD with zero acl num', () => {
      const cmd = 4101;
      const status = 0;
      const result = Buffer.from([1, 0, 0, 0, 0]);

      hci.processCmdCompleteEvent(cmd, status, result);

      should(hci._aclBuffers).deepEqual({ length: 27, num: 1 });
    });

    it('should do nothing - ??', () => {
      const cmd = 1;
      const status = 0;
      const result = Buffer.from([1, 0, 3, 2, 0]);

      hci.processCmdCompleteEvent(cmd, status, result);

      // called

      // not called
      assert.notCalled(hci.readBufferSize);
      assert.notCalled(rssiReadCallback);
      assert.notCalled(addressChangeCallback);
      assert.notCalled(hci.setEventMask);
      assert.notCalled(hci.setLeEventMask);
      assert.notCalled(hci.readLocalVersion);
      assert.notCalled(hci.readBdAddr);
      assert.notCalled(hci.setScanEnabled);
      assert.notCalled(hci.setScanParameters);
      assert.notCalled(hci.setCodedPhySupport);
      assert.notCalled(leScanEnableSetCallback);
      assert.notCalled(stateChangeCallback);
      assert.notCalled(leScanParametersSetCallback);
      assert.notCalled(readLocalVersionCallback);

      // hci checks
      should(hci._aclBuffers).deepEqual(aclBuffers);
      should(hci._isExtended).equal(false);
    });
  });

  describe('processLeMetaEvent', () => {
    beforeEach(() => {
      hci.processLeConnComplete = sinon.spy();
      hci.processLeAdvertisingReport = sinon.spy();
      hci.processLeConnUpdateComplete = sinon.spy();
    });

    it('should do nothing', () => {
      const eventType = 0;
      const status = 'status';
      const data = 'data';

      hci.processLeMetaEvent(eventType, status, data);

      assert.notCalled(hci.processLeConnComplete);
      assert.notCalled(hci.processLeAdvertisingReport);
      assert.notCalled(hci.processLeConnUpdateComplete);
    });

    it('should processLeConnComplete', () => {
      const eventType = 1;
      const status = 'status';
      const data = 'data';

      hci.processLeMetaEvent(eventType, status, data);

      assert.calledOnceWithExactly(hci.processLeConnComplete, status, data);
      assert.notCalled(hci.processLeAdvertisingReport);
      assert.notCalled(hci.processLeConnUpdateComplete);
    });

    it('should processLeAdvertisingReport', () => {
      const eventType = 2;
      const status = 'status';
      const data = 'data';

      hci.processLeMetaEvent(eventType, status, data);

      assert.calledOnceWithExactly(hci.processLeAdvertisingReport, status, data);
      assert.notCalled(hci.processLeConnComplete);
      assert.notCalled(hci.processLeConnUpdateComplete);
    });

    it('should processLeConnUpdateComplete', () => {
      const eventType = 3;
      const status = 'status';
      const data = 'data';

      hci.processLeMetaEvent(eventType, status, data);

      assert.calledOnceWithExactly(hci.processLeConnUpdateComplete, status, data);
      assert.notCalled(hci.processLeConnComplete);
      assert.notCalled(hci.processLeAdvertisingReport);
    });
  });

  it('should emit leConnComplete', () => {
    const status = 0;
    const data = Buffer.from([0x34, 0x11, 4, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 2, 1, 4, 3, 7, 8, 9]);
    const callback = sinon.spy();

    hci.on('leConnComplete', callback);
    hci.processLeConnComplete(status, data);

    assert.calledOnceWithExactly(callback, status, 4404, 4, 'random', 'ff:ee:dd:cc:bb:aa', 322.5, 772, 20550, 9);
    should(hci._aclConnections).keys(4404);
    should(hci._aclConnections.get(4404)).deepEqual({ pending: 0 });
  });

  it('should emit leConnComplete but not record the connection on failed status', () => {
    const status = 1;
    const data = Buffer.from([0x34, 0x11, 4, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 2, 1, 4, 3, 7, 8, 9]);
    const callback = sinon.spy();

    hci.on('leConnComplete', callback);
    hci.processLeConnComplete(status, data);

    assert.calledOnceWithExactly(callback, status, 4404, 4, 'random', 'ff:ee:dd:cc:bb:aa', 322.5, 772, 20550, 9);
    should(hci._aclConnections.size).equal(0);
  });

  it('should emit leConnComplete on processLeEnhancedConnComplete', () => {
    const status = 0;
    const data = Buffer.from([0x34, 0x11, 4, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 2, 1, 4, 3, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
    const callback = sinon.spy();

    hci.on('leConnComplete', callback);
    hci.processLeEnhancedConnComplete(status, data);

    assert.calledOnceWithExactly(callback, status, 4404, 4, 'random', 'ff:ee:dd:cc:bb:aa', 5138.75, 4625, 51390, 21, '0e:0d:0c:0b:0a:09');
    should(hci._aclConnections).keys(4404);
    should(hci._aclConnections.get(4404)).deepEqual({ pending: 0 });
  });

  it('should not emit leConnComplete for an all-zero payload (garbage/truncated event guard)', () => {
    const status = 0;
    const data = Buffer.alloc(17);
    const callback = sinon.spy();

    hci.on('leConnComplete', callback);
    hci.processLeConnComplete(status, data);

    assert.notCalled(callback);
    should(hci._aclConnections.size).equal(0);
  });

  it('emits a non-zero-status all-zero connection completion with its attempt token', () => {
    const status = 0x02;
    const data = Buffer.alloc(17);
    const callback = sinon.spy();
    const attemptToken = {};
    hci._pendingLeConn = {
      address: '11:22:33:44:55:66',
      addressType: 'random',
      token: attemptToken
    };

    hci.on('leConnComplete', callback);
    hci.processLeConnComplete(status, data);

    assert.calledOnceWithExactly(
      callback,
      status,
      0,
      0,
      'public',
      '00:00:00:00:00:00',
      0,
      0,
      0,
      0,
      undefined,
      attemptToken
    );
    should(hci._pendingLeConn).equal(null);
  });

  it('should not emit leConnComplete on processLeEnhancedConnComplete for an all-zero payload (garbage/truncated event guard)', () => {
    const status = 0;
    const data = Buffer.alloc(29);
    const callback = sinon.spy();

    hci.on('leConnComplete', callback);
    hci.processLeEnhancedConnComplete(status, data);

    assert.notCalled(callback);
    should(hci._aclConnections.size).equal(0);
  });

  it('emits a non-zero-status all-zero enhanced completion with its attempt token', () => {
    const status = 0x02;
    const data = Buffer.alloc(29);
    const callback = sinon.spy();
    const attemptToken = {};
    hci._pendingLeConn = {
      address: '11:22:33:44:55:66',
      addressType: 'random',
      token: attemptToken
    };

    hci.on('leConnComplete', callback);
    hci.processLeEnhancedConnComplete(status, data);

    assert.calledOnceWithExactly(
      callback,
      status,
      0,
      0,
      'public',
      '00:00:00:00:00:00',
      0,
      0,
      0,
      0,
      '00:00:00:00:00:00',
      attemptToken
    );
    should(hci._pendingLeConn).equal(null);
  });

  it('should not register an ACL connection when the completion reports a failure status', () => {
    const status = 0x02;
    const data = Buffer.from([0x34, 0x11, 4, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 2, 1, 4, 3, 7, 8, 9]);
    const callback = sinon.spy();

    hci.on('leConnComplete', callback);
    hci.processLeConnComplete(status, data);

    assert.calledOnceWithExactly(callback, status, 4404, 4, 'random', 'ff:ee:dd:cc:bb:aa', 322.5, 772, 20550, 9);
    should(hci._aclConnections.size).equal(0);
  });

  it('should not register an ACL connection on processLeEnhancedConnComplete when the completion reports a failure status', () => {
    const status = 0x02;
    const data = Buffer.from([0x34, 0x11, 4, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 2, 1, 4, 3, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
    const callback = sinon.spy();

    hci.on('leConnComplete', callback);
    hci.processLeEnhancedConnComplete(status, data);

    assert.calledOnceWithExactly(callback, status, 4404, 4, 'random', 'ff:ee:dd:cc:bb:aa', 5138.75, 4625, 51390, 21, '0e:0d:0c:0b:0a:09');
    should(hci._aclConnections.size).equal(0);
  });

  it('should not throw and should reject a too-short payload for processLeConnComplete', () => {
    // Non-zero payload, one byte short of the 17 the field reads require - the all-zero
    // guard must not be the only thing standing between this and a RangeError.
    const status = 0;
    const data = Buffer.from([0x34, 0x11, 4, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 2, 1, 4, 3, 7, 8]);
    const callback = sinon.spy();
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    hci.on('leConnComplete', callback);

    expect(() => hci.processLeConnComplete(status, data)).not.toThrow();

    assert.notCalled(callback);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('too short'));
    consoleSpy.mockRestore();
  });

  it('should not throw and should reject a too-short payload for processLeEnhancedConnComplete', () => {
    // Non-zero payload, one byte short of the 29 the field reads require - the all-zero
    // guard must not be the only thing standing between this and a RangeError.
    const status = 0;
    const data = Buffer.from([0x34, 0x11, 4, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 2, 1, 4, 3, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    const callback = sinon.spy();
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    hci.on('leConnComplete', callback);

    expect(() => hci.processLeEnhancedConnComplete(status, data)).not.toThrow();

    assert.notCalled(callback);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('too short'));
    consoleSpy.mockRestore();
  });

  it('should still write reset after a failed connection-complete recorded no connection (regression: guard must not jam)', () => {
    const status = 1;
    const data = Buffer.from([0x34, 0x11, 4, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 2, 1, 4, 3, 7, 8, 9]);

    hci.processLeConnComplete(status, data);
    should(hci._aclConnections.size).equal(0);

    hci.reset();

    assert.calledOnceWithExactly(hci._socket.write, Buffer.from([1, 3, 0x0c, 0]));
  });

  describe('processLeAdvertisingReport', () => {
    it('should emit without error', () => {
      const count = 2;
      const data1 = Buffer.from([0, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 2, 3, 4, 0]);
      const data2 = Buffer.from([1, 0, 0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 4, 3, 4, 5, 6, 7]);
      const data = Buffer.concat([data1, data2]);
      const callback = sinon.spy();

      hci.on('leAdvertisingReport', callback);
      hci.processLeAdvertisingReport(count, data);

      assert.callCount(callback, 2);
    });

    it('should emit only once with random address', () => {
      const count = 1;
      const data = Buffer.from([0, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 2, 3, 4, 0]);
      const callback = sinon.spy();

      hci.on('leAdvertisingReport', callback);
      hci.processLeAdvertisingReport(count, data);

      assert.calledOnceWithExactly(callback, 0, 0, 'ff:ee:dd:cc:bb:aa', 'random', Buffer.from([0x03, 0x04]), 0);
    });

    it('should emit only once with public address', () => {
      const count = 1;
      const data = Buffer.from([1, 0, 0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 4, 3, 4, 5, 6, 7]);
      const callback = sinon.spy();

      hci.on('leAdvertisingReport', callback);
      hci.processLeAdvertisingReport(count, data);

      assert.calledOnceWithExactly(callback, 0, 1, 'aa:bb:cc:dd:ee:ff', 'public', Buffer.from([0x03, 0x04, 0x05, 0x06]), 7);
    });

    it('should catch error', () => {
      const count = 1;
      const data = Buffer.from([1, 0, 0xff, 0xee]);
      const callback = sinon.spy();

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      hci.on('leAdvertisingReport', callback);
      hci.processLeAdvertisingReport(count, data);

      assert.notCalled(callback);
      
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
      const callback = sinon.spy();

      hci.on('leExtendedAdvertisingReport', callback);
      hci.processLeExtendedAdvertisingReport(count, data);

      assert.callCount(callback, 2);
    });

    it('should emit only once with random address', () => {
      const count = 1;
      const eir = Buffer.from([0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17]);
      const header = Buffer.from([0, 1, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, eir.length]);
      const data = Buffer.concat([header, eir]);
      const callback = sinon.spy();

      hci.on('leExtendedAdvertisingReport', callback);
      hci.processLeExtendedAdvertisingReport(count, data);

      assert.calledOnceWithExactly(callback, 0, 256, 'ff:ee:dd:cc:bb:aa', 'random', 5, 6, Buffer.from([0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17]));
    });

    it('should emit only once with public address', () => {
      const count = 1;
      const eir = Buffer.from([0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17]);
      const header = Buffer.from([0, 1, 2, 0xff, 0xee, 0xdd, 0xcc, 0xbb, 0xaa, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, eir.length]);
      const data = Buffer.concat([header, eir]);
      const callback = sinon.spy();

      hci.on('leExtendedAdvertisingReport', callback);
      hci.processLeExtendedAdvertisingReport(count, data);

      assert.calledOnceWithExactly(callback, 0, 256, 'aa:bb:cc:dd:ee:ff', 'public', 5, 6, Buffer.from([0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17]));
    });

    it('should catch error', () => {
      const count = 1;
      const data = Buffer.from([1, 0, 0xff, 0xee]);
      const callback = sinon.spy();

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      hci.on('leExtendedAdvertisingReport', callback);
      hci.processLeExtendedAdvertisingReport(count, data);

      assert.notCalled(callback);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('illegal packet'));
    });

    it('should ignore too-short extended report without throwing', () => {
      const count = 1;
      const data = Buffer.alloc(10);
      const callback = sinon.spy();

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      hci.on('leExtendedAdvertisingReport', callback);
      hci.processLeExtendedAdvertisingReport(count, data);

      assert.notCalled(callback);
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
      const callback = sinon.spy();

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      hci.on('leExtendedAdvertisingReport', callback);
      hci.processLeExtendedAdvertisingReport(count, data);

      assert.notCalled(callback);
      expect(consoleSpy.mock.calls.some((call) => String(call[0]).includes('eir length'))).toBe(true);
      consoleSpy.mockRestore();
    });
  });

  it('processLeConnUpdateComplete', () => {
    const callback = sinon.spy();
    hci.on('leConnUpdateComplete', callback);
    hci.processLeConnUpdateComplete('status', Buffer.from(([1, 0, 2, 0, 3, 0, 4, 0])));

    assert.calledOnceWithExactly(callback, 'status', 1, 2.5, 3, 40);
  });

  describe('processCmdStatusEvent', () => {
    it('should do nothing on bad cmd', () => {
      const callback = sinon.spy();
      hci.on('leConnComplete', callback);
      hci.processCmdStatusEvent(8206, 'status');

      assert.notCalled(callback);
    });

    [8205, 8259].forEach((cmd) => {
      it(`should do nothing on bad status - cmd = ${cmd}`, () => {
        const callback = sinon.spy();
        hci.on('leConnComplete', callback);
        hci.processCmdStatusEvent(cmd, 0);

        assert.notCalled(callback);
      });

      it(`should emit event - cmd = ${cmd}`, () => {
        const callback = sinon.spy();
        const attemptToken = {};
        hci._pendingLeConn = {
          address: '11:22:33:44:55:66',
          addressType: 'random',
          token: attemptToken
        };
        hci.on('leConnComplete', callback);
        hci.processCmdStatusEvent(cmd, 'status');

        assert.calledOnceWithExactly(
          callback,
          'status',
          undefined,
          undefined,
          'random',
          '11:22:33:44:55:66',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          attemptToken
        );
        should(hci._pendingLeConn).equal(null);
      });
    });
  });

  it('should change state', () => {
    hci.onStateChange('newState');
    should(hci._state).equal('newState');
  });
});
