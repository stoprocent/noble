const mockNoble = { mocked: 'noble' };
const mockWithBindings = jest.fn((..._args: unknown[]) => mockNoble);

// The package entry point creates the default instance on import; keep it from
// resolving (and loading) a real backend.
jest.mock('../src/bindings/resolve', () => ({ withBindings: mockWithBindings }));

import * as api from '../src/index';
import * as errors from '../src/common/errors';
import { Characteristic } from '../src/gatt/characteristic';
import { Descriptor } from '../src/gatt/descriptor';
import { Peripheral } from '../src/gatt/peripheral';
import { Service } from '../src/gatt/service';
import { Noble } from '../src/noble';

describe('public exports', () => {
  test('the default export is one instance on the default bindings', () => {
    expect(mockWithBindings).toHaveBeenCalledTimes(1);
    expect(mockWithBindings).toHaveBeenCalledWith();
    expect(api.default).toBe(mockNoble);
  });

  test('exposes withBindings for other backends', () => {
    expect(api.withBindings).toBe(mockWithBindings);
  });

  test('exposes the HCI status message helper', () => {
    expect(api.hciStatusMessage(0x3e)).toBe('Connection Failed to be Established');
  });

  test('exposes DevicePairingProtectionLevel constants', () => {
    expect(api.DevicePairingProtectionLevel).toEqual({
      Default: 0,
      None: 1,
      Encryption: 2,
      EncryptionAndAuthentication: 3
    });
  });

  test('exposes DevicePairingKinds constants', () => {
    expect(api.DevicePairingKinds).toEqual({
      None: 0,
      ConfirmOnly: 0x08,
      DisplayPin: 0x10,
      ConfirmPinMatch: 0x20,
      ProvidePin: 0x40,
      ProvidePassword: 0x80,
      ConfirmPassword: 0x100
    });
  });

  test('the pairing tables equal the ones of the previous implementation exactly', () => {
    expect(api.DevicePairingKinds).toStrictEqual(require('../lib/pairing-kinds'));
    expect(api.DevicePairingProtectionLevel).toStrictEqual(require('../lib/pairing-protection-level'));
  });

  test('exposes the model classes', () => {
    expect(api.Noble).toBe(Noble);
    expect(api.Peripheral).toBe(Peripheral);
    expect(api.Service).toBe(Service);
    expect(api.Characteristic).toBe(Characteristic);
    expect(api.Descriptor).toBe(Descriptor);
  });

  test.each([
    'NobleError',
    'AdapterStateError',
    'ConnectionCancelledError',
    'DisconnectedError',
    'NotSupportedError',
    'TimeoutError'
  ] as const)('exposes %s', name => {
    expect(api[name]).toBe(errors[name]);
  });

  test('exports nothing else', () => {
    expect(Object.keys(api).sort()).toEqual([
      'AdapterStateError',
      'Characteristic',
      'ConnectionCancelledError',
      'Descriptor',
      'DevicePairingKinds',
      'DevicePairingProtectionLevel',
      'DisconnectedError',
      'Noble',
      'NobleError',
      'NotSupportedError',
      'Peripheral',
      'Service',
      'TimeoutError',
      'default',
      'hciStatusMessage',
      'withBindings'
    ]);
  });
});

describe('errors', () => {
  test('every error is a NobleError named after its class', () => {
    const instances = [
      new errors.DisconnectedError('remote'),
      new errors.NotSupportedError('nope'),
      new errors.AdapterStateError('off', 'poweredOff'),
      new errors.TimeoutError('late'),
      new errors.ConnectionCancelledError()
    ];

    for (const error of instances) {
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(errors.NobleError);
      expect(error.name).toBe(error.constructor.name);
    }
    expect(new errors.NobleError('plain').name).toBe('NobleError');
  });

  test('DisconnectedError carries the reason', () => {
    expect(new errors.DisconnectedError(0x13)).toMatchObject({ reason: 0x13, message: 'Disconnected 19' });
    expect(new errors.DisconnectedError('cleanup')).toMatchObject({ reason: 'cleanup', message: 'Disconnected cleanup' });
  });

  test('AdapterStateError carries the state', () => {
    expect(new errors.AdapterStateError('message', 'unauthorized')).toMatchObject({
      state: 'unauthorized',
      message: 'message'
    });
  });

  test('ConnectionCancelledError has a fixed message', () => {
    expect(new errors.ConnectionCancelledError().message).toBe('connection canceled!');
  });
});
