const os = require('os');

const Noble = require('./noble');

function loadBindings (bindingType = null, options = {}) {
  switch (bindingType) {
    case 'hci':
      return new (require('./hci-socket/bindings'))(options);
    case 'mac':
      return new (require('./mac/bindings'))(options);
    case 'win':
      return new (getWindowsBindings())(options);
    default:
      throw new Error('Unsupported binding type: ' + bindingType);
  }
}

function getWindowsBindings () {
  const ver = os.release().split('.').map((str) => parseInt(str, 10));
  const isWin10WithBLE = 
    ver[0] > 10 ||
    (ver[0] === 10 && ver[1] > 0) ||
    (ver[0] === 10 && ver[1] === 0 && ver[2] >= 15063);
  return isWin10WithBLE ? require('./win/bindings') : require('./hci-socket/bindings');
}

function getDefaultBindings (options = {}) {
  const platform = os.platform();
  if (
    platform === 'linux' ||
    platform === 'freebsd' ||
    process.env.BLUETOOTH_HCI_SOCKET_UART_PORT ||
    process.env.BLUETOOTH_HCI_SOCKET_FORCE_UART ||
    (process.env.BLUETOOTH_HCI_SOCKET_USB_VID && process.env.BLUETOOTH_HCI_SOCKET_USB_PID)
  ) {
    return loadBindings('hci', options);
  } else if (platform === 'darwin') {
    return loadBindings('mac', options);
  } else if (platform === 'win32') {
    return loadBindings('win', options);
  } else {
    throw new Error('Unsupported platform: ' + platform);
  }
}

module.exports = function (bindingType = 'default', options = {}) {
  const bindings = bindingType === 'default' 
    ? getDefaultBindings(options)
    : loadBindings(bindingType, options);
  return new Noble(bindings);
};
