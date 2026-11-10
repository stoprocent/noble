import noble from '@stoprocent/noble';

// Connects to a known peripheral twice: first directly by id/address without
// scanning, then by scanning until it shows up.
//
//   usage: connect-address <id-or-address>

const target = (process.argv[2] ?? '2561b846d6f83ee27580bca8ed6ec079').toLowerCase();

async function main (): Promise<void> {
  console.log('Waiting for powered on state');
  await noble.waitForPoweredOn();

  console.log('Attempting direct connection to:', target);
  try {
    const peripheral = await noble.connect(target);
    console.log('Direct connection successful to:', peripheral.id);
    await peripheral.disconnect();
    console.log('Disconnected from direct connection');
  } catch (error) {
    console.log('Direct connection failed:', (error as Error).message);
  }

  console.log('Waiting 2 seconds before scan attempt...');
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('Scanning for device');
  for await (const peripheral of noble.discover()) {
    if (peripheral.id !== target && peripheral.address !== target) {
      continue;
    }
    console.log('Found device in scan:', peripheral.id);
    await peripheral.connect();
    console.log('Scan connection successful to:', peripheral.id);
    await peripheral.disconnect();
    console.log('Disconnected from scan connection');
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
