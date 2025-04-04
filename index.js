const withBindings = require('./lib/resolve-bindings');

// Expose both the default instance and the custom binding function
module.exports = withBindings();
module.exports.withBindings = withBindings;
