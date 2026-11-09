import { AsyncQueue } from '../../src/common/async-queue';
import { isPending } from '../helpers/fake-bindings';

describe('AsyncQueue', () => {
  test('yields buffered values in order', async () => {
    const queue = new AsyncQueue<number>();
    queue.push(1);
    queue.push(2);

    await expect(queue.next()).resolves.toEqual({ value: 1, done: false });
    await expect(queue.next()).resolves.toEqual({ value: 2, done: false });
  });

  test('a waiting next() resolves with the next pushed value', async () => {
    const queue = new AsyncQueue<string>();
    const next = queue.next();
    expect(await isPending(next)).toBe(true);

    queue.push('late');

    await expect(next).resolves.toEqual({ value: 'late', done: false });
  });

  test('end() finishes the iteration only after the buffer drained', async () => {
    const queue = new AsyncQueue<number>();
    queue.push(1);
    queue.end();

    await expect(queue.next()).resolves.toEqual({ value: 1, done: false });
    await expect(queue.next()).resolves.toEqual({ value: undefined, done: true });
    await expect(queue.next()).resolves.toEqual({ value: undefined, done: true });
  });

  test('end() wakes a waiting next()', async () => {
    const queue = new AsyncQueue<number>();
    const next = queue.next();

    queue.end();

    await expect(next).resolves.toEqual({ value: undefined, done: true });
  });

  test('end(error) rejects once the buffer drained, and keeps rejecting', async () => {
    const queue = new AsyncQueue<number>();
    const error = new Error('link lost');
    queue.push(1);
    queue.end(error);

    await expect(queue.next()).resolves.toEqual({ value: 1, done: false });
    await expect(queue.next()).rejects.toBe(error);
    await expect(queue.next()).rejects.toBe(error);
  });

  test('end(error) rejects a waiting next()', async () => {
    const queue = new AsyncQueue<number>();
    const next = queue.next();
    const error = new Error('link lost');

    queue.end(error);

    await expect(next).rejects.toBe(error);
  });

  test('values pushed after end() are dropped, and only the first end() counts', async () => {
    const queue = new AsyncQueue<number>();
    queue.end();
    queue.push(1);
    queue.end(new Error('ignored'));

    await expect(queue.next()).resolves.toEqual({ value: undefined, done: true });
  });

  test('return() discards the buffer and ends the iteration', async () => {
    const queue = new AsyncQueue<number>();
    queue.push(1);

    await expect(queue.return()).resolves.toEqual({ value: undefined, done: true });
    await expect(queue.next()).resolves.toEqual({ value: undefined, done: true });
  });

  test('works with for await, and breaking out ends the queue', async () => {
    const queue = new AsyncQueue<number>();
    queue.push(1);
    queue.push(2);
    queue.push(3);

    const seen: number[] = [];
    for await (const value of queue) {
      seen.push(value);
      if (value === 2) break;
    }

    expect(seen).toEqual([1, 2]);
    await expect(queue.next()).resolves.toEqual({ value: undefined, done: true });
  });

  test('for await consumes values pushed while it waits and stops at end()', async () => {
    const queue = new AsyncQueue<number>();
    const seen: number[] = [];
    const consumer = (async () => {
      for await (const value of queue) seen.push(value);
    })();

    queue.push(1);
    await Promise.resolve();
    queue.push(2);
    queue.end();
    await consumer;

    expect(seen).toEqual([1, 2]);
  });

  test('several concurrent next() calls are served in the order they were made', async () => {
    const queue = new AsyncQueue<number>();
    const first = queue.next();
    const second = queue.next();
    const third = queue.next();

    queue.push(1);
    queue.push(2);
    queue.end();

    await expect(first).resolves.toEqual({ value: 1, done: false });
    await expect(second).resolves.toEqual({ value: 2, done: false });
    await expect(third).resolves.toEqual({ value: undefined, done: true });
  });

  test('end(error) rejects every waiting next()', async () => {
    const queue = new AsyncQueue<number>();
    const first = queue.next();
    const second = queue.next();
    const error = new Error('link lost');

    queue.end(error);

    await expect(first).rejects.toBe(error);
    await expect(second).rejects.toBe(error);
  });
});
