import { createCipheriv, randomBytes } from 'crypto';

export function r (): Buffer {
  return randomBytes(16);
}

export function c1 (k: Buffer, r: Buffer, pres: Buffer, preq: Buffer, iat: Buffer, ia: Buffer, rat: Buffer, ra: Buffer): Buffer {
  const p1 = Buffer.concat([
    iat,
    rat,
    preq,
    pres
  ]);

  const p2 = Buffer.concat([
    ra,
    ia,
    Buffer.from('00000000', 'hex')
  ]);

  let res = xor(r, p1);
  res = e(k, res);
  res = xor(res, p2);
  res = e(k, res);

  return res;
}

export function s1 (k: Buffer | number[], r1: Buffer, r2: Buffer): Buffer {
  return e(k, Buffer.concat([
    r2.slice(0, 8),
    r1.slice(0, 8)
  ]));
}

export function e (key: Buffer | number[], data: Buffer | number[]): Buffer {
  const swappedKey = swap(key);
  const swappedData = swap(data);

  const cipher = createCipheriv('aes-128-ecb', swappedKey, '');
  cipher.setAutoPadding(false);

  return swap(Buffer.concat([
    cipher.update(swappedData),
    cipher.final()
  ]));
}

function xor (b1: Buffer, b2: Buffer): Buffer {
  const result = Buffer.alloc(b1.length);

  for (let i = 0; i < b1.length; i++) {
    result[i] = b1[i] ^ b2[i];
  }

  return result;
}

function swap (input: Buffer | number[]): Buffer {
  const output = Buffer.alloc(input.length);

  for (let i = 0; i < output.length; i++) {
    output[i] = input[input.length - i - 1];
  }

  return output;
}
