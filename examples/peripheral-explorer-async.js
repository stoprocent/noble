const noble = require('../');

let directConnect = '0';
let peripheralIdOrAddress = 'cd:6b:86:03:39:40'.toLowerCase();
let addressType = 'random';

try {
  directConnect = process.argv[2].toLowerCase() || '0';
  peripheralIdOrAddress = process.argv[3].toLowerCase() || 'cd:6b:86:03:39:40';
  addressType = process.argv[4].toLowerCase() || 'random';
} catch (error) {
  console.error('Error:', error);
}

const starTime = Date.now();

var peripheral;
async function main () {
  try {
    await noble.waitForPoweredOnAsync();

    // Cancel the connection after 5 seconds if it is still connecting
    setTimeout(() => {
      noble.cancelConnect(peripheralIdOrAddress);
    }, 5000);

    if (directConnect === '1') {
      peripheral = await noble.connectAsync(peripheralIdOrAddress, { addressType });
      await explore(peripheral);
    } else {
      await noble.startScanningAsync([], false);
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

noble.on('discover', async (peripheral) => {
  if (directConnect === '1') {
    return;
  }
  if ([peripheral.id, peripheral.address].includes(peripheralIdOrAddress)) {
    await noble.stopScanningAsync();
    
    console.log(`Peripheral with ID ${peripheral.id} found`);

    const advertisement = peripheral.advertisement;

    const localName = advertisement.localName;
    const txPowerLevel = advertisement.txPowerLevel;
    const manufacturerData = advertisement.manufacturerData;
    const serviceData = advertisement.serviceData;
    const serviceUuids = advertisement.serviceUuids;

    if (localName) {
      console.log(`  Local Name        = ${localName}`);
    }

    if (txPowerLevel) {
      console.log(`  TX Power Level    = ${txPowerLevel}`);
    }

    if (manufacturerData) {
      console.log(`  Manufacturer Data = ${manufacturerData.toString('hex')}`);
    }

    if (serviceData) {
      console.log(
        `  Service Data      = ${JSON.stringify(serviceData, null, 2)}`
      );
    }

    if (serviceUuids) {
      console.log(`  Service UUIDs     = ${serviceUuids}`);
    }

    console.log();

    await explore(peripheral);
  }
});

/**
 * @param {import('../').Peripheral} peripheral
 */
const explore = async (peripheral) => {
  console.log('Services and characteristics:');

  peripheral.on('disconnect', (reason) => {
    console.log('Disconnected', reason);
    process.exit(0);
  });

  if (peripheral.state !== 'connected') {
    await peripheral.connectAsync();
  }

  const rssi = await peripheral.updateRssiAsync();
  console.log('RSSI', rssi);

  const services = await peripheral.discoverServicesAsync([]);

  for (const service of services) {
    let serviceInfo = service.uuid;

    if (service.name) {
      serviceInfo += ` (${service.name})`;
    }

    console.log(serviceInfo);

    const characteristics = await service.discoverCharacteristicsAsync([]);

    for (const characteristic of characteristics) {
      let characteristicInfo = `  ${characteristic.uuid}`;

      if (characteristic.name) {
        characteristicInfo += ` (${characteristic.name})`;
      }

      const descriptors = await characteristic.discoverDescriptorsAsync();

      const userDescriptionDescriptor = descriptors.find(
        (descriptor) => descriptor.uuid === '2901'
      );

      if (userDescriptionDescriptor) {
        const data = await userDescriptionDescriptor.readValueAsync();
        if (data) {
          characteristicInfo += ` (${data.toString()})`;
        }
      }

      characteristicInfo += `\n    properties  ${characteristic.properties.join(
        ', '
      )}`;

      if (characteristic.properties.includes('read')) {
        const data = await characteristic.readAsync();

        if (data) {
          const string = data.toString('ascii');

          characteristicInfo += `\n    value       ${data.toString(
            'hex'
          )} | '${string}'`;
        }
      }

      console.log(characteristicInfo);
    }
  }

  console.log(`Time taken: ${Date.now() - starTime}ms`);
  await peripheral.disconnectAsync();

};

process.on('SIGINT', function () {
  console.log('Caught interrupt signal');
  noble.stopScanning(() => process.exit());
});

process.on('SIGQUIT', function () {
  console.log('Caught interrupt signal');
  noble.stopScanning(() => process.exit());
});

process.on('SIGTERM', function () {
  console.log('Caught interrupt signal');
  noble.stopScanning(() => process.exit());
});

main();
