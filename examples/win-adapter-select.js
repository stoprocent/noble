const readline = require('readline');
const { withBindings } = require('../');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask (question) {
  return new Promise(resolve => rl.question(question, resolve));
}

function printTable (rows, headers) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => String(r[i]).length))
  );
  const sep = widths.map(w => '-'.repeat(w + 2)).join('+');
  const fmt = row => row.map((c, i) => ` ${String(c).padEnd(widths[i])} `).join('|');

  console.log(fmt(headers));
  console.log(sep);
  rows.forEach(r => console.log(fmt(r)));
}

async function main () {
  const noble = withBindings('win');
  await noble.waitForPoweredOnAsync();

  // --- Step 1: List adapters ---
  const adapters = await noble.getAdaptersAsync();

  if (adapters.length === 0) {
    console.log('No Bluetooth adapters found.');
    cleanup(noble);
    return;
  }

  console.log('\nAvailable Bluetooth adapters:\n');
  printTable(
    adapters.map((a, i) => [i, a.name, a.address, a.default ? '*' : '']),
    ['#', 'Name', 'Address', 'Default']
  );

  // --- Step 2: Select adapter ---
  let selected = 0;
  if (adapters.length > 1) {
    const input = await ask(`\nSelect adapter [0-${adapters.length - 1}]: `);
    selected = parseInt(input, 10);
    if (isNaN(selected) || selected < 0 || selected >= adapters.length) {
      console.log('Invalid selection.');
      cleanup(noble);
      return;
    }

    console.log(`\nSwitching to "${adapters[selected].name}"...`);
    await noble.setAdapterAsync(adapters[selected].id);
  }

  console.log(`\nUsing adapter: ${adapters[selected].name} (${adapters[selected].address})`);

  // --- Step 3: Discover peripherals ---
  console.log('Scanning for peripherals... (press Ctrl+C to stop)\n');

  const discovered = new Map();

  noble.on('discover', peripheral => {
    const name = peripheral.advertisement.localName || '(unknown)';
    const isNew = !discovered.has(peripheral.id);
    discovered.set(peripheral.id, { name, peripheral });

    if (isNew) {
      console.log(
        `  [${discovered.size}] ${name.padEnd(30)} ` +
        `${peripheral.address.padEnd(20)} RSSI: ${peripheral.rssi}`
      );
    }
  });

  await noble.startScanningAsync([], false);

  // Wait for user to press enter to stop scanning
  await ask('\nPress Enter to stop scanning...');
  await noble.stopScanningAsync();

  if (discovered.size === 0) {
    console.log('No peripherals found.');
    cleanup(noble);
    return;
  }

  // --- Step 4: Pick a peripheral to explore ---
  const input = await ask(`\nSelect peripheral to explore [1-${discovered.size}] (or Enter to exit): `);
  if (!input) {
    cleanup(noble);
    return;
  }

  const idx = parseInt(input, 10);
  const entries = [...discovered.values()];
  if (isNaN(idx) || idx < 1 || idx > entries.length) {
    console.log('Invalid selection.');
    cleanup(noble);
    return;
  }

  const { peripheral } = entries[idx - 1];
  console.log(`\nConnecting to ${peripheral.advertisement.localName || peripheral.id}...`);

  peripheral.on('disconnect', reason => {
    console.log(`\nDisconnected (${reason})`);
  });

  try {
    await peripheral.connectAsync();
    console.log('Connected!\n');

    const services = await peripheral.discoverServicesAsync([]);
    for (const service of services) {
      console.log(`Service: ${service.uuid}${service.name ? ` (${service.name})` : ''}`);

      const chars = await service.discoverCharacteristicsAsync([]);
      for (const c of chars) {
        let info = `  ${c.uuid}`;
        if (c.name) info += ` (${c.name})`;
        info += ` [${c.properties.join(', ')}]`;

        if (c.properties.includes('read')) {
          try {
            const data = await c.readAsync();
            if (data) info += ` = ${data.toString('hex')}`;
          } catch (_) {}
        }
        console.log(info);
      }
    }

    await peripheral.disconnectAsync();
  } catch (err) {
    console.error('Error:', err.message);
  }

  cleanup(noble);
}

function cleanup (noble) {
  rl.close();
  noble.stop();
}

process.on('SIGINT', () => {
  console.log('\nInterrupted.');
  process.exit();
});

main().catch(err => {
  console.error(err);
  process.exit(1);
});
