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
const ERICSSON_STORE_IN_FLASH_CP_SIZE = 0xFF;

function parseAddress (address) {
  // Parse MAC Address as in 00:00:00:00:00:00 into Buffer (needs to reverse byte order)
  const macAddress = Buffer.from(address.split(':').reverse().join(''), 'hex');

  if (Buffer.isBuffer(macAddress) && macAddress.byteLength !== 6) {
    throw new Error('Invalid MAC Address. Should be formated as 00:00:00:00:00:00 string.');
  }

  return macAddress;
}

// eslint-disable-next-line camelcase
function csr_write_bd_addr (address) {
  // Parse MAC Address
  const macAddress = parseAddress(address);

  if (macAddress === null) {
    return null;
  }

  // Base command
  const base = Buffer.from([
    0x02, 0x00, 0x0c, 0x00, 0x11, 0x47, 0x03, 0x70,
    0x00, 0x00, 0x01, 0x00, 0x04, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
  ]);

  // Command
  const cmd = Buffer.alloc(3 + base.byteLength);

  cmd.writeUInt16LE(0x00 | OGF_VENDOR_CMD << 10, 0);
  cmd.writeUInt8(0xC2, 2);

  base.writeUint8(macAddress.readUInt8(2), 16);
  base.writeUint8(0x00, 17);
  base.writeUint8(macAddress.readUInt8(0), 18);
  base.writeUint8(macAddress.readUInt8(1), 19);
  base.writeUint8(macAddress.readUInt8(3), 20);
  base.writeUint8(0x00, 21);
  base.writeUint8(macAddress.readUInt8(4), 22);
  base.writeUint8(macAddress.readUInt8(5), 23);
  base.copy(cmd, 3);

  return cmd;
}

// eslint-disable-next-line camelcase
function ericsson_store_in_flash (user_id, data) {
  // Check Data
  if (Buffer.isBuffer(data) === false || data.byteLength > OCF_ERICSSON_STORE_IN_FLASH - 2) {
    return null;
  }

  // Command
  const cmd = Buffer.alloc(3 + ERICSSON_STORE_IN_FLASH_CP_SIZE);

  cmd.writeUInt16LE(OCF_ERICSSON_STORE_IN_FLASH | OGF_VENDOR_CMD << 10, 0);
  cmd.writeUInt8(ERICSSON_STORE_IN_FLASH_CP_SIZE, 2);
  cmd.writeUInt8(user_id, 3); // user_id
  cmd.writeUInt8(data.byteLength, 4); // flash_length
  data.copy(cmd, 5); // flash_data

  return cmd;
}

// eslint-disable-next-line camelcase
function st_write_bd_addr (address) {
  // Parse MAC Address
  const macAddress = parseAddress(address);

  if (macAddress === null) {
    return null;
  }

  return ericsson_store_in_flash(0xFE, macAddress);
}

// eslint-disable-next-line camelcase
function mrvl_write_bd_addr (address) {
  // Parse MAC Address
  const macAddress = parseAddress(address);

  if (macAddress === null) {
    return null;
  }

  // Command
  const cmd = Buffer.alloc(11);

  cmd.writeUInt16LE(OCF_MRVL_WRITE_BD_ADDR | OGF_VENDOR_CMD << 10, 0);
  cmd.writeUInt8(0x08, 2);
  cmd.writeUInt8(0xFE, 3); // parameter_id
  cmd.writeUInt8(0x06, 4); // bdaddr_len
  macAddress.copy(cmd, 5); // bdaddr

  return cmd;
}

// eslint-disable-next-line camelcase
function write_common_bd_addr (OCF_VS_WRITE_BD_ADDR) {
  // Return a function
  return (address) => {
    // Parse MAC Address
    const macAddress = parseAddress(address);

    if (macAddress === null) {
      return null;
    }

    // Command
    const cmd = Buffer.alloc(9);

    cmd.writeUInt16LE(OCF_VS_WRITE_BD_ADDR | OGF_VENDOR_CMD << 10, 0);
    cmd.writeUInt8(0x06, 2);
    macAddress.copy(cmd, 3); // bdaddr

    return cmd;
  };
}

const vendors = new Map();

vendors.set(0, write_common_bd_addr(OCF_ERICSSON_WRITE_BD_ADDR));
vendors.set(10, csr_write_bd_addr);
vendors.set(13, write_common_bd_addr(OCF_TI_WRITE_BD_ADDR));
vendors.set(15, write_common_bd_addr(OCF_BCM_WRITE_BD_ADDR));
vendors.set(18, write_common_bd_addr(OCF_ZEEVO_WRITE_BD_ADDR));
vendors.set(48, st_write_bd_addr);
vendors.set(57, write_common_bd_addr(OCF_ERICSSON_WRITE_BD_ADDR));
vendors.set(72, mrvl_write_bd_addr);
vendors.set(305, write_common_bd_addr(OCF_BCM_WRITE_BD_ADDR));
vendors.set(1521, write_common_bd_addr(OCF_LINUX_FOUNDATION_WRITE_BD_ADDR));

module.exports = {
  // Vendor Specific Set Address
  setAddressCmd: (manufacturer, address) => {
    const generateCommand = vendors.get(manufacturer);
    if (typeof generateCommand === 'function') {
      return generateCommand(address) || null;
    }
    return null;
  }
};
