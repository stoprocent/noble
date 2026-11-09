export type Listener<T> = (value: T) => void;

/** Removes the listener it was returned for. Safe to call more than once. */
export type Unsubscribe = () => void;

/**
 * A single typed stream of values. Owners call {@link emit}; everybody else
 * only ever sees {@link subscribe}.
 */
export class Signal<T = void> {
  private readonly listeners = new Set<Listener<T>>();

  get hasListeners (): boolean {
    return this.listeners.size > 0;
  }

  subscribe (listener: Listener<T>): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit (value: T): void {
    // Snapshot so listeners may unsubscribe (or subscribe) while being notified.
    for (const listener of [...this.listeners]) {
      listener(value);
    }
  }

  clear (): void {
    this.listeners.clear();
  }
}
