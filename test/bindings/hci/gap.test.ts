import { Gap } from '../../../src/bindings/hci/gap';

const createDelegate = () => ({
  onScanParametersSet: jest.fn(),
  onScanStart: jest.fn(),
  onScanStop: jest.fn(),
  onDiscover: jest.fn()
});

describe('hci-socket gap', () => {
  it('constructor', () => {
    const hci = {};
    const delegate = createDelegate();

    const gap = new Gap(hci as any, delegate) as any;

    expect(gap.hci).toBe(hci);
    expect(gap.delegate).toBe(delegate);
    expect(gap.scanState).toBe(null);
    expect(gap.scanFilterDuplicates).toBe(null);
    expect(gap.discoveries.size).toBe(0);
  });

  it('setScanParameters', () => {
    const hci = {
      setScanParameters: jest.fn()
    };

    const interval = 'interval';
    const window = 'window';

    const delegate = createDelegate();
    const gap = new Gap(hci as any, delegate) as any;
    gap.setScanParameters(interval, window);

    expect(hci.setScanParameters).toHaveBeenCalledTimes(1);
    expect(hci.setScanParameters).toHaveBeenCalledWith(interval, window);
  });

  it('startScanning', () => {
    const hci = {
      setScanEnabled: jest.fn(),
      setScanParameters: jest.fn()
    };

    const delegate = createDelegate();
    const gap = new Gap(hci as any, delegate) as any;
    gap.startScanning(true);

    expect(gap.scanState).toBe('starting');
    expect(gap.scanFilterDuplicates).toBe(false);

    expect(hci.setScanEnabled).toHaveBeenCalledTimes(2);
    expect(hci.setScanEnabled).toHaveBeenCalledWith(false, true);
    expect(hci.setScanEnabled).toHaveBeenCalledWith(true, false);
    expect(hci.setScanParameters).toHaveBeenCalledTimes(1);
    expect(hci.setScanParameters).toHaveBeenCalledWith();
  });

  it('stopScanning', () => {
    const hci = {
      setScanEnabled: jest.fn()
    };

    const delegate = createDelegate();
    const gap = new Gap(hci as any, delegate) as any;
    gap.stopScanning();

    expect(gap.scanState).toBe('stopping');

    expect(hci.setScanEnabled).toHaveBeenCalledTimes(1);
    expect(hci.setScanEnabled).toHaveBeenCalledWith(false, true);
  });

  describe('reset', () => {
    const report = (address: string) => ({
      status: 0,
      type: 0x00,
      address,
      addressType: 'public' as const,
      eir: Buffer.from([0x04, 0x09, 0x73, 0x69, 0x6d]),
      rssi: -60
    });

    it('clears the scan state and the accumulated discoveries without touching the controller', () => {
      const hci = { setScanEnabled: jest.fn(), setScanParameters: jest.fn() };
      const delegate = createDelegate();
      const gap = new Gap(hci as any, delegate) as any;

      gap.startScanning(false);
      gap.onHciLeScanEnableSet(0);
      gap.onHciLeAdvertisingReport(report('aa:bb:cc:dd:ee:ff'));
      expect(gap.scanState).toBe('started');
      expect(gap.discoveries.size).toBe(1);
      hci.setScanEnabled.mockClear();
      hci.setScanParameters.mockClear();
      delegate.onScanStart.mockClear();

      gap.reset();

      expect(gap.scanState).toBe(null);
      expect(gap.scanFilterDuplicates).toBe(null);
      expect(gap.discoveries.size).toBe(0);
      expect(hci.setScanEnabled).not.toHaveBeenCalled();
      expect(hci.setScanParameters).not.toHaveBeenCalled();
      expect(delegate.onScanStop).not.toHaveBeenCalled();
      expect(delegate.onScanStart).not.toHaveBeenCalled();
    });

    it.each(['starting', 'started', 'stopping', 'stopped'])('a late completion after a reset from %s reports nothing', (state) => {
      const hci = { setScanEnabled: jest.fn(), setScanParameters: jest.fn() };
      const delegate = createDelegate();
      const gap = new Gap(hci as any, delegate) as any;
      gap.scanState = state;

      gap.reset();
      gap.onHciLeScanEnableSet(0);
      gap.onLeScanEnableSetCmd(false, true);

      expect(gap.scanState).toBe(null);
      expect(delegate.onScanStart).not.toHaveBeenCalled();
      expect(delegate.onScanStop).not.toHaveBeenCalled();
    });

    it('a discovery after a reset starts from scratch', () => {
      const hci = { setScanEnabled: jest.fn(), setScanParameters: jest.fn() };
      const delegate = createDelegate();
      const gap = new Gap(hci as any, delegate) as any;

      gap.onHciLeAdvertisingReport(report('aa:bb:cc:dd:ee:ff'));
      gap.reset();
      gap.onHciLeAdvertisingReport(report('aa:bb:cc:dd:ee:ff'));

      // a first connectable advertisement is held back, as on a fresh instance
      expect(delegate.onDiscover).not.toHaveBeenCalled();
      expect(gap.discoveries.get('aa:bb:cc:dd:ee:ff').count).toBe(1);
    });

    it('poweredOn -> poweredOff -> poweredOn: scanning starts and reports again after a reset', () => {
      const hci = { setScanEnabled: jest.fn(), setScanParameters: jest.fn() };
      const delegate = createDelegate();
      const gap = new Gap(hci as any, delegate) as any;

      gap.startScanning(false);
      gap.onHciLeScanEnableSet(0);
      expect(delegate.onScanStart).toHaveBeenCalledTimes(1);

      // the adapter goes down: no completion ever arrives for the scan
      gap.reset();
      hci.setScanEnabled.mockClear();

      gap.startScanning(true);
      expect(hci.setScanEnabled).toHaveBeenLastCalledWith(true, false);
      gap.onHciLeScanEnableSet(0);

      expect(gap.scanState).toBe('started');
      expect(delegate.onScanStart).toHaveBeenCalledTimes(2);
      expect(delegate.onScanStart).toHaveBeenLastCalledWith(false);
      expect(delegate.onScanStop).not.toHaveBeenCalled();
    });
  });

  it('onHciLeScanParametersSet', () => {
    const hci = {};
    const delegate = createDelegate();
    const gap = new Gap(hci as any, delegate) as any;
    gap.onHciLeScanParametersSet();

    expect(delegate.onScanParametersSet).toHaveBeenCalledTimes(1);
    expect(delegate.onScanParametersSet).toHaveBeenCalledWith();
  });

  describe('onHciLeScanEnableSet', () => {
    it('status 1', () => {
      const hci = {};
      const delegate = createDelegate();
      const gap = new Gap(hci as any, delegate) as any;
      gap.onHciLeScanEnableSet(1);

      expect(delegate.onScanStart).not.toHaveBeenCalled();
      expect(delegate.onScanStop).not.toHaveBeenCalled();
    });

    it('status 0 but invalid state', () => {
      const hci = {};
      const delegate = createDelegate();
      const gap = new Gap(hci as any, delegate) as any;
      gap.scanState = 'unknown';
      gap.onHciLeScanEnableSet(0);

      expect(gap.scanState).toBe('unknown');

      expect(delegate.onScanStart).not.toHaveBeenCalled();
      expect(delegate.onScanStop).not.toHaveBeenCalled();
    });

    it('status 0 state starting', () => {
      const hci = {};
      const delegate = createDelegate();
      const gap = new Gap(hci as any, delegate) as any;
      gap.scanFilterDuplicates = true;
      gap.scanState = 'starting';
      gap.onHciLeScanEnableSet(0);

      expect(gap.scanState).toBe('started');

      expect(delegate.onScanStart).toHaveBeenCalledTimes(1);
      expect(delegate.onScanStart).toHaveBeenCalledWith(true);
      expect(delegate.onScanStop).not.toHaveBeenCalled();
    });

    it('status 0 state stopping', () => {
      const hci = {};
      const delegate = createDelegate();
      const gap = new Gap(hci as any, delegate) as any;
      gap.scanState = 'stopping';
      gap.onHciLeScanEnableSet(0);

      expect(gap.scanState).toBe('stopped');

      expect(delegate.onScanStart).not.toHaveBeenCalled();
      expect(delegate.onScanStop).toHaveBeenCalledTimes(1);
      expect(delegate.onScanStop).toHaveBeenCalledWith();
    });
  });

  describe('onLeScanEnableSetCmd', () => {
    it('invalid state', () => {
      const hci = {};
      const enable = false;
      const filterDuplicates = false;

      const delegate = createDelegate();
      const gap = new Gap(hci as any, delegate) as any;
      gap.scanState = 'unknown';
      gap.onLeScanEnableSetCmd(enable, filterDuplicates);

      expect(gap.scanState).toBe('unknown');
      expect(gap.scanFilterDuplicates).toBe(null);

      expect(delegate.onScanStart).not.toHaveBeenCalled();
      expect(delegate.onScanStop).not.toHaveBeenCalled();
    });

    ['starting', 'started'].forEach(state => {
      it(`state ${state}, do not enable`, () => {
        const hci = {};
        const enable = false;
        const filterDuplicates = false;

        const delegate = createDelegate();
        const gap = new Gap(hci as any, delegate) as any;
        gap.scanState = state;
        gap.onLeScanEnableSetCmd(enable, filterDuplicates);

        expect(gap.scanState).toBe(state);
        expect(gap.scanFilterDuplicates).toBe(null);

        expect(delegate.onScanStart).not.toHaveBeenCalled();
        expect(delegate.onScanStop).toHaveBeenCalledTimes(1);
        expect(delegate.onScanStop).toHaveBeenCalledWith();
      });
    });

    ['starting', 'started'].forEach(state => {
      it(`state ${state}, do enable`, () => {
        const hci = {};
        const enable = true;
        const filterDuplicates = false;

        const delegate = createDelegate();
        const gap = new Gap(hci as any, delegate) as any;
        gap.scanState = state;
        gap.onLeScanEnableSetCmd(enable, filterDuplicates);

        expect(gap.scanState).toBe(state);
        expect(gap.scanFilterDuplicates).toBe(filterDuplicates);

        expect(delegate.onScanStart).toHaveBeenCalledTimes(1);
        expect(delegate.onScanStart).toHaveBeenCalledWith(filterDuplicates);
        expect(delegate.onScanStop).not.toHaveBeenCalled();
      });
    });

    ['starting', 'started'].forEach(state => {
      it(`state ${state}, do enable, same filter`, () => {
        const hci = {};
        const enable = true;
        const filterDuplicates = false;

        const delegate = createDelegate();
        const gap = new Gap(hci as any, delegate) as any;
        gap.scanState = state;
        gap.scanFilterDuplicates = filterDuplicates;
        gap.onLeScanEnableSetCmd(enable, filterDuplicates);

        expect(gap.scanState).toBe(state);
        expect(gap.scanFilterDuplicates).toBe(filterDuplicates);

        expect(delegate.onScanStart).not.toHaveBeenCalled();
        expect(delegate.onScanStop).not.toHaveBeenCalled();
      });
    });

    ['stopping', 'stopped'].forEach(state => {
      it(`state ${state}, do not enable`, () => {
        const hci = {};
        const enable = false;
        const filterDuplicates = false;

        const delegate = createDelegate();
        const gap = new Gap(hci as any, delegate) as any;
        gap.scanState = state;
        gap.onLeScanEnableSetCmd(enable, filterDuplicates);

        expect(gap.scanState).toBe(state);
        expect(gap.scanFilterDuplicates).toBe(null);

        expect(delegate.onScanStart).not.toHaveBeenCalled();
        expect(delegate.onScanStop).not.toHaveBeenCalled();
      });
    });

    ['stopping', 'stopped'].forEach(state => {
      it(`state ${state}, do enable`, () => {
        const hci = {};
        const enable = true;
        const filterDuplicates = false;

        const delegate = createDelegate();
        const gap = new Gap(hci as any, delegate) as any;
        gap.scanState = state;
        gap.onLeScanEnableSetCmd(enable, filterDuplicates);

        expect(gap.scanState).toBe(state);
        expect(gap.scanFilterDuplicates).toBe(null);

        expect(delegate.onScanStart).toHaveBeenCalledTimes(1);
        // never scanned ourselves: the observed filter setting is reported
        expect(delegate.onScanStart).toHaveBeenCalledWith(filterDuplicates);
        expect(delegate.onScanStop).not.toHaveBeenCalled();
      });
    });
  });

  describe('onHciLeAdvertisingReport', () => {
    it('type === 0x04 / no eir', () => {
      const hci = {};

      const status = 'status';
      const type = 0x04;
      const address = 'a:d:d:r:e:s:s';
      const addressType = 'addressType';
      const eir = Buffer.alloc(0);
      const rssi = 'rssi';
      const delegate = createDelegate();
      const gap = new Gap(hci as any, delegate) as any;
      gap.onHciLeAdvertisingReport({ status, type, address, addressType, eir, rssi });

      const expectedDiscovery = {
        address,
        addressType,
        connectable: true,
        advertisement: {
          localName: undefined,
          txPowerLevel: undefined,
          manufacturerData: undefined,
          serviceData: [],
          serviceUuids: [],
          serviceSolicitationUuids: []
        },
        rssi,
        count: 1,
        hasScanResponse: true
      };
      expect(gap.discoveries.get(address)).toStrictEqual(expectedDiscovery);

      expect(delegate.onDiscover).toHaveBeenCalledTimes(1);
      expect(delegate.onDiscover).toHaveBeenCalledWith({ status, address, addressType, connectable: expectedDiscovery.connectable, scannable: false, advertisement: expectedDiscovery.advertisement, rssi });
    });

    it('type === 0x04 / no eir / previously discovered', () => {
      const hci = {};

      const status = 'status';
      const type = 0x04;
      const address = 'a:d:d:r:e:s:s';
      const addressType = 'addressType';
      const eir = Buffer.alloc(0);
      const rssi = 'rssi';
      const advertisement = {
        localName: 'localName',
        txPowerLevel: 'txPowerLevel',
        manufacturerData: 'manufacturerData',
        serviceData: ['data'],
        serviceUuids: ['uuids'],
        serviceSolicitationUuids: []
      };
      const count = 8;
      const hasScanResponse = true;
      const connectable = false;

      const delegate = createDelegate();
      const gap = new Gap(hci as any, delegate) as any;
      gap.discoveries.set(address, { advertisement, count, hasScanResponse, connectable });
      gap.onHciLeAdvertisingReport({ status, type, address, addressType, eir, rssi });

      const expectedDiscovery = {
        address,
        addressType,
        connectable,
        advertisement,
        rssi,
        count: count + 1,
        hasScanResponse
      };
      expect(gap.discoveries.get(address)).toStrictEqual(expectedDiscovery);

      expect(delegate.onDiscover).toHaveBeenCalledTimes(1);
      expect(delegate.onDiscover).toHaveBeenCalledWith({ status, address, addressType, connectable: expectedDiscovery.connectable, scannable: false, advertisement: expectedDiscovery.advertisement, rssi });
    });

    it('type === 0x06 / scannable', () => {
      const hci = {};

      const status = 'status';
      const type = 0x06;
      const address = 'a:d:d:r:e:s:s';
      const addressType = 'addressType';
      const eir = Buffer.alloc(0);
      const rssi = 'rssi';
      const advertisement = {
        localName: 'localName',
        txPowerLevel: 'txPowerLevel',
        manufacturerData: 'manufacturerData',
        serviceData: ['data'],
        serviceUuids: ['uuids'],
        solicitationServiceUuids: ['solicitation']
      };
      const count = 8;
      const hasScanResponse = false;
      const connectable = false;

      const delegate = createDelegate();
      const gap = new Gap(hci as any, delegate) as any;
      gap.discoveries.set(address, { advertisement, count, hasScanResponse, connectable });
      gap.onHciLeAdvertisingReport({ status, type, address, addressType, eir, rssi });

      const expectedDiscovery = {
        address,
        addressType,
        connectable: true,
        advertisement,
        rssi,
        count: count + 1,
        hasScanResponse
      };
      expect(gap.discoveries.get(address)).toStrictEqual(expectedDiscovery);

      expect(delegate.onDiscover).toHaveBeenCalledTimes(1);
      expect(delegate.onDiscover).toHaveBeenCalledWith({ status, address, addressType, connectable: expectedDiscovery.connectable, scannable: true, advertisement: expectedDiscovery.advertisement, rssi });
    });

    it('type !== 0x04 / no eir', () => {
      const hci = {};

      const status = 'status';
      const type = 0x01;
      const address = 'a:d:d:r:e:s:s';
      const addressType = 'addressType';
      const eir = Buffer.alloc(0);
      const rssi = 'rssi';
      const delegate = createDelegate();
      const gap = new Gap(hci as any, delegate) as any;
      gap.onHciLeAdvertisingReport({ status, type, address, addressType, eir, rssi });

      const expectedDiscovery = {
        address,
        addressType,
        connectable: true,
        advertisement: {
          localName: undefined,
          txPowerLevel: undefined,
          manufacturerData: undefined,
          serviceData: [],
          serviceUuids: [],
          serviceSolicitationUuids: []
        },
        rssi,
        count: 1,
        hasScanResponse: false
      };
      expect(gap.discoveries.get(address)).toStrictEqual(expectedDiscovery);

      expect(delegate.onDiscover).not.toHaveBeenCalled();
    });

    it('invalid EIR data, length === 0', () => {
      const hci = {};

      const status = 'status';
      const type = 0x01;
      const address = 'a:d:d:r:e:s:s';
      const addressType = 'addressType';
      const eir = Buffer.from([0x00, 0x00]);
      const rssi = 'rssi';
      const delegate = createDelegate();
      const gap = new Gap(hci as any, delegate) as any;
      gap.onHciLeAdvertisingReport({ status, type, address, addressType, eir, rssi });

      const expectedDiscovery = {
        address,
        addressType,
        connectable: true,
        advertisement: {
          localName: undefined,
          txPowerLevel: undefined,
          manufacturerData: undefined,
          serviceData: [],
          serviceUuids: [],
          serviceSolicitationUuids: []
        },
        rssi,
        count: 1,
        hasScanResponse: false
      };
      expect(gap.discoveries.get(address)).toStrictEqual(expectedDiscovery);

      expect(delegate.onDiscover).not.toHaveBeenCalled();
    });

    it('invalid EIR data, out of range of buffer length', () => {
      const hci = {};

      const status = 'status';
      const type = 0x01;
      const address = 'a:d:d:r:e:s:s';
      const addressType = 'addressType';
      const eir = Buffer.from([0x03, 0x01, 0x02]);
      const rssi = 'rssi';
      const delegate = createDelegate();
      const gap = new Gap(hci as any, delegate) as any;
      gap.onHciLeAdvertisingReport({ status, type, address, addressType, eir, rssi });

      const expectedDiscovery = {
        address,
        addressType,
        connectable: true,
        advertisement: {
          localName: undefined,
          txPowerLevel: undefined,
          manufacturerData: undefined,
          serviceData: [],
          serviceUuids: [],
          serviceSolicitationUuids: []
        },
        rssi,
        count: 1,
        hasScanResponse: false
      };
      expect(gap.discoveries.get(address)).toStrictEqual(expectedDiscovery);

      expect(delegate.onDiscover).not.toHaveBeenCalled();
    });

    [0x02, 0x03].forEach(eirType => {
      it(`List of 16-bit Service Class UUIDs (EIR type = ${eirType})`, () => {
        const hci = {};

        const status = 'status';
        const type = 0x01;
        const address = 'a:d:d:r:e:s:s';
        const addressType = 'addressType';
        const rssi = 'rssi';

        const serviceUuid = Buffer.from([0x01, 0x02]);
        const eirLength = (serviceUuid.length * 2) + 1;
        const eirLengthAndType = Buffer.from([eirLength, eirType]);
        // Add service twice to check unicity
        const eir = Buffer.concat([eirLengthAndType, serviceUuid, serviceUuid]);
        const delegate = createDelegate();
        const gap = new Gap(hci as any, delegate) as any;
        gap.onHciLeAdvertisingReport({ status, type, address, addressType, eir, rssi });

        const expectedDiscovery = {
          address,
          addressType,
          connectable: true,
          advertisement: {
            localName: undefined,
            txPowerLevel: undefined,
            manufacturerData: undefined,
            serviceData: [],
            serviceUuids: ['201'],
            serviceSolicitationUuids: []
          },
          rssi,
          count: 1,
          hasScanResponse: false
        };
        expect(gap.discoveries.get(address)).toStrictEqual(expectedDiscovery);

        expect(delegate.onDiscover).not.toHaveBeenCalled();
      });
    });

    [0x06, 0x07].forEach(eirType => {
      it(`List of 128-bit Service Class UUIDs (EIR type = ${eirType})`, () => {
        const hci = {};

        const status = 'status';
        const type = 0x01;
        const address = 'a:d:d:r:e:s:s';
        const addressType = 'addressType';
        const rssi = 'rssi';

        const serviceUuid = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f]);
        const eirLength = (serviceUuid.length * 2) + 1;
        const eirLengthAndType = Buffer.from([eirLength, eirType]);
        // Add service twice to check unicity
        const eir = Buffer.concat([eirLengthAndType, serviceUuid, serviceUuid]);
        const delegate = createDelegate();
        const gap = new Gap(hci as any, delegate) as any;
        gap.onHciLeAdvertisingReport({ status, type, address, addressType, eir, rssi });

        const expectedDiscovery = {
          address,
          addressType,
          connectable: true,
          advertisement: {
            localName: undefined,
            txPowerLevel: undefined,
            manufacturerData: undefined,
            serviceData: [],
            serviceUuids: ['0f0e0d0c0b0a09080706050403020100'],
            serviceSolicitationUuids: []
          },
          rssi,
          count: 1,
          hasScanResponse: false
        };
        expect(gap.discoveries.get(address)).toStrictEqual(expectedDiscovery);

        expect(delegate.onDiscover).not.toHaveBeenCalled();
      });
    });

    [0x08, 0x09].forEach(eirType => {
      it(`Local name (EIR type = ${eirType})`, () => {
        const hci = {};

        const status = 'status';
        const type = 0x01;
        const address = 'a:d:d:r:e:s:s';
        const addressType = 'addressType';
        const rssi = 'rssi';

        const localNameHex = Buffer.from([0x6d, 0x79, 0x2d, 0x6e, 0x61, 0x6d, 0x65]);
        const eirLength = localNameHex.length + 1;
        const eirLengthAndType = Buffer.from([eirLength, eirType]);
        const eir = Buffer.concat([eirLengthAndType, localNameHex]);
        const delegate = createDelegate();
        const gap = new Gap(hci as any, delegate) as any;
        gap.onHciLeAdvertisingReport({ status, type, address, addressType, eir, rssi });

        const expectedDiscovery = {
          address,
          addressType,
          connectable: true,
          advertisement: {
            localName: 'my-name',
            txPowerLevel: undefined,
            manufacturerData: undefined,
            serviceData: [],
            serviceUuids: [],
            serviceSolicitationUuids: []
          },
          rssi,
          count: 1,
          hasScanResponse: false
        };
        expect(gap.discoveries.get(address)).toStrictEqual(expectedDiscovery);

        expect(delegate.onDiscover).not.toHaveBeenCalled();
      });
    });

    it('txPowerLevel (EIR type = 10)', () => {
      const hci = {};

      const status = 'status';
      const type = 0x01;
      const address = 'a:d:d:r:e:s:s';
      const addressType = 'addressType';
      const rssi = 'rssi';

      const eirType = 0x0a;
      const localNameHex = Buffer.from([0x20]);
      const eirLength = localNameHex.length + 1;
      const eirLengthAndType = Buffer.from([eirLength, eirType]);
      const eir = Buffer.concat([eirLengthAndType, localNameHex]);
      const delegate = createDelegate();
      const gap = new Gap(hci as any, delegate) as any;
      gap.onHciLeAdvertisingReport({ status, type, address, addressType, eir, rssi });

      const expectedDiscovery = {
        address,
        addressType,
        connectable: true,
        advertisement: {
          localName: undefined,
          txPowerLevel: 32,
          manufacturerData: undefined,
          serviceData: [],
          serviceUuids: [],
          serviceSolicitationUuids: []
        },
        rssi,
        count: 1,
        hasScanResponse: false
      };
      expect(gap.discoveries.get(address)).toStrictEqual(expectedDiscovery);

      expect(delegate.onDiscover).not.toHaveBeenCalled();
    });

    it('List of 16 bit solicitation UUIDs (EIR type = 20)', () => {
      const hci = {};

      const status = 'status';
      const type = 0x01;
      const address = 'a:d:d:r:e:s:s';
      const addressType = 'addressType';
      const rssi = 'rssi';

      const eirType = 0x14;
      const serviceUuid = Buffer.from([0x01, 0x02]);
      const eirLength = (serviceUuid.length * 2) + 1;
      const eirLengthAndType = Buffer.from([eirLength, eirType]);
      // Add service twice to check unicity
      const eir = Buffer.concat([eirLengthAndType, serviceUuid, serviceUuid]);
      const delegate = createDelegate();
      const gap = new Gap(hci as any, delegate) as any;
      gap.onHciLeAdvertisingReport({ status, type, address, addressType, eir, rssi });

      const expectedDiscovery = {
        address,
        addressType,
        connectable: true,
        advertisement: {
          localName: undefined,
          txPowerLevel: undefined,
          manufacturerData: undefined,
          serviceData: [],
          serviceUuids: [],
          serviceSolicitationUuids: ['201']
        },
        rssi,
        count: 1,
        hasScanResponse: false
      };
      expect(gap.discoveries.get(address)).toStrictEqual(expectedDiscovery);

      expect(delegate.onDiscover).not.toHaveBeenCalled();
    });

    it('List of 128 bit solicitation UUIDs (EIR type = 21)', () => {
      const hci = {};

      const status = 'status';
      const type = 0x01;
      const address = 'a:d:d:r:e:s:s';
      const addressType = 'addressType';
      const rssi = 'rssi';

      const eirType = 0x15;
      const serviceUuid = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f]);
      const eirLength = (serviceUuid.length * 2) + 1;
      const eirLengthAndType = Buffer.from([eirLength, eirType]);
      // Add service twice to check unicity
      const eir = Buffer.concat([eirLengthAndType, serviceUuid, serviceUuid]);
      const delegate = createDelegate();
      const gap = new Gap(hci as any, delegate) as any;
      gap.onHciLeAdvertisingReport({ status, type, address, addressType, eir, rssi });

      const expectedDiscovery = {
        address,
        addressType,
        connectable: true,
        advertisement: {
          localName: undefined,
          txPowerLevel: undefined,
          manufacturerData: undefined,
          serviceData: [],
          serviceUuids: [],
          serviceSolicitationUuids: ['0f0e0d0c0b0a09080706050403020100']
        },
        rssi,
        count: 1,
        hasScanResponse: false
      };
      expect(gap.discoveries.get(address)).toStrictEqual(expectedDiscovery);

      expect(delegate.onDiscover).not.toHaveBeenCalled();
    });

    it('16-bit Service Data (EIR type = 22)', () => {
      const hci = {};

      const status = 'status';
      const type = 0x01;
      const address = 'a:d:d:r:e:s:s';
      const addressType = 'addressType';
      const rssi = 'rssi';

      const eirType = 0x16;
      const serviceUuid = Buffer.from([0x01, 0x02]);
      const serviceData = Buffer.from([0x03, 0x04]);
      const eirLength = serviceUuid.length + serviceData.length + 1;
      const eirLengthAndType = Buffer.from([eirLength, eirType]);
      const eir = Buffer.concat([eirLengthAndType, serviceUuid, serviceData]);
      const delegate = createDelegate();
      const gap = new Gap(hci as any, delegate) as any;
      gap.onHciLeAdvertisingReport({ status, type, address, addressType, eir, rssi });

      const expectedDiscovery = {
        address,
        addressType,
        connectable: true,
        advertisement: {
          localName: undefined,
          txPowerLevel: undefined,
          manufacturerData: undefined,
          serviceData: [
            {
              uuid: '0201',
              data: serviceData
            }
          ],
          serviceUuids: [],
          serviceSolicitationUuids: []
        },
        rssi,
        count: 1,
        hasScanResponse: false
      };
      expect(gap.discoveries.get(address)).toStrictEqual(expectedDiscovery);

      expect(delegate.onDiscover).not.toHaveBeenCalled();
    });

    it('32-bit Service Data (EIR type = 32)', () => {
      const hci = {};

      const status = 'status';
      const type = 0x01;
      const address = 'a:d:d:r:e:s:s';
      const addressType = 'addressType';
      const rssi = 'rssi';

      const eirType = 0x20;
      const serviceUuid = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const serviceData = Buffer.from([0x05, 0x06]);
      const eirLength = serviceUuid.length + serviceData.length + 1;
      const eirLengthAndType = Buffer.from([eirLength, eirType]);
      const eir = Buffer.concat([eirLengthAndType, serviceUuid, serviceData]);
      const delegate = createDelegate();
      const gap = new Gap(hci as any, delegate) as any;
      gap.onHciLeAdvertisingReport({ status, type, address, addressType, eir, rssi });

      const expectedDiscovery = {
        address,
        addressType,
        connectable: true,
        advertisement: {
          localName: undefined,
          txPowerLevel: undefined,
          manufacturerData: undefined,
          serviceData: [
            {
              uuid: '04030201',
              data: serviceData
            }
          ],
          serviceUuids: [],
          serviceSolicitationUuids: []
        },
        rssi,
        count: 1,
        hasScanResponse: false
      };
      expect(gap.discoveries.get(address)).toStrictEqual(expectedDiscovery);

      expect(delegate.onDiscover).not.toHaveBeenCalled();
    });

    it('128-bit Service Data (EIR type = 33)', () => {
      const hci = {};

      const status = 'status';
      const type = 0x01;
      const address = 'a:d:d:r:e:s:s';
      const addressType = 'addressType';
      const rssi = 'rssi';

      const eirType = 0x21;
      const serviceUuid = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f]);
      const serviceData = Buffer.from([0x05, 0x06]);
      const eirLength = serviceUuid.length + serviceData.length + 1;
      const eirLengthAndType = Buffer.from([eirLength, eirType]);
      const eir = Buffer.concat([eirLengthAndType, serviceUuid, serviceData]);
      const delegate = createDelegate();
      const gap = new Gap(hci as any, delegate) as any;
      gap.onHciLeAdvertisingReport({ status, type, address, addressType, eir, rssi });

      const expectedDiscovery = {
        address,
        addressType,
        connectable: true,
        advertisement: {
          localName: undefined,
          txPowerLevel: undefined,
          manufacturerData: undefined,
          serviceData: [
            {
              uuid: '0f0e0d0c0b0a09080706050403020100',
              data: serviceData
            }
          ],
          serviceUuids: [],
          serviceSolicitationUuids: []
        },
        rssi,
        count: 1,
        hasScanResponse: false
      };
      expect(gap.discoveries.get(address)).toStrictEqual(expectedDiscovery);

      expect(delegate.onDiscover).not.toHaveBeenCalled();
    });

    it('List of 32 bit solicitation UUIDs (EIR type = 31)', () => {
      const hci = {};

      const status = 'status';
      const type = 0x01;
      const address = 'a:d:d:r:e:s:s';
      const addressType = 'addressType';
      const rssi = 'rssi';

      const eirType = 0x1f;
      const serviceUuid = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const eirLength = (serviceUuid.length * 2) + 1;
      const eirLengthAndType = Buffer.from([eirLength, eirType]);
      // Add service twice to check unicity
      const eir = Buffer.concat([eirLengthAndType, serviceUuid, serviceUuid]);
      const delegate = createDelegate();
      const gap = new Gap(hci as any, delegate) as any;
      gap.onHciLeAdvertisingReport({ status, type, address, addressType, eir, rssi });

      const expectedDiscovery = {
        address,
        addressType,
        connectable: true,
        advertisement: {
          localName: undefined,
          txPowerLevel: undefined,
          manufacturerData: undefined,
          serviceData: [],
          serviceUuids: [],
          serviceSolicitationUuids: ['4030201']
        },
        rssi,
        count: 1,
        hasScanResponse: false
      };
      expect(gap.discoveries.get(address)).toStrictEqual(expectedDiscovery);

      expect(delegate.onDiscover).not.toHaveBeenCalled();
    });

    it('Manufacturer Specific Data (EIR type = 255)', () => {
      const hci = {};

      const status = 'status';
      const type = 0x01;
      const address = 'a:d:d:r:e:s:s';
      const addressType = 'addressType';
      const rssi = 'rssi';

      const eirType = 0xff;
      const manufacturerData = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      const eirLength = manufacturerData.length + 1;
      const eirLengthAndType = Buffer.from([eirLength, eirType]);
      const eir = Buffer.concat([eirLengthAndType, manufacturerData, manufacturerData]);
      const delegate = createDelegate();
      const gap = new Gap(hci as any, delegate) as any;
      gap.onHciLeAdvertisingReport({ status, type, address, addressType, eir, rssi });

      const expectedDiscovery = {
        address,
        addressType,
        connectable: true,
        advertisement: {
          localName: undefined,
          txPowerLevel: undefined,
          manufacturerData,
          serviceData: [],
          serviceUuids: [],
          serviceSolicitationUuids: []
        },
        rssi,
        count: 1,
        hasScanResponse: false
      };
      expect(gap.discoveries.get(address)).toStrictEqual(expectedDiscovery);

      expect(delegate.onDiscover).not.toHaveBeenCalled();
    });

    it('should accumulate different service UUIDs and data across multiple reports', () => {
      const hci = {};

      const status = 'status';
      const type = 0x01;
      const address = 'a:d:d:r:e:s:s';
      const addressType = 'addressType';
      const rssi = 'rssi';

      // First report
      const eirType1 = 0x16;
      const serviceUuid1 = Buffer.from([0x01, 0x02]);
      const serviceData1 = Buffer.from([0x03, 0x04]);
      const eirLength1 = serviceUuid1.length + serviceData1.length + 1;
      const eirLengthAndType1 = Buffer.from([eirLength1, eirType1]);
      const eir1 = Buffer.concat([eirLengthAndType1, serviceUuid1, serviceData1]);

      const delegate = createDelegate();
      const gap = new Gap(hci as any, delegate) as any;
      gap.onHciLeAdvertisingReport({ status, type, address, addressType, eir: eir1, rssi });

      // Second report with different UUID and data
      const eirType2 = 0x16;
      const serviceUuid2 = Buffer.from([0x05, 0x06]);
      const serviceData2 = Buffer.from([0x07, 0x08]);
      const eirLength2 = serviceUuid2.length + serviceData2.length + 1;
      const eirLengthAndType2 = Buffer.from([eirLength2, eirType2]);
      const eir2 = Buffer.concat([eirLengthAndType2, serviceUuid2, serviceData2]);

      gap.onHciLeAdvertisingReport({ status, type, address, addressType, eir: eir2, rssi });

      const expectedDiscovery = {
        address,
        addressType,
        connectable: true,
        advertisement: {
          localName: undefined,
          txPowerLevel: undefined,
          manufacturerData: undefined,
          serviceData: [
            {
              uuid: '0201',
              data: serviceData1
            },
            {
              uuid: '0605',
              data: serviceData2
            }
          ],
          serviceUuids: [],
          serviceSolicitationUuids: []
        },
        rssi,
        count: 2,
        hasScanResponse: false
      };

      expect(gap.discoveries.get(address)).toStrictEqual(expectedDiscovery);
    });

    it('should overwrite service data when receiving same UUID with different data', () => {
      const hci = {};

      const status = 'status';
      const type = 0x01;
      const address = 'a:d:d:r:e:s:s';
      const addressType = 'addressType';
      const rssi = 'rssi';

      // First report
      const eirType = 0x16;
      const serviceUuid = Buffer.from([0x01, 0x02]);
      const serviceData1 = Buffer.from([0x03, 0x04]);
      const eirLength1 = serviceUuid.length + serviceData1.length + 1;
      const eirLengthAndType1 = Buffer.from([eirLength1, eirType]);
      const eir1 = Buffer.concat([eirLengthAndType1, serviceUuid, serviceData1]);

      const delegate = createDelegate();
      const gap = new Gap(hci as any, delegate) as any;
      gap.onHciLeAdvertisingReport({ status, type, address, addressType, eir: eir1, rssi });

      // Verify first state
      const expectedDiscovery1 = {
        address,
        addressType,
        connectable: true,
        advertisement: {
          localName: undefined,
          txPowerLevel: undefined,
          manufacturerData: undefined,
          serviceData: [
            {
              uuid: '0201',
              data: serviceData1
            }
          ],
          serviceUuids: [],
          serviceSolicitationUuids: []
        },
        rssi,
        count: 1,
        hasScanResponse: false
      };

      expect(gap.discoveries.get(address)).toStrictEqual(expectedDiscovery1);

      // Second report with same UUID but different data
      const serviceData2 = Buffer.from([0x05, 0x06]);
      const eirLength2 = serviceUuid.length + serviceData2.length + 1;
      const eirLengthAndType2 = Buffer.from([eirLength2, eirType]);
      const eir2 = Buffer.concat([eirLengthAndType2, serviceUuid, serviceData2]);

      gap.onHciLeAdvertisingReport({ status, type, address, addressType, eir: eir2, rssi });

      // Verify data was overwritten
      const expectedDiscovery2 = {
        address,
        addressType,
        connectable: true,
        advertisement: {
          localName: undefined,
          txPowerLevel: undefined,
          manufacturerData: undefined,
          serviceData: [
            {
              uuid: '0201',
              data: serviceData2
            }
          ],
          serviceUuids: [],
          serviceSolicitationUuids: []
        },
        rssi,
        count: 2,
        hasScanResponse: false
      };

      expect(gap.discoveries.get(address)).toStrictEqual(expectedDiscovery2);
    });
  });

  it('should reset the service data on non scan responses', () => {
    const hci = {};

    const status = 'status';
    const address = 'a:d:d:r:e:s:s';
    const addressType = 'addressType';
    const rssi = 'rssi';

    const eirType = 0x21;
    const serviceUuid = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f]);
    const serviceData = Buffer.from([0x05, 0x06]);
    const eirLength = serviceUuid.length + serviceData.length + 1;
    const eirLengthAndType = Buffer.from([eirLength, eirType]);
    const eir = Buffer.concat([eirLengthAndType, serviceUuid, serviceData]);
    const delegate = createDelegate();
    const gap = new Gap(hci as any, delegate) as any;
    gap.onHciLeAdvertisingReport({ status, type: 0x04, address, addressType, eir, rssi });

    const expectedServiceData = [
      {
        uuid: '0f0e0d0c0b0a09080706050403020100',
        data: serviceData
      }
    ];

    expect(gap.discoveries.get(address).advertisement.serviceData).toStrictEqual(expectedServiceData);

    gap.onHciLeAdvertisingReport({ status, type: 0x01, address, addressType, eir, rssi });

    expect(gap.discoveries.get(address).advertisement.serviceData).toStrictEqual(expectedServiceData);

    expect(delegate.onDiscover).toHaveBeenCalledTimes(1);
  });

  describe('onHciLeExtendedAdvertisingReport', () => {
    const status = 0;
    const address = 'a:d:d:r:e:s:s';
    const addressType = 'random';
    const rssi = -60;
    const txpower = 4;
    const eir = Buffer.alloc(0);
    const emptyAdvertisement = {
      localName: undefined,
      txPowerLevel: txpower,
      manufacturerData: undefined,
      serviceData: [],
      serviceUuids: [],
      serviceSolicitationUuids: []
    };

    const createGap = () => {
      const delegate = createDelegate();
      const gap = new Gap({} as any, delegate) as any;
      return { gap, delegate };
    };

    it('connectable and scannable advertisement waits for more data', () => {
      const { gap, delegate } = createGap();

      gap.onHciLeExtendedAdvertisingReport({ status, type: 0x13, address, addressType, txpower, rssi, eir });

      expect(gap.discoveries.get(address)).toStrictEqual({
        address,
        addressType,
        connectable: true,
        advertisement: emptyAdvertisement,
        rssi,
        count: 1,
        hasScanResponse: false
      });
      expect(delegate.onDiscover).not.toHaveBeenCalled();
    });

    it('reports the second advertisement without a scan response, with booleans', () => {
      const { gap, delegate } = createGap();

      gap.onHciLeExtendedAdvertisingReport({ status, type: 0x13, address, addressType, txpower, rssi, eir });
      gap.onHciLeExtendedAdvertisingReport({ status, type: 0x13, address, addressType, txpower, rssi, eir });

      expect(delegate.onDiscover).toHaveBeenCalledTimes(1);
      expect(delegate.onDiscover).toHaveBeenCalledWith({
        status,
        address,
        addressType,
        connectable: true,
        scannable: true,
        advertisement: emptyAdvertisement,
        rssi
      });
    });

    it('non-connectable advertisement is reported right away', () => {
      const { gap, delegate } = createGap();

      gap.onHciLeExtendedAdvertisingReport({ status, type: 0x10, address, addressType, txpower, rssi, eir });

      expect(delegate.onDiscover).toHaveBeenCalledTimes(1);
      expect(delegate.onDiscover).toHaveBeenCalledWith({
        status,
        address,
        addressType,
        connectable: false,
        scannable: false,
        advertisement: emptyAdvertisement,
        rssi
      });
    });

    it('incomplete non-connectable advertisement is held back', () => {
      const { gap, delegate } = createGap();

      gap.onHciLeExtendedAdvertisingReport({ status, type: 0x20, address, addressType, txpower, rssi, eir });

      expect(delegate.onDiscover).not.toHaveBeenCalled();
    });

    it('scan response keeps the connectable flag of the advertisement and merges its data', () => {
      const { gap, delegate } = createGap();
      const name = Buffer.from('abc');
      const scanResponse = Buffer.concat([Buffer.from([name.length + 1, 0x09]), name]);

      gap.onHciLeExtendedAdvertisingReport({ status, type: 0x13, address, addressType, txpower, rssi, eir });
      gap.onHciLeExtendedAdvertisingReport({ status, type: 0x1a, address, addressType, txpower: 9, rssi: -50, eir: scanResponse });

      expect(gap.discoveries.get(address)).toStrictEqual({
        address,
        addressType,
        connectable: true,
        advertisement: { ...emptyAdvertisement, localName: 'abc' },
        rssi: -50,
        count: 2,
        hasScanResponse: true
      });
      expect(delegate.onDiscover).toHaveBeenCalledTimes(1);
      expect(delegate.onDiscover).toHaveBeenCalledWith({
        status,
        address,
        addressType,
        connectable: true,
        scannable: true,
        advertisement: { ...emptyAdvertisement, localName: 'abc' },
        rssi: -50
      });
    });

    it('scan response of an unknown address takes its flags from its own event type', () => {
      const { gap, delegate } = createGap();

      gap.onHciLeExtendedAdvertisingReport({ status, type: 0x1b, address, addressType, txpower, rssi, eir });

      expect(delegate.onDiscover).toHaveBeenCalledTimes(1);
      expect(delegate.onDiscover.mock.calls[0][0].connectable).toBe(true);
      expect(delegate.onDiscover.mock.calls[0][0].scannable).toBe(true);
    });

    it('a tx power level in the data wins over the one of the report', () => {
      const { gap } = createGap();

      gap.onHciLeExtendedAdvertisingReport({ status, type: 0x10, address, addressType, txpower, rssi, eir: Buffer.from([0x02, 0x0a, 0xfc]) });

      expect(gap.discoveries.get(address).advertisement.txPowerLevel).toBe(-4);
    });
  });

  it('truncated service data is ignored', () => {
    const delegate = createDelegate();
    const gap = new Gap({} as any, delegate) as any;

    // 32-bit service data that only carries two uuid bytes
    const advertisement = gap.parseServices('a:d:d:r:e:s:s', Buffer.from([0x03, 0x20, 0x01, 0x02]), false);

    expect(advertisement.serviceData).toEqual([]);
  });
});
