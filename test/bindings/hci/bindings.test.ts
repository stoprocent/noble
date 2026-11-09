// The sibling layers are mocked so these tests only exercise the orchestration
// in HciBindings. Every mock class records its instances and constructor
// arguments; the factories are self-contained because jest hoists them.
jest.mock('../../../src/bindings/hci/hci', () => {
  class Hci {
    static instances: any[] = [];
    address = 'lo:ca:la:dd:re:ss';
    addressType = 'public';
    init = jest.fn();
    stop = jest.fn();
    reset = jest.fn();
    isUserChannel = jest.fn().mockReturnValue(false);
    setAddress = jest.fn();
    setScanParameters = jest.fn();
    setScanEnabled = jest.fn();
    createLeConn = jest.fn();
    cancelConnect = jest.fn();
    connUpdateLe = jest.fn();
    startLeEncryption = jest.fn();
    disconnect = jest.fn();
    readRssi = jest.fn();
    writeAclDataPkt = jest.fn();
    args: any[];

    constructor (...args: any[]) {
      this.args = args;
      Hci.instances.push(this);
    }
  }
  return { Hci, HCI_STATUS: { 1: 'custom mapper' } };
}, { virtual: true });

jest.mock('../../../src/bindings/hci/gap', () => {
  class Gap {
    static instances: any[] = [];
    setScanParameters = jest.fn();
    startScanning = jest.fn();
    stopScanning = jest.fn();
    reset = jest.fn();
    onHciLeScanParametersSet = jest.fn();
    onHciLeScanEnableSet = jest.fn();
    onLeScanEnableSetCmd = jest.fn();
    onHciLeAdvertisingReport = jest.fn();
    onHciLeExtendedAdvertisingReport = jest.fn();
    args: any[];

    constructor (...args: any[]) {
      this.args = args;
      Gap.instances.push(this);
    }
  }
  return { Gap };
});

jest.mock('../../../src/bindings/hci/acl-stream', () => {
  class AclStream {
    static instances: any[] = [];
    push = jest.fn();
    pushEncrypt = jest.fn();
    close = jest.fn();
    args: any[];

    constructor (...args: any[]) {
      this.args = args;
      AclStream.instances.push(this);
    }
  }
  return { AclStream };
});

jest.mock('../../../src/bindings/hci/gatt', () => {
  class Gatt {
    static instances: any[] = [];
    // settled by the tests through `gatt.mtu`
    mtu: any = {};
    exchangeMtu = jest.fn(() => this.mtu.promise);
    discoverServices = jest.fn(() => Promise.resolve('discoverServices result'));
    discoverIncludedServices = jest.fn(() => Promise.resolve('discoverIncludedServices result'));
    discoverCharacteristics = jest.fn(() => Promise.resolve('discoverCharacteristics result'));
    read = jest.fn(() => Promise.resolve('read result'));
    write = jest.fn(() => Promise.resolve('write result'));
    broadcast = jest.fn(() => Promise.resolve('broadcast result'));
    notify = jest.fn(() => Promise.resolve('notify result'));
    discoverDescriptors = jest.fn(() => Promise.resolve('discoverDescriptors result'));
    readValue = jest.fn(() => Promise.resolve('readValue result'));
    writeValue = jest.fn(() => Promise.resolve('writeValue result'));
    readHandle = jest.fn(() => Promise.resolve('readHandle result'));
    writeHandle = jest.fn(() => Promise.resolve('writeHandle result'));
    close = jest.fn();
    args: any[];

    constructor (...args: any[]) {
      this.args = args;
      this.mtu.promise = new Promise((resolve, reject) => {
        this.mtu.resolve = resolve;
        this.mtu.reject = reject;
      });
      Gatt.instances.push(this);
    }
  }
  return { Gatt };
});

jest.mock('../../../src/bindings/hci/signaling', () => {
  class Signaling {
    static instances: any[] = [];
    args: any[];

    constructor (...args: any[]) {
      this.args = args;
      Signaling.instances.push(this);
    }
  }
  return { Signaling };
});

import { HciBindings } from '../../../src/bindings/hci/bindings';
import { Deferred } from '../../../src/common/deferred';
import {
  AdapterStateError,
  ConnectionCancelledError,
  DisconnectedError,
  NobleError
} from '../../../src/common/errors';

const { Hci } = jest.requireMock('../../../src/bindings/hci/hci');
const { Gap } = jest.requireMock('../../../src/bindings/hci/gap');
const { AclStream } = jest.requireMock('../../../src/bindings/hci/acl-stream');
const { Gatt } = jest.requireMock('../../../src/bindings/hci/gatt');
const { Signaling } = jest.requireMock('../../../src/bindings/hci/signaling');

const createDelegate = () => ({
  onStateChange: jest.fn(),
  onAddressChange: jest.fn(),
  onScanStart: jest.fn(),
  onScanStop: jest.fn(),
  onDiscover: jest.fn(),
  onConnect: jest.fn(),
  onDisconnect: jest.fn(),
  onMtu: jest.fn(),
  onRssi: jest.fn(),
  onNotification: jest.fn(),
  onHandleNotification: jest.fn(),
  onWarning: jest.fn()
});

/** Lets promise reactions that are already due run. */
const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

/** 'pending' until the promise settles; never waits for it. */
const stateOf = async (promise: Promise<unknown>) => {
  let state = 'pending';
  promise.then(() => { state = 'resolved'; }, () => { state = 'rejected'; });
  await flush();
  return state;
};

describe('hci-socket bindings', () => {
  let bindings: any;
  let delegate: ReturnType<typeof createDelegate>;
  let hci: any;
  let gap: any;
  const options = {};

  const queueEntry = (id: string, address: string, params: any = {}, addressType = 'random') => ({
    id,
    address,
    addressType,
    params,
    deferred: new Deferred<void>()
  });

  /** Brings up a link nobody asked for and returns its connection record. */
  const link = (handle: number, address: string, addressType = 'random') => {
    bindings.onLeConnComplete({ status: 0, handle, role: 0, addressType, address });
    return bindings.connections.get(handle);
  };

  beforeEach(() => {
    jest.spyOn(process, 'on').mockImplementation((() => process) as any);
    jest.spyOn(process, 'removeListener').mockImplementation((() => process) as any);
    jest.spyOn(process, 'exit').mockImplementation((() => undefined) as any);

    for (const mock of [Hci, Gap, AclStream, Gatt, Signaling]) {
      mock.instances.length = 0;
    }

    delegate = createDelegate();
    bindings = new HciBindings(options);
    bindings.start(delegate);
    hci = bindings.hci;
    gap = bindings.gap;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('constructor', () => {
    const fresh = new HciBindings({ deviceId: 3 }) as any;

    expect(fresh.options).toEqual({ deviceId: 3 });
    expect(fresh.state).toBe(null);
    expect(fresh.isScanning).toBe(false);
    expect(fresh.isScanningStarted).toBe(false);
    expect(fresh.scanServiceUuids).toEqual([]);

    expect(fresh.addresses.size).toBe(0);
    expect(fresh.addressTypes.size).toBe(0);
    expect(fresh.connectable.size).toBe(0);
    expect(fresh.scannable.size).toBe(0);

    expect(fresh.pendingConnectionId).toBe(null);
    expect(fresh.pendingConnectionAddress).toBe(null);
    expect(fresh.pendingConnectionToken).toBe(null);
    expect(fresh.cancelledConnectionId).toBe(null);
    expect(fresh.connectionQueue).toEqual([]);

    expect(fresh.connections.size).toBe(0);
    expect(fresh.handles.size).toBe(0);

    expect(fresh.hci).toBe(null);
    expect(fresh.gap).toBe(null);
  });

  it('constructor copies the options and defaults to none', () => {
    const given = { deviceId: 1 };

    expect((new HciBindings(given) as any).options).not.toBe(given);
    expect((new HciBindings() as any).options).toEqual({});
  });

  it('start', () => {
    expect(Hci.instances).toHaveLength(1);
    expect(Gap.instances).toHaveLength(1);

    // both layers report to the bindings; the gap drives the hci
    expect(hci.args).toEqual([options, bindings]);
    expect(gap.args).toEqual([hci, bindings]);

    expect(hci.init).toHaveBeenCalledTimes(1);

    // `process.on` is global: the runtime may register listeners of its own
    // while it is spied on, so only our two registrations are asserted.
    expect(process.on).toHaveBeenCalledWith('SIGINT', bindings.sigIntHandler);
    expect(process.on).toHaveBeenCalledWith('exit', bindings.exitHandler);
  });

  it('forwards the scan-related hci callbacks into the gap', () => {
    const report = { status: 0, type: 4, address: 'a', addressType: 'random', eir: Buffer.alloc(0), rssi: -1 };
    const extendedReport = { ...report, txpower: 3 };

    bindings.onLeScanParametersSet();
    bindings.onLeScanEnableSet(7);
    bindings.onLeScanEnableSetCmd(true, false);
    bindings.onLeAdvertisingReport(report);
    bindings.onLeExtendedAdvertisingReport(extendedReport);

    expect(gap.onHciLeScanParametersSet).toHaveBeenCalledTimes(1);
    expect(gap.onHciLeScanEnableSet).toHaveBeenCalledWith(7);
    expect(gap.onLeScanEnableSetCmd).toHaveBeenCalledWith(true, false);
    expect(gap.onHciLeAdvertisingReport).toHaveBeenCalledWith(report);
    expect(gap.onHciLeExtendedAdvertisingReport).toHaveBeenCalledWith(extendedReport);
  });

  describe('onSigInt', () => {
    it('should exit', () => {
      jest.spyOn(process, 'listeners').mockReturnValue([jest.fn(), bindings.sigIntHandler]);

      bindings.sigIntHandler();

      expect(process.exit).toHaveBeenCalledWith(1);
      expect(process.exit).toHaveBeenCalledTimes(1);
    });

    it('should not exit', () => {
      jest.spyOn(process, 'listeners').mockReturnValue([bindings.sigIntHandler, jest.fn()]);

      bindings.sigIntHandler();

      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe('setScanParameters', () => {
    it('drives the gap and resolves on the next scan-parameters-set', async () => {
      const promise = bindings.setScanParameters('interval', 'window');

      expect(gap.setScanParameters).toHaveBeenCalledTimes(1);
      expect(gap.setScanParameters).toHaveBeenCalledWith('interval', 'window');
      expect(await stateOf(promise)).toBe('pending');

      bindings.onScanParametersSet();

      await expect(promise).resolves.toBeUndefined();
    });

    it('rejects when the bindings were never started', async () => {
      await expect(new HciBindings().setScanParameters(1, 2)).rejects.toBeInstanceOf(NobleError);
    });
  });

  it('onScanParametersSet without anybody waiting', () => {
    expect(() => bindings.onScanParametersSet()).not.toThrow();
  });

  describe('startScanning', () => {
    it('no args, already scanning', async () => {
      bindings.isScanning = true;

      const promise = bindings.startScanning();

      expect(bindings.scanServiceUuids).toEqual([]);
      expect(delegate.onScanStart).toHaveBeenCalledTimes(1);
      expect(gap.startScanning).not.toHaveBeenCalled();
      await expect(promise).resolves.toBeUndefined();
    });

    it('no args, not scanning but started', async () => {
      bindings.isScanning = false;
      bindings.isScanningStarted = true;

      const promise = bindings.startScanning();

      expect(bindings.scanServiceUuids).toEqual([]);
      expect(gap.startScanning).not.toHaveBeenCalled();
      expect(delegate.onScanStart).not.toHaveBeenCalled();

      // joins the start that is already in flight
      expect(await stateOf(promise)).toBe('pending');
      bindings.onScanStart(true);
      await expect(promise).resolves.toBeUndefined();
    });

    it('with args, first time', async () => {
      const promise = bindings.startScanning(['uuid'], true);

      expect(bindings.scanServiceUuids).toEqual(['uuid']);
      expect(bindings.isScanningStarted).toBe(true);
      expect(bindings.isScanning).toBe(false);

      expect(gap.startScanning).toHaveBeenCalledTimes(1);
      expect(gap.startScanning).toHaveBeenCalledWith(true);
      expect(await stateOf(promise)).toBe('pending');

      bindings.onScanStart(false);

      expect(bindings.isScanning).toBe(true);
      expect(delegate.onScanStart).toHaveBeenCalledTimes(1);
      expect(delegate.onScanStart).toHaveBeenCalledWith(false);
      await expect(promise).resolves.toBeUndefined();
    });

    it('a second call while starting joins the first without restarting the gap', async () => {
      const first = bindings.startScanning(['uuid'], false);
      const second = bindings.startScanning(['other'], true);

      expect(gap.startScanning).toHaveBeenCalledTimes(1);
      expect(bindings.scanServiceUuids).toEqual(['uuid']);

      bindings.onScanStart(true);

      await expect(first).resolves.toBeUndefined();
      await expect(second).resolves.toBeUndefined();
    });

    it('rejects when the bindings were never started', async () => {
      await expect(new HciBindings().startScanning([], false)).rejects.toBeInstanceOf(NobleError);
    });
  });

  describe('stopScanning', () => {
    it('when scanning', async () => {
      bindings.isScanning = true;

      const promise = bindings.stopScanning();

      expect(gap.stopScanning).toHaveBeenCalledTimes(1);
      expect(delegate.onScanStop).not.toHaveBeenCalled();
      expect(await stateOf(promise)).toBe('pending');

      bindings.onScanStop();

      expect(delegate.onScanStop).toHaveBeenCalledTimes(1);
      await expect(promise).resolves.toBeUndefined();
    });

    it('when not scanning', async () => {
      bindings.isScanning = false;

      const promise = bindings.stopScanning();

      expect(gap.stopScanning).toHaveBeenCalledTimes(1);
      expect(delegate.onScanStop).toHaveBeenCalledTimes(1);
      await expect(promise).resolves.toBeUndefined();
    });

    it('rejects when the bindings were never started', async () => {
      await expect(new HciBindings().stopScanning()).rejects.toBeInstanceOf(NobleError);
    });
  });

  it('setAddress', () => {
    bindings.setAddress('test-address');

    expect(hci.setAddress).toHaveBeenCalledTimes(1);
    expect(hci.setAddress).toHaveBeenCalledWith('test-address');
  });

  it('addressToId', () => {
    expect(bindings.addressToId('AA:bb:CC:dd:EE:ff')).toBe('aabbccddeeff');
  });

  describe('connect', () => {
    beforeEach(() => {
      bindings.state = 'poweredOn';
    });

    it('rejects while the adapter is not poweredOn without queueing or writing', async () => {
      bindings.state = 'poweredOff';

      const promise = bindings.connect('112233445566');

      await expect(promise).rejects.toBeInstanceOf(AdapterStateError);
      await expect(promise).rejects.toMatchObject({
        message: 'Cannot connect while adapter state is poweredOff (not poweredOn)',
        state: 'poweredOff'
      });
      expect(bindings.connectionQueue).toHaveLength(0);
      expect(hci.createLeConn).not.toHaveBeenCalled();
    });

    it('does not overlap a user-channel initialization reset with a connect reset', async () => {
      bindings.state = null;
      hci.isUserChannel.mockReturnValue(true);

      // Model the reset already issued by Hci.init() before poweredOn.
      hci.reset();
      const promise = bindings.connect('112233445566');

      await expect(promise).rejects.toMatchObject({
        message: 'Cannot connect while adapter state is unknown (not poweredOn)',
        state: 'unknown'
      });
      expect(hci.reset).toHaveBeenCalledTimes(1);
      expect(hci.createLeConn).not.toHaveBeenCalled();
      expect(bindings.connectionQueue).toHaveLength(0);
    });

    it('coalesces duplicate requests for the same peripheral', () => {
      const first = bindings.connect('112233445566', { mtu: 100 });
      const second = bindings.connect('112233445566', { mtu: 200 });

      expect(second).toBe(first);
      expect(bindings.connectionQueue).toHaveLength(1);
      expect(bindings.connectionQueue[0].params).toEqual({ mtu: 100 });
      expect(hci.createLeConn).toHaveBeenCalledTimes(1);
    });

    it('a queued duplicate also returns the promise of its queue entry', () => {
      bindings.connect('112233445566');
      const first = bindings.connect('998877665544');
      const second = bindings.connect('998877665544');

      expect(second).toBe(first);
      expect(bindings.connectionQueue).toHaveLength(2);
    });

    it('missing peripheral, no queue, public address', () => {
      bindings.connect('112233445566', { addressType: 'public' });

      expect(bindings.connectionQueue).toHaveLength(1);
      expect(bindings.connectionQueue[0].id).toBe('112233445566');
      expect(bindings.connectionQueue[0].params).toEqual({ addressType: 'public' });

      expect(hci.createLeConn).toHaveBeenCalledTimes(1);
      expect(hci.createLeConn).toHaveBeenCalledWith('11:22:33:44:55:66', 'public', { addressType: 'public' }, true, expect.anything());
    });

    it('missing peripheral, no queue, random address', () => {
      bindings.connect('f32233445566', { addressType: 'random' });

      expect(bindings.connectionQueue).toHaveLength(1);
      expect(bindings.connectionQueue[0].id).toBe('f32233445566');
      expect(bindings.connectionQueue[0].params).toEqual({ addressType: 'random' });

      expect(hci.createLeConn).toHaveBeenCalledTimes(1);
      expect(hci.createLeConn).toHaveBeenCalledWith('f3:22:33:44:55:66', 'random', { addressType: 'random' }, true, expect.anything());
    });

    it('missing peripheral, no options, defaults to a random address', () => {
      bindings.connect('112233445566');

      expect(hci.createLeConn).toHaveBeenCalledWith('11:22:33:44:55:66', 'random', {}, true, expect.anything());
    });

    it('existing peripheral, no queue', () => {
      bindings.addresses.set('peripheralUuid', 'address');
      bindings.addressTypes.set('peripheralUuid', 'addressType');

      bindings.connect('peripheralUuid', 'parameters');

      expect(bindings.connectionQueue).toHaveLength(1);
      expect(bindings.connectionQueue[0].id).toBe('peripheralUuid');
      expect(bindings.connectionQueue[0].params).toBe('parameters');

      expect(hci.createLeConn).toHaveBeenCalledTimes(1);
      expect(hci.createLeConn).toHaveBeenCalledWith('address', 'addressType', 'parameters', true, expect.anything());
    });

    it('missing peripheral, with queue', () => {
      bindings.pendingConnectionId = 'pending-uuid';

      bindings.connect('peripheralUuid', 'parameters');

      expect(bindings.connectionQueue).toHaveLength(1);
      expect(bindings.connectionQueue[0].id).toBe('peripheralUuid');
      expect(bindings.connectionQueue[0].params).toBe('parameters');
      expect(hci.createLeConn).not.toHaveBeenCalled();
    });

    it('resolves once the link of the pending attempt is up, without waiting for the mtu', async () => {
      const promise = bindings.connect('112233445566');
      expect(await stateOf(promise)).toBe('pending');

      bindings.onLeConnComplete({ status: 0, handle: 64, role: 0, addressType: 'random', address: '11:22:33:44:55:66' });

      await expect(promise).resolves.toBeUndefined();
      expect(Gatt.instances[0].exchangeMtu).toHaveBeenCalledTimes(1);
      expect(delegate.onMtu).not.toHaveBeenCalled();
      // our own attempt is not an unsolicited link
      expect(delegate.onConnect).not.toHaveBeenCalled();
    });

    it('rejects with the mapped hci status when the pending attempt fails', async () => {
      const promise = bindings.connect('112233445566');

      bindings.onLeConnComplete({ status: 1, role: 0, addressType: 'random', address: '11:22:33:44:55:66' });

      await expect(promise).rejects.toBeInstanceOf(NobleError);
      await expect(promise).rejects.toMatchObject({ message: 'custom mapper (0x1)' });
    });

    // Characterization test: this also passes unmodified against main.
    it('a connection already in flight blocks createLeConn until it completes', () => {
      bindings.addresses.set('peripheralA', '112233445566').set('peripheralB', '998877665544');
      bindings.addressTypes.set('peripheralA', 'random').set('peripheralB', 'public');

      bindings.connect('peripheralA', { addressType: 'random' });

      expect(hci.createLeConn).toHaveBeenCalledTimes(1);

      bindings.connect('peripheralB', { addressType: 'public' });

      // Second connect() queued behind the in-flight first attempt.
      expect(hci.createLeConn).toHaveBeenCalledTimes(1);
      expect(bindings.connectionQueue).toHaveLength(2);

      bindings.onLeConnComplete({ status: 0, handle: 1, role: 0, addressType: 'random', address: '11:22:33:44:55:66' });

      expect(hci.createLeConn).toHaveBeenCalledTimes(2);
      expect(hci.createLeConn).toHaveBeenCalledWith('998877665544', 'public', { addressType: 'public' }, false, expect.anything());
    });

    describe('regression: concurrent connects during a scan (issue #112)', () => {
      it('two connects queued during scanning both reach createLeConn, one after the other completes', () => {
        bindings.addresses.set('peripheralA', '112233445566').set('peripheralB', '998877665544');
        bindings.addressTypes.set('peripheralA', 'random').set('peripheralB', 'public');
        bindings.isScanning = true;
        bindings.isScanningStarted = true;

        bindings.connect('peripheralA', { addressType: 'random' });
        bindings.connect('peripheralB', { addressType: 'public' });

        // Nothing may start while the scan hasn't actually stopped yet.
        expect(hci.createLeConn).not.toHaveBeenCalled();
        expect(bindings.connectionQueue).toHaveLength(2);
        // ...but the scan is asked to pause.
        expect(gap.stopScanning).toHaveBeenCalled();

        // Simulate the hardware reporting that scanning has actually stopped.
        bindings.onScanStop();

        expect(hci.createLeConn).toHaveBeenCalledTimes(1);
        expect(hci.createLeConn).toHaveBeenCalledWith('112233445566', 'random', { addressType: 'random' }, true, expect.anything());

        bindings.onLeConnComplete({ status: 0, handle: 1, role: 0, addressType: 'random', address: '11:22:33:44:55:66' });

        expect(hci.createLeConn).toHaveBeenCalledTimes(2);
        expect(hci.createLeConn).toHaveBeenCalledWith('998877665544', 'public', { addressType: 'public' }, false, expect.anything());
      });

      it('does not strand the queue when scanning resumes (via startScanning/onScanStart) before the second entry starts', () => {
        bindings.addresses.set('peripheralA', '112233445566').set('peripheralB', '998877665544');
        bindings.addressTypes.set('peripheralA', 'random').set('peripheralB', 'public');
        bindings.isScanning = true;
        bindings.isScanningStarted = true;

        bindings.connect('peripheralA', { addressType: 'random' });
        bindings.connect('peripheralB', { addressType: 'public' });

        bindings.onScanStop();
        expect(hci.createLeConn).toHaveBeenCalledTimes(1);

        // Drive scanning resumption through the same entry points a discovery
        // loop uses (startScanning() then the gap's scan start callback), not by
        // poking isScanningStarted directly.
        bindings.startScanning();
        bindings.onScanStart();

        bindings.onLeConnComplete({ status: 0, handle: 1, role: 0, addressType: 'random', address: '11:22:33:44:55:66' });

        // peripheralB must not start while scanning is active again.
        expect(hci.createLeConn).toHaveBeenCalledTimes(1);
        expect(bindings.connectionQueue).toHaveLength(1);

        // Scanning genuinely stops again; peripheralB must now proceed.
        bindings.onScanStop();

        expect(hci.createLeConn).toHaveBeenCalledTimes(2);
        // peripheralA's handle is now registered (its leConnComplete already succeeded), so reset is false.
        expect(hci.createLeConn).toHaveBeenCalledWith('998877665544', 'public', { addressType: 'public' }, false, expect.anything());
      });
    });
  });

  describe('disconnect', () => {
    it('missing handle', () => {
      bindings.disconnect('peripheralUuid');

      expect(hci.disconnect).not.toHaveBeenCalled();
    });

    it('existing handle', () => {
      link(64, '11:22:33:44:55:66');

      bindings.disconnect('112233445566');

      expect(hci.disconnect).toHaveBeenCalledTimes(1);
      expect(hci.disconnect).toHaveBeenCalledWith(64);
      // completion is only reported once the controller confirms it
      expect(delegate.onDisconnect).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('missing handle', () => {
      bindings.connectionQueue.push(queueEntry('anotherPeripheralUuid', 'aa'));

      bindings.cancelConnect('peripheralUuid');

      expect(bindings.connectionQueue).toHaveLength(1);
      expect(bindings.cancelledConnectionId).toBe(null);

      expect(hci.cancelConnect).toHaveBeenCalledTimes(1);
      expect(hci.cancelConnect).toHaveBeenCalledWith();
    });

    it('existing handle', async () => {
      const other = queueEntry('anotherPeripheralUuid', 'aa');
      const cancelled = queueEntry('peripheralUuid', 'bb');
      bindings.connectionQueue.push(other, cancelled);

      bindings.cancelConnect('peripheralUuid');

      expect(bindings.connectionQueue).toEqual([other]);

      expect(hci.cancelConnect).toHaveBeenCalledTimes(1);
      expect(hci.cancelConnect).toHaveBeenCalledWith();

      await expect(cancelled.deferred.promise).rejects.toBeInstanceOf(ConnectionCancelledError);
      expect(await stateOf(other.deferred.promise)).toBe('pending');
    });

    it('rejects the promise of a queued connect', async () => {
      bindings.state = 'poweredOn';
      const first = bindings.connect('112233445566');
      const second = bindings.connect('998877665544');

      bindings.cancelConnect('998877665544');

      await expect(second).rejects.toBeInstanceOf(ConnectionCancelledError);
      await expect(second).rejects.toMatchObject({ message: 'connection canceled!' });
      expect(await stateOf(first)).toBe('pending');
      // only the attempt in flight needs its completion awaited
      expect(bindings.cancelledConnectionId).toBe(null);
      expect(bindings.pendingConnectionId).toBe('112233445566');
    });

    it('waits for the cancelled attempt completion before starting the next peer', async () => {
      bindings.state = 'poweredOn';
      bindings.addresses.set('peripheralA', '11:22:33:44:55:66').set('peripheralB', '99:88:77:66:55:44');
      bindings.addressTypes.set('peripheralA', 'random').set('peripheralB', 'public');

      const connectA = bindings.connect('peripheralA');
      const connectB = bindings.connect('peripheralB');
      const cancelledToken = bindings.pendingConnectionToken;

      bindings.cancelConnect('peripheralA');

      await expect(connectA).rejects.toBeInstanceOf(ConnectionCancelledError);
      expect(hci.createLeConn).toHaveBeenCalledTimes(1);
      expect(bindings.connectionQueue).toHaveLength(1);
      expect(bindings.pendingConnectionId).toBe('peripheralA');
      expect(bindings.cancelledConnectionId).toBe('peripheralA');

      bindings.onLeConnComplete({
        status: 0x02,
        handle: 0,
        role: 0,
        addressType: 'public',
        address: '00:00:00:00:00:00',
        interval: 0,
        latency: 0,
        supervisionTimeout: 0,
        masterClockAccuracy: 0,
        attemptToken: cancelledToken
      });

      expect(delegate.onConnect).not.toHaveBeenCalled();
      expect(await stateOf(connectB)).toBe('pending');
      expect(hci.createLeConn).toHaveBeenCalledTimes(2);
      expect(hci.createLeConn).toHaveBeenLastCalledWith(
        '99:88:77:66:55:44',
        'public',
        {},
        true,
        expect.anything()
      );
      expect(bindings.pendingConnectionId).toBe('peripheralB');
      expect(bindings.cancelledConnectionId).toBe(null);
    });

    it('disconnects a link that came up after the attempt was cancelled', async () => {
      bindings.state = 'poweredOn';
      const promise = bindings.connect('112233445566');

      bindings.cancelConnect('112233445566');
      bindings.onLeConnComplete({ status: 0, handle: 64, role: 0, addressType: 'random', address: '11:22:33:44:55:66' });

      await expect(promise).rejects.toBeInstanceOf(ConnectionCancelledError);
      expect(hci.disconnect).toHaveBeenCalledTimes(1);
      expect(hci.disconnect).toHaveBeenCalledWith(64);
      expect(delegate.onConnect).not.toHaveBeenCalled();
      expect(bindings.pendingConnectionId).toBe(null);
      expect(bindings.cancelledConnectionId).toBe(null);

      // the controller then confirms the teardown like for any other link
      bindings.onDisconnComplete(64, 0x16);
      expect(delegate.onDisconnect).toHaveBeenCalledWith('112233445566', 0x16);
    });

    it('a cancelled peripheral can be connected again', async () => {
      bindings.state = 'poweredOn';
      const first = bindings.connect('112233445566');
      bindings.cancelConnect('112233445566');
      const second = bindings.connect('112233445566');

      expect(second).not.toBe(first);
      // the new attempt only starts once the cancelled one completed
      expect(hci.createLeConn).toHaveBeenCalledTimes(1);

      bindings.onLeConnComplete({ status: 0x02, role: 0, address: '11:22:33:44:55:66', addressType: 'random' });

      expect(hci.createLeConn).toHaveBeenCalledTimes(2);
      expect(await stateOf(second)).toBe('pending');

      bindings.onLeConnComplete({ status: 0, handle: 5, role: 0, address: '11:22:33:44:55:66', addressType: 'random' });

      await expect(second).resolves.toBeUndefined();
    });
  });

  describe('updateRssi', () => {
    it('missing handle', async () => {
      const promise = bindings.updateRssi('peripheralUuid');

      await expect(promise).rejects.toBeInstanceOf(NobleError);
      await expect(promise).rejects.toMatchObject({ message: 'unknown peripheral peripheralUuid' });
      expect(hci.readRssi).not.toHaveBeenCalled();
    });

    it('existing handle', async () => {
      link(64, '11:22:33:44:55:66');

      const promise = bindings.updateRssi('112233445566');

      expect(hci.readRssi).toHaveBeenCalledTimes(1);
      expect(hci.readRssi).toHaveBeenCalledWith(64);
      expect(await stateOf(promise)).toBe('pending');

      bindings.onRssiRead(64, -42);

      await expect(promise).resolves.toBe(-42);
      expect(delegate.onRssi).toHaveBeenCalledWith('112233445566', -42);
    });

    it('resolves concurrent reads in order, per connection', async () => {
      link(64, '11:22:33:44:55:66');
      link(65, '99:88:77:66:55:44');

      const first = bindings.updateRssi('112233445566');
      const other = bindings.updateRssi('998877665544');
      const second = bindings.updateRssi('112233445566');

      bindings.onRssiRead(64, -1);
      expect(await stateOf(second)).toBe('pending');
      expect(await stateOf(other)).toBe('pending');

      bindings.onRssiRead(64, -2);
      bindings.onRssiRead(65, -3);

      await expect(first).resolves.toBe(-1);
      await expect(second).resolves.toBe(-2);
      await expect(other).resolves.toBe(-3);
    });

    it('rejects pending reads when the link goes away', async () => {
      link(64, '11:22:33:44:55:66');
      const promise = bindings.updateRssi('112233445566');

      bindings.onDisconnComplete(64, 0x08);

      await expect(promise).rejects.toBeInstanceOf(DisconnectedError);
      await expect(promise).rejects.toMatchObject({ reason: 0x08 });
    });
  });

  describe('stop', () => {
    it('no handles', () => {
      bindings.isScanning = true;

      bindings.stop();

      expect(process.removeListener).toHaveBeenCalledWith('exit', bindings.exitHandler);
      expect(process.removeListener).toHaveBeenCalledWith('SIGINT', bindings.sigIntHandler);
      expect(gap.stopScanning).toHaveBeenCalledTimes(1);
      expect(hci.reset).not.toHaveBeenCalled(); // Reset is not called in stop()
      expect(hci.disconnect).not.toHaveBeenCalled();
      expect(hci.stop).toHaveBeenCalledTimes(1);
    });

    it('with handles', () => {
      bindings.isScanning = true;
      link(1, '11:22:33:44:55:01');
      link(2, '11:22:33:44:55:02');
      link(3, '11:22:33:44:55:03');

      bindings.stop();

      expect(gap.stopScanning).toHaveBeenCalledTimes(1);
      expect(hci.disconnect).toHaveBeenCalledTimes(3);
      expect(hci.disconnect).toHaveBeenCalledWith(1);
      expect(hci.disconnect).toHaveBeenCalledWith(2);
      expect(hci.disconnect).toHaveBeenCalledWith(3);
      expect(hci.stop).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when never started', () => {
      const fresh = new HciBindings();

      expect(() => fresh.stop()).not.toThrow();
    });

    it('the exit handler stops the bindings', () => {
      bindings.exitHandler();

      expect(hci.stop).toHaveBeenCalledTimes(1);
    });
  });

  describe('onStateChange', () => {
    it('same state', () => {
      bindings.state = 'state';

      bindings.onStateChange('state');

      expect(delegate.onStateChange).not.toHaveBeenCalled();
    });

    it('new state', () => {
      bindings.state = 'state';

      bindings.onStateChange('newState');

      expect(delegate.onStateChange).toHaveBeenCalledTimes(1);
      expect(delegate.onStateChange).toHaveBeenCalledWith('newState');
      expect(delegate.onWarning).not.toHaveBeenCalled();
    });

    it('unauthorized', () => {
      bindings.state = 'state';

      bindings.onStateChange('unauthorized');

      expect(delegate.onStateChange).toHaveBeenCalledTimes(1);
      expect(delegate.onStateChange).toHaveBeenCalledWith('unauthorized');

      expect(delegate.onWarning).toHaveBeenCalledTimes(1);
      expect(delegate.onWarning).toHaveBeenCalledWith(expect.stringContaining('adapter state unauthorized'));
    });

    it('unsupported', () => {
      bindings.state = 'state';

      bindings.onStateChange('unsupported');

      expect(delegate.onStateChange).toHaveBeenCalledTimes(1);
      expect(delegate.onStateChange).toHaveBeenCalledWith('unsupported');

      expect(delegate.onWarning).toHaveBeenCalledTimes(1);
      expect(delegate.onWarning).toHaveBeenCalledWith(expect.stringContaining('adapter does not support Bluetooth'));
    });

    it('poweredOn -> poweredOff with an attempt in flight clears the queue and in-flight flag, and a later connect() starts normally (issue #112)', () => {
      bindings.state = 'poweredOn';
      bindings.connectionQueue.push(queueEntry('queuedPeripheral', 'aa:aa:aa:aa:aa:aa'));
      bindings.pendingConnectionId = 'queuedPeripheral';

      bindings.onStateChange('poweredOff');

      expect(bindings.connectionQueue).toHaveLength(0);
      expect(bindings.pendingConnectionId).toBe(null);

      bindings.addresses.set('peripheralUuid', 'bb:bb:bb:bb:bb:bb');
      bindings.addressTypes.set('peripheralUuid', 'random');

      bindings.onStateChange('poweredOn');
      bindings.connect('peripheralUuid', {});

      expect(hci.createLeConn).toHaveBeenCalledTimes(1);
      expect(hci.createLeConn).toHaveBeenCalledWith('bb:bb:bb:bb:bb:bb', 'random', {}, true, expect.anything());
    });

    it('poweredOn -> poweredOff disconnects all live connections exactly once without throwing', () => {
      bindings.state = 'poweredOn';
      const connection1 = link(1, '11:22:33:44:55:01');
      const connection2 = link(2, '11:22:33:44:55:02');

      expect(() => bindings.onStateChange('poweredOff')).not.toThrow();

      expect(delegate.onDisconnect).toHaveBeenCalledTimes(2);
      expect(delegate.onDisconnect).toHaveBeenCalledWith('112233445501', 0x03);
      expect(delegate.onDisconnect).toHaveBeenCalledWith('112233445502', 0x03);

      for (const connection of [connection1, connection2]) {
        expect(connection.aclStream.close).toHaveBeenCalledTimes(1);
        expect(connection.gatt.close).toHaveBeenCalledTimes(1);
        expect(connection.gatt.close.mock.calls[0][0]).toBeInstanceOf(DisconnectedError);
        expect(connection.gatt.close.mock.calls[0][0].reason).toBe(0x03);
      }

      expect(bindings.handles.size).toBe(0);
      expect(bindings.connections.size).toBe(0);

      // the disconnects are reported before the state change
      expect(delegate.onDisconnect.mock.invocationCallOrder[1])
        .toBeLessThan(delegate.onStateChange.mock.invocationCallOrder[0]);
    });

    it.each(['poweredOff', 'unauthorized', 'unsupported'])('clears queued attempts when leaving poweredOn for %s', async (state) => {
      bindings.state = 'poweredOn';
      const pending = queueEntry('pending', 'aa');
      const queued = queueEntry('queued', 'bb');
      bindings.connectionQueue = [pending, queued];
      bindings.pendingConnectionId = 'pending';
      bindings.pendingConnectionAddress = 'aa';
      bindings.pendingConnectionToken = {};
      bindings.cancelledConnectionId = 'pending';

      bindings.onStateChange(state);

      expect(bindings.connectionQueue).toHaveLength(0);
      expect(bindings.pendingConnectionId).toBe(null);
      expect(bindings.pendingConnectionAddress).toBe(null);
      expect(bindings.pendingConnectionToken).toBe(null);
      expect(bindings.cancelledConnectionId).toBe(null);

      for (const entry of [pending, queued]) {
        await expect(entry.deferred.promise).rejects.toBeInstanceOf(AdapterStateError);
        await expect(entry.deferred.promise).rejects.toMatchObject({
          message: `Cannot connect while adapter state is ${state} (not poweredOn)`,
          state
        });
      }
    });

    it('rejects pending and queued connect() promises when the adapter powers off', async () => {
      bindings.onStateChange('poweredOn');
      const first = bindings.connect('112233445566');
      const second = bindings.connect('998877665544');

      bindings.onStateChange('poweredOff');

      await expect(first).rejects.toBeInstanceOf(AdapterStateError);
      await expect(second).rejects.toBeInstanceOf(AdapterStateError);
    });

    it('does not tear anything down between two states that are both not poweredOn', () => {
      bindings.state = 'poweredOff';
      const entry = queueEntry('queued', 'aa');
      bindings.connectionQueue = [entry];

      bindings.onStateChange('unknown');

      expect(bindings.connectionQueue).toEqual([entry]);
    });

    it('sets the unavailable state before notifying listeners, so a synchronous retry cannot write', async () => {
      bindings.state = 'poweredOn';
      let retry: Promise<void> | undefined;
      delegate.onStateChange.mockImplementation(() => {
        retry = bindings.connect('112233445566');
      });

      bindings.onStateChange('poweredOff');

      expect(hci.createLeConn).not.toHaveBeenCalled();
      expect(bindings.connectionQueue).toHaveLength(0);
      await expect(retry).rejects.toBeInstanceOf(AdapterStateError);
    });
  });

  describe('adapter power cycle while scanning (issue #143)', () => {
    /** A scan that the controller confirmed. */
    const liveScan = async () => {
      const started = bindings.startScanning(['uuid'], false);
      bindings.onScanStart(true);
      await started;
      gap.startScanning.mockClear();
      delegate.onScanStart.mockClear();
    };

    beforeEach(() => {
      bindings.onStateChange('poweredOn');
      delegate.onStateChange.mockClear();
    });

    it('resets the scan state of the bindings and the gap when the adapter leaves poweredOn', async () => {
      await liveScan();

      bindings.onStateChange('poweredOff');

      expect(bindings.isScanning).toBe(false);
      expect(bindings.isScanningStarted).toBe(false);
      expect(gap.reset).toHaveBeenCalledTimes(1);
    });

    it('reports the scan stop before the state change', async () => {
      await liveScan();
      const order: string[] = [];
      delegate.onScanStop.mockImplementation(() => order.push('scanStop'));
      delegate.onStateChange.mockImplementation((state: string) => order.push(state));

      bindings.onStateChange('poweredOff');

      expect(order).toEqual(['scanStop', 'poweredOff']);
    });

    it.each(['poweredOff', 'resetting', 'unauthorized', 'unsupported', 'unknown'])('also when the adapter goes to %s', async (state) => {
      await liveScan();

      bindings.onStateChange(state);

      expect(bindings.isScanning).toBe(false);
      expect(delegate.onScanStop).toHaveBeenCalledTimes(1);
    });

    it('does not report a scan stop when nothing was scanning, but still resets the gap', () => {
      bindings.onStateChange('poweredOff');

      expect(delegate.onScanStop).not.toHaveBeenCalled();
      expect(gap.reset).toHaveBeenCalledTimes(1);
      expect(delegate.onStateChange).toHaveBeenCalledWith('poweredOff');
    });

    it('rejects a start that was still in flight with AdapterStateError and reports the stop', async () => {
      const first = bindings.startScanning(['uuid'], false);
      const joined = bindings.startScanning(['uuid'], false);

      bindings.onStateChange('poweredOff');

      await expect(first).rejects.toBeInstanceOf(AdapterStateError);
      await expect(joined).rejects.toMatchObject({ state: 'poweredOff' });
      expect(delegate.onScanStop).toHaveBeenCalledTimes(1);
      expect(bindings.isScanningStarted).toBe(false);
      expect(bindings.scanStartWaiters).toEqual([]);
    });

    it('resolves a stop that was still in flight: scanning has in fact stopped', async () => {
      await liveScan();
      const stopping = bindings.stopScanning();
      expect(await stateOf(stopping)).toBe('pending');

      bindings.onStateChange('poweredOff');

      await expect(stopping).resolves.toBeUndefined();
      expect(delegate.onScanStop).toHaveBeenCalledTimes(1);
      expect(bindings.scanStopWaiters).toEqual([]);
    });

    it('rejects a pending setScanParameters with AdapterStateError', async () => {
      const promise = bindings.setScanParameters(1, 2);

      bindings.onStateChange('poweredOff');

      await expect(promise).rejects.toBeInstanceOf(AdapterStateError);
    });

    it('does not start connecting from the scan reset', async () => {
      await liveScan();
      const connecting = bindings.connect('112233445566', { addressType: 'public' });
      // the connect is parked behind the scan stop
      expect(gap.stopScanning).toHaveBeenCalledTimes(1);

      bindings.onStateChange('poweredOff');

      await expect(connecting).rejects.toBeInstanceOf(AdapterStateError);
      expect(hci.createLeConn).not.toHaveBeenCalled();
    });

    it('poweredOn -> poweredOff -> poweredOn: startScanning drives the controller again', async () => {
      await liveScan();

      bindings.onStateChange('poweredOff');
      bindings.onStateChange('poweredOn');

      const restarted = bindings.startScanning(['other'], true);

      // not short-circuited on a stale flag: no scanStart of our own making, a real start
      expect(delegate.onScanStart).not.toHaveBeenCalled();
      expect(gap.startScanning).toHaveBeenCalledTimes(1);
      expect(gap.startScanning).toHaveBeenCalledWith(true);
      expect(bindings.scanServiceUuids).toEqual(['other']);
      expect(await stateOf(restarted)).toBe('pending');

      bindings.onScanStart(false);

      await expect(restarted).resolves.toBeUndefined();
      expect(bindings.isScanning).toBe(true);
      expect(delegate.onScanStart).toHaveBeenCalledTimes(1);
    });

    it('poweredOn -> poweredOff -> poweredOn with a start in flight: the next start is not joined to the dead one', async () => {
      const dead = bindings.startScanning(['uuid'], false);
      bindings.onStateChange('poweredOff');
      await expect(dead).rejects.toBeInstanceOf(AdapterStateError);
      gap.startScanning.mockClear();

      bindings.onStateChange('poweredOn');
      const restarted = bindings.startScanning(['uuid'], false);

      expect(gap.startScanning).toHaveBeenCalledTimes(1);
      bindings.onScanStart(true);
      await expect(restarted).resolves.toBeUndefined();
    });

    it('poweredOn -> poweredOff -> poweredOn: a connect does not wait for a scan stop that cannot come', async () => {
      await liveScan();

      bindings.onStateChange('poweredOff');
      bindings.onStateChange('poweredOn');
      gap.stopScanning.mockClear();

      bindings.connect('112233445566', { addressType: 'public' });

      expect(gap.stopScanning).not.toHaveBeenCalled();
      expect(hci.createLeConn).toHaveBeenCalledTimes(1);
      expect(hci.createLeConn).toHaveBeenCalledWith('11:22:33:44:55:66', 'public', { addressType: 'public' }, true, expect.anything());
    });

    it('a second power cycle without a scan in between reports no further scan stop', async () => {
      await liveScan();

      bindings.onStateChange('poweredOff');
      bindings.onStateChange('poweredOn');
      bindings.onStateChange('poweredOff');

      expect(delegate.onScanStop).toHaveBeenCalledTimes(1);
    });
  });

  it('onAddressChange', () => {
    bindings.onAddressChange('newAddress');

    expect(delegate.onAddressChange).toHaveBeenCalledTimes(1);
    expect(delegate.onAddressChange).toHaveBeenCalledWith('newAddress');
  });

  describe('onError', () => {
    it('reports the message of an error as a warning', () => {
      bindings.onError(new Error('socket trouble'));

      expect(delegate.onWarning).toHaveBeenCalledTimes(1);
      expect(delegate.onWarning).toHaveBeenCalledWith('socket trouble');
    });

    it('reports anything else as a string', () => {
      bindings.onError('plain');

      expect(delegate.onWarning).toHaveBeenCalledWith('plain');
    });
  });

  describe('onScanStart', () => {
    it('reports to the delegate', () => {
      bindings.onScanStart('filterDuplicates');

      expect(delegate.onScanStart).toHaveBeenCalledTimes(1);
      expect(delegate.onScanStart).toHaveBeenCalledWith('filterDuplicates');
    });

    it('does not count as our scan when somebody else started it', () => {
      bindings.onScanStart(true);

      expect(bindings.isScanning).toBe(false);
    });
  });

  it('onScanStop', () => {
    bindings.isScanning = true;
    bindings.isScanningStarted = true;

    bindings.onScanStop();

    expect(bindings.isScanning).toBe(false);
    expect(bindings.isScanningStarted).toBe(false);
    expect(delegate.onScanStop).toHaveBeenCalledTimes(1);
  });

  describe('onDiscover', () => {
    const status = 0;
    const address = 'address:as:mac';
    const addressType = 'addressType';
    const connectable = 'connectable';
    const scannable = 'scannable';
    const rssi = 'rssi';
    const uuid = 'addressasmac';

    const discover = (advertisement: any) => {
      bindings.onDiscover({ status, address, addressType, connectable, scannable, advertisement, rssi });
    };

    const expectReported = (advertisement: any) => {
      expect([...bindings.addresses]).toEqual([[uuid, address]]);
      expect([...bindings.addressTypes]).toEqual([[uuid, addressType]]);
      expect([...bindings.connectable]).toEqual([[uuid, connectable]]);
      expect([...bindings.scannable]).toEqual([[uuid, scannable]]);

      expect(delegate.onDiscover).toHaveBeenCalledTimes(1);
      expect(delegate.onDiscover).toHaveBeenCalledWith({ id: uuid, address, addressType, connectable, scannable, advertisement, rssi });
    };

    const expectIgnored = () => {
      expect(bindings.addresses.size).toBe(0);
      expect(bindings.addressTypes.size).toBe(0);
      expect(bindings.connectable.size).toBe(0);
      expect(bindings.scannable.size).toBe(0);

      expect(delegate.onDiscover).not.toHaveBeenCalled();
    };

    it('new device, no scanServiceUuids', () => {
      bindings.scanServiceUuids = [];
      const advertisement = 'advertisement';

      discover(advertisement);

      expectReported(advertisement);
    });

    it('new device, with matching scanServiceUuids', () => {
      bindings.scanServiceUuids = ['service-uuid'];
      const advertisement = { serviceUuids: ['service-uuid'] };

      discover(advertisement);

      expectReported(advertisement);
    });

    it('new device, with non-matching scanServiceUuids', () => {
      bindings.scanServiceUuids = ['service-uuid'];

      discover({ serviceUuids: ['another-service-uuid'] });

      expectIgnored();
    });

    it('new device, with service data on advertisement', () => {
      bindings.scanServiceUuids = ['service-uuid'];
      const advertisement = { serviceData: [{ uuid: 'service-uuid' }] };

      discover(advertisement);

      expectReported(advertisement);
    });

    it('new device, non matching service data on advertisement', () => {
      bindings.scanServiceUuids = ['service-uuid'];

      discover({ serviceData: [{ uuid: 'another-service-uuid' }] });

      expectIgnored();
    });

    it('new device, no services on advertisement', () => {
      bindings.scanServiceUuids = ['service-uuid'];

      discover({});

      expectIgnored();
    });

    it('matching service data does not leak into the advertised service uuids', () => {
      bindings.scanServiceUuids = ['service-uuid'];
      const advertisement = { serviceUuids: ['other'], serviceData: [{ uuid: 'service-uuid' }] };

      discover(advertisement);

      expect(advertisement.serviceUuids).toEqual(['other']);
      expect(delegate.onDiscover).toHaveBeenCalledTimes(1);
    });
  });

  describe('onLeConnComplete', () => {
    beforeEach(() => {
      bindings.state = 'poweredOn';
    });

    it('not on master node', () => {
      bindings.onLeConnComplete({ status: 1, handle: 64, role: 1, addressType: 'addressType', address: 'address' });

      expect(delegate.onConnect).not.toHaveBeenCalled();
      expect(AclStream.instances).toHaveLength(0);
    });

    it('with right status on master node', async () => {
      const status = 0;
      const handle = 64;
      const role = 0;
      const addressType = 'addressType';
      const address = 'address:split:by:separator';

      bindings.onLeConnComplete({ status, handle, role, addressType, address });

      expect(AclStream.instances).toHaveLength(1);
      expect(Gatt.instances).toHaveLength(1);
      expect(Signaling.instances).toHaveLength(1);

      const [aclStream] = AclStream.instances;
      const [gatt] = Gatt.instances;
      const [signaling] = Signaling.instances;

      expect(aclStream.args).toEqual([hci, handle, hci.addressType, hci.address, addressType, address]);
      expect(gatt.args).toEqual([address, aclStream, { onNotification: expect.any(Function), onHandleNotify: expect.any(Function) }, undefined]);
      expect(signaling.args).toEqual([handle, aclStream, false, expect.any(Function)]);

      expect(gatt.exchangeMtu).toHaveBeenCalledTimes(1);

      expect(bindings.connections.get(handle)).toEqual({
        handle,
        peripheralId: 'addresssplitbyseparator',
        aclStream,
        gatt,
        signaling,
        rssiReads: []
      });
      expect(bindings.handles.get('addresssplitbyseparator')).toBe(handle);

      // nobody asked for this link: it is adopted and reported
      expect(delegate.onConnect).toHaveBeenCalledTimes(1);
      expect(delegate.onConnect).toHaveBeenCalledWith('addresssplitbyseparator');
      expect(bindings.pendingConnectionId).toBe(null);
    });

    it('simulates a discovery for an address that was never discovered', () => {
      bindings.scanServiceUuids = ['some-filter'];

      bindings.onLeConnComplete({ status: 0, handle: 64, role: 0, addressType: 'public', address: '11:22:33:44:55:66' });

      expect(delegate.onDiscover).toHaveBeenCalledTimes(1);
      expect(delegate.onDiscover).toHaveBeenCalledWith({
        id: '112233445566',
        address: '11:22:33:44:55:66',
        addressType: 'public',
        connectable: true,
        scannable: false,
        advertisement: { serviceUuids: [], serviceData: [] },
        rssi: 127
      });
      expect(bindings.scanServiceUuids).toEqual([]);
      expect(bindings.addresses.get('112233445566')).toBe('11:22:33:44:55:66');
      expect(bindings.addressTypes.get('112233445566')).toBe('public');

      // the discovery precedes the connect report
      expect(delegate.onDiscover.mock.invocationCallOrder[0])
        .toBeLessThan(delegate.onConnect.mock.invocationCallOrder[0]);
    });

    it('does not simulate a discovery for a known address', () => {
      bindings.addresses.set('112233445566', '11:22:33:44:55:66');
      bindings.scanServiceUuids = ['some-filter'];

      bindings.onLeConnComplete({ status: 0, handle: 64, role: 0, addressType: 'public', address: '11:22:33:44:55:66' });

      expect(delegate.onDiscover).not.toHaveBeenCalled();
      expect(bindings.scanServiceUuids).toEqual(['some-filter']);
    });

    it('accepts a completion without a role', () => {
      bindings.onLeConnComplete({ status: 0, handle: 64, addressType: 'public', address: '11:22:33:44:55:66' });

      expect(delegate.onConnect).toHaveBeenCalledWith('112233445566');
    });

    it('threads the hci userChannel flag into Signaling', () => {
      hci.isUserChannel.mockReturnValue(true);

      bindings.onLeConnComplete({ status: 0, handle: 64, role: 0, addressType: 'addressType', address: 'address:split:by:separator' });

      expect(Signaling.instances[0].args).toEqual([64, AclStream.instances[0], true, expect.any(Function)]);
    });

    it('with invalid status on master node', async () => {
      const address = 'address:split:by:separator';
      const entry = queueEntry('pending_uuid', address);
      bindings.connectionQueue.push(entry);
      bindings.pendingConnectionId = 'pending_uuid';
      bindings.pendingConnectionAddress = bindings.addressToId(address);

      bindings.onLeConnComplete({ status: 1, handle: 64, role: 0, addressType: 'addressType', address });

      expect(AclStream.instances).toHaveLength(0);
      expect(Gatt.instances).toHaveLength(0);
      expect(Signaling.instances).toHaveLength(0);

      await expect(entry.deferred.promise).rejects.toBeInstanceOf(NobleError);
      await expect(entry.deferred.promise).rejects.toMatchObject({ message: 'custom mapper (0x1)' });
      expect(delegate.onConnect).not.toHaveBeenCalled();

      expect(bindings.connectionQueue).toHaveLength(0);
      expect(bindings.pendingConnectionId).toBe(null);
    });

    it('with unmapped status on master node', async () => {
      const address = 'address:split:by:separator';
      const entry = queueEntry('pending_uuid', address);
      bindings.connectionQueue.push(entry);
      bindings.pendingConnectionId = 'pending_uuid';
      bindings.pendingConnectionAddress = bindings.addressToId(address);

      bindings.onLeConnComplete({ status: 2, handle: 64, role: 0, addressType: 'addressType', address });

      expect(AclStream.instances).toHaveLength(0);
      expect(Gatt.instances).toHaveLength(0);
      expect(Signaling.instances).toHaveLength(0);

      await expect(entry.deferred.promise).rejects.toMatchObject({ message: 'HCI Error: Unknown (0x2)' });

      expect(bindings.connectionQueue).toHaveLength(0);
    });

    it('formats the status of a failed attempt in hex', async () => {
      const promise = bindings.connect('112233445566');

      bindings.onLeConnComplete({ status: 0x3e, role: 0, addressType: 'random', address: '11:22:33:44:55:66' });

      await expect(promise).rejects.toMatchObject({ message: 'HCI Error: Unknown (0x3e)' });
    });

    // Characterization test: this also passes unmodified against main.
    it('reads the mtu from the queue head params before shifting it off', async () => {
      const address = 'address:split:by:separator';
      const entry = queueEntry('pending_uuid', address, { mtu: 100 });
      bindings.connectionQueue.push(entry);
      bindings.pendingConnectionId = 'pending_uuid';
      bindings.pendingConnectionAddress = bindings.addressToId(address);

      bindings.onLeConnComplete({ status: 0, handle: 64, role: 0, addressType: 'random', address });

      expect(Gatt.instances[0].args).toEqual([address, expect.anything(), expect.anything(), 100]);
      expect(bindings.connectionQueue).toHaveLength(0);
      await expect(entry.deferred.promise).resolves.toBeUndefined();
    });

    it('does not consume the in-flight attempt when a foreign connection completes', async () => {
      bindings.addresses.set('pending_uuid', '11:22:33:44:55:66');
      bindings.addressTypes.set('pending_uuid', 'random');

      const promise = bindings.connect('pending_uuid', { mtu: 100 });

      bindings.onLeConnComplete({ status: 0, handle: 64, role: 0, addressType: 'random', address: 'aa:bb:cc:dd:ee:ff' });

      expect(bindings.connectionQueue).toHaveLength(1);
      expect(bindings.pendingConnectionId).toBe('pending_uuid');
      expect(bindings.pendingConnectionAddress).toBe('112233445566');
      expect(hci.createLeConn).toHaveBeenCalledTimes(1);
      expect(Gatt.instances[0].args).toEqual(['aa:bb:cc:dd:ee:ff', expect.anything(), expect.anything(), undefined]);
      expect(delegate.onConnect).toHaveBeenCalledWith('aabbccddeeff');
      expect(await stateOf(promise)).toBe('pending');
    });

    it('does not consume a queued entry when no connection attempt is in flight', async () => {
      const entry = queueEntry('pending_uuid', '11:22:33:44:55:66', { mtu: 100 });
      bindings.connectionQueue.push(entry);

      bindings.onLeConnComplete({ status: 0, handle: 64, role: 0, addressType: 'random', address: '11:22:33:44:55:66' });

      expect(bindings.connectionQueue).toHaveLength(1);
      expect(bindings.pendingConnectionId).toBe(null);
      expect(bindings.pendingConnectionAddress).toBe(null);
      expect(Gatt.instances[0].args).toEqual(['11:22:33:44:55:66', expect.anything(), expect.anything(), undefined]);
      expect(delegate.onConnect).toHaveBeenCalledWith('112233445566');
      expect(await stateOf(entry.deferred.promise)).toBe('pending');
    });

    it('matches an enhanced completion by its peer resolvable private address', async () => {
      bindings.addresses.set('pending_uuid', 'aa:bb:cc:dd:ee:ff');
      bindings.addressTypes.set('pending_uuid', 'random');

      const promise = bindings.connect('pending_uuid', { mtu: 100 });

      bindings.onLeConnComplete({
        status: 0,
        handle: 64,
        role: 0,
        addressType: 'random',
        address: '11:22:33:44:55:66',
        peerResolvablePrivateAddress: 'aa:bb:cc:dd:ee:ff'
      });

      expect(bindings.connectionQueue).toHaveLength(0);
      expect(bindings.pendingConnectionId).toBe(null);
      expect(bindings.pendingConnectionAddress).toBe(null);
      expect(Gatt.instances[0].args).toEqual(['11:22:33:44:55:66', expect.anything(), expect.anything(), 100]);
      await expect(promise).resolves.toBeUndefined();
      expect(delegate.onConnect).not.toHaveBeenCalled();

      // the link belongs to the id connect() was called with
      expect(bindings.handles.get('pending_uuid')).toBe(64);
      await expect(bindings.readHandle('pending_uuid', 3)).resolves.toBe('readHandle result');
    });

    it('matches a completion by its attempt token even when the address differs', async () => {
      const promise = bindings.connect('112233445566');
      const attemptToken = hci.createLeConn.mock.calls[0][4];

      expect(attemptToken).toBe(bindings.pendingConnectionToken);

      bindings.onLeConnComplete({ status: 0x02, role: 0, attemptToken });

      await expect(promise).rejects.toMatchObject({ message: 'HCI Error: Unknown (0x2)' });
      expect(bindings.connectionQueue).toHaveLength(0);
    });

    it('does not fail the in-flight attempt for an unrelated failed completion', async () => {
      bindings.addresses.set('pending_uuid', '11:22:33:44:55:66');
      bindings.addressTypes.set('pending_uuid', 'random');

      const promise = bindings.connect('pending_uuid');

      bindings.onLeConnComplete({ status: 0x02, handle: undefined, role: 0, addressType: 'random', address: 'aa:bb:cc:dd:ee:ff' });

      expect(bindings.connectionQueue).toHaveLength(1);
      expect(bindings.pendingConnectionId).toBe('pending_uuid');
      expect(bindings.pendingConnectionAddress).toBe('112233445566');
      expect(delegate.onConnect).not.toHaveBeenCalled();
      expect(await stateOf(promise)).toBe('pending');
    });

    it('with connection queue', async () => {
      bindings.addresses.set('queuedId_1', '112233445566').set('queuedId_2', '998877665544');
      bindings.addressTypes.set('queuedId_1', 'random').set('queuedId_2', 'public');

      const first = bindings.connect('queuedId_1', { addressType: 'random' });
      const second = bindings.connect('queuedId_2', { addressType: 'public' });

      bindings.onLeConnComplete({ status: 0, handle: 1, role: 0, addressType: 'random', address: '11:22:33:44:55:66' });

      await expect(first).resolves.toBeUndefined();
      expect(await stateOf(second)).toBe('pending');
      expect(delegate.onConnect).not.toHaveBeenCalled();

      expect(hci.createLeConn).toHaveBeenCalledTimes(2);
      expect(hci.createLeConn).toHaveBeenCalledWith('112233445566', 'random', { addressType: 'random' }, true, expect.anything());
      expect(hci.createLeConn).toHaveBeenCalledWith('998877665544', 'public', { addressType: 'public' }, false, expect.anything());

      expect(bindings.connectionQueue).toHaveLength(1);
    });

    it('with longer connection queue', async () => {
      bindings.addresses.set('queuedId_1', '112233445566').set('queuedId_2', '998877665544').set('queuedId_3', 'aabbccddeeff');
      bindings.addressTypes.set('queuedId_1', 'random').set('queuedId_2', 'public').set('queuedId_3', 'random');

      const first = bindings.connect('queuedId_1', { addressType: 'random' });
      bindings.connect('queuedId_2', { addressType: 'public' });
      bindings.connect('queuedId_3', { addressType: 'random' });

      bindings.onLeConnComplete({ status: 0, handle: 1, role: 0, addressType: 'random', address: '11:22:33:44:55:66' });

      await expect(first).resolves.toBeUndefined();

      expect(hci.createLeConn).toHaveBeenCalledTimes(2);
      expect(hci.createLeConn).toHaveBeenCalledWith('112233445566', 'random', { addressType: 'random' }, true, expect.anything());
      expect(hci.createLeConn).toHaveBeenCalledWith('998877665544', 'public', { addressType: 'public' }, false, expect.anything());

      expect(bindings.connectionQueue).toHaveLength(2);
    });

    it('with longer connection queue where 2 connections are completed', async () => {
      bindings.addresses.set('queuedId_1', '112233445566').set('queuedId_2', '998877665544').set('queuedId_3', 'aabbccddeeff');
      bindings.addressTypes.set('queuedId_1', 'random').set('queuedId_2', 'public').set('queuedId_3', 'random');

      const first = bindings.connect('queuedId_1', { addressType: 'random' });
      const second = bindings.connect('queuedId_2', { addressType: 'public' });
      const third = bindings.connect('queuedId_3', { addressType: 'random' });

      bindings.onLeConnComplete({ status: 0, handle: 1, role: 0, addressType: 'random', address: '11:22:33:44:55:66' });
      bindings.onLeConnComplete({ status: 0, handle: 2, role: 0, addressType: 'public', address: '99:88:77:66:55:44' });

      await expect(first).resolves.toBeUndefined();
      await expect(second).resolves.toBeUndefined();
      expect(await stateOf(third)).toBe('pending');

      expect(hci.createLeConn).toHaveBeenCalledTimes(3);
      expect(hci.createLeConn).toHaveBeenCalledWith('112233445566', 'random', { addressType: 'random' }, true, expect.anything());
      expect(hci.createLeConn).toHaveBeenCalledWith('998877665544', 'public', { addressType: 'public' }, false, expect.anything());
      expect(hci.createLeConn).toHaveBeenCalledWith('aabbccddeeff', 'random', { addressType: 'random' }, false, expect.anything());

      expect(bindings.connectionQueue).toHaveLength(1);
    });

    it('uses a fresh attempt token for every attempt', () => {
      bindings.connect('112233445566');
      bindings.connect('998877665544');

      bindings.onLeConnComplete({ status: 0, handle: 1, role: 0, addressType: 'random', address: '11:22:33:44:55:66' });

      const firstToken = hci.createLeConn.mock.calls[0][4];
      const secondToken = hci.createLeConn.mock.calls[1][4];
      expect(secondToken).not.toBe(firstToken);
      expect(bindings.pendingConnectionToken).toBe(secondToken);
    });
  });

  it('onLeConnUpdateComplete is a no-op', () => {
    expect(() => bindings.onLeConnUpdateComplete(0, 64, 6, 0, 100)).not.toThrow();
  });

  describe('onDisconnComplete', () => {
    it('handle not found', () => {
      bindings.onDisconnComplete(99, 0x13);

      expect(delegate.onDisconnect).not.toHaveBeenCalled();
      expect(delegate.onWarning).toHaveBeenCalledTimes(1);
      expect(delegate.onWarning).toHaveBeenCalledWith('unknown handle 99 disconnected!');
    });

    it('existing handle', () => {
      const reason = 0x13;
      const connection = link(64, '11:22:33:44:55:66');
      const another = link(65, '99:88:77:66:55:44');

      bindings.onDisconnComplete(64, reason);

      expect(delegate.onDisconnect).toHaveBeenCalledTimes(1);
      expect(delegate.onDisconnect).toHaveBeenCalledWith('112233445566', reason);

      expect(connection.aclStream.close).toHaveBeenCalledTimes(1);
      expect(connection.gatt.close).toHaveBeenCalledTimes(1);
      const error = connection.gatt.close.mock.calls[0][0];
      expect(error).toBeInstanceOf(DisconnectedError);
      expect(error.reason).toBe(reason);

      expect(bindings.handles.has('112233445566')).toBe(false);
      expect(bindings.connections.has(64)).toBe(false);

      // the other link is untouched
      expect(another.aclStream.close).not.toHaveBeenCalled();
      expect(another.gatt.close).not.toHaveBeenCalled();
      expect(bindings.handles.get('998877665544')).toBe(65);
      expect(bindings.connections.get(65)).toBe(another);
    });

    it('the peripheral is unknown to the gatt methods afterwards', async () => {
      link(64, '11:22:33:44:55:66');

      bindings.onDisconnComplete(64, 0x13);

      await expect(bindings.read('112233445566', 's', 'c')).rejects.toMatchObject({ message: 'unknown peripheral 112233445566' });
    });

    it('a stale handle does not unregister the newer link of the same peripheral', () => {
      link(64, '11:22:33:44:55:66');
      link(65, '11:22:33:44:55:66');

      bindings.onDisconnComplete(64, 0x13);

      expect(bindings.handles.get('112233445566')).toBe(65);
    });
  });

  describe('onEncryptChange', () => {
    it('missing handle', () => {
      const connection = link(64, '11:22:33:44:55:66');

      expect(() => bindings.onEncryptChange(65, 1)).not.toThrow();

      expect(connection.aclStream.pushEncrypt).not.toHaveBeenCalled();
    });

    it('existing handle', () => {
      const connection = link(64, '11:22:33:44:55:66');

      bindings.onEncryptChange(64, 1);

      expect(connection.aclStream.pushEncrypt).toHaveBeenCalledTimes(1);
      expect(connection.aclStream.pushEncrypt).toHaveBeenCalledWith(1);
    });
  });

  describe('mtu exchange', () => {
    it('reports the negotiated mtu to the delegate', async () => {
      const connection = link(64, 'this:is:an:address');

      connection.gatt.mtu.resolve(185);
      await flush();

      expect(delegate.onMtu).toHaveBeenCalledTimes(1);
      expect(delegate.onMtu).toHaveBeenCalledWith('thisisanaddress', 185);
    });

    it('swallows a failed exchange', async () => {
      const connection = link(64, 'this:is:an:address');

      connection.gatt.mtu.reject(new Error('gone'));
      await flush();

      expect(delegate.onMtu).not.toHaveBeenCalled();
      expect(delegate.onWarning).not.toHaveBeenCalled();
    });
  });

  describe('onRssiRead', () => {
    it('reports every read to the delegate, also when nobody asked', () => {
      link(64, '11:22:33:44:55:66');

      bindings.onRssiRead(64, -70);

      expect(delegate.onRssi).toHaveBeenCalledTimes(1);
      expect(delegate.onRssi).toHaveBeenCalledWith('112233445566', -70);
    });

    it('ignores an unknown handle', () => {
      expect(() => bindings.onRssiRead(64, -70)).not.toThrow();

      expect(delegate.onRssi).not.toHaveBeenCalled();
    });
  });

  describe('onAclDataPkt', () => {
    it('missing handle', () => {
      const connection = link(64, '11:22:33:44:55:66');

      expect(() => bindings.onAclDataPkt(65, 4, Buffer.from([1]))).not.toThrow();

      expect(connection.aclStream.push).not.toHaveBeenCalled();
    });

    it('existing handle', () => {
      const connection = link(64, '11:22:33:44:55:66');
      const data = Buffer.from([1, 2]);

      bindings.onAclDataPkt(64, 4, data);

      expect(connection.aclStream.push).toHaveBeenCalledTimes(1);
      expect(connection.aclStream.push).toHaveBeenCalledWith(4, data);
    });
  });

  describe('gatt commands', () => {
    const data = Buffer.from([1, 2, 3]);

    // [method, arguments after the peripheral id, arguments the gatt must receive]
    const commands: Array<[string, any[], any[]]> = [
      ['discoverServices', [['uuids']], [['uuids']]],
      ['discoverIncludedServices', ['serviceUuid', ['uuids']], ['serviceUuid', ['uuids']]],
      ['discoverCharacteristics', ['serviceUuid', ['uuids']], ['serviceUuid', ['uuids']]],
      ['read', ['serviceUuid', 'characteristicUuid'], ['serviceUuid', 'characteristicUuid']],
      ['write', ['serviceUuid', 'characteristicUuid', data, true], ['serviceUuid', 'characteristicUuid', data, true]],
      ['broadcast', ['serviceUuid', 'characteristicUuid', true], ['serviceUuid', 'characteristicUuid', true]],
      ['notify', ['serviceUuid', 'characteristicUuid', true], ['serviceUuid', 'characteristicUuid', true]],
      ['discoverDescriptors', ['serviceUuid', 'characteristicUuid'], ['serviceUuid', 'characteristicUuid']],
      ['readValue', ['serviceUuid', 'characteristicUuid', 'descriptorUuid'], ['serviceUuid', 'characteristicUuid', 'descriptorUuid']],
      ['writeValue', ['serviceUuid', 'characteristicUuid', 'descriptorUuid', data], ['serviceUuid', 'characteristicUuid', 'descriptorUuid', data]],
      ['readHandle', [0x21], [0x21]],
      ['writeHandle', [0x21, data, false], [0x21, data, false]]
    ];

    describe.each(commands)('%s', (method, args, gattArgs) => {
      it('missing gatt', async () => {
        const connection = link(64, '11:22:33:44:55:66');

        const promise = bindings[method]('uuid', ...args);

        await expect(promise).rejects.toBeInstanceOf(NobleError);
        await expect(promise).rejects.toMatchObject({ message: 'unknown peripheral uuid' });
        expect(connection.gatt[method]).not.toHaveBeenCalled();
      });

      it('existing gatt', async () => {
        const connection = link(64, '11:22:33:44:55:66');
        const another = link(65, '99:88:77:66:55:44');

        const promise = bindings[method]('112233445566', ...args);

        expect(connection.gatt[method]).toHaveBeenCalledTimes(1);
        expect(connection.gatt[method]).toHaveBeenCalledWith(...gattArgs);
        expect(another.gatt[method]).not.toHaveBeenCalled();
        await expect(promise).resolves.toBe(`${method} result`);
      });

      it('passes a rejection of the gatt through', async () => {
        const connection = link(64, '11:22:33:44:55:66');
        const error = new Error('att error');
        connection.gatt[method].mockReturnValue(Promise.reject(error));

        await expect(bindings[method]('112233445566', ...args)).rejects.toBe(error);
      });
    });

    it('discoverServices, existing gatt no uuids', () => {
      const connection = link(64, '11:22:33:44:55:66');

      bindings.discoverServices('112233445566');

      expect(connection.gatt.discoverServices).toHaveBeenCalledWith([]);
    });

    it('discoverIncludedServices, existing gatt no uuids', () => {
      const connection = link(64, '11:22:33:44:55:66');

      bindings.discoverIncludedServices('112233445566', 'serviceUuid');

      expect(connection.gatt.discoverIncludedServices).toHaveBeenCalledWith('serviceUuid', []);
    });

    it('discoverCharacteristics, existing gatt no uuids', () => {
      const connection = link(64, '11:22:33:44:55:66');

      bindings.discoverCharacteristics('112233445566', 'serviceUuid');

      expect(connection.gatt.discoverCharacteristics).toHaveBeenCalledWith('serviceUuid', []);
    });
  });

  it('onNotification', () => {
    const connection = link(64, 'this:is:an:address');
    const gattDelegate = connection.gatt.args[2];
    const data = Buffer.from([1]);

    gattDelegate.onNotification('serviceUuid', 'characteristics', data);

    expect(delegate.onNotification).toHaveBeenCalledTimes(1);
    expect(delegate.onNotification).toHaveBeenCalledWith('thisisanaddress', 'serviceUuid', 'characteristics', data);
  });

  it('onHandleNotify', () => {
    const connection = link(64, 'this:is:an:address');
    const gattDelegate = connection.gatt.args[2];
    const data = Buffer.from([1]);

    gattDelegate.onHandleNotify(0x21, data);

    expect(delegate.onHandleNotification).toHaveBeenCalledTimes(1);
    expect(delegate.onHandleNotification).toHaveBeenCalledWith('thisisanaddress', 0x21, data);
  });

  it('onConnectionParameterUpdateRequest', () => {
    const connection = link(64, '11:22:33:44:55:66');
    const onRequest = connection.signaling.args[3];

    onRequest({ handle: 64, minInterval: 6, maxInterval: 12, latency: 1, supervisionTimeout: 200 });

    expect(hci.connUpdateLe).toHaveBeenCalledTimes(1);
    expect(hci.connUpdateLe).toHaveBeenCalledWith(64, 6, 12, 1, 200);
  });
});
