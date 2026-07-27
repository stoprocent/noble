jest.mock('../lib/resolve-bindings', () => jest.fn(() => ({})));

const noble = require('../index');

describe('public exports', () => {
  test('exposes the HCI status message helper', () => {
    expect(noble.hciStatusMessage(0x3e)).toBe(
      'Connection Failed to be Established'
    );
  });
});
