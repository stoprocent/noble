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

3. **Modern JavaScript Support**:
   - Added full Promise-based API with async/await support throughout the library
   - Implemented async iterators for device discovery with `for await...of` syntax
   - Refactored codebase to use modern JavaScript patterns and best practices

4. **Enhanced Testing and Reliability**:
   - Migrated tests to Jest for improved coverage and reliability
   - Added comprehensive TypeScript type definitions
   - Fixed numerous edge cases and stability issues

5. **New Features**: 
   - A `setAddress(...)` function to set the MAC address of the central device
   - Direct device connection with `connect(...)/connectAsync(...)` without requiring a prior scan
   - `waitForPoweredOnAsync(...)` function to simplify async workflows
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

### TypeScript (Recommended)

```typescript
// Auto-select based on platform
import noble from '@stoprocent/noble';
// or
import { withBindings } from '@stoprocent/noble';
// Auto-select based on platform
const noble = withBindings('default'); // 'hci', 'win', 'mac'
```

For more detailed examples and API documentation, see [Binding Types](#Binding-Types) below.

### JavaScript

```javascript
const noble = require('@stoprocent/noble');
// or 
const { withBindings } = require('@stoprocent/noble');
const noble = withBindings('default'); // 'hci', 'win', 'mac'
```


## Quick Start Example

### TypeScript Example (Modern Async/Await)

#### Basic Scan

```typescript
import noble from '@stoprocent/noble';

// Discover peripherals as an async generator
try {
  // Wait for Adapter poweredOn state
  await noble.waitForPoweredOnAsync();
  // Start scanning first
  await noble.startScanningAsync();
  
  // Use the async generator with proper boundaries
  for await (const peripheral of noble.discoverAsync()) {
    console.log(`Found device: ${peripheral.advertisement.localName || 'Unknown'}`);
    // Process the peripheral as needed
    
    // Optional: stop scanning when a specific device is found
    if (peripheral.advertisement.localName === 'MyDevice') {
      break;
    }
  }
  
  // Clean up after discovery
  await noble.stopScanningAsync();
} catch (error) {
  console.error('Discovery error:', error);
  await noble.stopScanningAsync();
}
```

For a more detailed example, please check out [examples/peripheral-explorer.ts](examples/peripheral-explorer.ts)

Alternatively, you can still use the legacy event-based API:

``` javascript
const noble = require('@stoprocent/noble');

// State change event is emitted when adapter state changes
noble.on('stateChange', function (state) {
  if (state === 'poweredOn') {
    // Start scanning when adapter is ready
    noble.startScanning();
  } else {
    // Stop scanning if adapter becomes unavailable
    noble.stopScanning();
  }
});

// Discover event is emitted when a peripheral is found
noble.on('discover', peripheral => {
  console.log(peripheral);
  // From here you can work with the peripheral:
  // - Connect to it: peripheral.connect()
  // - Check advertisement data: peripheral.advertisement
  // - See signal strength: peripheral.rssi
});
```

#### Connecting to the device

``` typescript
// Stop scan
await noble.stopScanningAsync();
// Connect
await peripheral.connectAsync();
// Discover
const { services, characteristics } = await peripheral.discoverAllServicesAndCharacteristicsAsync();
```

#### Working with Services and Characteristics

```typescript
async function exploreServices(peripheral) {
  // Discover all services and characteristics at once
  const { services } = await peripheral.discoverAllServicesAndCharacteristicsAsync();
  
  const results = [];
  
  for (const service of services) {
    const serviceInfo = {
      uuid: service.uuid,
      characteristics: []
    };
    
    for (const characteristic of service.characteristics) {
      const characteristicInfo = {
        uuid: characteristic.uuid,
        properties: characteristic.properties
      };
      
      // Read the characteristic if it's readable
      if (characteristic.properties.includes('read')) {
        characteristicInfo.value = await characteristic.readAsync();
      }
      
      serviceInfo.characteristics.push(characteristicInfo);
    }
    
    results.push(serviceInfo);
  }
  
  return results;
}
```

#### Reading and Writing Data

```typescript
async function readBatteryLevel(peripheral) {
  // Get battery service (0x180F is the standard UUID for Battery Service)
  const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
    ['180f'], // Battery Service
    ['2a19']  // Battery Level Characteristic
  );
  
  if (characteristics.length > 0) {
    const data = await characteristics[0].readAsync();
    return data[0]; // Battery percentage
  }
  
  return null;
}

async function writeCharacteristic(peripheral, serviceUuid, characteristicUuid, data) {
  const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
    [serviceUuid], 
    [characteristicUuid]
  );
  
  if (characteristics.length > 0) {
    // false = with response, true = without response
    const requiresResponse = !characteristics[0].properties.includes('writeWithoutResponse');
    await characteristics[0].writeAsync(data, !requiresResponse);
    return true;
  }
  
  return false;
}
```

### JavaScript Example (Battery Level)

```javascript
const { withBindings } = require('@stoprocent/noble');

// Read the battery level of the first found peripheral exposing the Battery Level characteristic
async function readBatteryLevel() {
  const noble = withBindings('default');

  try {
    await noble.waitForPoweredOnAsync();
    await noble.startScanningAsync(['180f'], false);
    
    noble.on('discover', async (peripheral) => {
      await noble.stopScanningAsync();
      await peripheral.connectAsync();
      
      const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(['180f'], ['2a19']);
      const batteryLevel = (await characteristics[0].readAsync())[0];

      console.log(`${peripheral.address} (${peripheral.advertisement.localName}): ${batteryLevel}%`);

      await peripheral.disconnectAsync();
      process.exit(0);
    });
  } catch (error) {
    console.error(error);
  }
}

readBatteryLevel();
```

## API Overview

Noble provides both callback-based and Promise-based (Async) APIs:

### Binding Types

```typescript
// Default binding (automatically selects based on platform)
import noble from '@stoprocent/noble';
// or
import { withBindings } from '@stoprocent/noble';
const noble = withBindings('default');

// Specific bindings
const nobleHci = withBindings('hci');  // HCI socket binding
const nobleMac = withBindings('mac');  // macOS binding
const nobleWin = withBindings('win');  // Windows binding

// Custom options for HCI binding (Using UART HCI Dongle)
const nobleCustom = withBindings('hci', { 
  hciDriver: 'uart',
  bindParams: {
    uart: {
      port: '/dev/ttyUSB0',
      baudRate: 1000000
    }
  }
});

// Custom options for HCI binding (Native)
const nobleCustom = withBindings('hci', { 
  hciDriver: 'native',
  deviceId: 0 // This could be also set by env.NOBLE_HCI_DEVICE_ID=0
});
```

### Core Methods

```typescript
// Wait for adapter to be powered on
await noble.waitForPoweredOnAsync(timeout?: number);

// Start scanning
await noble.startScanningAsync(serviceUUIDs?: string[], allowDuplicates?: boolean);

// Stop scanning
await noble.stopScanningAsync();

// Discover peripherals as an async generator
for await (const peripheral of noble.discoverAsync()) {
  // handle each discovered peripheral
}

// Connect directly to a peripheral by ID or address
const peripheral = await noble.connectAsync(idOrAddress, options?);

// Set adapter address (HCI only on supported devices)
noble.setAddress('00:11:22:33:44:55');

// Reset adapter
noble.reset();

// Stop noble
noble.stop();
```

### Peripheral Methods

```typescript
// Connect to peripheral
await peripheral.connectAsync();

// Disconnect from peripheral
await peripheral.disconnectAsync();

// Update RSSI
const rssi = await peripheral.updateRssiAsync();

// Discover services
const services = await peripheral.discoverServicesAsync(['180f']); // Optional service UUIDs

// Discover all services and characteristics
const { services, characteristics } = await peripheral.discoverAllServicesAndCharacteristicsAsync();

// Discover specific services and characteristics
const { services, characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
  ['180f'], ['2a19']
);

// Read and write handles
const data = await peripheral.readHandleAsync(handle);
await peripheral.writeHandleAsync(handle, data, withoutResponse);
```

### Service Methods

```typescript
// Discover included services
const includedServiceUuids = await service.discoverIncludedServicesAsync([serviceUUIDs]);

// Discover characteristics
const characteristics = await service.discoverCharacteristicsAsync([characteristicUUIDs]);
```

### Characteristic Methods

> **Note:** The `data` event is the primary event for handling both read responses and notifications. When using the event-based approach, you can differentiate between read responses and notifications using the `isNotification` parameter. The previously used `read` event **has been deprecated and removed**. Instead, use the `data` event with `isNotification=false` to identify read responses.

```typescript
// Read characteristic value
const data = await characteristic.readAsync();

// Write characteristic value
await characteristic.writeAsync(data, withoutResponse);

// Subscribe to notifications
await characteristic.subscribeAsync();

// Unsubscribe from notifications
await characteristic.unsubscribeAsync();

// Receive notifications using async iterator
for await (const data of characteristic.notificationsAsync()) {
  console.log(`Received notification: ${data}`);
}

// Discover descriptors
const descriptors = await characteristic.discoverDescriptorsAsync();
```

### Characteristic Events

```typescript
// Receive data (both read responses and notifications)
characteristic.on('data', (data: Buffer, isNotification: boolean) => {
  console.log(`Received ${isNotification ? 'notification' : 'read response'}: ${data}`);
});

// Write completion 
characteristic.on('write', (error: Error | undefined) => {
  console.log('Write completed');
});

// Descriptor discovery
characteristic.on('descriptorsDiscover', (descriptors: Descriptor[]) => {
  console.log('Descriptors discovered');
});
```

### Descriptor Methods

```typescript
// Read descriptor value
const value = await descriptor.readValueAsync();

// Write descriptor value
await descriptor.writeValueAsync(data);
```

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

 * Install [Xcode](https://itunes.apple.com/ca/app/xcode/id497799835?mt=12)
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

`hci0` is used by default.

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
| NOBLE_HCI_DEVICE_ID | Specify which HCI adapter to use | 0 | `export NOBLE_HCI_DEVICE_ID=1` |
| NOBLE_REPORT_ALL_HCI_EVENTS | Report HCI events without waiting for scan response | false | `export NOBLE_REPORT_ALL_HCI_EVENTS=1` |
| BLUETOOTH_HCI_SOCKET_UART_PORT | UART port for HCI communication | none | `export BLUETOOTH_HCI_SOCKET_UART_PORT=/dev/ttyUSB0` |
| BLUETOOTH_HCI_SOCKET_UART_BAUDRATE | UART baudrate | 1000000 | `export BLUETOOTH_HCI_SOCKET_UART_BAUDRATE=1000000` |

> **Note:** The preferred method for configuration is now using the `withBindings()` API rather than environment variables.