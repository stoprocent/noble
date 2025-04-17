const noble = require('../index');

async function handleDiscovery (peripheral) {
  console.log(`\n${new Date()}`);
  console.log(
    `Peripheral discovered (${peripheral.id}):
    - Address: ${peripheral.address} (${peripheral.addressType})
    - Connectable: ${peripheral.connectable}
    - Scannable: ${peripheral.scannable}
    - RSSI: ${peripheral.rssi}`
  );

  // Local Name
  if (peripheral.advertisement.localName) {
    console.log(`Local Name: ${peripheral.advertisement.localName}`);
  }

  // Service UUIDs
  if (peripheral.advertisement.serviceUuids.length) {
    console.log('Advertised Services:');
    console.log(`    ${peripheral.advertisement.serviceUuids.join(', ')}`);
  }

  // Service Data
  const serviceData = peripheral.advertisement.serviceData;
  if (serviceData && serviceData.length) {
    console.log('Service Data:');
    serviceData.forEach(data => {
      console.log(`    ${data.uuid}: ${data.data.toString('hex')}`);
    });
  }

  // Manufacturer Data
  if (peripheral.advertisement.manufacturerData) {
    console.log('Manufacturer Data:');
    console.log(`    ${peripheral.advertisement.manufacturerData.toString('hex')}`);
  }

  // TX Power Level
  if (peripheral.advertisement.txPowerLevel !== undefined) {
    console.log(`TX Power Level: ${peripheral.advertisement.txPowerLevel}`);
  }
}

async function main () {
  try {
    console.log('Waiting for Bluetooth adapter...');
    await noble.waitForPoweredOnAsync();
    console.log('Bluetooth adapter ready');

    console.log('Starting scan for all devices...');
    await noble.startScanningAsync([], false);
    
    noble.on('discover', handleDiscovery);
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Handle process termination
const cleanup = async () => {
  console.log('\nCleaning up...');
  await noble.stopScanningAsync();
  process.exit();
};

process.on('SIGINT', cleanup);
process.on('SIGQUIT', cleanup);
process.on('SIGTERM', cleanup);

// Start the application
main().catch(console.error);
