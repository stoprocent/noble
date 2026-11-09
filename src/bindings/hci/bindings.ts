import { Deferred } from '../../common/deferred';
import {
  AdapterStateError,
  ConnectionCancelledError,
  DisconnectedError,
  NobleError
} from '../../common/errors';
import type { AdapterState, ConnectOptions } from '../../types';
import type { Bindings, BindingsDelegate, CharacteristicInfo } from '../bindings';
import { AclStream } from './acl-stream';
import { Gap } from './gap';
import { Gatt } from './gatt';
import { HCI_STATUS, Hci } from './hci';
import { Signaling } from './signaling';
import type {
  ConnectionAttemptToken,
  ConnectionParameterUpdateRequest,
  GapDelegate,
  GapDiscovery,
  HciAddressType,
  HciBindingsOptions,
  HciConnectOptions,
  HciDelegate,
  LeAdvertisingReport,
  LeConnCompleteEvent,
  LeExtendedAdvertisingReport
} from './types';

/** One entry of the connection queue; the head is the attempt in flight. */
interface QueuedConnection {
  id: string;
  address: string;
  addressType: HciAddressType;
  params: HciConnectOptions;
  deferred: Deferred<void>;
}

/** Everything that lives exactly as long as one LE link. */
interface Connection {
  handle: number;
  peripheralId: string;
  aclStream: AclStream;
  gatt: Gatt;
  signaling: Signaling;
  rssiReads: Deferred<number>[];
}

const HCI_HARDWARE_FAILURE = 0x03;

const UNAUTHORIZED_WARNING = [
  'adapter state unauthorized, please run as root or with sudo',
  '               or see README for information on running without root/sudo:',
  '               https://github.com/sandeepmistry/noble#running-on-linux'
].join('\n');

const UNSUPPORTED_WARNING = [
  'adapter does not support Bluetooth Low Energy (BLE, Bluetooth Smart).',
  '               Try to run with environment variable:',
  '               [sudo] NOBLE_HCI_DEVICE_ID=x node ...'
].join('\n');

function adapterStateError (state: AdapterState | null): AdapterStateError {
  const name = state || 'unknown';
  return new AdapterStateError(`Cannot connect while adapter state is ${name} (not poweredOn)`, name);
}

/**
 * The HCI socket backend: orchestrates `Hci`, `Gap` and, per connection, an
 * `AclStream`, a `Gatt` client and L2CAP `Signaling`.
 */
export class HciBindings implements Bindings, HciDelegate, GapDelegate {
  private readonly options: HciBindingsOptions;

  private state: AdapterState | null = null;
  private isScanning = false;
  private isScanningStarted = false;
  private scanServiceUuids: string[] = [];

  /** What discovery told us about each peripheral id. */
  private readonly addresses = new Map<string, string>();
  private readonly addressTypes = new Map<string, HciAddressType>();
  private readonly connectable = new Map<string, boolean>();
  private readonly scannable = new Map<string, boolean>();

  private pendingConnectionId: string | null = null;
  private pendingConnectionAddress: string | null = null;
  private pendingConnectionToken: ConnectionAttemptToken | null = null;
  private cancelledConnectionId: string | null = null;
  private connectionQueue: QueuedConnection[] = [];

  /** Live links by HCI connection handle, and the handle of each connected peripheral id. */
  private readonly connections = new Map<number, Connection>();
  private readonly handles = new Map<string, number>();

  private scanParametersWaiters: Deferred<void>[] = [];
  private scanStartWaiters: Deferred<void>[] = [];
  private scanStopWaiters: Deferred<void>[] = [];

  private delegate: BindingsDelegate | null = null;
  private hci: Hci | null = null;
  private gap: Gap | null = null;

  private readonly sigIntHandler = (): void => this.onSigInt();
  private readonly exitHandler = (): void => this.stop();

  constructor (options: HciBindingsOptions = {}) {
    this.options = { ...options };
  }

  start (delegate: BindingsDelegate): void {
    this.delegate = delegate;

    /* Add exit handlers after `init()` has completed. If no adaptor
    is present it can throw an exception - in which case we don't
    want to try and clear up afterwards (issue #502) */
    process.on('SIGINT', this.sigIntHandler);
    process.on('exit', this.exitHandler);

    // Both layers report to us; the scan-related HCI events are forwarded into the gap
    this.hci = new Hci(this.options, this);
    this.gap = new Gap(this.hci, this);

    // Initialize the hci
    this.hci.init();
  }

  stop (): void {
    process.removeListener('exit', this.exitHandler);
    process.removeListener('SIGINT', this.sigIntHandler);

    if (!this.hci || !this.gap) {
      // never started
      return;
    }

    void this.stopScanning();
    for (const handle of this.connections.keys()) {
      this.hci.disconnect(handle);
    }
    this.hci.stop();
  }

  setAddress (address: string): void {
    this.requireHci().setAddress(address);
  }

  setScanParameters (interval?: number, window?: number): Promise<void> {
    if (!this.gap) {
      return Promise.reject(notStarted());
    }

    const waiter = new Deferred<void>();
    this.scanParametersWaiters.push(waiter);
    this.gap.setScanParameters(interval, window);
    return waiter.promise;
  }

  startScanning (serviceUuids: string[], allowDuplicates: boolean): Promise<void> {
    if (!this.gap) {
      return Promise.reject(notStarted());
    }

    if (this.isScanning) {
      this.delegate?.onScanStart();
      return Promise.resolve();
    }

    const waiter = new Deferred<void>();
    this.scanStartWaiters.push(waiter);

    if (this.isScanningStarted) {
      // a start is already in flight: join it
      return waiter.promise;
    }

    this.isScanningStarted = true;
    this.scanServiceUuids = serviceUuids || [];
    this.gap.startScanning(allowDuplicates);
    return waiter.promise;
  }

  stopScanning (): Promise<void> {
    if (!this.gap) {
      return Promise.reject(notStarted());
    }

    let waiter: Deferred<void> | null = null;

    if (this.isScanning) {
      // Registered before the command goes out, so a synchronous stop is not missed.
      waiter = new Deferred<void>();
      this.scanStopWaiters.push(waiter);
    }

    this.gap.stopScanning();

    if (!waiter) {
      this.delegate?.onScanStop();
      return Promise.resolve();
    }
    return waiter.promise;
  }

  addressToId (address: string): string {
    return address.replace(/:/g, '').toLowerCase();
  }

  connect (peripheralId: string, options: ConnectOptions = {}): Promise<void> {
    if (this.state !== 'poweredOn') {
      return Promise.reject(adapterStateError(this.state));
    }

    const queued = this.connectionQueue.find(connection => connection.id === peripheralId);
    if (queued) {
      return queued.deferred.promise;
    }

    let address = this.addresses.get(peripheralId);
    let addressType: HciAddressType = this.addressTypes.get(peripheralId) || 'random';

    if (!address) {
      address = (peripheralId.match(/.{1,2}/g) ?? []).join(':');
      addressType = options && options.addressType ? options.addressType : 'random';
    }

    // Add connection request to queue
    const deferred = new Deferred<void>();
    this.connectionQueue.push({
      id: peripheralId,
      address,
      addressType,
      params: options,
      deferred
    });

    this.processConnectionQueue();

    return deferred.promise;
  }

  cancelConnect (peripheralId: string): void {
    // TODO: check if it was not in the queue and only then issue cancel on hci
    const cancelled = this.connectionQueue.filter(c => c.id === peripheralId);
    this.connectionQueue = this.connectionQueue.filter(c => c.id !== peripheralId);

    if (this.pendingConnectionId === peripheralId) {
      // The controller still owes us the completion of this attempt; the
      // next queue entry only starts once it arrived (see onLeConnComplete).
      this.cancelledConnectionId = peripheralId;
    }

    for (const connection of cancelled) {
      connection.deferred.reject(new ConnectionCancelledError());
    }

    this.requireHci().cancelConnect();
  }

  disconnect (peripheralId: string): void {
    const handle = this.handles.get(peripheralId);

    if (handle !== undefined) {
      this.requireHci().disconnect(handle);
    }
  }

  updateRssi (peripheralId: string): Promise<number> {
    const connection = this.connectionOf(peripheralId);

    if (!connection) {
      return Promise.reject(unknownPeripheral(peripheralId));
    }

    const read = new Deferred<number>();
    connection.rssiReads.push(read);
    this.requireHci().readRssi(connection.handle);
    return read.promise;
  }

  discoverServices (peripheralId: string, serviceUuids: string[]): Promise<string[]> {
    return this.withGatt(peripheralId, gatt => gatt.discoverServices(serviceUuids || []));
  }

  discoverIncludedServices (peripheralId: string, serviceUuid: string, serviceUuids: string[]): Promise<string[]> {
    return this.withGatt(peripheralId, gatt => gatt.discoverIncludedServices(serviceUuid, serviceUuids || []));
  }

  discoverCharacteristics (peripheralId: string, serviceUuid: string, characteristicUuids: string[]): Promise<CharacteristicInfo[]> {
    return this.withGatt(peripheralId, gatt => gatt.discoverCharacteristics(serviceUuid, characteristicUuids || []));
  }

  read (peripheralId: string, serviceUuid: string, characteristicUuid: string): Promise<Buffer> {
    return this.withGatt(peripheralId, gatt => gatt.read(serviceUuid, characteristicUuid));
  }

  write (peripheralId: string, serviceUuid: string, characteristicUuid: string, data: Buffer, withoutResponse: boolean): Promise<void> {
    return this.withGatt(peripheralId, gatt => gatt.write(serviceUuid, characteristicUuid, data, withoutResponse));
  }

  broadcast (peripheralId: string, serviceUuid: string, characteristicUuid: string, broadcast: boolean): Promise<void> {
    return this.withGatt(peripheralId, gatt => gatt.broadcast(serviceUuid, characteristicUuid, broadcast));
  }

  notify (peripheralId: string, serviceUuid: string, characteristicUuid: string, notify: boolean): Promise<void> {
    return this.withGatt(peripheralId, gatt => gatt.notify(serviceUuid, characteristicUuid, notify));
  }

  discoverDescriptors (peripheralId: string, serviceUuid: string, characteristicUuid: string): Promise<string[]> {
    return this.withGatt(peripheralId, gatt => gatt.discoverDescriptors(serviceUuid, characteristicUuid));
  }

  readValue (peripheralId: string, serviceUuid: string, characteristicUuid: string, descriptorUuid: string): Promise<Buffer> {
    return this.withGatt(peripheralId, gatt => gatt.readValue(serviceUuid, characteristicUuid, descriptorUuid));
  }

  writeValue (peripheralId: string, serviceUuid: string, characteristicUuid: string, descriptorUuid: string, data: Buffer): Promise<void> {
    return this.withGatt(peripheralId, gatt => gatt.writeValue(serviceUuid, characteristicUuid, descriptorUuid, data));
  }

  readHandle (peripheralId: string, handle: number): Promise<Buffer> {
    return this.withGatt(peripheralId, gatt => gatt.readHandle(handle));
  }

  writeHandle (peripheralId: string, handle: number, data: Buffer, withoutResponse: boolean): Promise<void> {
    return this.withGatt(peripheralId, gatt => gatt.writeHandle(handle, data, withoutResponse));
  }

  // ---------------------------------------------------------------------------
  // HciDelegate
  // ---------------------------------------------------------------------------

  onStateChange (state: AdapterState): void {
    if (this.state === state) {
      return;
    }

    const previousState = this.state;
    this.state = state;

    // Tear down live and queued work whenever the adapter leaves poweredOn.
    if (previousState === 'poweredOn' && state !== 'poweredOn') {
      for (const handle of [...this.connections.keys()]) {
        this.onDisconnComplete(handle, HCI_HARDWARE_FAILURE);
      }

      const abandoned = this.connectionQueue;
      this.connectionQueue = [];
      this.pendingConnectionId = null;
      this.pendingConnectionAddress = null;
      this.pendingConnectionToken = null;
      this.cancelledConnectionId = null;

      for (const connection of abandoned) {
        connection.deferred.reject(adapterStateError(state));
      }

      // After the connection queue is emptied: nothing may start connecting from here.
      this.resetScanning(state);
    }

    if (state === 'unauthorized') {
      this.delegate?.onWarning(UNAUTHORIZED_WARNING);
    } else if (state === 'unsupported') {
      this.delegate?.onWarning(UNSUPPORTED_WARNING);
    }

    this.delegate?.onStateChange(state);
  }

  onAddressChange (address: string): void {
    this.delegate?.onAddressChange(address);
  }

  onError (error: Error): void {
    this.delegate?.onWarning(String(error.message ?? error));
  }

  onLeScanParametersSet (): void {
    this.gap?.onHciLeScanParametersSet();
  }

  onLeScanEnableSet (status: number): void {
    this.gap?.onHciLeScanEnableSet(status);
  }

  onLeScanEnableSetCmd (enable: boolean, filterDuplicates: boolean): void {
    this.gap?.onLeScanEnableSetCmd(enable, filterDuplicates);
  }

  onLeAdvertisingReport (report: LeAdvertisingReport): void {
    this.gap?.onHciLeAdvertisingReport(report);
  }

  onLeExtendedAdvertisingReport (report: LeExtendedAdvertisingReport): void {
    this.gap?.onHciLeExtendedAdvertisingReport(report);
  }

  onLeConnComplete (event: LeConnCompleteEvent): void {
    const { status, handle, role, addressType, address, peerResolvablePrivateAddress, attemptToken } = event;

    if (role !== 0 && role !== undefined) {
      // not master, ignore
      return;
    }

    const hci = this.requireHci();

    let peripheralId: string | null = null;
    let error: Error | null = null;
    const currentConn = this.connectionQueue[0] as QueuedConnection | undefined;
    const completionAddresses = [address, peerResolvablePrivateAddress]
      .filter((candidate): candidate is string => typeof candidate === 'string')
      .map(candidate => this.addressToId(candidate));
    const matchesPendingAttempt = Boolean(
      this.pendingConnectionId &&
      ((attemptToken && attemptToken === this.pendingConnectionToken) ||
        (this.pendingConnectionAddress &&
          completionAddresses.includes(this.pendingConnectionAddress)))
    );
    const pendingConn =
      matchesPendingAttempt && currentConn && this.pendingConnectionId === currentConn.id
        ? currentConn
        : null;
    const matchesCancelledConnection = Boolean(
      matchesPendingAttempt &&
      this.cancelledConnectionId &&
      this.pendingConnectionId === this.cancelledConnectionId
    );

    let linkHandle: number | null = null;

    if (status === 0 && handle !== undefined && address !== undefined && addressType !== undefined) {
      linkHandle = handle;

      // A link that answers our own attempt belongs to the id connect() was
      // called with. The two only differ when the controller reports the
      // peer's identity address for an attempt that matched by its resolvable
      // private address.
      const addressId = this.addressToId(address);
      peripheralId = pendingConn ? pendingConn.id : addressId;

      // Check if address is already known
      if (!this.addresses.has(addressId)) {
        // Simulate discovery if address is not known
        this.scanServiceUuids = []; // We have to set this to fake scan

        this.onDiscover({
          status,
          address,
          addressType,
          connectable: true, // Assuming the device is connectable
          scannable: false, // Assuming the device is not scannable
          advertisement: {
            serviceUuids: [], // Actual service UUID data needed here
            serviceData: [] // Actual service data needed here
          },
          rssi: 127
        });
      }

      const connectionParams: HciConnectOptions = pendingConn ? pendingConn.params : {};
      this.addConnection(hci, handle, peripheralId, addressType, address, connectionParams && connectionParams.mtu);
    } else {
      const statusMessage = HCI_STATUS[status] || 'HCI Error: Unknown';
      const errorCode = ` (0x${status.toString(16)})`;
      error = new NobleError(statusMessage + errorCode);
    }

    if (matchesCancelledConnection) {
      this.pendingConnectionId = null;
      this.pendingConnectionAddress = null;
      this.pendingConnectionToken = null;
      this.cancelledConnectionId = null;
      if (linkHandle !== null) {
        // The link came up although the attempt was cancelled: take it down again.
        hci.disconnect(linkHandle);
      }
      this.processConnectionQueue();
    } else if (pendingConn) {
      this.connectionQueue.shift();
      this.pendingConnectionId = null;
      this.pendingConnectionAddress = null;
      this.pendingConnectionToken = null;
      if (error) {
        pendingConn.deferred.reject(error);
      } else {
        pendingConn.deferred.resolve();
      }
      this.processConnectionQueue();
    } else if (peripheralId !== null && linkHandle !== null) {
      // Preserve the existing behavior of adopting unsolicited successful links,
      // without letting them consume or inherit parameters from a pending attempt.
      this.delegate?.onConnect(peripheralId);
    }
  }

  onLeConnUpdateComplete (
    _status: number,
    _handle: number,
    _interval: number,
    _latency: number,
    _supervisionTimeout: number
  ): void {
    // no-op
  }

  onDisconnComplete (handle: number, reason: number): void {
    const connection = this.connections.get(handle);

    if (!connection) {
      this.delegate?.onWarning(`unknown handle ${handle} disconnected!`);
      return;
    }

    this.connections.delete(handle);
    if (this.handles.get(connection.peripheralId) === handle) {
      this.handles.delete(connection.peripheralId);
    }

    const error = new DisconnectedError(reason);
    connection.aclStream.close();
    connection.gatt.close(error);
    for (const read of connection.rssiReads) {
      read.reject(error);
    }
    connection.rssiReads = [];

    this.delegate?.onDisconnect(connection.peripheralId, reason);
  }

  onEncryptChange (handle: number, encrypt: number): void {
    this.connections.get(handle)?.aclStream.pushEncrypt(encrypt);
  }

  onAclDataPkt (handle: number, cid: number, data: Buffer): void {
    this.connections.get(handle)?.aclStream.push(cid, data);
  }

  onRssiRead (handle: number, rssi: number): void {
    const connection = this.connections.get(handle);

    if (!connection) {
      return;
    }

    connection.rssiReads.shift()?.resolve(rssi);
    this.delegate?.onRssi(connection.peripheralId, rssi);
  }

  // ---------------------------------------------------------------------------
  // GapDelegate
  // ---------------------------------------------------------------------------

  onScanParametersSet (): void {
    const waiters = this.scanParametersWaiters;
    this.scanParametersWaiters = [];
    for (const waiter of waiters) {
      waiter.resolve();
    }
  }

  onScanStart (filterDuplicates: boolean): void {
    if (this.isScanningStarted) {
      this.isScanning = true;
    }
    this.delegate?.onScanStart(filterDuplicates);

    const waiters = this.scanStartWaiters;
    this.scanStartWaiters = [];
    for (const waiter of waiters) {
      waiter.resolve();
    }
  }

  onScanStop (): void {
    this.isScanning = false;
    this.isScanningStarted = false;
    this.delegate?.onScanStop();

    const waiters = this.scanStopWaiters;
    this.scanStopWaiters = [];
    for (const waiter of waiters) {
      waiter.resolve();
    }

    this.processConnectionQueue();
  }

  onDiscover (discovery: GapDiscovery): void {
    const { address, addressType, connectable, scannable, advertisement, rssi } = discovery;

    let serviceUuids = advertisement.serviceUuids || [];
    const serviceData = advertisement.serviceData || [];
    let hasScanServiceUuids = this.scanServiceUuids.length === 0;

    if (!hasScanServiceUuids) {
      serviceUuids = serviceUuids.slice();

      for (const entry of serviceData) {
        serviceUuids.push(entry.uuid);
      }

      hasScanServiceUuids = serviceUuids.some(uuid => this.scanServiceUuids.indexOf(uuid) !== -1);
    }

    if (hasScanServiceUuids) {
      const id = this.addressToId(address);
      this.addresses.set(id, address);
      this.addressTypes.set(id, addressType);
      this.connectable.set(id, connectable);
      this.scannable.set(id, scannable);

      this.delegate?.onDiscover({
        id,
        address,
        addressType,
        connectable,
        scannable,
        advertisement,
        rssi
      });
    }
  }

  // ---------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------

  private onSigInt (): void {
    const sigIntListeners = process.listeners('SIGINT');

    if (sigIntListeners[sigIntListeners.length - 1] === this.sigIntHandler) {
      // we are the last listener, so exit
      // this will trigger onExit, and clean up
      // eslint-disable-next-line no-process-exit
      process.exit(1);
    }
  }

  /**
   * The adapter left poweredOn, so whatever scan there was is over. A down
   * adapter completes no command, which means the scan stop cannot be learned
   * from the gap: the scan state of both layers is reset here and everybody
   * waiting on it is settled.
   */
  private resetScanning (state: AdapterState): void {
    const wasScanning = this.isScanning || this.isScanningStarted;

    this.isScanning = false;
    this.isScanningStarted = false;
    this.gap?.reset();

    const parametersWaiters = this.scanParametersWaiters;
    const startWaiters = this.scanStartWaiters;
    const stopWaiters = this.scanStopWaiters;
    this.scanParametersWaiters = [];
    this.scanStartWaiters = [];
    this.scanStopWaiters = [];

    if (wasScanning) {
      this.delegate?.onScanStop();
    }

    const name = state || 'unknown';
    for (const waiter of parametersWaiters) {
      waiter.reject(new AdapterStateError(`Could not set scan parameters, adapter state is ${name} (not poweredOn)`, name));
    }
    for (const waiter of startWaiters) {
      waiter.reject(new AdapterStateError(`Could not start scanning, adapter state is ${name} (not poweredOn)`, name));
    }
    for (const waiter of stopWaiters) {
      // scanning has in fact stopped
      waiter.resolve();
    }
  }

  private processConnectionQueue (): void {
    if (this.pendingConnectionId || this.connectionQueue.length === 0) {
      return;
    }

    if (this.isScanning) {
      // The scan is paused first; onScanStop continues the queue.
      void this.stopScanning();
      return;
    }

    const nextConn = this.connectionQueue[0];
    const attemptToken: ConnectionAttemptToken = {};
    this.pendingConnectionId = nextConn.id;
    this.pendingConnectionAddress = this.addressToId(nextConn.address);
    this.pendingConnectionToken = attemptToken;
    this.requireHci().createLeConn(
      nextConn.address,
      nextConn.addressType,
      nextConn.params,
      this.connections.size === 0,
      attemptToken
    );
  }

  private addConnection (
    hci: Hci,
    handle: number,
    peripheralId: string,
    addressType: HciAddressType,
    address: string,
    desiredMtu: number | undefined
  ): void {
    const aclStream = new AclStream(hci, handle, hci.addressType, hci.address, addressType, address);
    const gatt = new Gatt(
      address,
      aclStream,
      {
        onNotification: (serviceUuid: string, characteristicUuid: string, data: Buffer): void => {
          this.delegate?.onNotification(peripheralId, serviceUuid, characteristicUuid, data);
        },
        onHandleNotify: (attHandle: number, data: Buffer): void => {
          this.delegate?.onHandleNotification(peripheralId, attHandle, data);
        }
      },
      desiredMtu
    );
    const signaling = new Signaling(
      handle,
      aclStream,
      hci.isUserChannel(),
      request => this.onConnectionParameterUpdateRequest(request)
    );

    this.connections.set(handle, { handle, peripheralId, aclStream, gatt, signaling, rssiReads: [] });
    this.handles.set(peripheralId, handle);

    // The MTU is negotiated in the background; connect() does not wait for it.
    gatt.exchangeMtu().then(
      (mtu: number): void => {
        this.delegate?.onMtu(peripheralId, mtu);
      },
      () => {
        // the link went away (or the peer refused) before the MTU was negotiated
      }
    );
  }

  private onConnectionParameterUpdateRequest (request: ConnectionParameterUpdateRequest): void {
    this.requireHci().connUpdateLe(
      request.handle,
      request.minInterval,
      request.maxInterval,
      request.latency,
      request.supervisionTimeout
    );
  }

  private connectionOf (peripheralId: string): Connection | undefined {
    const handle = this.handles.get(peripheralId);
    return handle === undefined ? undefined : this.connections.get(handle);
  }

  private withGatt<T> (peripheralId: string, command: (gatt: Gatt) => Promise<T>): Promise<T> {
    const connection = this.connectionOf(peripheralId);

    if (!connection) {
      return Promise.reject(unknownPeripheral(peripheralId));
    }
    return command(connection.gatt);
  }

  private requireHci (): Hci {
    if (!this.hci) {
      throw notStarted();
    }
    return this.hci;
  }

}

function notStarted (): NobleError {
  return new NobleError('HCI bindings are not started');
}

function unknownPeripheral (peripheralId: string): NobleError {
  return new NobleError(`unknown peripheral ${peripheralId}`);
}
