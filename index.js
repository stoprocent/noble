const withBindings = require('./lib/resolve-bindings');
const hciStatusMessage = require('./lib/hci-status-message');
const DevicePairingKinds = require('./lib/pairing-kinds');

module.exports = withBindings();
module.exports.withBindings = withBindings;
module.exports.hciStatusMessage = hciStatusMessage;
module.exports.DevicePairingKinds = DevicePairingKinds;
