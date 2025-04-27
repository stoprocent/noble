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
let cancelConnectTimeout;

let peripheral;
async function main () {
  try {
    await noble.waitForPoweredOnAsync();

    // Cancel the connection after 5 seconds if it is still connecting
    cancelConnectTimeout = setTimeout(() => {
      noble.cancelConnect(peripheralIdOrAddress);
    }, 5000);

    if (directConnect === '1') {
      peripheral = await noble.connectAsync(peripheralIdOrAddress, { addressType });
      clearTimeout(cancelConnectTimeout);
      await explore(peripheral);
    } else {
      await noble.startScanningAsync([], false);
    }
  } catch (error) {
    throw new Error('Error:', error);
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
    noble.stop();
    console.log('noble stopped');
  });

  peripheral.on('mtu', (mtu) => {
    console.log('MTU Updated: ', mtu);
  });

  if (peripheral.state !== 'connected') {
    await peripheral.connectAsync();
    clearTimeout(cancelConnectTimeout);
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

main();
