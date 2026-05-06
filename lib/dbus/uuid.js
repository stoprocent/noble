const BLUETOOTH_BASE_SUFFIX = '-0000-1000-8000-00805f9b34fb';

function normalizeUuid (uuid) {
  if (!uuid) return uuid;
  const lower = String(uuid).toLowerCase();
  if (lower.length === 36 && lower.endsWith(BLUETOOTH_BASE_SUFFIX)) {
    const head = lower.slice(0, 8);
    if (head.startsWith('0000')) {
      return head.slice(4);
    }
    return head;
  }
  return lower.replace(/-/g, '');
}

function expandUuid (uuid) {
  if (!uuid) return uuid;
  const lower = String(uuid).toLowerCase().replace(/-/g, '');
  if (lower.length === 4) {
    return `0000${lower}-0000-1000-8000-00805f9b34fb`;
  }
  if (lower.length === 8) {
    return `${lower}-0000-1000-8000-00805f9b34fb`;
  }
  if (lower.length === 32) {
    return `${lower.slice(0, 8)}-${lower.slice(8, 12)}-${lower.slice(12, 16)}-${lower.slice(16, 20)}-${lower.slice(20)}`;
  }
  return lower;
}

function addressToId (address) {
  return address.replace(/:/g, '').toLowerCase();
}

function idToAddress (id) {
  return id.match(/.{1,2}/g).join(':').toUpperCase();
}

function devicePathToAddress (path) {
  const m = path.match(/dev_([0-9A-Fa-f_]+)$/);
  if (!m) return null;
  return m[1].replace(/_/g, ':').toUpperCase();
}

function deviceIdFromPath (path) {
  const address = devicePathToAddress(path);
  return address ? addressToId(address) : null;
}

function devicePathFromAddress (adapterPath, address) {
  return `${adapterPath}/dev_${address.toUpperCase().replace(/:/g, '_')}`;
}

module.exports = {
  normalizeUuid,
  expandUuid,
  addressToId,
  idToAddress,
  devicePathToAddress,
  deviceIdFromPath,
  devicePathFromAddress
};
