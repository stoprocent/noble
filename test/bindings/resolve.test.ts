import type { withBindings as WithBindings } from '../../src/bindings/resolve';

// Stand-ins for the platform backends. The factories below keep the real
// modules (and their native dependencies) from ever being loaded.
class MockHciBindings {
  constructor (readonly options: unknown) {}
}
class MockDbusBindings {
  constructor (readonly options: unknown) {}
}
class MockNativeBindings {
  constructor (readonly addon: string, readonly options: unknown) {}
}

let mockPlatform: string;
let mockRelease: string;

jest.mock('os', () => ({
  platform: () => mockPlatform,
  release: () => mockRelease
}));
jest.mock('../../src/bindings/hci/bindings', () => ({ HciBindings: MockHciBindings }));
jest.mock('../../src/bindings/dbus/bindings', () => ({ DbusBindings: MockDbusBindings }));
jest.mock('../../src/bindings/native', () => ({
  loadNativeBindings: (addon: string, options: unknown) => new MockNativeBindings(addon, options)
}));

const ENV_KEYS = [
  'NOBLE_BINDINGS',
  'BLUETOOTH_HCI_SOCKET_UART_PORT',
  'BLUETOOTH_HCI_SOCKET_FORCE_UART',
  'BLUETOOTH_HCI_SOCKET_USB_VID',
  'BLUETOOTH_HCI_SOCKET_USB_PID'
];

describe('withBindings', () => {
  const OLD_ENV = process.env;
  let withBindings: typeof WithBindings;
  let Noble: unknown;

  /** The bindings the returned Noble was constructed with. */
  const bindingsOf = (noble: unknown): any => (noble as any).bindings;

  const expectHci = (noble: unknown): void => {
    expect(noble).toBeInstanceOf(Noble);
    expect(bindingsOf(noble)).toBeInstanceOf(MockHciBindings);
  };
  const expectDbus = (noble: unknown): void => {
    expect(noble).toBeInstanceOf(Noble);
    expect(bindingsOf(noble)).toBeInstanceOf(MockDbusBindings);
  };
  const expectNative = (noble: unknown, addon: 'NobleMac' | 'NobleWinrt'): void => {
    expect(noble).toBeInstanceOf(Noble);
    expect(bindingsOf(noble)).toBeInstanceOf(MockNativeBindings);
    expect(bindingsOf(noble).addon).toBe(addon);
  };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
    mockPlatform = 'linux';
    mockRelease = '6.1.0';

    ({ withBindings } = require('../../src/bindings/resolve'));
    ({ Noble } = require('../../src/noble'));
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  describe('default bindings', () => {
    test('uses the native Mac bindings on macOS', () => {
      mockPlatform = 'darwin';

      expectNative(withBindings(), 'NobleMac');
    });

    test('uses HCI bindings on Linux', () => {
      mockPlatform = 'linux';

      expectHci(withBindings());
    });

    test('uses HCI bindings on FreeBSD', () => {
      mockPlatform = 'freebsd';

      expectHci(withBindings());
    });

    test('uses the native WinRT bindings on Windows 10 with BLE support', () => {
      mockPlatform = 'win32';
      mockRelease = '10.0.15063';

      expectNative(withBindings(), 'NobleWinrt');
    });

    test('uses HCI bindings on older Windows versions', () => {
      mockPlatform = 'win32';
      mockRelease = '6.3.9600'; // Windows 8.1

      expectHci(withBindings());
    });

    test('throws for an unsupported platform', () => {
      mockPlatform = 'sunos';

      expect(() => withBindings()).toThrow('Unsupported platform: sunos');
    });

    test('"default" may be passed explicitly', () => {
      mockPlatform = 'darwin';

      expectNative(withBindings('default'), 'NobleMac');
    });

    test('uses HCI bindings when BLUETOOTH_HCI_SOCKET_UART_PORT is set, regardless of platform', () => {
      mockPlatform = 'darwin';
      process.env.BLUETOOTH_HCI_SOCKET_UART_PORT = '/dev/ttyUSB0';

      expectHci(withBindings());
    });

    test('uses HCI bindings when BLUETOOTH_HCI_SOCKET_FORCE_UART is set', () => {
      mockPlatform = 'darwin';
      process.env.BLUETOOTH_HCI_SOCKET_FORCE_UART = 'true';

      expectHci(withBindings());
    });

    test('uses HCI bindings when USB VID and PID are both set', () => {
      mockPlatform = 'darwin';
      process.env.BLUETOOTH_HCI_SOCKET_USB_VID = '0x0483';
      process.env.BLUETOOTH_HCI_SOCKET_USB_PID = '0x5740';

      expectHci(withBindings());
    });

    test('a USB VID without a PID does not force HCI', () => {
      mockPlatform = 'darwin';
      process.env.BLUETOOTH_HCI_SOCKET_USB_VID = '0x0483';

      expectNative(withBindings(), 'NobleMac');
    });

    test('the HCI environment variables also apply on an otherwise unsupported platform', () => {
      mockPlatform = 'sunos';
      process.env.BLUETOOTH_HCI_SOCKET_UART_PORT = '/dev/ttyUSB0';

      expectHci(withBindings());
    });

    test('passes options to the bindings', () => {
      mockPlatform = 'darwin';
      const options = { testOption: true };

      const noble = withBindings('default', options as any);

      expectNative(noble, 'NobleMac');
      expect(bindingsOf(noble).options).toBe(options);
    });

    test('options default to an empty object', () => {
      expect(bindingsOf(withBindings()).options).toEqual({});
    });
  });

  describe('NOBLE_BINDINGS', () => {
    test.each([
      ['hci', 'darwin', expectHci],
      ['dbus', 'linux', expectDbus],
      ['mac', 'linux', (noble: unknown) => expectNative(noble, 'NobleMac')]
    ] as const)('"%s" overrides the platform default (%s)', (requested, platform, expectBackend) => {
      mockPlatform = platform;
      process.env.NOBLE_BINDINGS = requested;

      expectBackend(withBindings());
    });

    test('"win" selects WinRT on a capable Windows release', () => {
      mockPlatform = 'linux';
      mockRelease = '10.0.19045';
      process.env.NOBLE_BINDINGS = 'win';

      expectNative(withBindings(), 'NobleWinrt');
    });

    test('is case-insensitive', () => {
      mockPlatform = 'linux';
      process.env.NOBLE_BINDINGS = 'DBus';

      expectDbus(withBindings());
    });

    test('wins over the HCI environment variables', () => {
      mockPlatform = 'linux';
      process.env.NOBLE_BINDINGS = 'dbus';
      process.env.BLUETOOTH_HCI_SOCKET_UART_PORT = '/dev/ttyUSB0';

      expectDbus(withBindings());
    });

    test('an unknown value falls back to the platform default', () => {
      mockPlatform = 'linux';
      process.env.NOBLE_BINDINGS = 'bluez';

      expectHci(withBindings());
    });

    test('does not affect an explicitly requested backend', () => {
      process.env.NOBLE_BINDINGS = 'dbus';

      expectHci(withBindings('hci'));
    });

    test('passes options through', () => {
      process.env.NOBLE_BINDINGS = 'dbus';
      const options = { testOption: true };

      expect(bindingsOf(withBindings('default', options as any)).options).toBe(options);
    });
  });

  describe('explicit bindings', () => {
    test('loads HCI bindings', () => {
      mockPlatform = 'darwin';

      expectHci(withBindings('hci'));
    });

    test('loads D-Bus bindings', () => {
      expectDbus(withBindings('dbus'));
    });

    test('loads Mac bindings', () => {
      mockPlatform = 'linux';

      expectNative(withBindings('mac'), 'NobleMac');
    });

    test('loads Windows bindings', () => {
      mockRelease = '10.0.15063';

      expectNative(withBindings('win'), 'NobleWinrt');
    });

    test('"win" on a Windows release without native BLE falls back to HCI', () => {
      mockRelease = '6.1.7601'; // Windows 7

      expectHci(withBindings('win'));
    });

    test('throws for an unsupported binding type', () => {
      expect(() => withBindings('unsupported' as any)).toThrow('Unsupported binding type: unsupported');
      expect(() => withBindings('unknown' as any)).toThrow('Unsupported binding type: unknown');
    });

    test.each(['hci', 'dbus', 'mac', 'win'] as const)('passes options to %s bindings', type => {
      mockRelease = '10.0.19045';
      const options = { testOption: true };

      expect(bindingsOf(withBindings(type as any, options as any)).options).toBe(options);
    });

    test('every call creates a new Noble on new bindings', () => {
      const first = withBindings('hci');
      const second = withBindings('hci');

      expect(second).not.toBe(first);
      expect(bindingsOf(second)).not.toBe(bindingsOf(first));
    });

    test('creating a Noble does not start its bindings', () => {
      const start = jest.fn();
      (MockHciBindings.prototype as any).start = start;
      try {
        withBindings('hci');

        expect(start).not.toHaveBeenCalled();
      } finally {
        delete (MockHciBindings.prototype as any).start;
      }
    });
  });

  describe('Windows version detection', () => {
    beforeEach(() => {
      mockPlatform = 'win32';
    });

    test.each([
      ['Windows 10 at the minimum build', '10.0.15063'],
      ['a later Windows 10', '10.0.19042'],
      ['Windows 11 reporting 10.0.x', '10.0.22621'],
      ['a hypothetical 10.1', '10.1.0'],
      ['a major version above 10', '11.0.22621']
    ])('uses WinRT bindings on %s (%s)', (_label, release) => {
      mockRelease = release;

      expectNative(withBindings(), 'NobleWinrt');
    });

    test.each([
      ['Windows 10 just below the minimum build', '10.0.15062'],
      ['an early Windows 10', '10.0.10240'],
      ['Windows 8.1', '6.3.9600'],
      ['Windows 7', '6.1.7601'],
      ['a release string without a build number', '10.0'],
      ['an unparsable release string', 'unknown']
    ])('uses HCI bindings on %s (%s)', (_label, release) => {
      mockRelease = release;

      expectHci(withBindings());
    });
  });
});
