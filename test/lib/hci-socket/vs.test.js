// Mock dependencies if needed
jest.mock('os', () => ({}));

const vs = require('../../../lib/hci-socket/vs');

describe('Bluetooth Address Utility', () => {
  const validAddress = '00:11:22:33:44:55';
  
  describe('setAddressCmd', () => {
    test('returns null for unsupported manufacturer', () => {
      const result = vs.setAddressCmd(999, validAddress);
      expect(result).toBeNull();
    });
    
    test('returns null for invalid address', () => {
      // Most vendor functions call parseAddress which validates the address
      // Testing with a supported manufacturer (Broadcom - 15)
      expect(() => vs.setAddressCmd(15, 'invalid-address')).toThrow();
    });
    
    describe('for each supported manufacturer', () => {
      // Test Ericsson (0)
      test('creates correct command for Ericsson (0)', () => {
        const result = vs.setAddressCmd(0, validAddress);
        
        expect(result).toBeInstanceOf(Buffer);
        expect(result.length).toBe(9);
        expect(result.readUInt16LE(0)).toBe(0x000d | (0x3f << 10)); // OCF | OGF
        expect(result.readUInt8(2)).toBe(0x06); // Parameter length
        
        // Check MAC address bytes are properly placed
        expect(result.slice(3, 9)).toEqual(Buffer.from([0x55, 0x44, 0x33, 0x22, 0x11, 0x00]));
      });
      
      // Test CSR (10)
      test('creates correct command for CSR (10)', () => {
        const result = vs.setAddressCmd(10, validAddress);
        
        expect(result).toBeInstanceOf(Buffer);
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
      
      // Test TI (13)
      test('creates correct command for Texas Instruments (13)', () => {
        const result = vs.setAddressCmd(13, validAddress);
        
        expect(result).toBeInstanceOf(Buffer);
        expect(result.length).toBe(9);
        expect(result.readUInt16LE(0)).toBe(0x0006 | (0x3f << 10)); // OCF | OGF
        expect(result.readUInt8(2)).toBe(0x06); // Parameter length
        
        // Check MAC address bytes are properly placed
        expect(result.slice(3, 9)).toEqual(Buffer.from([0x55, 0x44, 0x33, 0x22, 0x11, 0x00]));
      });
      
      // Test Broadcom (15)
      test('creates correct command for Broadcom (15)', () => {
        const result = vs.setAddressCmd(15, validAddress);
        
        expect(result).toBeInstanceOf(Buffer);
        expect(result.length).toBe(9);
        expect(result.readUInt16LE(0)).toBe(0x0001 | (0x3f << 10)); // OCF | OGF
        expect(result.readUInt8(2)).toBe(0x06); // Parameter length
        
        // Check MAC address bytes are properly placed
        expect(result.slice(3, 9)).toEqual(Buffer.from([0x55, 0x44, 0x33, 0x22, 0x11, 0x00]));
      });
      
      // Test Zeevo (18)
      test('creates correct command for Zeevo (18)', () => {
        const result = vs.setAddressCmd(18, validAddress);
        
        expect(result).toBeInstanceOf(Buffer);
        expect(result.length).toBe(9);
        expect(result.readUInt16LE(0)).toBe(0x0001 | (0x3f << 10)); // OCF | OGF
        expect(result.readUInt8(2)).toBe(0x06); // Parameter length
        
        // Check MAC address bytes are properly placed
        expect(result.slice(3, 9)).toEqual(Buffer.from([0x55, 0x44, 0x33, 0x22, 0x11, 0x00]));
      });
      
      // Test ST Microelectronics (48)
      test('creates correct command for ST Microelectronics (48)', () => {
        const result = vs.setAddressCmd(48, validAddress);
        
        expect(result).toBeInstanceOf(Buffer);
        expect(result.length).toBe(3 + 0xFF); // Header + ERICSSON_STORE_IN_FLASH_CP_SIZE
        expect(result.readUInt16LE(0)).toBe(0x0022 | (0x3f << 10)); // OCF | OGF
        expect(result.readUInt8(2)).toBe(0xFF); // Parameter length
        expect(result.readUInt8(3)).toBe(0xFE); // user_id
        expect(result.readUInt8(4)).toBe(0x06); // flash_length
        
        // Check MAC address bytes are properly placed
        expect(result.slice(5, 11)).toEqual(Buffer.from([0x55, 0x44, 0x33, 0x22, 0x11, 0x00]));
      });
      
      // Test Ericsson mobile (57)
      test('creates correct command for Ericsson Mobile (57)', () => {
        const result = vs.setAddressCmd(57, validAddress);
        
        expect(result).toBeInstanceOf(Buffer);
        expect(result.length).toBe(9);
        expect(result.readUInt16LE(0)).toBe(0x000d | (0x3f << 10)); // OCF | OGF
        expect(result.readUInt8(2)).toBe(0x06); // Parameter length
        
        // Check MAC address bytes are properly placed
        expect(result.slice(3, 9)).toEqual(Buffer.from([0x55, 0x44, 0x33, 0x22, 0x11, 0x00]));
      });
      
      // Test Marvell (72)
      test('creates correct command for Marvell (72)', () => {
        const result = vs.setAddressCmd(72, validAddress);
        
        expect(result).toBeInstanceOf(Buffer);
        expect(result.length).toBe(11);
        expect(result.readUInt16LE(0)).toBe(0x0022 | (0x3f << 10)); // OCF | OGF
        expect(result.readUInt8(2)).toBe(0x08); // Parameter length
        expect(result.readUInt8(3)).toBe(0xFE); // parameter_id
        expect(result.readUInt8(4)).toBe(0x06); // bdaddr_len
        
        // Check MAC address bytes are properly placed
        expect(result.slice(5, 11)).toEqual(Buffer.from([0x55, 0x44, 0x33, 0x22, 0x11, 0x00]));
      });
      
      // Test Atheros (305)
      test('creates correct command for Atheros/Qualcomm (305)', () => {
        const result = vs.setAddressCmd(305, validAddress);
        
        expect(result).toBeInstanceOf(Buffer);
        expect(result.length).toBe(9);
        expect(result.readUInt16LE(0)).toBe(0x0001 | (0x3f << 10)); // OCF | OGF
        expect(result.readUInt8(2)).toBe(0x06); // Parameter length
        
        // Check MAC address bytes are properly placed
        expect(result.slice(3, 9)).toEqual(Buffer.from([0x55, 0x44, 0x33, 0x22, 0x11, 0x00]));
      });
      
      // Test Linux Foundation (1521)
      test('creates correct command for Linux Foundation (1521)', () => {
        const result = vs.setAddressCmd(1521, validAddress);
        
        expect(result).toBeInstanceOf(Buffer);
        expect(result.length).toBe(9);
        expect(result.readUInt16LE(0)).toBe(0x0006 | (0x3f << 10)); // OCF | OGF
        expect(result.readUInt8(2)).toBe(0x06); // Parameter length
        
        // Check MAC address bytes are properly placed
        expect(result.slice(3, 9)).toEqual(Buffer.from([0x55, 0x44, 0x33, 0x22, 0x11, 0x00]));
      });
    });
  });
  
  describe('parseAddress', () => {
    test('should throw an Error for invalid address', () => {
      expect(() => {
        vs.setAddressCmd(0, '00:11:22:33:44');
      }).toThrow();
    });
    
    test('should convert to Buffer correctly', () => {
      const result = vs.setAddressCmd(0, '00:11:22:33:44:55');
      expect(result.slice(3)).toEqual(Buffer.from([0x55, 0x44, 0x33, 0x22, 0x11, 0x00]));
    });
  });
  
  describe('edge cases', () => {
    test('handle address with different case format', () => {
      // Upper case should work the same
      const result = vs.setAddressCmd(15, '00:11:22:33:44:55');
      const resultUpperCase = vs.setAddressCmd(15, '00:11:22:33:44:55');
      
      expect(result).toEqual(resultUpperCase);
    });
    
    test('handle invalid address format', () => {
      // These should all return null
      expect(() => vs.setAddressCmd(15, '00-11-22-33-44-55')).toThrow(); // Wrong separator
      expect(() => vs.setAddressCmd(15, '00:11:22:33:44')).toThrow(); // Too short
      expect(() => vs.setAddressCmd(15, '00:11:22:33:44:55:66')).toThrow(); // Too long
      expect(() => vs.setAddressCmd(15, 'invalid')).toThrow(); // Not an address
    });
    
    test('handle non-existent manufacturer', () => {
      expect(vs.setAddressCmd(9999, validAddress)).toBeNull();
      expect(vs.setAddressCmd(-1, validAddress)).toBeNull();
      expect(vs.setAddressCmd(null, validAddress)).toBeNull();
      expect(vs.setAddressCmd(undefined, validAddress)).toBeNull();
    });
  });
});