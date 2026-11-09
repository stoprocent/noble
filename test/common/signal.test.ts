import { Signal } from '../../src/common/signal';

describe('Signal', () => {
  test('delivers every emitted value to every listener, in subscription order', () => {
    const signal = new Signal<number>();
    const calls: string[] = [];
    signal.subscribe(value => calls.push(`a${value}`));
    signal.subscribe(value => calls.push(`b${value}`));

    signal.emit(1);
    signal.emit(2);

    expect(calls).toEqual(['a1', 'b1', 'a2', 'b2']);
  });

  test('emitting without listeners is a no-op', () => {
    expect(() => new Signal<number>().emit(1)).not.toThrow();
  });

  test('hasListeners reflects the current subscriptions', () => {
    const signal = new Signal();
    expect(signal.hasListeners).toBe(false);

    const unsubscribe = signal.subscribe(() => {});
    expect(signal.hasListeners).toBe(true);

    unsubscribe();
    expect(signal.hasListeners).toBe(false);
  });

  test('unsubscribe removes only its own listener and may be called twice', () => {
    const signal = new Signal<string>();
    const first = jest.fn();
    const second = jest.fn();
    const unsubscribeFirst = signal.subscribe(first);
    signal.subscribe(second);

    unsubscribeFirst();
    unsubscribeFirst();
    signal.emit('x');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('x');
  });

  test('subscribing the same function twice registers it once', () => {
    const signal = new Signal<void>();
    const listener = jest.fn();
    signal.subscribe(listener);
    signal.subscribe(listener);

    signal.emit();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('a listener may unsubscribe itself while being notified', () => {
    const signal = new Signal<number>();
    const once = jest.fn(() => unsubscribe());
    const unsubscribe = signal.subscribe(once);
    const other = jest.fn();
    signal.subscribe(other);

    signal.emit(1);
    signal.emit(2);

    expect(once).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(2);
  });

  test('a listener added during an emit only sees later values', () => {
    const signal = new Signal<number>();
    const late = jest.fn();
    signal.subscribe(() => {
      signal.subscribe(late);
    });

    signal.emit(1);
    expect(late).not.toHaveBeenCalled();

    signal.emit(2);
    expect(late).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledWith(2);
  });

  test('a listener removed during an emit is still notified of that value (snapshot semantics)', () => {
    const signal = new Signal<number>();
    const second = jest.fn();
    let unsubscribeSecond = (): void => {};
    signal.subscribe(() => unsubscribeSecond());
    unsubscribeSecond = signal.subscribe(second);

    signal.emit(1);
    signal.emit(2);

    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(1);
  });

  test('clear removes every listener', () => {
    const signal = new Signal<number>();
    const listener = jest.fn();
    signal.subscribe(listener);

    signal.clear();
    signal.emit(1);

    expect(listener).not.toHaveBeenCalled();
    expect(signal.hasListeners).toBe(false);
  });

  test('a throwing listener propagates to the emitter and skips the remaining listeners', () => {
    const signal = new Signal<number>();
    const after = jest.fn();
    signal.subscribe(() => {
      throw new Error('listener failed');
    });
    signal.subscribe(after);

    expect(() => signal.emit(1)).toThrow('listener failed');
    expect(after).not.toHaveBeenCalled();
  });
});
