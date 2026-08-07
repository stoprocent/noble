// Integer values mirror WinRT's DevicePairingProtectionLevel enum
// (Windows.Devices.Enumeration). Only the Windows binding uses these;
// other bindings' `pair()` surfaces "Pairing is not supported on this
// platform".
module.exports = {
  Default: 0,
  None: 1,
  Encryption: 2,
  EncryptionAndAuthentication: 3,
};
