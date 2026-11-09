import noble, { type Peripheral } from '@stoprocent/noble';

// Talks to a peripheral running the bleno echo service
// (https://github.com/noble/bleno/blob/master/examples/echo): writes a
// message every 500 ms and prints what the peripheral notifies back.

const ECHO_SERVICE_UUID = 'ec00';
const ECHO_CHARACTERISTIC_UUID = 'ec0e';
const MESSAGES = 15;

async function echo (peripheral: Peripheral): Promise<void> {
  await peripheral.connect();
  console.log('Connected to', peripheral.id);

  const { characteristics } = await peripheral.discoverSomeServicesAndCharacteristics(
    [ECHO_SERVICE_UUID],
    [ECHO_CHARACTERISTIC_UUID]
  );
  const [echoCharacteristic] = characteristics;

  let count = 0;
  const interval = setInterval(() => {
    count++;
    const message = Buffer.from(`hello, ble ${count}`, 'utf-8');
    console.log(`Sending:  '${message}'`);
    echoCharacteristic.write(message).catch(error => console.error('Write failed:', error.message));
  }, 500);

  try {
    // notifications() subscribes, and unsubscribes again when the loop is left.
    for await (const data of echoCharacteristic.notifications()) {
      console.log(`Received: '${data}'`);
      if (count >= MESSAGES) {
        break;
      }
    }
  } finally {
    clearInterval(interval);
    await peripheral.disconnect();
  }
}

async function main (): Promise<void> {
  console.log('Waiting for powered on');
  await noble.waitForPoweredOn();

  console.log('Scanning');
  for await (const peripheral of noble.discover({ serviceUuids: [ECHO_SERVICE_UUID] })) {
    // Use the first peripheral that advertises the echo service.
    console.log(`Connecting to '${peripheral.advertisement.localName}' ${peripheral.id}`);
    await echo(peripheral);
    break;
  }
}

process.once('SIGINT', () => noble.stop());

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => noble.stop());
