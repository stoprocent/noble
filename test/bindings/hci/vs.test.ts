import { setAddressCmd } from '../../../src/bindings/hci/vs';

describe('Bluetooth Address Utility', () => {
  const validAddress = '00:11:22:33:44:55';
  const reversedAddress = Buffer.from([0x55, 0x44, 0x33, 0x22, 0x11, 0x00]);

  // Vendor commands always succeed for a supported manufacturer and a valid address.
  const commandFor = (manufacturer: number, address = validAddress): Buffer => {
    const result = setAddressCmd(manufacturer, address);
    expect(result).toBeInstanceOf(Buffer);
    return result as Buffer;
  };

  describe('setAddressCmd', () => {
    test('returns null for unsupported manufacturer', () => {
      const result = setAddressCmd(999, validAddress);
      expect(result).toBeNull();
    });

    test('throws for invalid address', () => {
      // Most vendor functions call parseAddress which validates the address
      // Testing with a supported manufacturer (Broadcom - 15)
      expect(() => setAddressCmd(15, 'invalid-address')).toThrow();
    });

    describe('for each supported manufacturer', () => {
      // Test Ericsson (0)
      test('creates correct command for Ericsson (0)', () => {
        const result = commandFor(0);

        expect(result.length).toBe(9);
        expect(result.readUInt16LE(0)).toBe(0x000d | (0x3f << 10)); // OCF | OGF
        expect(result.readUInt8(2)).toBe(0x06); // Parameter length

        // Check MAC address bytes are properly placed
        expect(result.slice(3, 9)).toEqual(reversedAddress);
      });

      // Test CSR (10)
      test('creates correct command for CSR (10)', () => {
        const result = commandFor(10);

        expect(result.length).toBe(27); // 3 header + 24 base
        expect(result.readUInt16LE(0)).toBe(0x0000 | (0x3f << 10)); // OCF | OGF
        expect(result.readUInt8(2)).toBe(0xC2);

        // Check specific positions where MAC address bytes should be
        expect(result.readUInt8(16 + 3)).toBe(0x33); // macAddress[2]
        expect(result.readUInt8(18 + 3)).toBe(0x55); // macAddress[0]
        expect(result.readUInt8(19 + 3)).toBe(0x44); // macAddress[1]
        expect(result.readUInt8(20 + 3)).toBe(0x22); // macAddress[3]
        expect(result.readUInt8(22 + 3)).toBe(0x11); // macAddress[4]
        expect(result.readUInt8(23 + 3)).toBe(0x00); // macAddress[5]
      });

      test('creates the exact CSR (10) command bytes', () => {
        expect(commandFor(10)).toEqual(Buffer.from([
          0x00, 0xfc, 0xc2,
          0x02, 0x00, 0x0c, 0x00, 0x11, 0x47, 0x03, 0x70,
          0x00, 0x00, 0x01, 0x00, 0x04, 0x00, 0x00, 0x00,
          0x33, 0x00, 0x55, 0x44, 0x22, 0x00, 0x11, 0x00
        ]));
      });

      // Test TI (13)
      test('creates correct command for Texas Instruments (13)', () => {
        const result = commandFor(13);

        expect(result.length).toBe(9);
        expect(result.readUInt16LE(0)).toBe(0x0006 | (0x3f << 10)); // OCF | OGF
        expect(result.readUInt8(2)).toBe(0x06); // Parameter length

        // Check MAC address bytes are properly placed
        expect(result.slice(3, 9)).toEqual(reversedAddress);
      });

      // Test Broadcom (15)
      test('creates correct command for Broadcom (15)', () => {
        const result = commandFor(15);

        expect(result.length).toBe(9);
        expect(result.readUInt16LE(0)).toBe(0x0001 | (0x3f << 10)); // OCF | OGF
        expect(result.readUInt8(2)).toBe(0x06); // Parameter length

        // Check MAC address bytes are properly placed
        expect(result.slice(3, 9)).toEqual(reversedAddress);
      });

      // Test Zeevo (18)
      test('creates correct command for Zeevo (18)', () => {
        const result = commandFor(18);

        expect(result.length).toBe(9);
        expect(result.readUInt16LE(0)).toBe(0x0001 | (0x3f << 10)); // OCF | OGF
        expect(result.readUInt8(2)).toBe(0x06); // Parameter length

        // Check MAC address bytes are properly placed
        expect(result.slice(3, 9)).toEqual(reversedAddress);
      });

      // Test ST Microelectronics (48)
      test('creates correct command for ST Microelectronics (48)', () => {
        const result = commandFor(48);

        expect(result.length).toBe(3 + 0xFF); // Header + ERICSSON_STORE_IN_FLASH_CP_SIZE
        expect(result.readUInt16LE(0)).toBe(0x0022 | (0x3f << 10)); // OCF | OGF
        expect(result.readUInt8(2)).toBe(0xFF); // Parameter length
        expect(result.readUInt8(3)).toBe(0xFE); // user_id
        expect(result.readUInt8(4)).toBe(0x06); // flash_length

        // Check MAC address bytes are properly placed
        expect(result.slice(5, 11)).toEqual(reversedAddress);
        // The rest of the flash data is zero padding
        expect(result.slice(11).every((byte) => byte === 0)).toBe(true);
      });

      // Test Ericsson mobile (57)
      test('creates correct command for Ericsson Mobile (57)', () => {
        const result = commandFor(57);

        expect(result.length).toBe(9);
        expect(result.readUInt16LE(0)).toBe(0x000d | (0x3f << 10)); // OCF | OGF
        expect(result.readUInt8(2)).toBe(0x06); // Parameter length

        // Check MAC address bytes are properly placed
        expect(result.slice(3, 9)).toEqual(reversedAddress);
      });

      // Test Marvell (72)
      test('creates correct command for Marvell (72)', () => {
        const result = commandFor(72);

        expect(result.length).toBe(11);
        expect(result.readUInt16LE(0)).toBe(0x0022 | (0x3f << 10)); // OCF | OGF
        expect(result.readUInt8(2)).toBe(0x08); // Parameter length
        expect(result.readUInt8(3)).toBe(0xFE); // parameter_id
        expect(result.readUInt8(4)).toBe(0x06); // bdaddr_len

        // Check MAC address bytes are properly placed
        expect(result.slice(5, 11)).toEqual(reversedAddress);
      });

      // Test Atheros (305)
      test('creates correct command for Atheros/Qualcomm (305)', () => {
        const result = commandFor(305);

        expect(result.length).toBe(9);
        expect(result.readUInt16LE(0)).toBe(0x0001 | (0x3f << 10)); // OCF | OGF
        expect(result.readUInt8(2)).toBe(0x06); // Parameter length

        // Check MAC address bytes are properly placed
        expect(result.slice(3, 9)).toEqual(reversedAddress);
      });

      // Test Linux Foundation (1521)
      test('creates correct command for Linux Foundation (1521)', () => {
        const result = commandFor(1521);

        expect(result.length).toBe(9);
        expect(result.readUInt16LE(0)).toBe(0x0006 | (0x3f << 10)); // OCF | OGF
        expect(result.readUInt8(2)).toBe(0x06); // Parameter length

        // Check MAC address bytes are properly placed
        expect(result.slice(3, 9)).toEqual(reversedAddress);
      });
    });
  });

  describe('parseAddress', () => {
    test('should throw an Error for invalid address', () => {
      expect(() => {
        setAddressCmd(0, '00:11:22:33:44');
      }).toThrow();
    });

    test('should convert to Buffer correctly', () => {
      const result = commandFor(0, '00:11:22:33:44:55');
      expect(result.slice(3)).toEqual(reversedAddress);
    });
  });

  describe('edge cases', () => {
    test('handle address with different case format', () => {
      // Upper case should work the same
      const result = setAddressCmd(15, 'aa:bb:cc:dd:ee:ff');
      const resultUpperCase = setAddressCmd(15, 'AA:BB:CC:DD:EE:FF');

      expect(result).toEqual(resultUpperCase);
    });

    test('handle invalid address format', () => {
      // These should all throw
      expect(() => setAddressCmd(15, '00-11-22-33-44-55')).toThrow(); // Wrong separator
      expect(() => setAddressCmd(15, '00:11:22:33:44')).toThrow(); // Too short
      expect(() => setAddressCmd(15, '00:11:22:33:44:55:66')).toThrow(); // Too long
      expect(() => setAddressCmd(15, 'invalid')).toThrow(); // Not an address
    });

    test('handle non-existent manufacturer', () => {
      expect(setAddressCmd(9999, validAddress)).toBeNull();
      expect(setAddressCmd(-1, validAddress)).toBeNull();
      expect(setAddressCmd(null, validAddress)).toBeNull();
      expect(setAddressCmd(undefined, validAddress)).toBeNull();
    });
  });
});
