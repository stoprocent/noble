// This file is based on the bluez implementation
// https://github.com/bluez/bluez/blob/master/tools/bdaddr.c

const OGF_VENDOR_CMD = 0x3f;

const OCF_ERICSSON_WRITE_BD_ADDR = 0x000d;
const OCF_TI_WRITE_BD_ADDR = 0x0006;
const OCF_LINUX_FOUNDATION_WRITE_BD_ADDR = 0x0006;
const OCF_BCM_WRITE_BD_ADDR = 0x0001;
const OCF_ZEEVO_WRITE_BD_ADDR = 0x0001;
const OCF_MRVL_WRITE_BD_ADDR = 0x0022;
const OCF_ERICSSON_STORE_IN_FLASH = 0x0022;
const ERICSSON_STORE_IN_FLASH_CP_SIZE = 0xff;

/** Builds a vendor command (opcode + parameter length + parameters, no packet indicator). */
type SetAddressCommandBuilder = (address: string) => Buffer | null;

function parseAddress (address: string): Buffer {
  // Parse MAC Address as in 00:00:00:00:00:00 into Buffer (needs to reverse byte order)
  const macAddress = Buffer.from(address.split(':').reverse().join(''), 'hex');

  if (macAddress.byteLength !== 6) {
    throw new Error('Invalid MAC Address. Should be formated as 00:00:00:00:00:00 string.');
  }

  return macAddress;
}

function csrWriteBdAddr (address: string): Buffer {
  const macAddress = parseAddress(address);

  // Base command
  const base = Buffer.from([
    0x02, 0x00, 0x0c, 0x00, 0x11, 0x47, 0x03, 0x70,
    0x00, 0x00, 0x01, 0x00, 0x04, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
  ]);

  // Command
  const cmd = Buffer.alloc(3 + base.byteLength);

  cmd.writeUInt16LE(0x00 | OGF_VENDOR_CMD << 10, 0);
  cmd.writeUInt8(0xc2, 2);

  base.writeUInt8(macAddress.readUInt8(2), 16);
  base.writeUInt8(0x00, 17);
  base.writeUInt8(macAddress.readUInt8(0), 18);
  base.writeUInt8(macAddress.readUInt8(1), 19);
  base.writeUInt8(macAddress.readUInt8(3), 20);
  base.writeUInt8(0x00, 21);
  base.writeUInt8(macAddress.readUInt8(4), 22);
  base.writeUInt8(macAddress.readUInt8(5), 23);
  base.copy(cmd, 3);

  return cmd;
}

function ericssonStoreInFlash (userId: number, data: Buffer): Buffer | null {
  // Check Data
  if (data.byteLength > OCF_ERICSSON_STORE_IN_FLASH - 2) {
    return null;
  }

  // Command
  const cmd = Buffer.alloc(3 + ERICSSON_STORE_IN_FLASH_CP_SIZE);

  cmd.writeUInt16LE(OCF_ERICSSON_STORE_IN_FLASH | OGF_VENDOR_CMD << 10, 0);
  cmd.writeUInt8(ERICSSON_STORE_IN_FLASH_CP_SIZE, 2);
  cmd.writeUInt8(userId, 3); // user_id
  cmd.writeUInt8(data.byteLength, 4); // flash_length
  data.copy(cmd, 5); // flash_data

  return cmd;
}

function stWriteBdAddr (address: string): Buffer | null {
  return ericssonStoreInFlash(0xfe, parseAddress(address));
}

function mrvlWriteBdAddr (address: string): Buffer {
  const macAddress = parseAddress(address);

  // Command
  const cmd = Buffer.alloc(11);

  cmd.writeUInt16LE(OCF_MRVL_WRITE_BD_ADDR | OGF_VENDOR_CMD << 10, 0);
  cmd.writeUInt8(0x08, 2);
  cmd.writeUInt8(0xfe, 3); // parameter_id
  cmd.writeUInt8(0x06, 4); // bdaddr_len
  macAddress.copy(cmd, 5); // bdaddr

  return cmd;
}

function writeCommonBdAddr (ocfWriteBdAddr: number): SetAddressCommandBuilder {
  return (address) => {
    const macAddress = parseAddress(address);

    // Command
    const cmd = Buffer.alloc(9);

    cmd.writeUInt16LE(ocfWriteBdAddr | OGF_VENDOR_CMD << 10, 0);
    cmd.writeUInt8(0x06, 2);
    macAddress.copy(cmd, 3); // bdaddr

    return cmd;
  };
}

/** Keyed by the Bluetooth SIG company identifier reported by Read Local Version. */
const vendors: ReadonlyMap<number, SetAddressCommandBuilder> = new Map<number, SetAddressCommandBuilder>([
  [0, writeCommonBdAddr(OCF_ERICSSON_WRITE_BD_ADDR)],
  [10, csrWriteBdAddr],
  [13, writeCommonBdAddr(OCF_TI_WRITE_BD_ADDR)],
  [15, writeCommonBdAddr(OCF_BCM_WRITE_BD_ADDR)],
  [18, writeCommonBdAddr(OCF_ZEEVO_WRITE_BD_ADDR)],
  [48, stWriteBdAddr],
  [57, writeCommonBdAddr(OCF_ERICSSON_WRITE_BD_ADDR)],
  [72, mrvlWriteBdAddr],
  [305, writeCommonBdAddr(OCF_BCM_WRITE_BD_ADDR)],
  [1521, writeCommonBdAddr(OCF_LINUX_FOUNDATION_WRITE_BD_ADDR)]
]);

/**
 * Vendor Specific Set Address.
 *
 * Returns the command to write (without the leading HCI packet indicator), or
 * `null` when the manufacturer has no known set-address command. Throws when
 * `address` is not a `00:00:00:00:00:00` style MAC address.
 */
export function setAddressCmd (manufacturer: number | null | undefined, address: string): Buffer | null {
  if (manufacturer === null || manufacturer === undefined) {
    return null;
  }
  const generateCommand = vendors.get(manufacturer);
  if (generateCommand === undefined) {
    return null;
  }
  return generateCommand(address);
}
