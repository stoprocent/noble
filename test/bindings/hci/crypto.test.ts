import * as cryptoLib from 'crypto';

import * as crypto from '../../../src/bindings/hci/crypto';

jest.mock('crypto', () => {
  const actual = jest.requireActual('crypto');
  return {
    ...actual,
    randomBytes: jest.fn(actual.randomBytes),
    createCipheriv: jest.fn(actual.createCipheriv)
  };
});

describe('hci crypto', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should generate a random on 16 bytes', () => {
    const result1 = crypto.r();
    const result2 = crypto.r();

    expect(result1).toHaveLength(16);
    expect(result2).toHaveLength(16);
    expect(result1.equals(result2)).toBe(false);

    expect(cryptoLib.randomBytes).toHaveBeenCalledTimes(2);
    expect(cryptoLib.randomBytes).toHaveBeenCalledWith(16);
  });

  it('should compute s1', () => {
    const key = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    const r1 = Buffer.from([29, 30, 31, 32, 33, 34, 35, 36, 4, 5, 6]);
    const r2 = Buffer.from([21, 22, 23, 24, 25, 26, 27, 28, 1, 2, 3]);

    const result = crypto.s1(key, r1, r2);

    const expectedResult = Buffer.from([0xab, 0xa0, 0x44, 0x06, 0x3b, 0xdc, 0x1c, 0x5d, 0x3c, 0x68, 0x0e, 0xdb, 0xc7, 0x9b, 0xe7, 0xc3]);
    expect(result).toEqual(expectedResult);
  });

  it('should compute e', () => {
    const key = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    const data = [21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36];
    const swapKey = [16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

    const result = crypto.e(key, data);

    const expectedResult = Buffer.from([0xab, 0xa0, 0x44, 0x06, 0x3b, 0xdc, 0x1c, 0x5d, 0x3c, 0x68, 0x0e, 0xdb, 0xc7, 0x9b, 0xe7, 0xc3]);
    expect(result).toEqual(expectedResult);
    expect(cryptoLib.createCipheriv).toHaveBeenCalledTimes(1);
    expect(cryptoLib.createCipheriv).toHaveBeenCalledWith('aes-128-ecb', Buffer.from(swapKey), '');
  });

  it('should compute c1 (Bluetooth Core spec sample data)', () => {
    // Core 5.x, Vol 3, Part H, 2.2.3: the worked example for the confirm value generation function c1
    const k = Buffer.alloc(16);
    const r = Buffer.from('5783D52156AD6F0E6388274EC6702EE0', 'hex').reverse();
    const pres = Buffer.from('05000800000302', 'hex').reverse();
    const preq = Buffer.from('07071000000101', 'hex').reverse();
    const iat = Buffer.from([0x01]);
    const rat = Buffer.from([0x00]);
    const ia = Buffer.from('A1A2A3A4A5A6', 'hex').reverse();
    const ra = Buffer.from('B1B2B3B4B5B6', 'hex').reverse();

    const result = crypto.c1(k, r, pres, preq, iat, ia, rat, ra);

    expect(Buffer.from(result).reverse().toString('hex')).toEqual('1e1e3fef878988ead2a74dc5bef13b86');
  });
});
