import createDebug from 'debug';

import type { Bindings, BindingsDelegate, DiscoveredPeripheral } from './bindings/bindings';
import { AdapterStateError, NobleError, NotSupportedError, TimeoutError } from './common/errors';
import { Signal, type Listener, type Unsubscribe } from './common/signal';
import { Peripheral } from './gatt/peripheral';
import { PeripheralSession } from './gatt/session';
import type {
  AdapterState,
  ConnectOptions,
  DevicePairingKinds,
  DevicePairingProtectionLevel,
  DisconnectReason,
  ScanOptions
} from './types';

const debug = createDebug('noble');

interface PeripheralEntry {
  peripheral: Peripheral;
  session: PeripheralSession;
}

/**
 * A Bluetooth LE central bound to one adapter.
 *
 * `Noble` owns its {@link Bindings} and the peripherals discovered through
 * them. Nothing it hands out holds a reference back to it.
 */
export class Noble {
  private currentState: AdapterState = 'unknown';
  private currentAddress = 'unknown';
  private started = false;

  private readonly entries = new Map<string, PeripheralEntry>();
  /** Peripherals already reported during the current scan. */
  private readonly reported = new Set<string>();
  private allowDuplicates = false;
  /** Bumped by every explicit stop so running `discover()` loops know to finish. */
  private scanStopRequests = 0;

  private readonly stateSignal = new Signal<AdapterState>();
  private readonly addressSignal = new Signal<string>();
  private readonly scanStartSignal = new Signal<void>();
  private readonly scanStopSignal = new Signal<void>();
  private readonly discoverSignal = new Signal<Peripheral>();
  private readonly warningSignal = new Signal<string>();
  private readonly stopSignal = new Signal<void>();

  constructor (private readonly bindings: Bindings) {}

  /** The adapter state. Reading it starts the bindings if they are not running yet. */
  get state (): AdapterState {
    this.start();
    return this.currentState;
  }

  /** The adapter's own address, or `'unknown'` until the binding reports it. */
  get address (): string {
    return this.currentAddress;
  }

  /**
   * Starts the bindings. Called implicitly by everything that needs the
   * adapter, so calling it yourself is only useful to power up early.
   */
  start (): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.bindings.start(this.createDelegate());
  }

  /** Stops the bindings and ends every running {@link discover} loop. */
  stop (): void {
    this.scanStopRequests += 1;
    this.bindings.stop();
    this.dropLinks('stopped');
    this.stopSignal.emit();
  }

  reset (): void {
    this.bindings.reset?.();
  }

  setAddress (address: string): void {
    if (!this.bindings.setAddress) {
      throw new NotSupportedError('The current bindings do not implement setAddress');
    }
    this.bindings.setAddress(address);
  }

  async setScanParameters (interval?: number, window?: number): Promise<void> {
    if (!this.bindings.setScanParameters) {
      throw new NotSupportedError('The current bindings do not implement setScanParameters');
    }
    this.start();
    await this.bindings.setScanParameters(interval, window);
  }

  /** Resolves once the adapter is powered on; rejects with {@link TimeoutError} otherwise. */
  waitForPoweredOn (timeout = 10000): Promise<void> {
    if (this.state === 'poweredOn') {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new TimeoutError('Timeout waiting for Noble to be powered on'));
      }, timeout);
      const unsubscribe = this.stateSignal.subscribe(state => {
        if (state === 'poweredOn') {
          clearTimeout(timer);
          unsubscribe();
          resolve();
        }
      });
    });
  }

  /**
   * Starts scanning; discovered peripherals are reported to
   * {@link onDiscover} listeners. Rejects when the adapter is not powered on.
   */
  async startScanning (options: ScanOptions = {}): Promise<void> {
    const state = await this.settledState();
    if (state !== 'poweredOn') {
      throw new AdapterStateError(`Could not start scanning, state is ${state} (not poweredOn)`, state);
    }

    this.reported.clear();
    this.allowDuplicates = options.allowDuplicates ?? false;
    await this.bindings.startScanning(options.serviceUuids ?? [], this.allowDuplicates);
  }

  async stopScanning (): Promise<void> {
    if (!this.started) {
      throw new NobleError('Bindings are not initialized');
    }
    this.scanStopRequests += 1;
    await this.bindings.stopScanning();
  }

  /**
   * Scans and yields peripherals as they are discovered. Scanning stops when
   * the consumer leaves the loop; the loop ends when {@link stopScanning} or
   * {@link stop} is called, or the adapter leaves `poweredOn`.
   */
  async * discover (options: ScanOptions = {}): AsyncGenerator<Peripheral, void, void> {
    const scanStopRequests = this.scanStopRequests;
    const queue: Peripheral[] = [];
    let scanning = false;
    let observedStops = 0;
    let resumedThroughStop = 0;
    let wake: (() => void) | null = null;

    const signalActivity = (): void => {
      const resolve = wake;
      wake = null;
      resolve?.();
    };
    const shouldContinue = (): boolean =>
      this.scanStopRequests === scanStopRequests && this.currentState === 'poweredOn';
    const waitForActivity = (): Promise<void> => new Promise<void>(resolve => {
      wake = resolve;
      if (queue.length > 0 || !scanning || !shouldContinue()) {
        signalActivity();
      }
    });

    const startScan = async (): Promise<void> => {
      const stopsBefore = observedStops;
      await this.startScanning(options);
      // Bindings normally report the start themselves; a resolved start means
      // "scanning" even if one did not, unless a stop was observed meanwhile.
      if (observedStops === stopsBefore) {
        scanning = true;
      }
    };

    const subscriptions = [
      this.discoverSignal.subscribe(peripheral => {
        queue.push(peripheral);
        signalActivity();
      }),
      this.scanStartSignal.subscribe(() => {
        scanning = true;
        signalActivity();
      }),
      this.scanStopSignal.subscribe(() => {
        scanning = false;
        observedStops += 1;
        signalActivity();
      }),
      this.stateSignal.subscribe(signalActivity),
      this.stopSignal.subscribe(signalActivity)
    ];

    try {
      await startScan();
      resumedThroughStop = observedStops;

      while (shouldContinue()) {
        if (resumedThroughStop < observedStops) {
          // HCI connection setup can briefly report a scan start after stopping
          // the discovery scan, without a matching stop. Stops are counted
          // independently so that transient start cannot suppress the restart.
          const stoppedThrough = observedStops;
          await startScan();
          resumedThroughStop = stoppedThrough;
        } else if (queue.length > 0) {
          yield queue.shift() as Peripheral;
        } else if (!scanning) {
          // HCI bindings pause scanning before connecting. Resume the session
          // once the consumer finished handling the yielded peripheral.
          await startScan();
        } else {
          await waitForActivity();
        }
      }
    } finally {
      for (const unsubscribe of subscriptions) {
        unsubscribe();
      }
      signalActivity();

      if (scanning && shouldContinue()) {
        await this.stopScanning();
      }
    }
  }

  /**
   * Connects to a peripheral by id or MAC address, without scanning for it
   * first, and resolves with the connected peripheral.
   */
  async connect (idOrAddress: string, options?: ConnectOptions): Promise<Peripheral> {
    this.start();
    const peripheral = this.peripheralFor(idOrAddress);
    await peripheral.connect(options);
    // The binding may have reported fresher details while connecting.
    return this.entries.get(peripheral.id)?.peripheral ?? peripheral;
  }

  /** Abandons a connection attempt started with {@link connect}. */
  cancelConnect (idOrAddress: string): void {
    const id = this.resolveId(idOrAddress);
    const entry = this.entries.get(id);
    if (entry) {
      entry.peripheral.cancelConnect();
    } else {
      this.bindings.cancelConnect(id);
    }
  }

  /** Pairs with a peripheral by id or MAC address. See {@link Peripheral.pair}. */
  async pair (
    idOrAddress: string,
    kind?: DevicePairingKinds | null,
    protectionLevel?: DevicePairingProtectionLevel | null
  ): Promise<void> {
    this.start();
    await this.peripheralFor(idOrAddress).pair(kind, protectionLevel);
  }

  /** Called with the current adapter state whenever it changes. Starts the bindings. */
  onStateChange (listener: Listener<AdapterState>): Unsubscribe {
    const unsubscribe = this.stateSignal.subscribe(listener);
    this.start();
    return unsubscribe;
  }

  onAddressChange (listener: Listener<string>): Unsubscribe {
    return this.addressSignal.subscribe(listener);
  }

  onScanStart (listener: Listener<void>): Unsubscribe {
    return this.scanStartSignal.subscribe(listener);
  }

  onScanStop (listener: Listener<void>): Unsubscribe {
    return this.scanStopSignal.subscribe(listener);
  }

  /** Called for every discovered peripheral while scanning. */
  onDiscover (listener: Listener<Peripheral>): Unsubscribe {
    return this.discoverSignal.subscribe(listener);
  }

  /**
   * Called with non-fatal diagnostics. While nobody listens, warnings go to
   * `console.warn`.
   */
  onWarning (listener: Listener<string>): Unsubscribe {
    return this.warningSignal.subscribe(listener);
  }

  /** Starts the bindings and resolves with the first state they report. */
  private settledState (): Promise<AdapterState> {
    const alreadyStarted = this.started;
    this.start();
    if (alreadyStarted) {
      return Promise.resolve(this.currentState);
    }
    return new Promise<AdapterState>(resolve => {
      const unsubscribe = this.stateSignal.subscribe(state => {
        unsubscribe();
        resolve(state);
      });
    });
  }

  private resolveId (idOrAddress: string): string {
    if (/^[0-9A-Fa-f]+$/.test(idOrAddress)) {
      return idOrAddress;
    }
    const id = this.bindings.addressToId(idOrAddress);
    if (id === null) {
      throw new NobleError(`Invalid peripheral ID or Address ${idOrAddress}`);
    }
    return id;
  }

  /** The known peripheral for an id/address, or a placeholder for one never discovered. */
  private peripheralFor (idOrAddress: string): Peripheral {
    const id = this.resolveId(idOrAddress);
    const entry = this.entries.get(id) ?? this.createEntry({
      id,
      address: id === idOrAddress ? '' : idOrAddress,
      addressType: 'unknown',
      connectable: true,
      scannable: false,
      advertisement: { serviceUuids: [], serviceData: [] },
      rssi: 127
    });
    return entry.peripheral;
  }

  private createEntry (discovery: DiscoveredPeripheral): PeripheralEntry {
    const session = new PeripheralSession(this.bindings, discovery.id);
    const entry = { session, peripheral: new Peripheral(session, discovery) };
    this.entries.set(discovery.id, entry);
    return entry;
  }

  private warn (message: string): void {
    if (this.warningSignal.hasListeners) {
      this.warningSignal.emit(message);
    } else {
      console.warn(`noble: ${message}`);
    }
  }

  /** Runs `handler` for a known peripheral; warns about activity for unknown ones. */
  private withSession (peripheralId: string, what: string, handler: (session: PeripheralSession) => void): void {
    const entry = this.entries.get(peripheralId);
    if (entry) {
      handler(entry.session);
    } else {
      this.warn(`unknown peripheral ${peripheralId} ${what}!`);
    }
  }

  /**
   * Live links and pending connects do not survive the adapter going away.
   * The peripherals themselves stay known, so objects the application holds
   * keep working once the adapter is back.
   */
  private dropLinks (reason: DisconnectReason): void {
    this.reported.clear();
    for (const { peripheral, session } of [...this.entries.values()]) {
      if (peripheral.state !== 'disconnected' && peripheral.state !== 'error') {
        session.disconnected.emit(reason);
      }
    }
  }

  private handleDiscover (discovery: DiscoveredPeripheral): void {
    let entry = this.entries.get(discovery.id);
    if (entry) {
      entry.session.advertised.emit(discovery);
    } else {
      entry = this.createEntry(discovery);
    }

    const alreadyReported = this.reported.has(discovery.id);
    this.reported.add(discovery.id);

    if (this.allowDuplicates || !alreadyReported || (!discovery.scannable && !discovery.connectable)) {
      this.discoverSignal.emit(entry.peripheral);
    }
  }

  /**
   * The only door through which bindings reach back in. It is a private
   * object rather than methods on `Noble` so none of it leaks into the API.
   */
  private createDelegate (): BindingsDelegate {
    return {
      onStateChange: state => {
        debug(`stateChange ${state}`);
        const leftPoweredOn = state !== 'poweredOn' && this.currentState === 'poweredOn';
        this.currentState = state;
        if (leftPoweredOn) {
          this.dropLinks('cleanup');
        }
        this.stateSignal.emit(state);
      },
      onAddressChange: address => {
        debug(`addressChange ${address}`);
        this.currentAddress = address;
        this.addressSignal.emit(address);
      },
      onScanStart: () => {
        debug('scanStart');
        this.scanStartSignal.emit();
      },
      onScanStop: () => {
        debug('scanStop');
        this.scanStopSignal.emit();
      },
      onDiscover: discovery => this.handleDiscover(discovery),
      onConnect: id => this.withSession(id, 'connected', session => session.connected.emit()),
      onDisconnect: (id, reason) =>
        this.withSession(id, 'disconnected', session => session.disconnected.emit(reason)),
      onMtu: (id, mtu) => {
        if (mtu) {
          this.entries.get(id)?.session.mtuChanged.emit(mtu);
        }
      },
      onRssi: (id, rssi) =>
        this.withSession(id, 'RSSI update', session => session.rssiUpdated.emit(rssi)),
      onNotification: (id, serviceUuid, characteristicUuid, data) =>
        this.withSession(id, 'notification', session =>
          session.notifications(serviceUuid, characteristicUuid).emit(data)),
      onHandleNotification: (id, handle, data) =>
        this.withSession(id, 'handle notify', session => session.handleNotified.emit({ handle, data })),
      onWarning: message => this.warn(message)
    };
  }
}
