const BLUETOOTH_BASE_SUFFIX = '-0000-1000-8000-00805f9b34fb';

/**
 * Converts a BlueZ (dashed, 128-bit) UUID to noble's form: lowercase, no
 * dashes, shortened to 16/32 bits when it sits on the Bluetooth base UUID.
 * Falsy input is returned unchanged.
 */
export function normalizeUuid (uuid: string): string;
export function normalizeUuid (uuid: string | null | undefined): string | null | undefined;
export function normalizeUuid (uuid: string | null | undefined): string | null | undefined {
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

/** Converts a noble UUID to the dashed 128-bit form BlueZ uses. Falsy input is returned unchanged. */
export function expandUuid (uuid: string): string;
export function expandUuid (uuid: string | null | undefined): string | null | undefined;
export function expandUuid (uuid: string | null | undefined): string | null | undefined {
  if (!uuid) return uuid;
  const lower = String(uuid).toLowerCase().replace(/-/g, '');
  if (lower.length === 4) {
    return `0000${lower}${BLUETOOTH_BASE_SUFFIX}`;
  }
  if (lower.length === 8) {
    return `${lower}${BLUETOOTH_BASE_SUFFIX}`;
  }
  if (lower.length === 32) {
    return `${lower.slice(0, 8)}-${lower.slice(8, 12)}-${lower.slice(12, 16)}-${lower.slice(16, 20)}-${lower.slice(20)}`;
  }
  return lower;
}

export function addressToId (address: string): string {
  return address.replace(/:/g, '').toLowerCase();
}

export function idToAddress (id: string): string {
  return (id.match(/.{1,2}/g) ?? []).join(':').toUpperCase();
}

export function devicePathToAddress (path: string): string | null {
  const m = path.match(/dev_([0-9A-Fa-f_]+)$/);
  if (!m) return null;
  return m[1].replace(/_/g, ':').toUpperCase();
}

export function deviceIdFromPath (path: string): string | null {
  const address = devicePathToAddress(path);
  return address ? addressToId(address) : null;
}

export function devicePathFromAddress (adapterPath: string, address: string): string {
  return `${adapterPath}/dev_${address.toUpperCase().replace(/:/g, '_')}`;
}
