import { hciStatusMessage } from '../src/hci-status-message';

describe('hciStatusMessage', () => {
  test('resolves a known numeric HCI status', () => {
    expect(hciStatusMessage(0x3e)).toBe('Connection Failed to be Established');
  });

  test.each([
    [0x00, 'Success'],
    [0x08, 'Connection Timeout'],
    [0x0c, 'Command Disallowed']
  ])('resolves status 0x%s', (status, message) => {
    expect(hciStatusMessage(status)).toBe(message);
  });

  test('preserves string disconnect reasons', () => {
    expect(hciStatusMessage('cleanup')).toBe('cleanup');
    expect(hciStatusMessage('unknown')).toBe('unknown');
  });

  test('includes an unknown numeric status in the fallback', () => {
    expect(hciStatusMessage(0xff)).toBe('Unknown HCI status (0xff)');
  });

  test('pads a large unknown status to at least two hex digits', () => {
    expect(hciStatusMessage(0x1234)).toBe('Unknown HCI status (0x1234)');
  });

  test('reports a non-integer status verbatim', () => {
    expect(hciStatusMessage(1.5)).toBe('Unknown HCI status (1.5)');
    expect(hciStatusMessage(NaN)).toBe('Unknown HCI status (NaN)');
  });
});
