// Integer values mirror WinRT's DevicePairingKinds enum (Windows.Devices.Enumeration).
// Only the Windows binding uses these; other bindings surface a deterministic
// "Pairing is not supported on this platform" error when pairing is requested.
module.exports = {
  None:            0,
  ConfirmOnly:     0x00000008,
  DisplayPin:      0x00000010,
  ConfirmPinMatch: 0x00000020,
  ProvidePin:      0x00000040,
  ProvidePassword: 0x00000080,
  ConfirmPassword: 0x00000100,
};
