import { withBindings, type Noble } from '@stoprocent/noble';

// Scans on several adapters at once: two UART HCI dongles and the platform default.

const adapters: Array<{ label: string; noble: Noble; address?: string }> = [
  {
    label: 'UART A',
    address: '00:11:22:33:44:01',
    noble: withBindings('hci', {
      hciDriver: 'uart',
      bindParams: { uart: { port: '/dev/tty.usbmodem1474201', baudRate: 1000000 } }
    })
  },
  {
    label: 'UART B',
    address: '00:11:22:33:44:02',
    noble: withBindings('hci', {
      hciDriver: 'uart',
      bindParams: { uart: { port: '/dev/tty.usbmodem1474401', baudRate: 1000000 } }
    })
  },
  {
    label: 'Default',
    noble: withBindings('default')
  }
];

async function scan ({ label, noble, address }: typeof adapters[number]): Promise<void> {
  await noble.waitForPoweredOn();
  if (address) {
    noble.setAddress(address);
  }
  for await (const peripheral of noble.discover({ allowDuplicates: true })) {
    console.log(label, peripheral.id);
  }
}

process.once('SIGINT', () => adapters.forEach(({ noble }) => noble.stop()));

Promise.all(adapters.map(scan)).catch(error => {
  console.error(error);
  adapters.forEach(({ noble }) => noble.stop());
  process.exitCode = 1;
});
