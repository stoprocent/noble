const noble = require('../index');

/*
  Continuously scans for peripherals and prints out message when they enter/exit

    In range criteria:      RSSI < threshold
    Out of range criteria:  lastSeen > grace period

  based on code provided by: Mattias Ask (http://www.dittlof.com)
*/

const RSSI_THRESHOLD = -50;
const EXIT_GRACE_PERIOD = 2000; // milliseconds

const inRange = {};

// Self-executing async function
(async function () {
  try {
    // Initialize noble
    await noble.waitForPoweredOnAsync();
    console.log('noble started');

    // Start scanning
    await noble.startScanningAsync([], true);
    console.log('Scanning for peripherals...');

    // Continuously discover peripherals
    for await (const peripheral of noble.discoverAsync()) {
      if (peripheral.rssi < RSSI_THRESHOLD) {
        // ignore devices with weak signal
        continue;
      }

      const id = peripheral.id;
      const entered = !inRange[id];

      if (entered) {
        inRange[id] = {
          peripheral
        };

        console.log(
          `"${peripheral.advertisement.localName}" entered (RSSI ${
            peripheral.rssi
          }) ${new Date()}`
        );
      }

      inRange[id].lastSeen = Date.now();
    }
  } catch (error) {
    throw new Error('Error:', error);
  }
})();

// Check for peripherals that have left range
setInterval(() => {
  for (const id in inRange) {
    if (inRange[id].lastSeen < Date.now() - EXIT_GRACE_PERIOD) {
      const peripheral = inRange[id].peripheral;

      console.log(
        `"${peripheral.advertisement.localName}" exited (RSSI ${
          peripheral.rssi
        }) ${new Date()}`
      );

      delete inRange[id];
    }
  }
}, EXIT_GRACE_PERIOD / 2);

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
