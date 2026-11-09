# ![noble](assets/noble-logo.png)

[![npm version](https://badgen.net/npm/v/@stoprocent/noble)](https://www.npmjs.com/package/@stoprocent/noble)
[![npm downloads](https://badgen.net/npm/dt/@stoprocent/noble)](https://www.npmjs.com/package/@stoprocent/noble)


A Node.js BLE (Bluetooth Low Energy) central module.

Want to implement a peripheral? Check out [@stoprocent/bleno](https://github.com/stoprocent/bleno).

> **Note:** Currently, running both noble (central) and bleno (peripheral) together only works with macOS bindings or when using separate HCI/UART dongles. Support for running both on a single HCI adapter (e.g., on Linux systems) will be added in future releases.

## About This Fork

This fork of `noble` was created to introduce several key improvements and new features:

1. **Flexible Bluetooth Driver Selection**:
   - This library enables flexible selection of Bluetooth drivers through the new `withBindings()` API. Use native platform bindings (Mac, Windows) or HCI bindings with UART/serial support for hardware dongles, allowing Bluetooth connectivity across various platforms and hardware setups.
   
2. **Native Bindings Improvements**: 
   - Fixed and optimized native bindings for macOS, ensuring better compatibility and performance on Apple devices
   - Overhauled Windows native bindings with support for `Service Data` from advertisements
   - Aligned behavior across different bindings (macOS, Windows, HCI) for consistent behavior 

3. **Native TypeScript, promise-first API**:
   - The library is written in strict TypeScript and ships its own type definitions
   - Every operation returns a promise; there are no callbacks and no `EventEmitter` events
   - Async iterators for discovery and notifications with `for await...of` syntax
   - Typed errors (`DisconnectedError`, `ConnectionCancelledError`, ...) instead of hung callbacks

4. **Enhanced Testing and Reliability**:
   - Jest test suite covering the core and every backend
   - Fixed numerous edge cases and stability issues

5. **New Features**: 
   - A `setAddress(...)` function to set the MAC address of the central device
   - Direct device connection with `noble.connect(...)` without requiring a prior scan
   - `waitForPoweredOn(...)` function to simplify async workflows
   - Support for multiple adapter configurations through the new `withBindings()` API
   - Extended debugging capabilities and error handling
   - Additionally, I plan to add raw L2CAP channel support, enhancing low-level Bluetooth communication capabilities


If you appreciate these enhancements and the continued development of this project, please consider supporting my work. 

[![Buy me a coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/stoprocent)

## Install

```sh
npm install @stoprocent/noble
```

## Usage

noble is written in TypeScript and ships its own type definitions. The API is
promise-based throughout: there are no callbacks and no `EventEmitter`.

```typescript
// A ready-to-use instance on the default bindings for this platform
import noble from '@stoprocent/noble';

// ...or pick the bindings yourself
import { withBindings } from '@stoprocent/noble';
const noble = withBindings('default'); // 'hci', 'dbus', 'mac', 'win'
```

CommonJS works too:

```javascript
const { default: noble, withBindings } = require('@stoprocent/noble');
```

For the available bindings and their options, see [Binding Types](#binding-types) below.

## Quick Start Example

### Scanning

```typescript
import noble from '@stoprocent/noble';

await noble.waitForPoweredOn();

// discover() starts scanning, yields peripherals as they are found,
// and stops scanning when you leave the loop.
for await (const peripheral of noble.discover()) {
  console.log(`Found device: ${peripheral.advertisement.localName ?? 'Unknown'}`);

  if (peripheral.advertisement.localName === 'MyDevice') {
    break;
  }
}
```

`discover()` resumes scanning after temporary binding-level pauses, such as
the Linux HCI binding stopping the scan while it connects. Leave the loop, or
call `noble.stopScanning()` / `noble.stop()`, to end the discovery session.

If you prefer a listener over a loop:

```typescript
const stopListening = noble.onDiscover(peripheral => console.log(peripheral.id));
await noble.startScanning({ serviceUuids: ['180f'], allowDuplicates: false });
// later
await noble.stopScanning();
stopListening();
```

### Connecting and exploring

```typescript
await peripheral.connect();

const { services } = await peripheral.discoverAllServicesAndCharacteristics();

for (const service of services) {
  for (const characteristic of service.characteristics ?? []) {
    console.log(service.uuid, characteristic.uuid, characteristic.properties);

    if (characteristic.properties.includes('read')) {
      console.log(await characteristic.read());
    }
  }
}

await peripheral.disconnect();
```

### Reading, writing and notifications

```typescript
import type { Peripheral } from '@stoprocent/noble';

async function readBatteryLevel (peripheral: Peripheral): Promise<number> {
  const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristics(
    ['180f'], // Battery Service
    ['2a19']  // Battery Level
  );
  const data = await characteristics[0].read();
  return data[0];
}

// Write with response (default) or without
await characteristic.write(Buffer.from([0x01]));
await characteristic.write(Buffer.from([0x01]), true);

// Stream notifications; subscribes on entry and unsubscribes when the loop is left
for await (const data of characteristic.notifications()) {
  console.log('Notified:', data);
}
```

More complete programs live in [examples/](examples), e.g.
[examples/peripheral-explorer.ts](examples/peripheral-explorer.ts). After
`npm run build` they can be run with any TypeScript runner, for instance
`npx tsx examples/peripheral-explorer.ts`.

## API Overview

Every operation returns a promise. Things that happen without being asked for
(state changes, discoveries, disconnects, notifications) are delivered either
through async iterators or through typed `onX(listener)` methods, each of which
returns a function that removes the listener again.

### Binding Types

```typescript
// Default binding (automatically selects based on platform)
import noble from '@stoprocent/noble';
// or
import { withBindings } from '@stoprocent/noble';
const noble = withBindings('default');

// Specific bindings
const nobleHci = withBindings('hci');   // HCI socket binding
const nobleDbus = withBindings('dbus'); // BlueZ D-Bus binding (Linux desktop)
const nobleMac = withBindings('mac');   // macOS binding
const nobleWin = withBindings('win');   // Windows binding

// Custom options for HCI binding (Using UART HCI Dongle)
const nobleUart = withBindings('hci', {
  hciDriver: 'uart',
  bindParams: {
    uart: {
      port: '/dev/ttyUSB0',
      baudRate: 1000000
    }
  }
});

// Custom options for HCI binding (Native)
const nobleNative = withBindings('hci', {
  hciDriver: 'native',
  deviceId: 0 // This could be also set by env.NOBLE_HCI_DEVICE_ID=0
});

// D-Bus / BlueZ binding (Linux desktop). Talks to bluetoothd over org.bluez,
// so it coexists with the system Bluetooth stack and does not need root /
// CAP_NET_ADMIN. Requires the `dbus-next` package to be installed in the
// host project — it is not bundled, since it is only useful on Linux:
//
//   npm install dbus-next
//
// Supports basic GATT: scan, connect, service/characteristic/descriptor
// discovery, read, write, notify/indicate. Does not support raw HCI handle
// I/O, custom scan parameters, or vendor-specific commands.
const nobleBluez = withBindings('dbus', {
  adapterId: 'hci0' // optional; defaults to hci<NOBLE_HCI_DEVICE_ID>, else the first BlueZ adapter
});

// Equivalent to withBindings('dbus') without code changes:
//   NOBLE_BINDINGS=dbus node app.js
```

### Noble

```typescript
noble.state;    // 'poweredOn' | 'poweredOff' | 'unauthorized' | 'unsupported' | 'unknown' | 'resetting'
noble.address;  // adapter address, 'unknown' until reported

// Wait for the adapter to be powered on (rejects with TimeoutError)
await noble.waitForPoweredOn(timeout?: number);

// Scan
await noble.startScanning({ serviceUuids?: string[], allowDuplicates?: boolean });
await noble.stopScanning();

// Scan as an async generator. Starts scanning and resumes temporary
// binding-level scan pauses until the loop is left or scanning is stopped.
for await (const peripheral of noble.discover({ serviceUuids, allowDuplicates })) { /* ... */ }

// Connect directly to a peripheral by id or address, without scanning
const peripheral = await noble.connect(idOrAddress, options?);
noble.cancelConnect(idOrAddress);

// Pair with a peripheral by id or address (Windows only — see "Pairing" below)
await noble.pair(idOrAddress);

// Set adapter address (HCI only, on supported devices)
noble.setAddress('00:11:22:33:44:55');

// Set scan interval/window (HCI only)
await noble.setScanParameters(interval, window);

// Reset adapter / stop noble
noble.reset();
noble.stop();

// Listeners — each returns an unsubscribe function
noble.onStateChange(state => { /* ... */ });
noble.onAddressChange(address => { /* ... */ });
noble.onScanStart(() => { /* ... */ });
noble.onScanStop(() => { /* ... */ });
noble.onDiscover(peripheral => { /* ... */ });
noble.onWarning(message => { /* ... */ }); // console.warn is used while nobody listens
```

### Peripheral

```typescript
peripheral.id; peripheral.address; peripheral.addressType;
peripheral.advertisement; peripheral.rssi; peripheral.connectable; peripheral.scannable;
peripheral.state;    // 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error'
peripheral.mtu;      // number | null
peripheral.services; // result of the last discoverServices(), or null

await peripheral.connect(options?);
peripheral.cancelConnect();        // the pending connect() rejects with ConnectionCancelledError
await peripheral.disconnect();

// Pair with peripheral (Windows only — see "Pairing" below)
await peripheral.pair();

const rssi = await peripheral.updateRssi();

const services = await peripheral.discoverServices(['180f']); // UUID filter is optional
const { services, characteristics } = await peripheral.discoverAllServicesAndCharacteristics();
const { services, characteristics } = await peripheral.discoverSomeServicesAndCharacteristics(['180f'], ['2a19']);

// Raw ATT handles (HCI and native bindings)
const data = await peripheral.readHandle(handle);
await peripheral.writeHandle(handle, data, withoutResponse);

// Listeners — each returns an unsubscribe function
peripheral.onDisconnect(reason => { /* ... */ });
peripheral.onMtuChange(mtu => { /* ... */ });
peripheral.onHandleNotification(({ handle, data }) => { /* ... */ });
```

Any operation that is still in flight when the link drops rejects with a
`DisconnectedError` carrying the `reason`.

On macOS, a `connect()` that fails, or whose attempt is ended by a disconnect
before the link is up, rejects with an `Error` whose message is the
CoreBluetooth description and which also carries `nativeErrorDomain` (string)
and `nativeErrorCode` (number), e.g. `CBErrorDomain` / `14` when the peer
removed its pairing information (type `NativeErrorDetails`).

The Linux HCI binding reports controller disconnect reasons as numeric HCI
status codes. Other bindings and library cleanup paths may report a string.
Use `hciStatusMessage` when a human-readable HCI message is needed:

```typescript
import { hciStatusMessage } from '@stoprocent/noble';

peripheral.onDisconnect(reason => {
  console.log(`Disconnected: ${hciStatusMessage(reason)}`);
});
```

### Pairing

```typescript
import noble, {
  DevicePairingKinds,
  DevicePairingProtectionLevel
} from '@stoprocent/noble';

// Pair at the Noble level (by id or address) or on a Peripheral instance.
await noble.pair(idOrAddress);
// or
await peripheral.pair();

// Optionally choose pairing ceremony + protection level (Windows only).
await noble.pair(
  idOrAddress,
  DevicePairingKinds.ConfirmOnly,
  DevicePairingProtectionLevel.EncryptionAndAuthentication
);

// The same choices as an options object.
await peripheral.pair({ kind: DevicePairingKinds.DisplayPin });

// Supply a PIN for authenticated ProvidePin / ConfirmPinMatch pairing.
await peripheral.pair({ pin: '123456' });
await noble.pair(idOrAddress, { pin: '123456' });

// A connected peripheral can be checked first, to skip asking for a PIN.
if (!(await peripheral.isPaired())) { // or: await noble.isPaired(idOrAddress)
  // ask for the PIN, then pair
}
```

The `pair` promise resolves when pairing succeeded (or the device was already
paired) and rejects otherwise.

**Platform support and limitations — please read before using pairing:**

- **Windows only.** Pairing is implemented solely by the Windows (WinRT)
  binding. On macOS, Linux, and other bindings `pair` does not attempt a
  native call — it rejects with a `NotSupportedError`
  (`'Pairing is not supported on this platform'`) so callers do not hang.
- **A connected device is required.** The peripheral must already be
  discovered and connected before pairing is requested.
- **Windows pairing options.** `kind` defaults to `ConfirmOnly` and
  `protectionLevel` defaults to `Encryption`. You can pass a
  `DevicePairingKinds` bitmask (single or OR-ed values) and (optionally)
  `DevicePairingProtectionLevel`.
  The same values can be given as `pair({ kind, protectionLevel })`.
  `ConfirmOnly`, `DisplayPin`, and `ConfirmPinMatch` use Windows' native UI.
  `ProvidePin` is rejected unless a PIN is supplied (see below), and the
  password kinds (`ProvidePassword`, `ConfirmPassword`) are always rejected:
  this library has no way to pass a password into WinRT.
- **PIN pairing.** `pair({ pin })` takes the PIN shown by, or configured on,
  the peripheral as a non-empty string. `kind` then defaults to
  `ConfirmOnly | ProvidePin | ConfirmPinMatch` and `protectionLevel` to
  `EncryptionAndAuthentication`, the only level accepted together with a PIN.
  The PIN answers a `ProvidePin` request; a `ConfirmPinMatch` request is
  accepted only when the PIN Windows presents equals the supplied one, and
  pairing fails otherwise. A PIN that is not a non-empty string, or one
  combined with another protection level, rejects with a `TypeError` before
  anything is sent. The PIN's format is not checked. noble never logs the
  PIN; collecting and storing it safely is up to the application.
- **`isPaired()` reports Windows' pairing state.** It resolves `true` when
  Windows reports the connected device as paired. On the Windows binding it
  rejects when the peripheral is unknown or not connected; on every other
  binding it resolves `false`, because they expose no pairing state.

### Service

```typescript
service.uuid; service.name; service.type;
service.characteristics;      // result of the last discoverCharacteristics(), or null
service.includedServiceUuids; // result of the last discoverIncludedServices(), or null

const includedServiceUuids = await service.discoverIncludedServices(serviceUuids?);
const characteristics = await service.discoverCharacteristics(characteristicUuids?);
```

### Characteristic

```typescript
characteristic.uuid; characteristic.name; characteristic.type;
characteristic.properties;  // e.g. ['read', 'notify']
characteristic.descriptors; // result of the last discoverDescriptors(), or null
characteristic.isNotifying;

const data = await characteristic.read();
await characteristic.write(data, withoutResponse?);

// Notifications / indications
await characteristic.subscribe();
const stopListening = characteristic.onNotification(data => { /* ... */ });
await characteristic.unsubscribe();

// ...or as an async iterator that subscribes and unsubscribes for you
for await (const data of characteristic.notifications()) {
  console.log(`Received notification: ${data}`);
}

const descriptors = await characteristic.discoverDescriptors();
await characteristic.broadcast(true); // HCI only
```

### Descriptor

```typescript
const value = await descriptor.readValue();
await descriptor.writeValue(data);
```

### Errors

All errors raised deliberately by noble extend `NobleError`:

| Error | Raised when |
| ----- | ----------- |
| `DisconnectedError` | the link dropped while an operation was in flight (`.reason`) |
| `ConnectionCancelledError` | `cancelConnect()` abandoned a pending `connect()` |
| `AdapterStateError` | an operation needed the adapter powered on (`.state`) |
| `NotSupportedError` | the active bindings cannot perform the operation |
| `TimeoutError` | `waitForPoweredOn()` timed out |

## Migrating from 1.x

2.0 is a ground-up TypeScript rewrite. The callback API and all
`EventEmitter` events are gone; what remains is the promise API, without the
`Async` suffix.

| 1.x | 2.x |
| --- | --- |
| `const noble = require('@stoprocent/noble')` | `const { default: noble } = require('@stoprocent/noble')` (or `import noble from ...`) |
| `xxxAsync(...)` | `xxx(...)` — e.g. `peripheral.connectAsync()` → `peripheral.connect()` |
| `xxx(..., callback)` | removed — `await xxx(...)` |
| `noble.startScanningAsync(uuids, allowDuplicates)` | `noble.startScanning({ serviceUuids, allowDuplicates })` |
| `noble.discoverAsync()` | `noble.discover(options?)` |
| `noble.on('stateChange' \| 'discover' \| 'scanStart' \| 'scanStop' \| 'warning', fn)` | `noble.onStateChange(fn)`, `onDiscover(fn)`, `onScanStart(fn)`, `onScanStop(fn)`, `onWarning(fn)` |
| `noble.once(...)` / `removeListener(...)` | call the function returned by `onX(fn)` to unsubscribe |
| `peripheral.on('disconnect', fn)` / `on('mtu', fn)` | `peripheral.onDisconnect(fn)` / `peripheral.onMtuChange(fn)` |
| `peripheral.on('connect' \| 'rssiUpdate' \| 'servicesDiscover' \| 'pair', fn)` | removed — use the result of the corresponding promise |
| `characteristic.on('data', (data, isNotification) => ...)` | `characteristic.onNotification(fn)` or `for await (... of characteristic.notifications())`; reads are returned by `read()` |
| `characteristic.notificationsAsync()` | `characteristic.notifications()` |
| `peripheral.uuid` | `peripheral.id` |
| `String` rejections / hung callbacks on failure | typed errors (see [Errors](#errors)); ATT failures on the HCI bindings now reject instead of hanging |

Other behavioural changes worth knowing about:

- An operation interrupted by a disconnect always rejects with `DisconnectedError`.
- `peripheral.disconnect()` on a peripheral that is not connected resolves immediately.
- On the HCI bindings a characteristic/descriptor read that the peripheral answers with an ATT error now rejects (1.x resolved with an empty buffer).
- The undocumented GATT handle-cache hooks (`servicesDiscovered` / `characteristicsDiscovered` events, `noble.addServices()`, `noble.addCharacteristics()`) were removed.
- Node.js 18 or newer is required.
- The macOS backend was rewritten in Swift and the Windows backend now reports through promises natively. Both reject requests that 1.x silently dropped (unknown peripheral, undiscovered service or characteristic, adapter not powered on), and the Windows backend now rejects writes and subscriptions whose GATT status is not `Success`.

## Installation

* [Prerequisites](#prerequisites)
  * [UART](#uart)
  * [OS X](#os-x)
  * [Linux](#linux)
    * [Ubuntu, Debian, Raspbian](#ubuntu-debian-raspbian)
    * [Fedora and other RPM-based distributions](#fedora-and-other-rpm-based-distributions)
    * [Intel Edison](#intel-edison)
  * [FreeBSD](#freebsd)
  * [Windows](#windows)
  * [Docker](#docker)
* [Installing and using the package](#installing-and-using-the-package)

### Prerequisites

#### UART (Any OS)

Please refer to [https://github.com/stoprocent/node-bluetooth-hci-socket#uartserial-any-os](https://github.com/stoprocent/node-bluetooth-hci-socket#uartserial-any-os)

__NOTE:__ While environmental variables are still supported for backward compatibility, the recommended approach is to specify driver options directly in the `withBindings()` call as shown below:

##### Recommended Approach (UART port specified in `bindParams`)

```typescript
import { withBindings } from '@stoprocent/noble';
const noble = withBindings('hci', { 
  hciDriver: 'uart',
  bindParams: {
    uart: {
      port: '/dev/ttyUSB0',
      baudRate: 1000000
    }
  }
});
```

##### Legacy Approach (Using environmental variables - not recommended for new implementations)

```bash
$ export BLUETOOTH_HCI_SOCKET_UART_PORT=/dev/tty...
$ export BLUETOOTH_HCI_SOCKET_UART_BAUDRATE=1000000
```

__NOTE:__ `BLUETOOTH_HCI_SOCKET_UART_BAUDRATE` defaults to `1000000` so only needed if different.

```typescript
import noble from '@stoprocent/noble';
```

#### OS X

 * macOS 11 or newer. Prebuilt binaries (x64 and arm64) are included, so nothing has to be compiled for a normal install.
 * To build the addon from source you need [Xcode](https://itunes.apple.com/ca/app/xcode/id497799835?mt=12) or the Xcode Command Line Tools: the CoreBluetooth backend is written in Swift (with a small C++ N-API layer) and is compiled with `swiftc` as part of `node-gyp rebuild`.
 * On newer versions of OSX, allow bluetooth access on the terminal app: "System Preferences" —> "Security & Privacy" —> "Bluetooth" -> Add terminal app (see [Sandboxed terminal](#sandboxed-terminal))

#### Linux

 * Kernel version 3.6 or above
 * `libbluetooth-dev` needs to be installed. For instructions for specific distributions, see below.
 * To set the necessary privileges to run without sudo, [see this section](#running-without-rootsudo-linux-specific). This is required for all distributions (Raspbian, Ubuntu, Fedora, etc). You will not get any errors if running without sudo, but nothing will happen.

##### Ubuntu, Debian, Raspbian

See the [generic Linux notes above](#linux) first.

```sh
sudo apt-get install bluetooth bluez libbluetooth-dev libudev-dev
```

Make sure `node` is on your `PATH`. If it's not, some options:
 * Symlink `nodejs` to `node`: `sudo ln -s /usr/bin/nodejs /usr/bin/node`
 * [Install Node.js using the NodeSource package](https://nodejs.org/en/download/package-manager/#debian-and-ubuntu-based-linux-distributions)

If you are having trouble connecting to BLE devices on a Raspberry Pi, you should disable the `pnat` plugin. Add the following line at the bottom of `/etc/bluetooth/main.conf`:

```
DisablePlugins=pnat
```

Then restart the system.

See [Issue #425 · OpenWonderLabs/homebridge-switchbot](https://github.com/OpenWonderLabs/homebridge-switchbot/issues/425#issuecomment-1190864279).

##### Fedora and other RPM-based distributions

See the [generic Linux notes above](#linux) first.

```sh
sudo yum install bluez bluez-libs bluez-libs-devel
```

##### Intel Edison

See the [generic Linux notes above](#linux) first.

See [Configure Intel Edison for Bluetooth LE (Smart) Development](http://rexstjohn.com/configure-intel-edison-for-bluetooth-le-smart-development/).

#### FreeBSD

Make sure you have GNU Make:

```sh
sudo pkg install gmake
```

Disable automatic loading of the default Bluetooth stack by putting [no-ubt.conf](https://gist.github.com/myfreeweb/44f4f3e791a057bc4f3619a166a03b87) into `/usr/local/etc/devd/no-ubt.conf` and restarting devd (`sudo service devd restart`).

Unload `ng_ubt` kernel module if already loaded:

```sh
sudo kldunload ng_ubt
```

Make sure you have read and write permissions on the `/dev/usb/*` device that corresponds to your Bluetooth adapter.

#### Windows

[node-gyp requirements for Windows](https://github.com/TooTallNate/node-gyp#installation)

Install the required tools and configurations using Microsoft's [windows-build-tools](https://github.com/felixrieseberg/windows-build-tools) from an elevated PowerShell or cmd.exe (run as Administrator).

```cmd
npm install --global --production windows-build-tools
```

[node-bluetooth-hci-socket prerequisites](#windows)
   * Compatible Bluetooth 5.0 Zephyr HCI-USB adapter (you need to add BLUETOOTH_HCI_SOCKET_USB_VID and BLUETOOTH_HCI_SOCKET_USB_PID to the process env)
   * Compatible Bluetooth 4.0 USB adapter
   * [WinUSB](https://msdn.microsoft.com/en-ca/library/windows/hardware/ff540196(v=vs.85).aspx) driver setup for Bluetooth 4.0 USB adapter, using [Zadig tool](http://zadig.akeo.ie/)

See [@don](https://github.com/don)'s setup guide on [Bluetooth LE with Node.js and Noble on Windows](https://www.youtube.com/watch?v=mL9B8wuEdms&feature=youtu.be&t=1m46s)

#### Docker

Make sure your container runs with `--network=host` options and all specific environment prerequisites are verified.

### Choosing a Linux Bluetooth access mode

Noble supports three materially different Linux setups:

- **D-Bus binding:** `withBindings('dbus')` uses the system BlueZ service and
  is the best default when noble should coexist with desktop or system
  Bluetooth clients.
- **Raw HCI binding:** `withBindings('hci')` is the default on Linux. It shares
  the controller with the kernel Bluetooth stack and BlueZ. It requires raw
  socket privileges and gives noble direct access to HCI traffic.
- **HCI user channel:** `withBindings('hci', { userChannel: true })` gives noble
  exclusive controller access. Use it for a dedicated adapter when another
  Bluetooth stack must not operate that controller.

The user channel requires `CAP_NET_ADMIN` (running with `sudo` is the simplest
setup) and the adapter must be down before noble binds it:

```sh
sudo hciconfig hci1 down
sudo NOBLE_HCI_DEVICE_ID=1 HCI_CHANNEL_USER=1 node app.js
```

The equivalent code configuration is:

```typescript
const noble = withBindings('hci', {
  hciDriver: 'native',
  deviceId: 1,
  userChannel: true
});
```

Binding the user channel to an adapter that is still up fails with `EBUSY`.
Conversely, raw mode does not power up a down adapter; run
`sudo hciconfig hciX up` first when using raw mode.

When diagnosing raw-mode traffic with `btmon`, an unlabeled HCI command only
shows that the kernel sent it. It is not, by itself, proof that `bluetoothd`
started an unrelated operation: noble's native HCI dependency also uses kernel
L2CAP sockets for connection bookkeeping. Use a dedicated adapter with the
user channel when command ownership must be unambiguous.

### Running without root/sudo (Linux-specific)

Run the following command:

```sh
sudo setcap cap_net_raw+eip $(eval readlink -f `which node`)
```

This grants the `node` binary `cap_net_raw` privileges, so it can start/stop BLE advertising.

__Note:__ The above command requires `setcap` to be installed.
It can be installed the following way:

 * apt: `sudo apt-get install libcap2-bin`
 * yum: `su -c \'yum install libcap2-bin\'`

### Multiple Adapters (Linux-specific)

When no adapter is specified, raw mode selects the first adapter that is up,
while the user channel selects the first adapter that is down. Specify the
adapter explicitly whenever more than one is present.

You can specify which HCI adapter to use in two ways:

#### 1. Using `withBindings` (Recommended)

```typescript
import { withBindings } from '@stoprocent/noble';

// Specify HCI adapter in code
const noble = withBindings('hci', { 
  hciDriver: 'native',
  deviceId: 1 // Using hci1
});
```

#### 2. Using environment variable

To override using environment variables, set the `NOBLE_HCI_DEVICE_ID` environment variable to the interface number.

For example, to specify `hci1`:

```sh
sudo NOBLE_HCI_DEVICE_ID=1 node <your file>.js
```

If you are using multiple HCI devices in one setup you can run two instances of noble with different binding configurations by initializing them seperatly in code:

``` typescript
import { withBindings } from '@stoprocent/noble';

// Create two noble instances with different HCI adapters
const nobleAdapter0 = withBindings('hci', { 
  hciDriver: 'native',
  deviceId: 0 // Using hci0
});

const nobleAdapter1 = withBindings('hci', { 
  hciDriver: 'native',
  deviceId: 1 // Using hci1
});
```


### Reporting all HCI events (Linux-specific)

By default, noble waits for both the advertisement data and scan response data for each Bluetooth address. If your device does not use scan response, the `NOBLE_REPORT_ALL_HCI_EVENTS` environment variable can be used to bypass it.

```sh
sudo NOBLE_REPORT_ALL_HCI_EVENTS=1 node <your file>.js
```

## Environment Variables

The following environment variables can configure noble's behavior:

| Variable | Purpose | Default | Example |
|----------|---------|---------|---------|
| NOBLE_HCI_DEVICE_ID | Specify which HCI adapter to use (HCI socket and D-Bus bindings) | 0 (D-Bus: the first BlueZ adapter) | `export NOBLE_HCI_DEVICE_ID=1` |
| HCI_CHANNEL_USER | Use the exclusive Linux HCI user channel | false | `export HCI_CHANNEL_USER=1` |
| NOBLE_CODED_PHY | Offer LE Coded PHY for connections (long range, lower throughput; requires controller support) | false | `export NOBLE_CODED_PHY=1` |
| NOBLE_REPORT_ALL_HCI_EVENTS | Report HCI events without waiting for scan response | false | `export NOBLE_REPORT_ALL_HCI_EVENTS=1` |
| BLUETOOTH_HCI_SOCKET_UART_PORT | UART port for HCI communication | none | `export BLUETOOTH_HCI_SOCKET_UART_PORT=/dev/ttyUSB0` |
| BLUETOOTH_HCI_SOCKET_UART_BAUDRATE | UART baudrate | 1000000 | `export BLUETOOTH_HCI_SOCKET_UART_BAUDRATE=1000000` |

> **Note:** The preferred method for configuration is now using the `withBindings()` API rather than environment variables.
