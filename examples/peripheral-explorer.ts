import noble, { type ConnectOptions, type Peripheral } from '@stoprocent/noble';

// Connects to a peripheral and prints its services, characteristics,
// descriptors and readable values.
//
//   usage: peripheral-explorer <direct: 0|1> <id-or-address> [addressType: public|random]
//
// With direct=1 the peripheral is connected by id/address without scanning.

const direct = process.argv[2] === '1';
const target = (process.argv[3] ?? 'cd:6b:86:03:39:40').toLowerCase();
const addressType = (process.argv[4] ?? 'random') as ConnectOptions['addressType'];

const CONNECT_TIMEOUT = 5000;
const startTime = Date.now();

async function find (): Promise<Peripheral | undefined> {
  for await (const peripheral of noble.discover()) {
    if (peripheral.id === target || peripheral.address === target) {
      return peripheral;
    }
    console.log(`Peripheral ${peripheral.id} (${peripheral.advertisement.localName}) ignored`);
  }
  return undefined;
}

async function connect (): Promise<Peripheral | undefined> {
  if (direct) {
    // Give up on the attempt if the peripheral does not answer in time.
    const timer = setTimeout(() => noble.cancelConnect(target), CONNECT_TIMEOUT);
    try {
      return await noble.connect(target, { addressType });
    } finally {
      clearTimeout(timer);
    }
  }

  const peripheral = await find();
  if (peripheral) {
    const timer = setTimeout(() => peripheral.cancelConnect(), CONNECT_TIMEOUT);
    try {
      await peripheral.connect();
    } finally {
      clearTimeout(timer);
    }
  }
  return peripheral;
}

async function explore (peripheral: Peripheral): Promise<void> {
  peripheral.onDisconnect(reason => console.log('Disconnected', reason));
  peripheral.onMtuChange(mtu => console.log('MTU updated:', mtu));

  console.log(`Connected to ${peripheral.id} (${peripheral.advertisement.localName ?? 'no name'})`);
  console.log('RSSI', await peripheral.updateRssi());
  console.log('Services and characteristics:');

  for (const service of await peripheral.discoverServices()) {
    console.log(service.name ? `${service.uuid} (${service.name})` : service.uuid);

    for (const characteristic of await service.discoverCharacteristics()) {
      let info = `  ${characteristic.uuid}`;
      if (characteristic.name) {
        info += ` (${characteristic.name})`;
      }

      const descriptors = await characteristic.discoverDescriptors();
      const userDescription = descriptors.find(descriptor => descriptor.uuid === '2901');
      if (userDescription) {
        info += ` (${await userDescription.readValue()})`;
      }

      info += `\n    properties  ${characteristic.properties.join(', ')}`;

      if (characteristic.properties.includes('read')) {
        const data = await characteristic.read();
        info += `\n    value       ${data.toString('hex')} | '${data.toString('ascii')}'`;
      }

      console.log(info);
    }
  }

  console.log(`Time taken: ${Date.now() - startTime}ms`);
}

async function main (): Promise<void> {
  await noble.waitForPoweredOn();

  const peripheral = await connect();
  if (!peripheral) {
    console.log('Peripheral not found');
    return;
  }
  try {
    await explore(peripheral);
  } finally {
    await peripheral.disconnect();
  }
}

process.once('SIGINT', () => noble.stop());

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => noble.stop());
