const noble = require('../');

const directConnect = process.argv[2].toLowerCase();
const peripheralIdOrAddress = process.argv[3].toLowerCase();
const addressType = process.argv[4].toLowerCase() || 'random';

const starTime = Date.now();

async function main () {
  try {
    await noble.waitForPoweredOn();
    if (directConnect === '1') {
      const peripheral = await noble.connectAsync(peripheralIdOrAddress.replace(/:/g, ''), { addressType });
      await explore(peripheral);
    } else {
      await noble.startScanningAsync();
    }
  } catch (error) {
    console.error('Error:', error);
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

  peripheral.on('disconnect', () => {
    process.exit(0);
  });

  if (peripheral.state !== 'connected') {
    await peripheral.connectAsync();
  }

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
