import os from 'os';

import createDebug from 'debug';

import type { ServiceData } from '../../types';
import type {
  GapController,
  GapDelegate,
  HciAddressType,
  LeAdvertisingReport,
  LeExtendedAdvertisingReport
} from './types';

const debug = createDebug('gap');

const isChip = os.platform() === 'linux' && os.release().indexOf('-ntc') !== -1;

const LE_META_EVENT_TYPE_CONNECTABLE = 0x3;
const LE_META_EVENT_TYPE_SCAN_RESPONSE = 0x4;
const LE_META_EVENT_TYPE_SCANNABLE = 0x6;

const LE_META_EXTENDED_EVENT_TYPE_CONNECTABLE_MASK = 0x1;
const LE_META_EXTENDED_EVENT_TYPE_SCANNABLE_MASK = 0x2;
const LE_META_EXTENDED_EVENT_TYPE_SCAN_RESPONSE_MASK = 0x8;
const LE_META_EXTENDED_EVENT_TYPE_INCOMPLETE_MASK = 0x20;

type ScanState = 'starting' | 'started' | 'stopping' | 'stopped';

/** The advertisement as `Gap` accumulates it: every list is always present. */
export interface GapAdvertisement {
  localName: string | undefined;
  txPowerLevel: number | undefined;
  manufacturerData: Buffer | undefined;
  serviceData: ServiceData[];
  serviceUuids: string[];
  serviceSolicitationUuids: string[];
}

interface DiscoveryState {
  address: string;
  addressType: HciAddressType;
  connectable: boolean;
  advertisement: GapAdvertisement;
  rssi: number;
  count: number;
  hasScanResponse: boolean;
}

/** Little-endian UUID bytes -> the usual big-endian hex string. */
function reversedHex (bytes: Buffer): string {
  return (bytes.toString('hex').match(/.{1,2}/g) ?? []).reverse().join('');
}

function pushUnique (list: string[], value: string): void {
  if (list.indexOf(value) === -1) {
    list.push(value);
  }
}

/**
 * Scanning state machine and advertisement parsing.
 *
 * `Gap` drives the controller through {@link GapController} and never listens
 * to it: its owner feeds the scan-related HCI events into the `onHci…`
 * handlers, and everything `Gap` concludes is reported to the
 * {@link GapDelegate}.
 */
export class Gap {
  private scanState: ScanState | null = null;
  private scanFilterDuplicates: boolean | null = null;
  private readonly discoveries = new Map<string, DiscoveryState>();

  constructor (
    private readonly hci: GapController,
    private readonly delegate: GapDelegate
  ) {}

  setScanParameters (interval?: number, window?: number): void {
    this.hci.setScanParameters(interval, window);
  }

  startScanning (allowDuplicates: boolean): void {
    this.scanState = 'starting';
    this.scanFilterDuplicates = !allowDuplicates;

    // Always set scan parameters before scanning
    // https://www.bluetooth.org/docman/handlers/downloaddoc.ashx?doc_id=229737
    // p106 - p107
    this.hci.setScanEnabled(false, true);
    this.hci.setScanParameters();

    if (isChip) {
      // work around for Next Thing Co. C.H.I.P, always allow duplicates, to get scan response
      this.scanFilterDuplicates = false;
    }

    this.hci.setScanEnabled(true, this.scanFilterDuplicates);
  }

  stopScanning (): void {
    this.scanState = 'stopping';

    this.hci.setScanEnabled(false, true);
  }

  /**
   * The adapter went away: forgets the scan and everything discovered so far.
   * No command is written and nothing is reported; a completion that still
   * arrives for a command of the forgotten scan is ignored.
   */
  reset (): void {
    this.scanState = null;
    this.scanFilterDuplicates = null;
    this.discoveries.clear();
  }

  onHciLeScanParametersSet (): void {
    this.delegate.onScanParametersSet();
  }

  // Called when receive an event "Command Complete" for "LE Set Scan Enable"
  onHciLeScanEnableSet (status: number): void {
    // Check the status we got from the command complete function.
    if (status !== 0) {
      // If it is non-zero there was an error, and we should not change
      // our status as a result.
      return;
    }

    if (this.scanState === 'starting') {
      this.scanState = 'started';

      this.delegate.onScanStart(this.scanFilterDuplicates ?? false);
    } else if (this.scanState === 'stopping') {
      this.scanState = 'stopped';

      this.delegate.onScanStop();
    }
  }

  // Called when we see the actual command "LE Set Scan Enable"
  onLeScanEnableSetCmd (enable: boolean, filterDuplicates: boolean): void {
    // Check to see if the new settings differ from what we expect.
    // If we are scanning, then a change happens if the new command stops
    // scanning or if duplicate filtering changes.
    // If we are not scanning, then a change happens if scanning was enabled.
    if (this.scanState === 'starting' || this.scanState === 'started') {
      if (!enable) {
        this.delegate.onScanStop();
      } else if (this.scanFilterDuplicates !== filterDuplicates) {
        this.scanFilterDuplicates = filterDuplicates;

        this.delegate.onScanStart(this.scanFilterDuplicates);
      }
    } else if (
      (this.scanState === 'stopping' || this.scanState === 'stopped') &&
      enable
    ) {
      // Someone started scanning on us. We report our own last known filter
      // setting; when we never scanned ourselves, the observed one.
      this.delegate.onScanStart(this.scanFilterDuplicates ?? filterDuplicates);
    }
  }

  onHciLeAdvertisingReport (report: LeAdvertisingReport): void {
    const { status, type, address, addressType, eir, rssi } = report;
    const previous = this.discoveries.get(address);
    const previouslyDiscovered = previous !== undefined;

    let discoveryCount = previous ? previous.count : 0;
    let hasScanResponse = previous ? previous.hasScanResponse : false;

    if (type === LE_META_EVENT_TYPE_SCAN_RESPONSE) {
      hasScanResponse = true;
    }

    discoveryCount++;

    const advertisement = this.parseServices(address, eir, previouslyDiscovered, type);

    if (process.env.DEBUG === 'gap') {
      debug(`advertisement = ${JSON.stringify(advertisement, null, 0)}`);
    }

    const connectable =
      type === LE_META_EVENT_TYPE_SCAN_RESPONSE && previous
        ? previous.connectable
        : type !== LE_META_EVENT_TYPE_CONNECTABLE;
    const scannable = type === LE_META_EVENT_TYPE_SCANNABLE;

    this.discoveries.set(address, {
      address,
      addressType,
      connectable,
      advertisement,
      rssi,
      count: discoveryCount,
      hasScanResponse
    });

    // only report after a scan response event or if non-connectable or more than one discovery without a scan response, so more data can be collected
    if (
      type === LE_META_EVENT_TYPE_SCAN_RESPONSE ||
      !connectable ||
      (discoveryCount > 1 && !hasScanResponse) ||
      process.env.NOBLE_REPORT_ALL_HCI_EVENTS
    ) {
      this.delegate.onDiscover({
        status,
        address,
        addressType,
        connectable,
        scannable,
        advertisement,
        rssi
      });
    }
  }

  onHciLeExtendedAdvertisingReport (report: LeExtendedAdvertisingReport): void {
    const { status, type, address, addressType, txpower, rssi, eir } = report;
    const previous = this.discoveries.get(address);
    const previouslyDiscovered = previous !== undefined;

    let discoveryCount = previous ? previous.count : 0;
    let hasScanResponse = previous ? previous.hasScanResponse : false;

    const isScanResponse = (type & LE_META_EXTENDED_EVENT_TYPE_SCAN_RESPONSE_MASK) !== 0;

    if (isScanResponse) {
      hasScanResponse = true;
    }

    discoveryCount++;

    const advertisement = this.parseServices(address, eir, previouslyDiscovered, type, txpower);

    if (process.env.DEBUG === 'gap') {
      debug(`advertisement = ${JSON.stringify(advertisement, null, 0)}`);
    }

    const connectable =
      isScanResponse && previous
        ? previous.connectable
        : (type & LE_META_EXTENDED_EVENT_TYPE_CONNECTABLE_MASK) !== 0;
    const scannable = (type & LE_META_EXTENDED_EVENT_TYPE_SCANNABLE_MASK) !== 0;
    const incomplete = (type & LE_META_EXTENDED_EVENT_TYPE_INCOMPLETE_MASK) !== 0;

    this.discoveries.set(address, {
      address,
      addressType,
      connectable,
      advertisement,
      rssi,
      count: discoveryCount,
      hasScanResponse
    });

    // only report after a scan response event or if non-connectable or more than one discovery without a scan response, so more data can be collected
    if (
      isScanResponse ||
      (!connectable && !incomplete) ||
      (discoveryCount > 1 && !hasScanResponse) ||
      process.env.NOBLE_REPORT_ALL_HCI_EVENTS
    ) {
      this.delegate.onDiscover({
        status,
        address,
        addressType,
        connectable,
        scannable,
        advertisement,
        rssi
      });
    }
  }

  /**
   * Parses EIR / advertising data. Data of an address that was discovered
   * before is merged into the advertisement accumulated so far.
   */
  parseServices (
    address: string,
    eir: Buffer,
    previouslyDiscovered: boolean,
    _leMetaEventType?: number,
    txpower?: number
  ): GapAdvertisement {
    let i = 0;
    const previous = previouslyDiscovered ? this.discoveries.get(address) : undefined;
    const advertisement: GapAdvertisement = previous
      ? previous.advertisement
      : {
          localName: undefined,
          txPowerLevel: txpower,
          manufacturerData: undefined,
          serviceData: [],
          serviceUuids: [],
          serviceSolicitationUuids: []
        };

    while (i + 1 < eir.length) {
      const length = eir.readUInt8(i);

      if (length < 1) {
        debug(`invalid EIR data, length = ${length}`);
        break;
      }

      const eirType = eir.readUInt8(i + 1); // https://www.bluetooth.org/en-us/specification/assigned-numbers/generic-access-profile

      if (i + length + 1 > eir.length) {
        debug('invalid EIR data, out of range of buffer length');
        break;
      }

      const bytes = eir.subarray(i + 2).subarray(0, length - 1);

      switch (eirType) {
        case 0x02: // Incomplete List of 16-bit Service Class UUID
        case 0x03: // Complete List of 16-bit Service Class UUIDs
          for (let j = 0; j < bytes.length - 1; j += 2) {
            pushUnique(advertisement.serviceUuids, bytes.readUInt16LE(j).toString(16));
          }
          break;

        case 0x06: // Incomplete List of 128-bit Service Class UUIDs
        case 0x07: // Complete List of 128-bit Service Class UUIDs
          for (let j = 0; j < bytes.length - 15; j += 16) {
            pushUnique(advertisement.serviceUuids, reversedHex(bytes.subarray(j, j + 16)));
          }
          break;

        case 0x08: // Shortened Local Name
        case 0x09: // Complete Local Name
          advertisement.localName = bytes.toString('utf8');
          break;

        case 0x0a: // Tx Power Level
          advertisement.txPowerLevel = bytes.readInt8(0);
          break;

        case 0x14: // List of 16 bit solicitation UUIDs
          for (let j = 0; j < bytes.length - 1; j += 2) {
            pushUnique(advertisement.serviceSolicitationUuids, bytes.readUInt16LE(j).toString(16));
          }
          break;

        case 0x15: // List of 128 bit solicitation UUIDs
          for (let j = 0; j < bytes.length - 15; j += 16) {
            pushUnique(advertisement.serviceSolicitationUuids, reversedHex(bytes.subarray(j, j + 16)));
          }
          break;

        case 0x16: // 16-bit Service Data
        case 0x20: // 32-bit Service Data
        case 0x21: // 128-bit Service Data
          {
            let uuidLength: number;
            if (eirType === 0x16) {
              uuidLength = 2;
            } else if (eirType === 0x20) {
              uuidLength = 4;
            } else {
              uuidLength = 16;
            }

            if (bytes.length < uuidLength) {
              debug(
                `invalid EIR service data, type = 0x${eirType.toString(16)}, expected uuid bytes = ${uuidLength}, actual = ${bytes.length}`
              );
              break;
            }

            const serviceUuid = reversedHex(bytes.subarray(0, uuidLength));

            // Find existing service data index
            const existingIndex = advertisement.serviceData.findIndex(
              s => s.uuid === serviceUuid
            );
            const serviceData: ServiceData = {
              uuid: serviceUuid,
              data: bytes.subarray(uuidLength, bytes.length)
            };

            // Update or append service data
            if (existingIndex >= 0) {
              advertisement.serviceData[existingIndex] = serviceData;
            } else {
              advertisement.serviceData.push(serviceData);
            }
          }
          break;

        case 0x1f: // List of 32 bit solicitation UUIDs
          for (let j = 0; j < bytes.length - 3; j += 4) {
            pushUnique(advertisement.serviceSolicitationUuids, bytes.readUInt32LE(j).toString(16));
          }
          break;

        case 0xff: // Manufacturer Specific Data
          advertisement.manufacturerData = bytes;
          break;
      }

      i += length + 1;
    }

    return advertisement;
  }
}
