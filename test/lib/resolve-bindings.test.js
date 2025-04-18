// Import EventEmitter to extend mock classes
const { EventEmitter } = require('events');

// Mock classes
class MockNoble extends EventEmitter {}
class MockHciBindings extends EventEmitter {}
class MockMacBindings extends EventEmitter {}
class MockWinBindings extends EventEmitter {}
class MockNobleClass {
  constructor(bindings) {
    this.bindings = bindings;
  }
}

// Mock platform data
let mockPlatform;
let mockRelease;

// Mock os module
jest.mock('os', () => ({
  platform: () => mockPlatform,
  release: () => mockRelease
}));

// Mock the various binding modules
jest.mock('../../lib/hci-socket/bindings', () => MockHciBindings, { virtual: true });
jest.mock('../../lib/mac/bindings', () => MockMacBindings, { virtual: true });
jest.mock('../../lib/win/bindings', () => MockWinBindings, { virtual: true });
jest.mock('../../lib/noble', () => MockNobleClass, { virtual: true });

// Mock node-gyp-build
jest.mock('node-gyp-build', () => () => ({
  NobleMac: MockMacBindings,
  NobleWinrt: MockWinBindings
}), { virtual: true });

// Import the module under test after mocks are set up
let resolver;

describe('resolve-bindings', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    // Reset modules before each test to ensure fresh mocks
    jest.resetModules();
    
    // Clone initial environment
    process.env = { ...OLD_ENV };
    
    // Import the module under test after mocks are set up
    resolver = require('../../lib/resolve-bindings');
  });

  afterEach(() => {
    // Restore initial environment
    process.env = OLD_ENV;
    
    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('default bindings', () => {
    test('should use Mac bindings on macOS', () => {
      mockPlatform = 'darwin';
      
      const noble = resolver();
      expect(noble).toBeInstanceOf(MockNobleClass);
      expect(noble.bindings).toBeInstanceOf(MockMacBindings);
    });

    test('should use HCI bindings on Linux', () => {
      mockPlatform = 'linux';
      
      const noble = resolver();
      expect(noble).toBeInstanceOf(MockNobleClass);
      expect(noble.bindings).toBeInstanceOf(MockHciBindings);
    });

    test('should use HCI bindings on FreeBSD', () => {
      mockPlatform = 'freebsd';
      
      const noble = resolver();
      expect(noble).toBeInstanceOf(MockNobleClass);
      expect(noble.bindings).toBeInstanceOf(MockHciBindings);
    });

    test('should use Windows bindings on Windows 10 with BLE support', () => {
      mockPlatform = 'win32';
      mockRelease = '10.0.15063';
      
      const noble = resolver();
      expect(noble).toBeInstanceOf(MockNobleClass);
      expect(noble.bindings).toBeInstanceOf(MockWinBindings);
    });

    test('should use HCI bindings on older Windows versions', () => {
      mockPlatform = 'win32';
      mockRelease = '6.3.9600'; // Windows 8.1
      
      const noble = resolver();
      expect(noble).toBeInstanceOf(MockNobleClass);
      expect(noble.bindings).toBeInstanceOf(MockHciBindings);
    });

    test('should throw error for unsupported platforms', () => {
      expect(() => resolver('unknown')).toThrow('Unsupported binding type: unknown');
    });

    test('should use HCI bindings when BLUETOOTH_HCI_SOCKET_UART_PORT is set, regardless of platform', () => {
      mockPlatform = 'darwin'; // Even on macOS
      process.env.BLUETOOTH_HCI_SOCKET_UART_PORT = '/dev/ttyUSB0';
      
      const noble = resolver();
      expect(noble).toBeInstanceOf(MockNobleClass);
      expect(noble.bindings).toBeInstanceOf(MockHciBindings);
    });

    test('should use HCI bindings when BLUETOOTH_HCI_SOCKET_FORCE_UART is set', () => {
      mockPlatform = 'darwin';
      process.env.BLUETOOTH_HCI_SOCKET_FORCE_UART = 'true';
      
      const noble = resolver();
      expect(noble).toBeInstanceOf(MockNobleClass);
      expect(noble.bindings).toBeInstanceOf(MockHciBindings);
    });

    test('should use HCI bindings when USB VID and PID are set', () => {
      mockPlatform = 'darwin'; // Even on macOS
      process.env.BLUETOOTH_HCI_SOCKET_USB_VID = '0x0483';
      process.env.BLUETOOTH_HCI_SOCKET_USB_PID = '0x5740';
      
      const noble = resolver();
      expect(noble).toBeInstanceOf(MockNobleClass);
      expect(noble.bindings).toBeInstanceOf(MockHciBindings);
    });

    test('should pass options to bindings', () => {
      mockPlatform = 'darwin';
      const options = { testOption: true };
      
      const noble = resolver('default', options);
      expect(noble).toBeInstanceOf(MockNobleClass);
      expect(noble.bindings).toBeInstanceOf(MockMacBindings);
      // Would need to enhance mock to verify options are passed through
    });
  });

  describe('explicit bindings', () => {
    test('should load HCI bindings when explicitly specified', () => {
      const noble = resolver('hci');
      expect(noble).toBeInstanceOf(MockNobleClass);
      expect(noble.bindings).toBeInstanceOf(MockHciBindings);
    });

    test('should load Mac bindings when explicitly specified', () => {
      const noble = resolver('mac');
      expect(noble).toBeInstanceOf(MockNobleClass);
      expect(noble.bindings).toBeInstanceOf(MockMacBindings);
    });

    test('should load Windows bindings when explicitly specified', () => {
      mockRelease = '10.0.15063';
      const noble = resolver('win');
      expect(noble).toBeInstanceOf(MockNobleClass);
      expect(noble.bindings).toBeInstanceOf(MockWinBindings);
    });

    test('should throw error for unsupported binding type', () => {
      expect(() => resolver('unsupported')).toThrow('Unsupported binding type: unsupported');
    });

    test('should pass options to explicitly specified bindings', () => {
      const options = { testOption: true };
      
      const noble = resolver('hci', options);
      expect(noble).toBeInstanceOf(MockNobleClass);
      expect(noble.bindings).toBeInstanceOf(MockHciBindings);
      // Would need to enhance mock to verify options are passed through
    });
  });

  describe('Windows version detection', () => {
    beforeEach(() => {
      mockPlatform = 'win32';
    });

    test('should use WinRT bindings on Windows 10 with minimum required version', () => {
      mockRelease = '10.0.15063'; // Exactly the minimum version
      
      const noble = resolver();
      expect(noble).toBeInstanceOf(MockNobleClass);
      expect(noble.bindings).toBeInstanceOf(MockWinBindings);
    });

    test('should use WinRT bindings on Windows 10 with higher version', () => {
      mockRelease = '10.0.19042'; // Later Windows 10 version
      
      const noble = resolver();
      expect(noble).toBeInstanceOf(MockNobleClass);
      expect(noble.bindings).toBeInstanceOf(MockWinBindings);
    });

    test('should use WinRT bindings on Windows 11', () => {
      mockRelease = '11.0.22621';
      
      const noble = resolver();
      expect(noble).toBeInstanceOf(MockNobleClass);
      expect(noble.bindings).toBeInstanceOf(MockWinBindings);
    });

    test('should use HCI bindings on Windows 10 with earlier version', () => {
      mockRelease = '10.0.10240'; // Early Windows 10 without proper BLE support
      
      const noble = resolver();
      expect(noble).toBeInstanceOf(MockNobleClass);
      expect(noble.bindings).toBeInstanceOf(MockHciBindings);
    });

    test('should use HCI bindings on Windows 8.1', () => {
      mockRelease = '6.3.9600';
      
      const noble = resolver();
      expect(noble).toBeInstanceOf(MockNobleClass);
      expect(noble.bindings).toBeInstanceOf(MockHciBindings);
    });
  });
});