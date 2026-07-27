const hciStatusMessage = require('../../lib/hci-status-message');

describe('hciStatusMessage', () => {
  test('resolves a known numeric HCI status', () => {
    expect(hciStatusMessage(0x3e)).toBe('Connection Failed to be Established');
  });

  test('preserves string disconnect reasons', () => {
    expect(hciStatusMessage('cleanup')).toBe('cleanup');
  });

  test('includes an unknown numeric status in the fallback', () => {
    expect(hciStatusMessage(0xff)).toBe('Unknown HCI status (0xff)');
  });
});
