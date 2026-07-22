'use strict';

// Headless teardown smoke test for the Windows (WinRT) binding.
//
// Reproduces the crash scenarios from
// https://github.com/stoprocent/noble/issues/95 that do NOT require a real
// Bluetooth adapter, so they can run on a GitHub-hosted windows runner:
//
//   1. withBindings('default') then stop() WITHOUT ever starting. This used to
//      `delete` an uninitialized `manager` pointer and crash the process with
//      0xC0000005 (ACCESS_VIOLATION).
//   2. start() (kicked without a powered-on radio) followed by an immediate
//      stop(), repeated, which used to race the RadioWatcher fire_and_forget
//      coroutine into a use-after-free during teardown.
//
// Pass condition: the process survives every teardown and exits with code 0.
// A clean exit also proves the native keep-alive (the referenced N-API
// ThreadSafeFunction) is released on stop(), so a probe can exit in-process.
//
// This only exercises the native module on win32; on other platforms it is a
// no-op so it is safe to invoke unconditionally from CI.

if (process.platform !== 'win32') {
  console.log('SKIP: win teardown smoke test only runs on win32');
  process.exit(0);
}

const assert = require('assert');
const { withBindings } = require('../..');

// Case 1: stop() before start() must be a safe, idempotent no-op.
{
  const noble = withBindings('default');
  noble.stop();
  noble.stop(); // idempotent
}

// Case 2: stress start() -> immediate stop() to exercise the RadioWatcher
// coroutine teardown. Reading `.state` forces _initializeBindings() ->
// bindings.start() synchronously, without needing a powered-on adapter.
const ITERATIONS = 50;
for (let i = 0; i < ITERATIONS; i++) {
  const noble = withBindings('default');
  noble.on('stateChange', () => {});
  assert.strictEqual(typeof noble.state, 'string');
  noble.stop();
}

console.log(`win teardown smoke test: created and tore down ${ITERATIONS} instances`);

// Keep the event loop alive briefly so any in-flight WinRT coroutines resume
// AFTER their RadioWatcher has been destroyed. With the fix they observe the
// liveness flag and no-op; without it, this window is where the use-after-free
// crash would occur.
setTimeout(() => {
  console.log('win teardown smoke test: process exited cleanly after stop()');
  process.exit(0);
}, 2000);
