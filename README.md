# ![noble](assets/noble-logo.png)

[![npm version](https://badgen.net/npm/v/@stoprocent/noble)](https://www.npmjs.com/package/@stoprocent/noble)
[![npm downloads](https://badgen.net/npm/dt/@stoprocent/noble)](https://www.npmjs.com/package/@stoprocent/noble)


A Node.js BLE (Bluetooth Low Energy) central module.

Want to implement a peripheral? Check out [@stoprocent/bleno](https://github.com/stoprocent/bleno).

## About This Fork

This fork of `noble` was created to introduce several key improvements and new features:

1. **HCI UART Support**: This version enables HCI UART communication through the `@stoprocent/node-bluetooth-hci-socket` dependency, allowing more flexible use of Bluetooth devices across platforms.
   
2. **macOS Native Bindings Fix**: I have fixed the native bindings for macOS, ensuring better compatibility and performance on Apple devices.

3. **Windows Native Bindings Fix**: I have fixed the native bindings for Windows, adding support for `Service Data` from advertisements.

4. **New Features**: 
  - A `setAddress(...)` function has been added, allowing users to set the MAC address of the central device. 
  - A `connect(...)/connectAsync(...)` function has been added, allowing users to connect directly to specific device by address/identifier without a need to prior scan. 
  - A `waitForPoweredOn(...)` function to wait for the adapter to be powered on in await/async functions.
  - Additionally, I plan to add raw L2CAP channel support, enhancing low-level Bluetooth communication capabilities.

If you appreciate these enhancements and the continued development of this project, please consider supporting my work. 

[![Buy me a coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/stoprocent)

## Install

```sh
npm install @stoprocent/noble
```

## Usage

### TypeScript (Recommended)

```typescript
import noble from '@stoprocent/noble';
// or
import { withBindings } from '@stoprocent/noble';
const noble = withBindings('default');
```

### JavaScript

```javascript
const noble = require('@stoprocent/noble');
// or
const { withBindings } = require('@stoprocent/noble');
const noble = withBindings('default');
```

For more detailed examples and API documentation, see [Binding Types](#Binding-Types) below.

## Quick Start Example

### TypeScript Example (Modern Async/Await)

#### Basic Connection and Service Discovery

```typescript
import { withBindings } from '@stoprocent/noble';

async function connectToDevice(targetAddress: string) {
  // Initialize noble with default bindings
  const noble = withBindings('default');
  
  // Wait for Bluetooth adapter to be ready
  await noble.waitForPoweredOnAsync();
  
  // Scan for devices
  await noble.startScanningAsync([], false);
  
  // Option 1: Using async generator to discover devices
  for await (const peripheral of noble.discoverAsync()) {
    if (peripheral.address === targetAddress) {
      await noble.stopScanningAsync();
      await peripheral.connectAsync();
      return peripheral;
    }
  }
  
  // Option 2: Direct connection without scanning
  // return await noble.connectAsync(targetAddress);
}
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

// Set adapter address (HCI only)
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

```typescript
// Read characteristic value
const data = await characteristic.readAsync();

// Write characteristic value
await characteristic.writeAsync(data, withoutResponse);

// Subscribe to notifications
await characteristic.subscribeAsync();

// Unsubscribe from notifications
await characteristic.unsubscribeAsync();

// Discover descriptors
const descriptors = await characteristic.discoverDescriptorsAsync();
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

##### Example 1 (UART port specified as environmental variable)

```bash
$ export BLUETOOTH_HCI_SOCKET_UART_PORT=/dev/tty...
$ export BLUETOOTH_HCI_SOCKET_UART_BAUDRATE=1000000
```

__NOTE:__ `BLUETOOTH_HCI_SOCKET_UART_BAUDRATE` defaults to `1000000` so only needed if different.

```typescript
import noble from '@stoprocent/noble';
```

##### Example 2 (UART port specified in `bindParams`)

```bash
$ export BLUETOOTH_HCI_SOCKET_FORCE_UART=1
```

```typescript
import { withBindings } from '@stoprocent/noble';
const noble = withBindings('hci', { 
  bindParams: { 
    uart: { 
      port: '/dev/tty...', 
      baudRate: 1000000
    } 
  } 
});
```

__NOTE:__ There is a [UART code example](examples/uart-bind-params.js) in the `/examples` directory.

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

### Installing and using the package

```sh
npm install @stoprocent/noble
```

In Windows OS add your custom hci-usb dongle to the process env
```sh
set BLUETOOTH_HCI_SOCKET_USB_VID=xxx
set BLUETOOTH_HCI_SOCKET_USB_PID=xxx
```

```typescript
// TypeScript
import noble from '@stoprocent/noble';
// or with custom bindings
import { withBindings } from '@stoprocent/noble';
const noble = withBindings('default');

// JavaScript
const noble = require('@stoprocent/noble');
// or with custom bindings
const { withBindings } = require('@stoprocent/noble');
const noble = withBindings('default');
```



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

To override, set the `NOBLE_HCI_DEVICE_ID` environment variable to the interface number.

For example, to specify `hci1`:

```sh
sudo NOBLE_HCI_DEVICE_ID=1 node <your file>.js
```

If you are using multiple HCI devices in one setup you can run two instances of noble with different binding configurations by initializing them seperatly in code:

```
const HCIBindings = require('@stoprocent/noble/lib/hci-socket/bindings');
const Noble = require('@stoprocent/noble/lib/noble');

const params = {
  deviceId: 0,
  userChannel: true,
  extended: false //ble5 extended features
};

const noble = new Noble(new HCIBindings(params));
```

### Reporting all HCI events (Linux-specific)

By default, noble waits for both the advertisement data and scan response data for each Bluetooth address. If your device does not use scan response, the `NOBLE_REPORT_ALL_HCI_EVENTS` environment variable can be used to bypass it.

```sh
sudo NOBLE_REPORT_ALL_HCI_EVENTS=1 node <your file>.js
```

### bleno compatibility (Linux-specific)

By default, noble will respond with an error whenever a GATT request message is received. If your intention is to use bleno in tandem with noble, the `NOBLE_MULTI_ROLE` environment variable can be used to bypass this behaviour.

__Note:__ this requires a Bluetooth 4.1 adapter.

```sh
sudo NOBLE_MULTI_ROLE=1 node <your file>.js
```

## Common problems

### Maximum simultaneous connections

This limit is imposed by the Bluetooth adapter hardware as well as its firmware.

| Platform                          |                       |
| :-------------------------------- | --------------------- |
| OS X 10.11 (El Capitan)           | 6                     |
| Linux/Windows - Adapter-dependent | 5 (CSR based adapter) |

### Sandboxed terminal

On newer versions of OSX, the terminal app is sandboxed to not allow bluetooth connections by default. If you run a script that tries to access it, you will get an `Abort trap: 6` error.

To enable bluetooth, go to "System Preferences" —> "Security & Privacy" —> "Bluetooth" -> Add your terminal into allowed apps.

### Adapter-specific known issues

Some BLE adapters cannot connect to a peripheral while they are scanning (examples below). You will get the following messages when trying to connect:

Sena UD-100 (Cambridge Silicon Radio, Ltd Bluetooth Dongle (HCI mode)): `Error: Command disallowed`

Intel Dual Band Wireless-AC 7260 (Intel Corporation Wireless 7260 (rev 73)): `Error: Connection Rejected due to Limited Resources (0xd)`

You need to stop scanning before trying to connect in order to solve this issue.

## Useful links

 * [Bluetooth Development Portal](http://developer.bluetooth.org)
   * [GATT Specifications](https://www.bluetooth.com/specifications/gatt/)
 * [Bluetooth: ATT and GATT](http://epx.com.br/artigos/bluetooth_gatt.php)
