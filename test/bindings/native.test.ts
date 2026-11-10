const mockLoad = jest.fn();
jest.mock('node-gyp-build', () => mockLoad);

import { resolve } from 'path';

import { loadNativeBindings } from '../../src/bindings/native';

describe('loadNativeBindings', () => {
  beforeEach(() => {
    mockLoad.mockReset();
  });

  test('loads the addon from the package root and instantiates the requested backend', () => {
    const NobleMac = jest.fn();
    mockLoad.mockReturnValue({ NobleMac });
    const options = { some: 'option' };

    const bindings = loadNativeBindings('NobleMac', options);

    expect(mockLoad).toHaveBeenCalledWith(resolve(__dirname, '..', '..'));
    expect(NobleMac).toHaveBeenCalledWith(options);
    expect(bindings).toBe(NobleMac.mock.instances[0]);
  });

  test('defaults the options to an empty object', () => {
    const NobleWinrt = jest.fn();
    mockLoad.mockReturnValue({ NobleWinrt });

    loadNativeBindings('NobleWinrt');

    expect(NobleWinrt).toHaveBeenCalledWith({});
  });

  test('the addon instance is used as the bindings as-is, without a wrapper', () => {
    class NobleMac {
      start = jest.fn();
    }
    mockLoad.mockReturnValue({ NobleMac });

    expect(loadNativeBindings('NobleMac')).toBeInstanceOf(NobleMac);
  });

  test('throws when the addon was built without the requested backend', () => {
    mockLoad.mockReturnValue({ NobleMac: jest.fn() });

    expect(() => loadNativeBindings('NobleWinrt')).toThrow(/does not provide NobleWinrt/);
  });
});
