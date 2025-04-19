/* eslint-disable handle-callback-err */
// Connect to a peripheral running the echo service
// https://github.com/noble/bleno/blob/master/examples/echo

// subscribe to be notified when the value changes
// start an interval to write data to the characteristic

// const noble = require('noble');
const noble = require('..');

const ECHO_SERVICE_UUID = 'ec00';
const ECHO_CHARACTERISTIC_UUID = 'ec0e';

async function main () {
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
    throw new Error('Error initializing BLE:', error);
  }
}

noble.on('discover', async (peripheral) => {
  // connect to the first peripheral that is scanned
  await noble.stopScanningAsync();
  const name = peripheral.advertisement.localName;
  console.log(`Connecting to '${name}' ${peripheral.id}`);
  connectAndSetUp(peripheral);
});

async function connectAndSetUp (peripheral) {
  try {
    await peripheral.connectAsync();
    console.log('Connected to', peripheral.id);

    // // specify the services and characteristics to discover
    const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristicsAsync(
      [ECHO_SERVICE_UUID],
      [ECHO_CHARACTERISTIC_UUID]
    );

    console.log('Discovered services and characteristics');
    const echoCharacteristic = characteristics[0];

    // create an interval to send data to the service
    let count = 0;
    const interval = setInterval(async () => {
      count++;
      const message = Buffer.from(`hello, ble ${count}`, 'utf-8');
      console.log(`Sending:  '${message}'`);
      await echoCharacteristic.writeAsync(message, false);
    }, 500);

    // subscribe to be notified whenever the peripheral update the characteristic
    try {
      for await (const data of echoCharacteristic.notificationsAsync()) {
        console.log(`Received: "${data}"`);
        if (count >= 15) {
          break;
        }
      }
    } finally {
      clearInterval(interval);
      await peripheral.disconnectAsync();
      noble.stop();
    }

  } catch (error) {
    console.error('Error during connection setup:', error);
  }
}

// Handle process termination
const cleanup = async () => {
  console.log('Caught interrupt signal');
  await noble.stopScanningAsync();
  noble.stop();
  console.log('noble stopped');
};

process.on('SIGINT', cleanup);
process.on('SIGQUIT', cleanup);
process.on('SIGTERM', cleanup);

// Start the application
main().catch(console.error);
