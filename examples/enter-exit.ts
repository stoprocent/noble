import noble, { type Peripheral } from '@stoprocent/noble';

/*
  Continuously scans for peripherals and prints a message when they enter/exit.

    In range criteria:      RSSI >= threshold
    Out of range criteria:  not seen for longer than the grace period

  based on code provided by: Mattias Ask (http://www.dittlof.com)
*/

const RSSI_THRESHOLD = -50;
const EXIT_GRACE_PERIOD = 2000; // milliseconds

const inRange = new Map<string, { peripheral: Peripheral; lastSeen: number }>();

const describe = (peripheral: Peripheral): string =>
  `"${peripheral.advertisement.localName}" (RSSI ${peripheral.rssi}) ${new Date()}`;

const exitTimer = setInterval(() => {
  for (const [id, { peripheral, lastSeen }] of inRange) {
    if (lastSeen < Date.now() - EXIT_GRACE_PERIOD) {
      console.log(`exited  ${describe(peripheral)}`);
      inRange.delete(id);
    }
  }
}, EXIT_GRACE_PERIOD / 2);

async function main (): Promise<void> {
  await noble.waitForPoweredOn();
  console.log('Scanning for peripherals...');

  // allowDuplicates: every advertisement is reported, which refreshes lastSeen.
  for await (const peripheral of noble.discover({ allowDuplicates: true })) {
    if (peripheral.rssi < RSSI_THRESHOLD) {
      continue; // ignore devices with a weak signal
    }
    if (!inRange.has(peripheral.id)) {
      console.log(`entered ${describe(peripheral)}`);
    }
    inRange.set(peripheral.id, { peripheral, lastSeen: Date.now() });
  }
}

process.once('SIGINT', () => noble.stop());

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    clearInterval(exitTimer);
    noble.stop();
  });
