/** A promise whose settlement is controlled from the outside. */
export class Deferred<T = void> {
  readonly promise: Promise<T>;
  resolve!: (value: T | PromiseLike<T>) => void;
  reject!: (reason: Error) => void;

  constructor () {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    // Callers race this promise against others; an unobserved rejection is expected.
    this.promise.catch(() => {});
  }
}
