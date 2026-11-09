/**
 * Bridges push-style producers to `for await` consumers. Values pushed while
 * nobody is waiting are buffered; {@link end} finishes the iteration once the
 * buffer drains, optionally with an error.
 */
export class AsyncQueue<T> implements AsyncIterableIterator<T> {
  private readonly values: T[] = [];
  private waiter: (() => void) | null = null;
  private ended = false;
  private error: Error | null = null;

  push (value: T): void {
    if (this.ended) return;
    this.values.push(value);
    this.wake();
  }

  end (error?: Error): void {
    if (this.ended) return;
    this.ended = true;
    this.error = error ?? null;
    this.wake();
  }

  async next (): Promise<IteratorResult<T>> {
    for (;;) {
      if (this.values.length > 0) {
        return { value: this.values.shift() as T, done: false };
      }
      if (this.ended) {
        if (this.error) throw this.error;
        return { value: undefined, done: true };
      }
      await new Promise<void>(resolve => {
        this.waiter = resolve;
      });
    }
  }

  async return (): Promise<IteratorResult<T>> {
    this.values.length = 0;
    this.end();
    return { value: undefined, done: true };
  }

  [Symbol.asyncIterator] (): this {
    return this;
  }

  private wake (): void {
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.();
  }
}
