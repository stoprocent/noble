const hciStatus = require('./hci-socket/hci-status');

module.exports = function hciStatusMessage (reason) {
  if (typeof reason !== 'number') {
    return String(reason);
  }

  if (hciStatus[reason]) {
    return hciStatus[reason];
  }

  const code = Number.isInteger(reason)
    ? `0x${reason.toString(16).padStart(2, '0')}`
    : String(reason);

  return `Unknown HCI status (${code})`;
};
