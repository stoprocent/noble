const { withBindings } = require('../index');

const nobleUartA = withBindings('hci', { 
  hciDriver: 'uart', 
    bindParams: { 
        uart: { 
            port: '/dev/tty.usbmodem1474201' 
        } 
    } 
});

const nobleUartB = withBindings('hci', { 
  hciDriver: 'uart', 
    bindParams: { 
        uart: { 
            port: '/dev/tty.usbmodem1474401' 
        } 
    } 
});

const nobleUartC = withBindings('default');

nobleUartA.on('discover', peripheral => {
  console.log('UART A', peripheral.id);
});

nobleUartB.on('discover', peripheral => {
  console.log('UART B', peripheral.id);
});

nobleUartC.on('discover', peripheral => {
  console.log('UART C', peripheral.id);
});

nobleUartA.on('stateChange', state => {
  if (state === 'poweredOn') {
    nobleUartA.setAddress('00:11:22:33:44:01');
    nobleUartA.startScanning([], true);
  }
});

nobleUartB.on('stateChange', state => {
  if (state === 'poweredOn') {
    nobleUartB.setAddress('00:11:22:33:44:02');
    nobleUartB.startScanning([], true);
  }
});

nobleUartC.on('stateChange', state => {
  if (state === 'poweredOn') {
    nobleUartC.startScanning([], true);
  }
});
