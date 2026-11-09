import noble, { type Peripheral } from '@stoprocent/noble';

// Prints every advertisement field of each peripheral in range.

function describe (peripheral: Peripheral): void {
  const { advertisement } = peripheral;

  console.log(`\n${new Date()}`);
  console.log(
    `Peripheral discovered (${peripheral.id}):
    - Address: ${peripheral.address} (${peripheral.addressType})
    - Connectable: ${peripheral.connectable}
    - Scannable: ${peripheral.scannable}
    - RSSI: ${peripheral.rssi}`
  );

  if (advertisement.localName) {
    console.log(`Local Name: ${advertisement.localName}`);
  }
  if (advertisement.serviceUuids.length > 0) {
    console.log(`Advertised Services:\n    ${advertisement.serviceUuids.join(', ')}`);
  }
  if (advertisement.serviceData.length > 0) {
    console.log('Service Data:');
    for (const { uuid, data } of advertisement.serviceData) {
      console.log(`    ${uuid}: ${data.toString('hex')}`);
    }
  }
  if (advertisement.manufacturerData) {
    console.log(`Manufacturer Data:\n    ${advertisement.manufacturerData.toString('hex')}`);
  }
  if (advertisement.txPowerLevel != null) {
    console.log(`TX Power Level: ${advertisement.txPowerLevel}`);
  }
}

async function main (): Promise<void> {
  console.log('Waiting for Bluetooth adapter...');
  await noble.waitForPoweredOn();

  console.log('Scanning for all devices (Ctrl+C to stop)...');
  for await (const peripheral of noble.discover()) {
    describe(peripheral);
  }
}

// stop() ends the discover() loop above, which lets main() return.
process.once('SIGINT', () => noble.stop());

main().catch(error => {
  console.error(error);
  noble.stop();
  process.exitCode = 1;
});
