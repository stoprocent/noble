const {
  normalizeUuid,
  expandUuid,
  addressToId,
  idToAddress,
  devicePathToAddress,
  deviceIdFromPath,
  devicePathFromAddress
} = require('../../../lib/dbus/uuid');

describe('dbus/uuid', () => {
  describe('normalizeUuid', () => {
    test('shortens 16-bit Bluetooth base UUIDs', () => {
      expect(normalizeUuid('00002a37-0000-1000-8000-00805f9b34fb')).toBe('2a37');
    });

    test('shortens 32-bit Bluetooth base UUIDs', () => {
      expect(normalizeUuid('1234abcd-0000-1000-8000-00805f9b34fb')).toBe('1234abcd');
    });

    test('strips dashes for non-base 128-bit UUIDs', () => {
      expect(normalizeUuid('6E400001-B5A3-F393-E0A9-E50E24DCCA9E'))
        .toBe('6e400001b5a3f393e0a9e50e24dcca9e');
    });

    test('returns falsy values unchanged', () => {
      expect(normalizeUuid(undefined)).toBeUndefined();
      expect(normalizeUuid(null)).toBeNull();
      expect(normalizeUuid('')).toBe('');
    });
  });

  describe('expandUuid', () => {
    test('expands 16-bit short form', () => {
      expect(expandUuid('2a37')).toBe('00002a37-0000-1000-8000-00805f9b34fb');
    });

    test('expands 32-bit short form', () => {
      expect(expandUuid('1234abcd')).toBe('1234abcd-0000-1000-8000-00805f9b34fb');
    });

    test('expands no-dash 128-bit form', () => {
      expect(expandUuid('6e400001b5a3f393e0a9e50e24dcca9e'))
        .toBe('6e400001-b5a3-f393-e0a9-e50e24dcca9e');
    });
  });

  describe('addressToId / idToAddress', () => {
    test('addressToId strips colons and lowercases', () => {
      expect(addressToId('AA:BB:CC:DD:EE:FF')).toBe('aabbccddeeff');
    });

    test('idToAddress reverses the transformation', () => {
      expect(idToAddress('aabbccddeeff')).toBe('AA:BB:CC:DD:EE:FF');
    });
  });

  describe('devicePathToAddress / deviceIdFromPath', () => {
    test('parses BlueZ device path', () => {
      expect(devicePathToAddress('/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF'))
        .toBe('AA:BB:CC:DD:EE:FF');
      expect(deviceIdFromPath('/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF'))
        .toBe('aabbccddeeff');
    });

    test('returns null for non-device paths', () => {
      expect(devicePathToAddress('/org/bluez/hci0')).toBeNull();
      expect(deviceIdFromPath('/org/bluez/hci0')).toBeNull();
    });
  });

  describe('devicePathFromAddress', () => {
    test('builds the BlueZ device path', () => {
      expect(devicePathFromAddress('/org/bluez/hci0', 'aa:bb:cc:dd:ee:ff'))
        .toBe('/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF');
    });
  });
});
