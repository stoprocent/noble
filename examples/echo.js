/* eslint-disable handle-callback-err */
// Connect to a peripheral running the echo service
// https://github.com/noble/bleno/blob/master/examples/echo

// subscribe to be notified when the value changes
// start an interval to write data to the characteristic

// const noble = require('noble');
const noble = require('..');

const ECHO_SERVICE_UUID = 'ec00';
const ECHO_CHARACTERISTIC_UUID = 'ec0e';

async function main() {
  try {
    // Wait for the BLE adapter to be ready
    console.log('Waiting for powered on');
    await noble.waitForPoweredOnAsync();
    console.log('Powered on');
    await noble.setAddress('11:22:33:44:55:66');
    console.log('Set address');
    await noble.startScanningAsync([ECHO_SERVICE_UUID], false);
    console.log('Scanning');
  } catch (error) {
    console.error('Error initializing BLE:', error);
    process.exit(1);
  }
}

noble.on('discover', (peripheral) => {
  // connect to the first peripheral that is scanned
  noble.stopScanningAsync();
  const name = peripheral.advertisement.localName;
  console.log(`Connecting to '${name}' ${peripheral.id}`);
  connectAndSetUp(peripheral);
});

async function connectAndSetUp(peripheral) {
  try {
    await peripheral.connectAsync();
    console.log('Connected to', peripheral.id);

    // // specify the services and characteristics to discover
    const { services, characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
      [ECHO_SERVICE_UUID],
      [ECHO_CHARACTERISTIC_UUID]
    );

    console.log('Discovered services and characteristics');
    const echoCharacteristic = characteristics[0];

    // data callback receives notifications
    echoCharacteristic.on('read', (data, isNotification) => {
      console.log(`Received: "${data}"`);
    });

    // subscribe to be notified whenever the peripheral update the characteristic
    try {
      await echoCharacteristic.subscribeAsync();
      console.log('Subscribed for echoCharacteristic notifications');
    } catch (error) {
      console.error('Error subscribing to echoCharacteristic:', error);
      return;
    }

    // create an interval to send data to the service
    let count = 0;
    setInterval(async () => {
      count++;
      const message = Buffer.from(`hello, ble ${count}`, 'utf-8');
      console.log(`Sending:  '${message}'`);
      await echoCharacteristic.writeAsync(message, false);
    }, 2500);

  } catch (error) {
    console.error('Error during connection setup:', error);
  }

  peripheral.on('disconnect', () => console.log('disconnected'));
}

// Handle process termination
const cleanup = async () => {
  console.log('Caught interrupt signal');
  await noble.stopScanningAsync();
  process.exit();
};

process.on('SIGINT', cleanup);
process.on('SIGQUIT', cleanup);
process.on('SIGTERM', cleanup);

// Start the application
main().catch(console.error);
