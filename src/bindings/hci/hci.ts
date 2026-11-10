import createDebug from 'debug';

import type { AdapterState } from '../../types';
import {
  ACL_CONT,
  ACL_START,
  ACL_START_NO_FLUSH,
  DISCONNECT_CMD,
  EVT_CMD_COMPLETE,
  EVT_CMD_STATUS,
  EVT_DISCONN_COMPLETE,
  EVT_ENCRYPT_CHANGE,
  EVT_LE_ADVERTISING_REPORT,
  EVT_LE_CONN_COMPLETE,
  EVT_LE_CONN_UPDATE_COMPLETE,
  EVT_LE_DATA_LENGTH_CHANGE,
  EVT_LE_ENHANCED_CONN_COMPLETE,
  EVT_LE_EXTENDED_ADVERTISING_REPORT,
  EVT_LE_META_EVENT,
  EVT_NUMBER_OF_COMPLETED_PACKETS,
  HCI_ACLDATA_PKT,
  HCI_COMMAND_PKT,
  HCI_EVENT_PKT,
  HCI_OE_USER_ENDED_CONNECTION,
  LE_CANCEL_CONN_CMD,
  LE_CONN_UPDATE_CMD,
  LE_CREATE_CONN_CMD,
  LE_CREATE_EXTENDED_CONN_CMD,
  LE_MAX_TX_OCTETS,
  LE_MAX_TX_TIME,
  LE_MIN_ACL_LENGTH,
  LE_MIN_TX_OCTETS,
  LE_MIN_TX_TIME,
  LE_READ_BUFFER_SIZE_CMD,
  LE_READ_LOCAL_SUPPORTED_FEATURES_CMD,
  LE_READ_MAX_DATA_LENGTH_CMD,
  LE_SET_DATA_LENGTH_CMD,
  LE_SET_DEFAULT_PHY_CMD,
  LE_SET_EVENT_MASK_CMD,
  LE_SET_EXTENDED_SCAN_ENABLE_CMD,
  LE_SET_EXTENDED_SCAN_PARAMETERS_CMD,
  LE_SET_SCAN_ENABLE_CMD,
  LE_SET_SCAN_PARAMETERS_CMD,
  LE_START_ENCRYPTION_CMD,
  READ_BD_ADDR_CMD,
  READ_BUFFER_SIZE_CMD,
  READ_LE_HOST_SUPPORTED_CMD,
  READ_LOCAL_VERSION_CMD,
  READ_RSSI_CMD,
  READ_SUPPORTED_COMMANDS_CMD,
  RESET_CMD,
  SET_EVENT_MASK_CMD,
  WRITE_LE_HOST_SUPPORTED_CMD
} from './hci-constants';
import hciStatus from './hci-status.json';
import type {
  ConnectionAttemptToken,
  HciAddressType,
  HciBindingsOptions,
  HciConnectOptions,
  HciDelegate,
  LeConnCompleteEvent
} from './types';
import { setAddressCmd } from './vs';

const debug = createDebug('hci');

/** HCI status code -> human readable message (Core Spec Vol 1 Part F). */
export const HCI_STATUS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(hciStatus.map((message, code) => [String(code), message]))
);

/**
 * The part of the `@stoprocent/bluetooth-hci-socket` driver that `Hci` uses.
 *
 * The package typings are narrower than the drivers themselves (no `'state'`
 * event, mandatory device id and bind params), so the driver instance is
 * viewed through this interface instead.
 */
interface HciSocket {
  on (event: 'data', listener: (data: Buffer) => void): unknown;
  on (event: 'error', listener: (error: NodeJS.ErrnoException) => void): unknown;
  on (event: 'state', listener: () => void): unknown;
  removeAllListeners (): unknown;
  isDevUp (): boolean;
  start (): void;
  stop (): void;
  bindRaw (deviceId?: number, params?: HciBindingsOptions['bindParams']): number;
  bindUser (deviceId?: number, params?: HciBindingsOptions['bindParams']): number;
  setFilter (filter: Buffer): void;
  write (data: Buffer): void;
}

/**
 * Loads the socket driver. `@stoprocent/bluetooth-hci-socket` is an optional
 * dependency, so it is required on first use rather than imported: noble must
 * build, load and run its other backends on machines where it is missing.
 */
function loadSocketDriver (driver: NonNullable<HciBindingsOptions['hciDriver']>): new () => HciSocket {
  let driverModule: { loadDriver (driver: string): new () => HciSocket };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    driverModule = require('@stoprocent/bluetooth-hci-socket');
  } catch (cause) {
    throw new Error(
      'noble HCI bindings require the "@stoprocent/bluetooth-hci-socket" package, which is not installed ' +
      '(it is an optional dependency and may have failed to build on this platform)',
      { cause }
    );
  }
  return driverModule.loadDriver(driver);
}

/** Controller ACL buffer budget: maximum packet payload and number of packets in flight. */
interface AclBuffers {
  length: number;
  num: number;
}

interface AclConnection {
  /** Packets handed to the controller and not yet acknowledged by Number Of Completed Packets. */
  pending: number;
}

interface QueuedAclPacket {
  handle: number;
  packet: Buffer;
}

/** An L2CAP PDU whose remaining fragments have not arrived yet. */
interface PartialL2capPdu {
  length: number;
  cid: number;
  data: Buffer;
}

interface PendingLeConnection {
  address: string;
  addressType: HciAddressType;
  token?: ConnectionAttemptToken;
}

interface MaxDataLength {
  txOctets: number;
  txTime: number;
}

/** Allocates a command packet of `parameterLength` zeroed parameter octets with its header filled in. */
function allocCommand (opcode: number, parameterLength: number): Buffer {
  const cmd = Buffer.alloc(4 + parameterLength);

  // header
  cmd.writeUInt8(HCI_COMMAND_PKT, 0);
  cmd.writeUInt16LE(opcode, 1);

  // length
  cmd.writeUInt8(parameterLength, 3);

  return cmd;
}

/** Formats little-endian address octets as a colon separated, big-endian hex string. */
function formatAddress (octets: Buffer): string {
  return (octets.toString('hex').match(/.{1,2}/g) ?? []).reverse().join(':');
}

/** Parses a colon separated address into little-endian octets. */
function parseAddress (address: string): Buffer {
  return Buffer.from(address.split(':').reverse().join(''), 'hex');
}

function normalizeAddress (address: string): string {
  return address.replace(/:/g, '').toLowerCase();
}

function errorMessage (error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Owns the HCI socket: writes HCI commands and ACL data, parses everything
 * the controller sends back and reports it to its {@link HciDelegate}.
 */
export class Hci {
  /** Controller public address. Unset until Read BD_ADDR completes (see `onAddressChange`). */
  address!: string;
  /** Unset until Read BD_ADDR completes. */
  addressType!: HciAddressType;

  private readonly delegate: HciDelegate;
  private readonly socket: HciSocket;
  private readonly deviceId: number | undefined;
  private readonly bindParams: HciBindingsOptions['bindParams'];
  private readonly userChannel: boolean;
  private readonly extendedModeConfigured: boolean;
  private readonly codedPhy: boolean;

  private manufacturer: number | null = null;
  private bound = false;
  private isStarted = false;
  private isDevUp: boolean | null = null;
  private devUpPollTimer: ReturnType<typeof setTimeout> | null = null;
  private isExtended: boolean;
  private supportsCodedPhy = false;
  private supportsDataLengthExtension = false;
  private maxDataLength: MaxDataLength | null = null;
  private state: AdapterState | null = null;

  private handleBuffers: Record<number, PartialL2capPdu> = {};
  private aclBuffers: AclBuffers | undefined = undefined;
  private readonly aclBuffersPromise: Promise<AclBuffers>;
  private resolveAclBuffers!: (aclBuffers: AclBuffers) => void;
  private readonly aclConnections = new Map<number, AclConnection>();
  private aclQueue: QueuedAclPacket[] = [];
  private pendingLeConn: PendingLeConnection | null = null;

  /** One-shot callbacks run the next time the post-reset command chain has been written. */
  private readonly afterResetCallbacks: Array<() => void> = [];

  constructor (options: HciBindingsOptions, delegate: HciDelegate) {
    this.delegate = delegate;

    const BluetoothHciSocket = loadSocketDriver(options.hciDriver || 'default');
    this.socket = new BluetoothHciSocket();

    this.extendedModeConfigured = Object.prototype.hasOwnProperty.call(options, 'extended');
    this.isExtended = this.extendedModeConfigured ? Boolean(options.extended) : false;
    this.codedPhy = typeof options.codedPhy !== 'undefined'
      ? Boolean(options.codedPhy)
      : Boolean(process.env.NOBLE_CODED_PHY);
    this.bindParams = options.bindParams;

    this.aclBuffersPromise = new Promise((resolve) => {
      this.resolveAclBuffers = resolve;
    });

    this.deviceId = options.deviceId != null
      ? parseInt(String(options.deviceId), 10)
      : process.env.NOBLE_HCI_DEVICE_ID
        ? parseInt(process.env.NOBLE_HCI_DEVICE_ID, 10)
        : undefined;

    this.userChannel = typeof options.userChannel !== 'undefined'
      ? options.userChannel
      : Boolean(process.env.HCI_CHANNEL_USER);
  }

  isUserChannel (): boolean {
    return this.userChannel;
  }

  /** Binds and starts the socket, then resets the controller to kick off the init command chain. */
  init (): void {
    this.socket.on('data', (data) => this.onSocketData(data));
    this.socket.on('error', (error) => this.onSocketError(error));
    this.socket.on('state', () => this.pollIsDevUp());

    try {
      // Bind first (either user channel or raw)
      if (this.userChannel) {
        this.socket.bindUser(this.deviceId, this.bindParams);
      } else {
        if (!this.bound) {
          this.socket.bindRaw(this.deviceId, this.bindParams);
          this.bound = true;
        }
      }

      // Start and reset (common to both paths)
      this.socket.start();

      if (this.userChannel) {
        // No kernel command flow control on the user channel: nothing serialises this behind HCI_Reset
        this.afterResetCallbacks.push(() => this.readLeSupportedFeatures());
      }

      this.reset();
      this.isStarted = true;

      if (!this.userChannel) {
        this.pollIsDevUp();
      }
    } catch (error) {
      debug(`init error: ${errorMessage(error)}`);
      this.setState('unsupported');
    }
  }

  /** Checks whether the adapter is up, reacts to a change, and (raw channel only) re-arms the 1s poll. */
  pollIsDevUp (): void {
    const isDevUp = this.socket.isDevUp();

    if (this.isDevUp !== isDevUp) {
      if (isDevUp) {
        if (this.state === 'poweredOff') {
          this.socket.removeAllListeners();
          this.state = null;
          this.init();
        } else {
          this.setSocketFilter();
          this.readLeSupportedFeatures();
          // Subsequent calls moved to processCmdCompleteEvent for LE_READ_LOCAL_SUPPORTED_FEATURES
        }
      } else {
        this.setState('poweredOff');
      }

      this.isDevUp = isDevUp;
    }
    if (this.isStarted && !this.userChannel && this.devUpPollTimer === null) {
      this.devUpPollTimer = setTimeout(() => {
        this.devUpPollTimer = null;
        this.pollIsDevUp();
      }, 1000);
    }
  }

  setCodedPhySupport (): void {
    const cmd = allocCommand(LE_SET_DEFAULT_PHY_CMD, 0x03);

    // data
    cmd.writeUInt8(0x00, 4); // all phy prefs
    cmd.writeUInt8(0x05, 5); // tx phy: 0x01 - LE 1M, 0x03 - LE 1M + LE 2M, 0x05 - LE 1M + LE CODED, 0x07 -  LE 1M + LE 2M +  LE CODED
    cmd.writeUInt8(0x05, 6); // rx phy: 0x01 - LE 1M, 0x03 - LE 1M + LE 2M, 0x05 - LE 1M + LE CODED, 0x07 -  LE 1M + LE 2M +  LE CODED

    debug(`set all phys supporting - writing: ${cmd.toString('hex')}`);
    this.socket.write(cmd);
  }

  /**
   * Writes the vendor specific set-address command for the controller's
   * manufacturer, if one is known, then re-reads the address.
   */
  setAddress (address: string): void {
    // Command
    const addrCmd = setAddressCmd(this.manufacturer, address);

    if (addrCmd !== null) {
      // Make Command Buffer
      const cmd = Buffer.alloc(1 + addrCmd.byteLength);
      cmd.writeUInt8(HCI_COMMAND_PKT, 0);
      addrCmd.copy(cmd, 1);

      debug(`set address - writing: ${cmd.toString('hex')}`);
      this.socket.write(cmd);
      this.readBdAddr();
    }
  }

  setSocketFilter (): void {
    const filter = Buffer.alloc(14);
    const typeMask =
      (1 << HCI_COMMAND_PKT) | (1 << HCI_EVENT_PKT) | (1 << HCI_ACLDATA_PKT);
    const eventMask1 =
      (1 << EVT_DISCONN_COMPLETE) |
      (1 << EVT_ENCRYPT_CHANGE) |
      (1 << EVT_CMD_COMPLETE) |
      (1 << EVT_CMD_STATUS) |
      (1 << EVT_NUMBER_OF_COMPLETED_PACKETS);
    const eventMask2 = 1 << (EVT_LE_META_EVENT - 32);
    const opcode = 0;

    filter.writeUInt32LE(typeMask, 0);
    filter.writeUInt32LE(eventMask1, 4);
    filter.writeUInt32LE(eventMask2, 8);
    filter.writeUInt16LE(opcode, 12);

    debug(`setting filter to: ${filter.toString('hex')}`);
    this.socket.setFilter(filter);
  }

  setEventMask (): void {
    const eventMask = Buffer.from('fffffbff07f8bf3d', 'hex');
    const cmd = allocCommand(SET_EVENT_MASK_CMD, eventMask.length);

    eventMask.copy(cmd, 4);

    debug(`set event mask - writing: ${cmd.toString('hex')}`);
    this.socket.write(cmd);
  }

  /**
   * Writes HCI_Reset. While ACL connections are active the reset itself is
   * skipped (it would drop them), but the post-reset chain still runs.
   */
  reset (): void {
    if (this.aclConnections.size > 0) {
      debug(`reset - refusing while ${this.aclConnections.size} ACL connection(s) are active`);
      this.afterReset();
      return;
    }

    const cmd = allocCommand(RESET_CMD, 0x00);

    debug(`reset - writing: ${cmd.toString('hex')}`);
    this.socket.write(cmd);
  }

  stop (): void {
    this.socket.stop();
    this.isStarted = false;

    if (this.devUpPollTimer !== null) {
      clearTimeout(this.devUpPollTimer);
      this.devUpPollTimer = null;
    }

    this.aclConnections.clear();
    this.aclQueue = [];
    this.pendingLeConn = null;
  }

  readSupportedCommands (): void {
    const cmd = allocCommand(READ_SUPPORTED_COMMANDS_CMD, 0x00);

    debug(`read supported commands - writing: ${cmd.toString('hex')}`);
    this.socket.write(cmd);
  }

  readLocalVersion (): void {
    const cmd = allocCommand(READ_LOCAL_VERSION_CMD, 0x00);

    debug(`read local version - writing: ${cmd.toString('hex')}`);
    this.socket.write(cmd);
  }

  readBufferSize (): void {
    const cmd = allocCommand(READ_BUFFER_SIZE_CMD, 0x00);

    debug(`read buffer size - writing: ${cmd.toString('hex')}`);
    this.socket.write(cmd);
  }

  readBdAddr (): void {
    const cmd = allocCommand(READ_BD_ADDR_CMD, 0x00);

    debug(`read bd addr - writing: ${cmd.toString('hex')}`);
    this.socket.write(cmd);
  }

  setLeEventMask (): void {
    // Bit 6 is LE Data Length Change; without it the negotiated length is never reported.
    const leEventMask = this.isExtended
      ? Buffer.from('5fff000000000000', 'hex')
      : Buffer.from('5f00000000000000', 'hex');
    const cmd = allocCommand(LE_SET_EVENT_MASK_CMD, leEventMask.length);

    leEventMask.copy(cmd, 4);

    debug(`set le event mask - writing: ${cmd.toString('hex')}`);
    this.socket.write(cmd);
  }

  readLeSupportedFeatures (): void {
    const cmd = allocCommand(LE_READ_LOCAL_SUPPORTED_FEATURES_CMD, 0x00);

    debug(`le read supported feature - writing: ${cmd.toString('hex')}`);
    this.socket.write(cmd);
  }

  readLeBufferSize (): void {
    const cmd = allocCommand(LE_READ_BUFFER_SIZE_CMD, 0x00);

    debug(`le read buffer size - writing: ${cmd.toString('hex')}`);
    this.socket.write(cmd);
  }

  readLeMaxDataLength (): void {
    const cmd = allocCommand(LE_READ_MAX_DATA_LENGTH_CMD, 0x00);

    debug(`le read maximum data length - writing: ${cmd.toString('hex')}`);
    this.socket.write(cmd);
  }

  /** Requests the controller's maximum data length for a link. A no-op until that maximum is known. */
  setLeDataLength (handle: number): void {
    if (!this.supportsDataLengthExtension || this.maxDataLength === null) {
      return;
    }

    const cmd = allocCommand(LE_SET_DATA_LENGTH_CMD, 0x06);

    // data
    cmd.writeUInt16LE(handle, 4);
    cmd.writeUInt16LE(this.maxDataLength.txOctets, 6);
    cmd.writeUInt16LE(this.maxDataLength.txTime, 8);

    debug(`le set data length - writing: ${cmd.toString('hex')}`);
    // A link works at the 27 octet default, so a failure here must not fail the connection.
    try {
      this.socket.write(cmd);
    } catch (error) {
      debug(`le set data length failed - handle: ${handle}, error: ${errorMessage(error)}`);
    }
  }

  readLeHostSupported (): void {
    const cmd = allocCommand(READ_LE_HOST_SUPPORTED_CMD, 0x00);

    debug(`read LE host supported - writing: ${cmd.toString('hex')}`);
    this.socket.write(cmd);
  }

  writeLeHostSupported (): void {
    const cmd = allocCommand(WRITE_LE_HOST_SUPPORTED_CMD, 0x02);

    // data
    cmd.writeUInt8(0x01, 4); // le
    cmd.writeUInt8(0x00, 5); // simul

    debug(`write LE host supported - writing: ${cmd.toString('hex')}`);
    this.socket.write(cmd);
  }

  setScanParameters (interval = 0x0012, window = 0x0012): void {
    const useCodedPhy = this.isExtended && this.supportsCodedPhy;
    let cmd: Buffer;

    if (this.isExtended) {
      cmd = allocCommand(LE_SET_EXTENDED_SCAN_PARAMETERS_CMD, useCodedPhy ? 0x0d : 0x08);

      // data
      cmd.writeUInt8(0x00, 4); // own address type: 0 -> public, 1 -> random
      cmd.writeUInt8(0x00, 5); // filter: 0 -> all event types
      cmd.writeUInt8(useCodedPhy ? 0x05 : 0x01, 6); // phy: LE 1M, plus LE Coded when supported
      // phy 1M
      cmd.writeUInt8(0x01, 7); // type: 0 -> passive, 1 -> active
      cmd.writeUInt16LE(interval, 8); // interval, ms * 1.6
      cmd.writeUInt16LE(window, 10); // window, ms * 1.6
      if (useCodedPhy) {
        // phy coded
        cmd.writeUInt8(0x01, 12); // type: 0 -> passive, 1 -> active
        cmd.writeUInt16LE(interval, 13); // interval, ms * 1.6
        cmd.writeUInt16LE(window, 15); // window, ms * 1.6
      }
    } else {
      cmd = allocCommand(LE_SET_SCAN_PARAMETERS_CMD, 0x07);

      // data
      cmd.writeUInt8(0x01, 4); // type: 0 -> passive, 1 -> active
      cmd.writeUInt16LE(interval, 5); // interval, ms * 1.6
      cmd.writeUInt16LE(window, 7); // window, ms * 1.6
      cmd.writeUInt8(0x00, 9); // own address type: 0 -> public, 1 -> random
      cmd.writeUInt8(0x00, 10); // filter: 0 -> all event types
    }

    debug(`set scan parameters - writing: ${cmd.toString('hex')}`);
    this.socket.write(cmd);
  }

  setScanEnabled (enabled: boolean, filterDuplicates: boolean): void {
    let cmd: Buffer;

    if (this.isExtended) {
      cmd = allocCommand(LE_SET_EXTENDED_SCAN_ENABLE_CMD, 0x06);

      // data
      cmd.writeUInt8(enabled ? 0x01 : 0x00, 4); // enable: 0 -> disabled, 1 -> enabled
      cmd.writeUInt8(filterDuplicates ? 0x01 : 0x00, 5); // duplicates: 0 -> duplicates, 1 -> all
      cmd.writeUInt16LE(0x0000, 6); // duration
      cmd.writeUInt16LE(0x0000, 8); // period
    } else {
      cmd = allocCommand(LE_SET_SCAN_ENABLE_CMD, 0x02);

      // data
      cmd.writeUInt8(enabled ? 0x01 : 0x00, 4); // enable: 0 -> disabled, 1 -> enabled
      cmd.writeUInt8(filterDuplicates ? 0x01 : 0x00, 5); // duplicates: 0 -> duplicates, 0 -> duplicates
    }

    debug(`set scan enabled - writing: ${cmd.toString('hex')}`);
    this.socket.write(cmd);
  }

  // This is a mystery case for me.
  // I don't know why we need to reset the hci socket before creating a LE connection.
  // Issues related to this:
  // https://github.com/stoprocent/noble/issues/12
  // https://github.com/bluez/bluez/issues/1178
  createLeConn (
    address: string,
    addressType: HciAddressType,
    parameters: HciConnectOptions = {},
    reset = true,
    attemptToken?: ConnectionAttemptToken
  ): void {
    if (reset) {
      this.afterResetCallbacks.push(() => this.createLeConnAfterReset(address, addressType, parameters, attemptToken));
      this.reset();
    } else {
      this.createLeConnAfterReset(address, addressType, parameters, attemptToken);
    }
  }

  /** Writes LE (Extended) Create Connection and records the attempt so its completion can be attributed. */
  createLeConnAfterReset (
    address: string,
    addressType: HciAddressType,
    parameters: HciConnectOptions = {},
    attemptToken?: ConnectionAttemptToken
  ): void {
    const {
      minInterval = 0x0006,
      maxInterval = 0x0012,
      latency = 0x0000,
      timeout = 0x002a
    } = parameters;

    const useCodedPhy = this.isExtended && this.supportsCodedPhy;
    let cmd: Buffer;

    if (this.isExtended) {
      cmd = allocCommand(LE_CREATE_EXTENDED_CONN_CMD, useCodedPhy ? 0x2a : 0x1a);

      // data
      cmd.writeUInt8(0x00, 4); // filter policy: white list is not used
      cmd.writeUInt8(0x00, 5); // own address type
      cmd.writeUInt8(addressType === 'random' ? 0x01 : 0x00, 6); // peer address type
      parseAddress(address).copy(cmd, 7); // peer address
      cmd.writeUInt8(useCodedPhy ? 0x05 : 0x01, 13); // initiating PHYs: LE 1M, plus LE Coded when supported

      // LE 1M PHY
      cmd.writeUInt16LE(0x0060, 14); // scan interval 60 msec
      cmd.writeUInt16LE(0x0060, 16); // scan window 60 msec
      cmd.writeUInt16LE(minInterval, 18); // min interval
      cmd.writeUInt16LE(maxInterval, 20); // max interval
      cmd.writeUInt16LE(latency, 22); // latency
      cmd.writeUInt16LE(timeout, 24); // supervision timeout
      cmd.writeUInt16LE(0x0000, 26); // min ce length
      cmd.writeUInt16LE(0x0000, 28); // max ce length

      if (useCodedPhy) {
        // LE Coded PHY
        cmd.writeUInt16LE(0x0060, 30); // scan interval 60 msec
        cmd.writeUInt16LE(0x0060, 32); // scan window 60 msec
        cmd.writeUInt16LE(minInterval, 34); // min interval
        cmd.writeUInt16LE(maxInterval, 36); // max interval
        cmd.writeUInt16LE(latency, 38); // latency
        cmd.writeUInt16LE(timeout, 40); // supervision timeout
        cmd.writeUInt16LE(0x0000, 42); // min ce length
        cmd.writeUInt16LE(0x0000, 44); // max ce length
      }
    } else {
      cmd = allocCommand(LE_CREATE_CONN_CMD, 0x19);

      // data
      cmd.writeUInt16LE(0x0060, 4); // interval
      cmd.writeUInt16LE(0x0030, 6); // window
      cmd.writeUInt8(0x00, 8); // initiator filter

      cmd.writeUInt8(addressType === 'random' ? 0x01 : 0x00, 9); // peer address type
      parseAddress(address).copy(cmd, 10); // peer address

      cmd.writeUInt8(0x00, 16); // own address type

      cmd.writeUInt16LE(minInterval, 17); // min interval
      cmd.writeUInt16LE(maxInterval, 19); // max interval
      cmd.writeUInt16LE(latency, 21); // latency
      cmd.writeUInt16LE(timeout, 23); // supervision timeout
      cmd.writeUInt16LE(0x0004, 25); // min ce length
      cmd.writeUInt16LE(0x0006, 27); // max ce length
    }

    debug(`create le conn - writing: ${cmd.toString('hex')}`);
    this.pendingLeConn = { address, addressType, token: attemptToken };
    this.socket.write(cmd);
  }

  /** Intervals and supervision timeout are in milliseconds. */
  connUpdateLe (
    handle: number,
    minInterval: number,
    maxInterval: number,
    latency: number,
    supervisionTimeout: number
  ): void {
    const cmd = allocCommand(LE_CONN_UPDATE_CMD, 0x0e);

    // data
    cmd.writeUInt16LE(handle, 4);
    cmd.writeUInt16LE(Math.floor(minInterval / 1.25), 6); // min interval
    cmd.writeUInt16LE(Math.floor(maxInterval / 1.25), 8); // max interval
    cmd.writeUInt16LE(latency, 10); // latency
    cmd.writeUInt16LE(Math.floor(supervisionTimeout / 10), 12); // supervision timeout
    cmd.writeUInt16LE(0x0000, 14); // min ce length
    cmd.writeUInt16LE(0x0000, 16); // max ce length

    debug(`conn update le - writing: ${cmd.toString('hex')}`);
    this.socket.write(cmd);
  }

  cancelConnect (): void {
    const cmd = allocCommand(LE_CANCEL_CONN_CMD, 0x00);

    debug(`cancel le conn - writing: ${cmd.toString('hex')}`);
    this.socket.write(cmd);
  }

  startLeEncryption (handle: number, random: Buffer, diversifier: Buffer, key: Buffer): void {
    const cmd = allocCommand(LE_START_ENCRYPTION_CMD, 0x1c);

    // data
    cmd.writeUInt16LE(handle, 4); // handle
    random.copy(cmd, 6);
    diversifier.copy(cmd, 14);
    key.copy(cmd, 16);

    debug(`start le encryption - writing: ${cmd.toString('hex')}`);
    this.socket.write(cmd);
  }

  disconnect (handle: number, reason?: number): void {
    const cmd = allocCommand(DISCONNECT_CMD, 0x03);

    // data
    cmd.writeUInt16LE(handle, 4); // handle
    cmd.writeUInt8(reason || HCI_OE_USER_ENDED_CONNECTION, 6); // reason

    debug(`disconnect - writing: ${cmd.toString('hex')}`);
    this.socket.write(cmd);
  }

  readRssi (handle: number): void {
    const cmd = allocCommand(READ_RSSI_CMD, 0x02);

    // data
    cmd.writeUInt16LE(handle, 4); // handle

    debug(`read rssi - writing: ${cmd.toString('hex')}`);
    this.socket.write(cmd);
  }

  /** Resolves once the controller's ACL buffer size is known. */
  async getAclBuffers (): Promise<AclBuffers> {
    if (this.aclBuffers) return this.aclBuffers;
    return await this.aclBuffersPromise;
  }

  setAclBuffers (length: number, num: number): void {
    if (this.aclBuffers) {
      this.aclBuffers.length = length;
      this.aclBuffers.num = num;
      return;
    }
    this.aclBuffers = {
      length,
      num
    };
    this.resolveAclBuffers(this.aclBuffers);
  }

  /**
   * Fragments one L2CAP PDU to the controller's ACL buffer size and queues
   * it. Resolves once the fragments are queued, not once they are sent.
   */
  async writeAclDataPkt (handle: number, cid: number, data: Buffer): Promise<void> {
    const l2capLength = 4 /* l2cap header */ + data.length;

    const aclBuffers = await this.getAclBuffers();
    const aclLength = Math.min(l2capLength, aclBuffers.length);

    const minFirstLength = Math.max(aclLength + 5 /* acl header */, 9 /* prevent buffer overflow */);
    const first = Buffer.alloc(minFirstLength);

    // acl header
    first.writeUInt8(HCI_ACLDATA_PKT, 0);
    first.writeUInt16LE(handle | (ACL_START_NO_FLUSH << 12), 1);
    first.writeUInt16LE(aclLength, 3);

    // l2cap header
    first.writeUInt16LE(data.length, 5);
    first.writeUInt16LE(cid, 7);

    data.copy(first, 9);
    let remaining = data.slice(first.length - 9);

    debug(`push to acl queue: ${first.toString('hex')}`);
    this.aclQueue.push({ handle, packet: first });

    while (remaining.length > 0) {
      const fragAclLength = Math.min(remaining.length, aclBuffers.length);
      const frag = Buffer.alloc(fragAclLength + 5 /* acl header */);
      // acl header
      frag.writeUInt8(HCI_ACLDATA_PKT, 0);
      frag.writeUInt16LE(handle | (ACL_CONT << 12), 1);
      frag.writeUInt16LE(fragAclLength, 3);

      remaining.copy(frag, 5);
      remaining = remaining.slice(frag.length - 5);

      debug(`push fragment to acl queue: ${frag.toString('hex')}`);
      this.aclQueue.push({ handle, packet: frag });
    }

    void this.flushAcl();
  }

  /** Writes queued ACL packets while the controller has free buffers. */
  async flushAcl (): Promise<void> {
    const pendingPackets = (): number => {
      let totalPending = 0;
      for (const { pending } of this.aclConnections.values()) {
        totalPending += pending;
      }
      return totalPending;
    };

    debug(`flush - pending: ${pendingPackets()} queue length: ${this.aclQueue.length}`);

    const aclBuffers = await this.getAclBuffers();
    while (this.aclQueue.length > 0 && pendingPackets() < aclBuffers.num) {
      const { handle, packet } = this.aclQueue.shift() as QueuedAclPacket;
      const connection = this.aclConnections.get(handle);
      if (!connection) {
        continue;
      }
      connection.pending++;
      debug(`write acl data packet - writing: ${packet.toString('hex')}`);
      this.socket.write(packet);
    }
  }

  /** Entry point for everything read from the socket: events, ACL data and (echoed) commands. */
  onSocketData (data: Buffer): void {
    debug(`onSocketData: ${data.toString('hex')}`);

    const eventType = data.readUInt8(0);

    debug(`\tevent type = ${eventType}`);

    if (HCI_EVENT_PKT === eventType) {
      const subEventType = data.readUInt8(1);

      debug(`\tsub event type = ${subEventType}`);

      if (subEventType === EVT_DISCONN_COMPLETE) {
        const handle = data.readUInt16LE(4);
        const reason = data.readUInt8(6);

        debug(`\t\thandle = ${handle}`);
        debug(`\t\treason = ${reason}`);

        this.aclQueue = this.aclQueue.filter((acl) => acl.handle !== handle);
        this.aclConnections.delete(handle);
        void this.flushAcl();

        this.delegate.onDisconnComplete(handle, reason);
      } else if (subEventType === EVT_ENCRYPT_CHANGE) {
        const handle = data.readUInt16LE(4);
        const encrypt = data.readUInt8(6);

        debug(`\t\thandle = ${handle}`);
        debug(`\t\tencrypt = ${encrypt}`);

        this.delegate.onEncryptChange(handle, encrypt);
      } else if (subEventType === EVT_CMD_COMPLETE) {
        const cmd = data.readUInt16LE(4);
        const status = data.readUInt8(6);
        const result = data.slice(7);

        debug(`\t\tcmd = ${cmd}`);
        debug(`\t\tstatus = ${status}`);
        debug(`\t\tresult = ${result.toString('hex')}`);

        this.processCmdCompleteEvent(cmd, status, result);
      } else if (subEventType === EVT_CMD_STATUS) {
        const status = data.readUInt8(3);
        const cmd = data.readUInt16LE(5);

        debug(`\t\tstatus = ${status}`);
        debug(`\t\tcmd = ${cmd}`);

        this.processCmdStatusEvent(cmd, status);
      } else if (subEventType === EVT_LE_META_EVENT) {
        const leMetaEventLength = data.readUInt8(2);
        const leMetaEventType = data.readUInt8(3);
        const leMetaEventNumReports = data.readUInt8(4);
        const leMetaEventData = data.slice(5);

        debug(`\t\tLE meta event type = ${leMetaEventType}`);
        debug(`\t\tLE meta event data length = ${leMetaEventLength}`);
        debug(`\t\tLE meta event num reports = ${leMetaEventNumReports}`);
        debug(`\t\tLE meta event data = ${leMetaEventData.toString('hex')}`);

        this.processLeMetaEvent(
          leMetaEventType,
          leMetaEventNumReports,
          leMetaEventData
        );
      } else if (subEventType === EVT_NUMBER_OF_COMPLETED_PACKETS) {
        const handles = data.readUInt8(3);
        for (let h = 0; h < handles; h++) {
          const handle = data.readUInt16LE(4 + h * 4);
          const pkts = data.readUInt16LE(6 + h * 4);
          debug(`\thandle = ${handle}`);
          debug(`\t\tcompleted = ${pkts}`);

          const connection = this.aclConnections.get(handle);
          if (!connection) {
            debug('\t\tclosed');
            continue;
          }

          connection.pending -= pkts;

          if (connection.pending < 0) {
            connection.pending = 0;
          }
        }
        void this.flushAcl();
      }
    } else if (HCI_ACLDATA_PKT === eventType) {
      const flags = data.readUInt16LE(1) >> 12;
      const handle = data.readUInt16LE(1) & 0x0fff;

      if (ACL_START === flags) {
        const cid = data.readUInt16LE(7);

        const length = data.readUInt16LE(5);
        const pktData = data.slice(9);

        debug(`\t\tcid = ${cid}`);

        if (length === pktData.length) {
          debug(`\t\thandle = ${handle}`);
          debug(`\t\tdata = ${pktData.toString('hex')}`);

          this.delegate.onAclDataPkt(handle, cid, pktData);
        } else {
          this.handleBuffers[handle] = {
            length,
            cid,
            data: pktData
          };
        }
      } else if (ACL_CONT === flags) {
        const partial = this.handleBuffers[handle];
        if (!partial || !partial.data) {
          return;
        }

        partial.data = Buffer.concat([
          partial.data,
          data.slice(5)
        ]);

        if (partial.data.length === partial.length) {
          this.delegate.onAclDataPkt(handle, partial.cid, partial.data);

          delete this.handleBuffers[handle];
        }
      }
    } else if (HCI_COMMAND_PKT === eventType) {
      const cmd = data.readUInt16LE(1);
      const len = data.readUInt8(3);

      debug(`\t\tcmd = ${cmd}`);
      debug(`\t\tdata len = ${len}`);

      if (
        cmd === LE_SET_SCAN_ENABLE_CMD ||
        cmd === LE_SET_EXTENDED_SCAN_ENABLE_CMD
      ) {
        const enable = data.readUInt8(4) === 0x1;
        const filterDuplicates = data.readUInt8(5) === 0x1;

        debug('\t\t\tLE enable scan command');
        debug(`\t\t\tenable scanning = ${enable}`);
        debug(`\t\t\tfilter duplicates = ${filterDuplicates}`);

        this.delegate.onLeScanEnableSetCmd(enable, filterDuplicates);
      }
    }
  }

  onSocketError (error: NodeJS.ErrnoException): void {
    debug(`onSocketError: ${error.message}`);
    // Handle Socket Error
    if ('syscall' in error && error.syscall === 'socket creation failed') {
      this.setState('unsupported');
    } else if (error.code === 'EPERM') {
      // Permisions
      this.setState('unauthorized');
    } else if (error.message === 'Network is down') {
      // no-op
    }
  }

  /** Handles a Command Complete event; `result` is the return parameters after the status octet. */
  processCmdCompleteEvent (cmd: number, status: number, result: Buffer): void {
    if (cmd === RESET_CMD) {
      this.afterReset();
    } else if (cmd === LE_READ_LOCAL_SUPPORTED_FEATURES_CMD) {
      if (status === 0) {
        if (!this.extendedModeConfigured) {
          // Auto-detect from the LE Extended Advertising feature bit (12).
          this.isExtended = (result[1] & (1 << 4)) !== 0;
        }
        // LE Coded PHY feature bit (11).
        this.supportsCodedPhy = (result[1] & (1 << 3)) !== 0;
        // LE Data Packet Length Extension feature bit (5).
        this.supportsDataLengthExtension = (result[0] & (1 << 5)) !== 0;
        this.delegate.onLeFeatures?.(result);
      } else {
        debug(`le read local supported features failed - status: ${status}`);
      }

      if (this.codedPhy && this.supportsCodedPhy) {
        this.setCodedPhySupport();
      }

      if (this.supportsDataLengthExtension) {
        this.readLeMaxDataLength();
      } else {
        this.maxDataLength = null;
      }

      this.setEventMask();
      this.setLeEventMask();
      this.readLocalVersion();
      this.writeLeHostSupported();
      this.readLeHostSupported();
      this.readLeBufferSize();
      this.readBdAddr();
    } else if (cmd === LE_SET_DATA_LENGTH_CMD) {
      if (status !== 0) {
        debug(`le set data length failed - status: ${status}`);
      }
    } else if (cmd === LE_READ_MAX_DATA_LENGTH_CMD) {
      if (status !== 0 || result.length < 8) {
        debug(`le read maximum data length failed or returned a short result - status: ${status}, length: ${result.length}`);
        return;
      }

      const txOctets = result.readUInt16LE(0);
      const txTime = result.readUInt16LE(2);
      const rxOctets = result.readUInt16LE(4);
      const rxTime = result.readUInt16LE(6);

      debug(`\t\t\tsupported max tx octets = ${txOctets}`);
      debug(`\t\t\tsupported max tx time = ${txTime}`);
      debug(`\t\t\tsupported max rx octets = ${rxOctets}`);
      debug(`\t\t\tsupported max rx time = ${rxTime}`);

      if (txOctets < LE_MIN_TX_OCTETS || txTime < LE_MIN_TX_TIME) {
        debug(`le read maximum data length returned values below the spec minimum - octets: ${txOctets}, time: ${txTime}`);
        this.maxDataLength = null;
        return;
      }

      this.maxDataLength = {
        txOctets: Math.min(txOctets, LE_MAX_TX_OCTETS),
        txTime: Math.min(txTime, LE_MAX_TX_TIME)
      };
    } else if (cmd === READ_LE_HOST_SUPPORTED_CMD && status === 0) {
      const le = result.readUInt8(0);
      const simul = result.readUInt8(1);

      debug(`\t\t\tle = ${le}`);
      debug(`\t\t\tsimul = ${simul}`);
    } else if (cmd === READ_LOCAL_VERSION_CMD) {
      if (status !== 0 || result.length < 8) {
        debug(`read local version failed or returned a short result - status: ${status}, length: ${result.length}`);
        return;
      }

      const hciVer = result.readUInt8(0);
      const hciRev = result.readUInt16LE(1);
      const lmpVer = result.readInt8(3);
      const manufacturer = result.readUInt16LE(4);
      const lmpSubVer = result.readUInt16LE(6);

      if (hciVer < 0x06) {
        this.setState('unsupported');
      } else if (this.state !== 'poweredOn') {
        this.setScanEnabled(false, true);
        this.setScanParameters();
      }

      // Update manufacturer
      this.manufacturer = manufacturer;

      this.delegate.onReadLocalVersion?.({ hciVer, hciRev, lmpVer, manufacturer, lmpSubVer });
    } else if (cmd === READ_SUPPORTED_COMMANDS_CMD) {
      if (status !== 0 || result.length < 38) {
        debug(`read supported commands failed or returned a short result - status: ${status}, length: ${result.length}`);
        return;
      }

      const extendedScanParameters = result.readUInt8(37) & 0x10; // LE Set Extended Scan Parameters (Octet 37 - Bit 5)
      const extendedScan = result.readUInt8(37) & 0x20; // LE Set Extended Scan Enable (Octet 37 - Bit 6)

      debug(
        `Extended advertising features: parameters = ${
          extendedScanParameters ? 'true' : 'false'
        }, num = ${extendedScan ? 'true' : 'false'}`
      );
    } else if (cmd === READ_BD_ADDR_CMD) {
      if (status !== 0 || result.length < 6) {
        debug(`read bd addr failed or returned a short result - status: ${status}, length: ${result.length}`);
        return;
      }

      this.addressType = 'public';
      this.address = formatAddress(result);

      debug(`address = ${this.address}`);

      this.delegate.onAddressChange(this.address);
    } else if (
      cmd === LE_SET_SCAN_PARAMETERS_CMD ||
      cmd === LE_SET_EXTENDED_SCAN_PARAMETERS_CMD
    ) {
      this.setState('poweredOn');

      this.delegate.onLeScanParametersSet();
    } else if (
      cmd === LE_SET_SCAN_ENABLE_CMD ||
      cmd === LE_SET_EXTENDED_SCAN_ENABLE_CMD
    ) {
      this.delegate.onLeScanEnableSet(status);
    } else if (cmd === READ_RSSI_CMD) {
      const handle = result.readUInt16LE(0);
      const rssi = result.readInt8(2);

      debug(`\t\t\thandle = ${handle}`);
      debug(`\t\t\trssi = ${rssi}`);

      this.delegate.onRssiRead(handle, rssi);
    } else if (cmd === LE_READ_BUFFER_SIZE_CMD) {
      const aclLength = status === 0 ? result.readUInt16LE(0) : 0;
      const aclNum = status === 0 ? result.readUInt8(2) : 0;

      /* Spec Vol 4 Part E.7.8
      /* No dedicated LE Buffer exists. Use the HCI_Read_Buffer_Size command. */
      if (aclLength === 0 || aclNum === 0) {
        debug(`using br/edr buffer size - le status: ${status}`);
        this.readBufferSize();
      } else {
        debug(`le buffer size: length = ${aclLength}, num = ${aclNum}`);
        this.setAclBuffers(aclLength, aclNum);
      }
    } else if (cmd === READ_BUFFER_SIZE_CMD) {
      const aclLength = status === 0 ? result.readUInt16LE(0) : 0;
      const aclNum = status === 0 ? result.readUInt16LE(3) : 0;

      if (aclLength === 0 || aclNum === 0) {
        debug(`no usable buffer size reported - falling back to le minimum - status: ${status}`);
        this.setAclBuffers(LE_MIN_ACL_LENGTH, 1);
      } else {
        debug(`buffer size: length = ${aclLength}, num = ${aclNum}`);
        this.setAclBuffers(aclLength, aclNum);
      }
    }
  }

  /**
   * Dispatches an LE Meta event. `firstParameter` is the octet following the
   * subevent code: a status, a report count or (data length change) the low
   * byte of the connection handle, depending on the subevent.
   */
  processLeMetaEvent (eventType: number, firstParameter: number, data: Buffer): void {
    if (eventType === EVT_LE_CONN_COMPLETE) {
      this.processLeConnComplete(firstParameter, data);
    } else if (eventType === EVT_LE_ENHANCED_CONN_COMPLETE) {
      this.processLeEnhancedConnComplete(firstParameter, data);
    } else if (eventType === EVT_LE_ADVERTISING_REPORT) {
      this.processLeAdvertisingReport(firstParameter, data);
    } else if (eventType === EVT_LE_EXTENDED_ADVERTISING_REPORT) {
      this.processLeExtendedAdvertisingReport(firstParameter, data);
    } else if (eventType === EVT_LE_CONN_UPDATE_COMPLETE) {
      this.processLeConnUpdateComplete(firstParameter, data);
    } else if (eventType === EVT_LE_DATA_LENGTH_CHANGE) {
      this.processLeDataLengthChange(firstParameter, data);
    }
  }

  // The caller has already consumed the first parameter octet, which for this subevent is the
  // low byte of the connection handle rather than a status or report count.
  processLeDataLengthChange (handleLowByte: number, data: Buffer): void {
    if (data.length < 9) {
      debug(`processLeDataLengthChange: ignoring illegal packet (too short: ${data.length} < 9)`);
      return;
    }

    const handle = handleLowByte | (data.readUInt8(0) << 8);
    const maxTxOctets = data.readUInt16LE(1);
    const maxTxTime = data.readUInt16LE(3);
    const maxRxOctets = data.readUInt16LE(5);
    const maxRxTime = data.readUInt16LE(7);

    debug(`\t\t\thandle = ${handle}`);
    debug(`\t\t\tmax tx octets = ${maxTxOctets}`);
    debug(`\t\t\tmax tx time = ${maxTxTime}`);
    debug(`\t\t\tmax rx octets = ${maxRxOctets}`);
    debug(`\t\t\tmax rx time = ${maxRxTime}`);

    this.delegate.onLeDataLengthChange?.({ handle, maxTxOctets, maxTxTime, maxRxOctets, maxRxTime });
  }

  processLeConnComplete (status: number, data: Buffer): void {
    if (data.length < 17) {
      console.warn(`processLeConnComplete: Caught illegal packet (too short: ${data.length} < 17)`);
      return;
    }
    const allZero = data.every(byte => byte === 0);
    if (status === 0 && allZero) {
      return;
    }
    const handle = data.readUInt16LE(0);
    const role = data.readUInt8(2);
    const addressType: HciAddressType = data.readUInt8(3) === 0x01 ? 'random' : 'public';
    const address = formatAddress(data.slice(4, 10));
    const interval = data.readUInt16LE(10) * 1.25;
    const latency = data.readUInt16LE(12); // TODO: multiplier?
    const supervisionTimeout = data.readUInt16LE(14) * 10;
    const masterClockAccuracy = data.readUInt8(16); // TODO: multiplier?

    debug(`\t\t\thandle = ${handle}`);
    debug(`\t\t\trole = ${role}`);
    debug(`\t\t\taddress type = ${addressType}`);
    debug(`\t\t\taddress = ${address}`);
    debug(`\t\t\tinterval = ${interval}`);
    debug(`\t\t\tlatency = ${latency}`);
    debug(`\t\t\tsupervision timeout = ${supervisionTimeout}`);
    debug(`\t\t\tmaster clock accuracy = ${masterClockAccuracy}`);

    if (status === 0) {
      this.aclConnections.set(handle, { pending: 0 });
      this.setLeDataLength(handle);
    }

    const event: LeConnCompleteEvent = {
      status,
      handle,
      role,
      addressType,
      address,
      interval,
      latency,
      supervisionTimeout,
      masterClockAccuracy
    };
    const attemptToken = this.takePendingAttemptToken([address], status !== 0 && allZero);
    if (attemptToken !== undefined) {
      event.attemptToken = attemptToken;
    }
    this.delegate.onLeConnComplete(event);
  }

  processLeEnhancedConnComplete (status: number, data: Buffer): void {
    if (data.length < 29) {
      console.warn(`processLeEnhancedConnComplete: Caught illegal packet (too short: ${data.length} < 29)`);
      return;
    }
    const allZero = data.every(byte => byte === 0);
    if (status === 0 && allZero) {
      return;
    }
    const handle = data.readUInt16LE(0);
    const role = data.readUInt8(2);
    const addressType: HciAddressType = data.readUInt8(3) === 0x01 ? 'random' : 'public';
    const address = formatAddress(data.slice(4, 10));
    const localResolvablePrivateAddress = formatAddress(data.slice(10, 16));
    const peerResolvablePrivateAddress = formatAddress(data.slice(16, 22));
    const interval = data.readUInt16LE(22) * 1.25;
    const latency = data.readUInt16LE(24); // TODO: multiplier?
    const supervisionTimeout = data.readUInt16LE(26) * 10;
    const masterClockAccuracy = data.readUInt8(28); // TODO: multiplier?

    debug(`\t\t\thandle = ${handle}`);
    debug(`\t\t\trole = ${role}`);
    debug(`\t\t\taddress type = ${addressType}`);
    debug(`\t\t\taddress = ${address}`);
    debug(`\t\t\tLocal resolvable private address = ${localResolvablePrivateAddress}`);
    debug(`\t\t\tPeer resolvable private address = ${peerResolvablePrivateAddress}`);
    debug(`\t\t\tinterval = ${interval}`);
    debug(`\t\t\tlatency = ${latency}`);
    debug(`\t\t\tsupervision timeout = ${supervisionTimeout}`);
    debug(`\t\t\tmaster clock accuracy = ${masterClockAccuracy}`);

    if (status === 0) {
      this.aclConnections.set(handle, { pending: 0 });
      this.setLeDataLength(handle);
    }

    const event: LeConnCompleteEvent = {
      status,
      handle,
      role,
      addressType,
      address,
      interval,
      latency,
      supervisionTimeout,
      masterClockAccuracy,
      peerResolvablePrivateAddress
    };
    const attemptToken = this.takePendingAttemptToken(
      [address, peerResolvablePrivateAddress],
      status !== 0 && allZero
    );
    if (attemptToken !== undefined) {
      event.attemptToken = attemptToken;
    }
    this.delegate.onLeConnComplete(event);
  }

  processLeAdvertisingReport (numReports: number, data: Buffer): void {
    try {
      for (let i = 0; i < numReports; i++) {
        const type = data.readUInt8(0);
        const addressType: HciAddressType = data.readUInt8(1) === 0x01 ? 'random' : 'public';
        const address = formatAddress(data.slice(2, 8));
        const eirLength = data.readUInt8(8);
        const eir = data.slice(9, eirLength + 9);
        const rssi = data.readInt8(eirLength + 9);

        debug(`\t\t\ttype = ${type}`);
        debug(`\t\t\taddress = ${address}`);
        debug(`\t\t\taddress type = ${addressType}`);
        debug(`\t\t\teir = ${eir.toString('hex')}`);
        debug(`\t\t\trssi = ${rssi}`);

        this.delegate.onLeAdvertisingReport({ status: 0, type, address, addressType, eir, rssi });

        data = data.slice(eirLength + 10);
      }
    } catch (e) {
      console.warn(
        `processLeAdvertisingReport: Caught illegal packet (buffer overflow): ${e}`
      );
    }
  }

  processLeExtendedAdvertisingReport (numReports: number, data: Buffer): void {
    for (let i = 0; i < numReports; i++) {
      let type: number;
      let address: string;
      let addressType: HciAddressType;
      let txpower: number;
      let rssi: number;
      let eir: Buffer;
      let eirLength: number;

      try {
        if (data.length < 24) {
          console.warn(
            `processLeExtendedAdvertisingReport: Caught illegal packet (too short: ${data.length} < 24)`
          );
          break;
        }
        type = data.readUInt16LE(0);
        addressType = data.readUInt8(2) === 0x01 ? 'random' : 'public';
        address = formatAddress(data.slice(3, 9));
        const primaryPHY = data.readUInt8(9);
        const secondaryPHY = data.readUInt8(10);
        const sid = data.readUInt8(11);
        txpower = data.readUInt8(12);
        rssi = data.readInt8(13);
        const periodicAdvInterval = data.readUInt16LE(14);
        const directAddressType =
          data.readUInt8(16) === 0x01 ? 'random' : 'public';
        const directAddress = formatAddress(data.slice(17, 23));
        eirLength = data.readUInt8(23);
        if (data.length < 24 + eirLength) {
          console.warn(
            `processLeExtendedAdvertisingReport: Caught illegal packet (eir length ${eirLength} exceeds remaining ${data.length - 24})`
          );
          break;
        }
        eir = data.slice(24, 24 + eirLength);

        debug(`\t\t\ttype = ${type}`);
        debug(`\t\t\taddress = ${address}`);
        debug(`\t\t\taddress type = ${addressType}`);
        debug(`\t\t\tprimary phy = ${primaryPHY.toString(16)}`);
        debug(`\t\t\tsecondary phy = ${secondaryPHY.toString(16)}`);
        debug(`\t\t\tSID = ${sid.toString(16)}`);
        debug(`\t\t\tTX power = ${txpower}`);
        debug(`\t\t\tRSSI = ${rssi}`);
        debug(`\t\t\tperiodic advertising interval = ${periodicAdvInterval} msec`);
        debug(`\t\t\tdirect address type = ${directAddressType}`);
        debug(`\t\t\tdirect address = ${directAddress}`);
        debug(`\t\t\teir length = ${eirLength}`);
        debug(`\t\t\teir = ${eir.toString('hex')}`);
      } catch (e) {
        console.warn(
          `processLeExtendedAdvertisingReport: Caught illegal packet (buffer overflow): ${e}`
        );
        break;
      }

      this.delegate.onLeExtendedAdvertisingReport({ status: 0, type, address, addressType, eir, rssi, txpower });

      data = data.slice(eirLength + 24);
    }
  }

  processLeConnUpdateComplete (status: number, data: Buffer): void {
    const handle = data.readUInt16LE(0);
    const interval = data.readUInt16LE(2) * 1.25;
    const latency = data.readUInt16LE(4); // TODO: multiplier?
    const supervisionTimeout = data.readUInt16LE(6) * 10;

    debug(`\t\t\thandle = ${handle}`);
    debug(`\t\t\tinterval = ${interval}`);
    debug(`\t\t\tlatency = ${latency}`);
    debug(`\t\t\tsupervision timeout = ${supervisionTimeout}`);

    this.delegate.onLeConnUpdateComplete(status, handle, interval, latency, supervisionTimeout);
  }

  processCmdStatusEvent (cmd: number, status: number): void {
    if (cmd === LE_CREATE_CONN_CMD || cmd === LE_CREATE_EXTENDED_CONN_CMD) {
      if (status !== 0) {
        const pendingLeConn = this.pendingLeConn;
        this.pendingLeConn = null;
        // No LE Connection Complete follows a failed Command Status. Carry the
        // identity and private token recorded when this instance wrote the command;
        // bindings will ignore failures that have no matching local attempt.
        const event: LeConnCompleteEvent = { status };
        if (pendingLeConn) {
          event.addressType = pendingLeConn.addressType;
          event.address = pendingLeConn.address;
          if (pendingLeConn.token !== undefined) {
            event.attemptToken = pendingLeConn.token;
          }
        }
        this.delegate.onLeConnComplete(event);
      }
    }
  }

  /**
   * Decides whether a connection completion answers the attempt this instance
   * started: either one of the reported addresses is the one we asked for, or
   * the controller reported a failure without any identity at all. A matching
   * attempt is consumed and its token (if it had one) returned.
   */
  private takePendingAttemptToken (
    reportedAddresses: string[],
    anonymousFailure: boolean
  ): ConnectionAttemptToken | undefined {
    const pendingLeConn = this.pendingLeConn;
    if (!pendingLeConn) {
      return undefined;
    }

    const pendingAddress = normalizeAddress(pendingLeConn.address);
    const matchesPendingAttempt =
      reportedAddresses.some((candidate) => normalizeAddress(candidate) === pendingAddress) ||
      anonymousFailure;
    if (!matchesPendingAttempt) {
      return undefined;
    }

    this.pendingLeConn = null;
    return pendingLeConn.token;
  }

  /** Rewrites the configuration HCI_Reset wiped, then runs whatever was waiting for the reset. */
  private afterReset (): void {
    // HCI_Reset clears the default PHY, so it has to be rewritten here. Support stays false
    // until the first LE_READ_LOCAL_SUPPORTED_FEATURES reply, so the initial reset writes nothing.
    if (this.codedPhy && this.supportsCodedPhy) {
      this.setCodedPhySupport();
    }
    this.setEventMask();
    this.setLeEventMask();
    this.readLocalVersion();
    this.readBdAddr();

    // Only the callbacks registered before this point run, each at most once; one that
    // throws leaves the ones behind it registered for the next reset.
    for (const callback of this.afterResetCallbacks.slice()) {
      const index = this.afterResetCallbacks.indexOf(callback);
      if (index !== -1) {
        this.afterResetCallbacks.splice(index, 1);
      }
      callback();
    }
  }

  private setState (state: AdapterState): void {
    // If we are powered on and we are powered off, clean up
    if (this.state === 'poweredOn' && state === 'poweredOff') {
      this.aclConnections.clear();
      this.aclQueue = [];
      this.pendingLeConn = null;
    }
    this.state = state;

    this.delegate.onStateChange(state);
  }
}
