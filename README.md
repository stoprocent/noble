# ![noble](assets/noble-logo.png)

[![npm version](https://badgen.net/npm/v/@stoprocent/noble)](https://www.npmjs.com/package/@stoprocent/noble)
[![npm downloads](https://badgen.net/npm/dt/@stoprocent/noble)](https://www.npmjs.com/package/@stoprocent/noble)
[![Build Status](https://travis-ci.org/stoprocent/noble.svg?branch=master)](https://travis-ci.org/stoprocent/noble)

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

```javascript
const noble = require('@stoprocent/noble');
```

## Documentation

* [Quick Start Example](#quick-start-example)
* [Installation](#installation)
* [API docs](#api-docs)
* [Advanced usage](#advanced-usage)
* [Common problems](#common-problems)

## Quick Start Example

```javascript
// Read the battery level of the first found peripheral exposing the Battery Level characteristic
const noble = require('../');

async function run() {
  try {
    await noble.waitForPoweredOn();
    await noble.startScanningAsync(['180f'], false);
  } catch (error) {
    console.error(error);
  }
}

noble.on('discover', async (peripheral) => {
  await noble.stopScanningAsync();
  await peripheral.connectAsync();
  const {characteristics} = await peripheral.discoverSomeServicesAndCharacteristicsAsync(['180f'], ['2a19']);
  const batteryLevel = (await characteristics[0].readAsync())[0];

  console.log(`${peripheral.address} (${peripheral.advertisement.localName}): ${batteryLevel}%`);

  await peripheral.disconnectAsync();
  process.exit(0);
});

run();

```
## Use Noble With BLE5 Extended Features With HCI 

```javascript
const noble = require('@stoprocent/noble/with-custom-binding')({extended: true});

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

##### Example 1 (UART port spcified as enviromental variable)

```bash
$ export BLUETOOTH_HCI_SOCKET_UART_PORT=/dev/tty...
$ export BLUETOOTH_HCI_SOCKET_UART_BAUDRATE=1000000
```

__NOTE:__ `BLUETOOTH_HCI_SOCKET_UART_BAUDRATE` defaults to `1000000` so only needed if different.

```javascript
const noble = require('@stoprocent/noble');
```

##### Example 2 (UART port spcified in `bindParams`)

```bash
$ export BLUETOOTH_HCI_SOCKET_FORCE_UART=1
```

```javascript
const noble = require('@stoprocent/noble/with-custom-binding') ( { 
  bindParams: { 
    uart: { 
      port: '/dev/tty...', 
      baudRate: 1000000
    } 
  } 
} );
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

Make sure your container runs with `--network=host` options and all specific environment preriquisites are verified.

### Installing and using the package

```sh
npm install @stoprocent/noble
```

In Windows OS add your custom hci-usb dongle to the process env
```sh
set BLUETOOTH_HCI_SOCKET_USB_VID=xxx
set BLUETOOTH_HCI_SOCKET_USB_PID=xxx
```

```javascript
const noble = require('@stoprocent/noble');
```

## API docs

All operations have two API variants – one expecting a callback, one returning a Promise (denoted by `Async` suffix).

Additionally, there are events corresponding to each operation (and a few global events).

For example, in case of the "discover services" operation of Peripheral:

* There's a `discoverServices` method expecting a callback:
   ```javascript
   peripheral.discoverServices((error, services) => {
     // callback - handle error and services
   });
   ```
* There's a `discoverServicesAsync` method returning a Promise:
  ```javascript
  try {
    const services = await peripheral.discoverServicesAsync();
    // handle services
  } catch (e) {
    // handle error
  }
  ```
* There's a `servicesDiscover` event emitted after services are discovered:
  ```javascript
  peripheral.once('servicesDiscover', (services) => {
    // handle services
  });
  ```

API structure:

* [Scanning and discovery](#scanning-and-discovery)
  * [_Event: Adapter state changed_](#event-adapter-state-changed)
  * [Set address](#set-address)
  * [Start scanning](#start-scanning)
  * [_Event: Scanning started_](#event-scanning-started)
  * [Stop scanning](#stop-scanning)
  * [_Event: Scanning stopped_](#event-scanning-stopped)
  * [Connect by UUID / Address](#connect-by-uuid)
  * [_Event: Peripheral discovered_](#event-peripheral-discovered)
  * [_Event: Warning raised_](#event-warning-raised)
* [Reset device](#reset-device)
* [Peripheral](#peripheral)
  * [Connect](#connect)
  * [_Event: Connected_](#event-connected)
  * [Cancel a pending connection](#cancel-a-pending-connection)
  * [Disconnect](#disconnect)
  * [_Event: Disconnected_](#event-disconnected)
  * [Update RSSI](#update-rssi)
  * [_Event: RSSI updated_](#event-rssi-updated)
  * [Discover services](#discover-services)
  * [Discover all services and characteristics](#discover-all-services-and-characteristics)
  * [Discover some services and characteristics](#discover-some-services-and-characteristics)
  * [_Event: Services discovered_](#event-services-discovered)
  * [Read handle](#read-handle)
  * [_Event: Handle read_](#event-handle-read)
  * [Write handle](#write-handle)
  * [_Event: Handle written_](#event-handle-written)
* [Service](#service)
  * [Discover included services](#discover-included-services)
  * [_Event: Included services discovered_](#event-included-services-discovered)
  * [Discover characteristics](#discover-characteristics)
  * [_Event: Characteristics discovered_](#event-characteristics-discovered)
* [Characteristic](#characteristic)
  * [Read](#read)
  * [_Event: Data read_](#event-data-read)
  * [Write](#write)
  * [_Event: Data written_](#event-data-written)
  * [Broadcast](#broadcast)
  * [_Event: Broadcast sent_](#event-broadcast-sent)
  * [Subscribe](#subscribe)
  * [_Event: Notification received_](#event-notification-received)
  * [Unsubscribe](#unsubscribe)
  * [Discover descriptors](#discover-descriptors)
  * [_Event: Descriptors discovered_](#event-descriptors-discovered)
* [Descriptor](#descriptor)
  * [Read value](#read-value)
  * [_Event: Value read_](#event-value-read)
  * [Write value](#write-value)
  * [_Event: Value written_](#event-value-written)

### Scanning and discovery

#### _Event: Adapter state changed_

```javascript
noble.on('stateChange', callback(state));
```

`state` can be one of:
* `unknown`
* `resetting`
* `unsupported`
* `unauthorized`
* `poweredOff`
* `poweredOn`

#### Set address

```javascript
noble.setAddress('00:11:22:33:44:55'); // set adapter's mac address
```
__NOTE:__ Curently this feature is only supported on HCI as it's using vendor specific commands. Source of the commands is based on the [BlueZ bdaddr.c](https://github.com/pauloborges/bluez/blob/master/tools/bdaddr.c).
__NOTE:__ `noble.state` must be `poweredOn` before address can be set. `noble.on('stateChange', callback(state));` can be used to listen for state change events.

#### Start scanning

```javascript
noble.startScanning(); // any service UUID, no duplicates


noble.startScanning([], true); // any service UUID, allow duplicates


var serviceUUIDs = ['<service UUID 1>', ...]; // default: [] => all
var allowDuplicates = falseOrTrue; // default: false

noble.startScanning(serviceUUIDs, allowDuplicates[, callback(error)]); // particular UUIDs
```

__NOTE:__ `noble.state` must be `poweredOn` before scanning is started. `noble.on('stateChange', callback(state));` can be used to listen for state change events.

#### _Event: Scanning started_

```javascript
noble.on('scanStart', callback);
```

The event is emitted when:
* Scanning is started
* Another application enables scanning
* Another application changes scanning settings

#### Stop scanning

```javascript
noble.stopScanning();
```

#### _Event: Scanning stopped_

```javascript
noble.on('scanStop', callback);
```

The event is emitted when:
* Scanning is stopped
* Another application stops scanning

#### Connect by UUID

The `connect` function is used to establish a Bluetooth Low Energy connection to a peripheral device using its UUID. It provides both callback-based and Promise-based interfaces.

##### Usage

```typescript
// Callback-based usage
connect(peripheralUuid: string, options?: object, callback?: (error?: Error, peripheral: Peripheral) => void): void;

// Promise-based usage
connectAsync(peripheralUuid: string, options?: object): Promise<Peripheral>;
```

##### Parameters
- `peripheralUuid`: The UUID of the peripheral to connect to.
- `options`: Optional parameters for the connection (this may include connection interval, latency, supervision timeout, etc.).
- `callback`: An optional callback that returns an error or the connected peripheral object.

##### Description
The `connect` function initiates a connection to a BLE peripheral. The function immediately returns, and the actual connection result is provided asynchronously via the callback or Promise. If the peripheral is successfully connected, a `Peripheral` object representing the connected device is provided.

##### Example

```javascript
const noble = require('@stoprocent/noble');

// Using callback
noble.connect('1234567890abcdef', {}, (error, peripheral) => {
  if (error) {
    console.error('Connection error:', error);
  } else {
    console.log('Connected to:', peripheral.uuid);
  }
});

// Using async/await
async function connectPeripheral() {
  try {
    const peripheral = await noble.connectAsync('1234567890abcdef');
    console.log('Connected to:', peripheral.uuid);
  } catch (error) {
    console.error('Connection error:', error);
  }
}
connectPeripheral();
```


#### _Event: Peripheral discovered_

```javascript
noble.on('discover', callback(peripheral));
```

* `peripheral`:
  ```javascript
  {
    id: '<id>',
    address: '<BT address'>, // Bluetooth Address of device, or 'unknown' if not known
    addressType: '<BT address type>', // Bluetooth Address type (public, random), or 'unknown' if not known
    connectable: trueOrFalseOrUndefined, // true or false, or undefined if not known
    advertisement: {
      localName: '<name>',
      txPowerLevel: someInteger,
      serviceUuids: ['<service UUID>', ...],
      serviceSolicitationUuid: ['<service solicitation UUID>', ...],
      manufacturerData: someBuffer, // a Buffer
      serviceData: [
          {
              uuid: '<service UUID>',
              data: someBuffer // a Buffer
          },
          // ...
      ]
    },
    rssi: integerValue,
    mtu: integerValue // MTU will be null, until device is connected and hci-socket is used
  };
  ```

__Note:__ On macOS, the address will be set to '' if the device has not been connected previously.


#### _Event: Warning raised_

```javascript
noble.on('warning', callback(message));
```

### Reset device

```javascript
noble.reset()
```

### Peripheral

#### Connect

```javascript
peripheral.connect([callback(error)]);
```

Some of the bluetooth devices doesn't connect seamlessly, may be because of bluetooth device firmware or kernel. Do reset the device with noble.reset() API before connect API.

#### _Event: Connected_

```javascript
peripheral.once('connect', callback);
```

#### Cancel a pending connection

```javascript
peripheral.cancelConnect();
// Will emit a 'connect' event with error
```

#### Disconnect

```javascript
peripheral.disconnect([callback(error)]);
```

#### _Event: Disconnected_

```javascript
peripheral.once('disconnect', callback);
```

#### Update RSSI

```javascript
peripheral.updateRssi([callback(error, rssi)]);
```

#### _Event: RSSI updated_

```javascript
peripheral.once('rssiUpdate', callback(rssi));
```

#### Discover services

```javascript
peripheral.discoverServices(); // any service UUID

var serviceUUIDs = ['<service UUID 1>', ...];
peripheral.discoverServices(serviceUUIDs[, callback(error, services)]); // particular UUIDs
```

#### Discover all services and characteristics

```javascript
peripheral.discoverAllServicesAndCharacteristics([callback(error, services, characteristics)]);
```

#### Discover some services and characteristics

```javascript
var serviceUUIDs = ['<service UUID 1>', ...];
var characteristicUUIDs = ['<characteristic UUID 1>', ...];
peripheral.discoverSomeServicesAndCharacteristics(serviceUUIDs, characteristicUUIDs, [callback(error, services, characteristics));
```

#### _Event: Services discovered_

```javascript
peripheral.once('servicesDiscover', callback(services));
```

#### Read handle

```javascript
peripheral.readHandle(handle, callback(error, data));
```

#### _Event: Handle read_

```javascript
peripheral.once('handleRead<handle>', callback(data)); // data is a Buffer
```

`<handle>` is the handle identifier.

#### Write handle

```javascript
peripheral.writeHandle(handle, data, withoutResponse, callback(error));
```

#### _Event: Handle written_

```javascript
peripheral.once('handleWrite<handle>', callback());
```

`<handle>` is the handle identifier.

### Service

#### Discover included services

```javascript
service.discoverIncludedServices(); // any service UUID

var serviceUUIDs = ['<service UUID 1>', ...];
service.discoverIncludedServices(serviceUUIDs[, callback(error, includedServiceUuids)]); // particular UUIDs
```

#### _Event: Included services discovered_

```javascript
service.once('includedServicesDiscover', callback(includedServiceUuids));
```

#### Discover characteristics

```javascript
service.discoverCharacteristics() // any characteristic UUID

var characteristicUUIDs = ['<characteristic UUID 1>', ...];
service.discoverCharacteristics(characteristicUUIDs[, callback(error, characteristics)]); // particular UUIDs
```

#### _Event: Characteristics discovered_

```javascript
service.once('characteristicsDiscover', callback(characteristics));
```

* `characteristics`
  ```javascript
  {
    uuid: '<uuid>',
    properties: ['...'] // 'broadcast', 'read', 'writeWithoutResponse', 'write', 'notify', 'indicate', 'authenticatedSignedWrites', 'extendedProperties'
  };
  ```

### Characteristic

#### Read

```javascript
characteristic.read([callback(error, data)]);
```

#### _Event: Data read_

```javascript
characteristic.on('data', callback(data, isNotification));

characteristic.once('read', callback(data, isNotification)); // legacy
```

Emitted when:
* Characteristic read has completed, result of `characteristic.read(...)`
* Characteristic value has been updated by peripheral via notification or indication, after having been enabled with `characteristic.notify(true[, callback(error)])`

**Note:** `isNotification` event parameter value MAY be `undefined` depending on platform. The parameter is **deprecated** after version 1.8.1, and not supported on macOS High Sierra and later.

#### Write

```javascript
characteristic.write(data, withoutResponse[, callback(error)]); // data is a Buffer, withoutResponse is true|false
```

* `withoutResponse`:
  * `false`: send a write request, used with "write" characteristic property
  * `true`: send a write command, used with "write without response" characteristic property


#### _Event: Data written_

```javascript
characteristic.once('write', withoutResponse, callback());
```

Emitted when characteristic write has completed, result of `characteristic.write(...)`.

#### Broadcast

```javascript
characteristic.broadcast(broadcast[, callback(error)]); // broadcast is true|false
```

#### _Event: Broadcast sent_

```javascript
characteristic.once('broadcast', callback(state));
```

Emitted when characteristic broadcast state changes, result of `characteristic.broadcast(...)`.

#### Subscribe

```javascript
characteristic.subscribe([callback(error)]);
```

Subscribe to a characteristic.

Triggers `data` events when peripheral sends a notification or indication. Use for characteristics with "notify" or "indicate" properties.

#### _Event: Notification received_

```javascript
characteristic.once('notify', callback(state));
```

Emitted when characteristic notification state changes, result of `characteristic.notify(...)`.

#### Unsubscribe

```javascript
characteristic.unsubscribe([callback(error)]);
```

Unsubscribe from a characteristic.

Use for characteristics with "notify" or "indicate" properties

#### Discover descriptors

```javascript
characteristic.discoverDescriptors([callback(error, descriptors)]);
```

#### _Event: Descriptors discovered_

```javascript
characteristic.once('descriptorsDiscover', callback(descriptors));
```
* `descriptors`:
  ```javascript
  [
    {
      uuid: '<uuid>'
    },
    // ...
  ]
  ```

### Descriptor

#### Read value

```javascript
descriptor.readValue([callback(error, data)]);
```

#### _Event: Value read_

```javascript
descriptor.once('valueRead', data); // data is a Buffer
```

#### Write value

```javascript
descriptor.writeValue(data[, callback(error)]); // data is a Buffer
```

#### _Event: Value written_

```javascript
descriptor.once('valueWrite');
```

## Advanced usage

### Override default bindings

By default, noble will select appropriate Bluetooth device bindings based on your platform. You can provide custom bindings using the `with-bindings` module.

```javascript
var noble = require('@stoprocent/noble/with-bindings')(require('./my-custom-bindings'));
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
