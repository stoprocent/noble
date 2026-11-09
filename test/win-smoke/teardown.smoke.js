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
//   3. Requests made while the binding is not running (before start(), after
//      stop()). The addon implements the promise-based Bindings contract
//      natively, so these must come back as rejected promises - never as a
//      thrown exception or a crash on the torn-down BLEManager.
//
// Pass condition: the process survives every teardown and exits with code 0.
// A clean exit also proves the native keep-alive (the referenced N-API
// ThreadSafeFunction) is released on stop(), so a probe can exit in-process.
//
// It runs against the compiled package (`npm run build` first).
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
// coroutine teardown. Reading `.state` forces Noble#start() ->
// bindings.start() synchronously, without needing a powered-on adapter.
const ITERATIONS = 50;
for (let i = 0; i < ITERATIONS; i++) {
  const noble = withBindings('default');
  noble.onStateChange(() => {});
  assert.strictEqual(typeof noble.state, 'string');
  noble.stop();
}

console.log(`win teardown smoke test: created and tore down ${ITERATIONS} instances`);

// Case 3: requests outside start()..stop() reject instead of throwing.
// `bindings` is the native addon instance (a TypeScript-private field of
// Noble, a plain property at runtime); the public API guards most of these
// calls itself, so talk to the addon directly.
const PERIPHERAL = 'aabbccddeeff';
const SERVICE = '180f';
const CHARACTERISTIC = '2a19';
const requestsWhileStopped = (bindings) => [
  bindings.startScanning([], false),
  bindings.stopScanning(),
  bindings.connect(PERIPHERAL),
  bindings.updateRssi(PERIPHERAL),
  bindings.isPaired(PERIPHERAL),
  bindings.discoverServices(PERIPHERAL, []),
  bindings.read(PERIPHERAL, SERVICE, CHARACTERISTIC),
  bindings.write(PERIPHERAL, SERVICE, CHARACTERISTIC, Buffer.from([1]), false),
  bindings.notify(PERIPHERAL, SERVICE, CHARACTERISTIC, true)
];
const stoppedRequests = [];
{
  const noble = withBindings('default');
  const bindings = noble.bindings;

  // Never started.
  stoppedRequests.push(...requestsWhileStopped(bindings));
  // Synchronous calls stay safe no-ops, and addressToId needs no manager.
  bindings.disconnect(PERIPHERAL);
  bindings.cancelConnect(PERIPHERAL);
  assert.strictEqual(bindings.addressToId('AA:BB:CC:DD:EE:FF'), PERIPHERAL);
  assert.strictEqual(bindings.addressToId('not an address'), null);
  // Argument mistakes are still reported synchronously.
  assert.throws(() => bindings.connect(42), TypeError);

  // Started, then stopped.
  assert.strictEqual(typeof noble.state, 'string');
  noble.stop();
  stoppedRequests.push(...requestsWhileStopped(bindings));
  bindings.disconnect(PERIPHERAL);
  bindings.cancelConnect(PERIPHERAL);
}
for (const request of stoppedRequests) {
  assert.ok(request instanceof Promise, 'a request made while stopped must return a promise');
}
const stoppedRequestsSettled = Promise.allSettled(stoppedRequests).then((results) => {
  for (const result of results) {
    assert.strictEqual(result.status, 'rejected');
    assert.ok(result.reason instanceof Error);
  }
  console.log(`win teardown smoke test: ${results.length} requests made while stopped were rejected`);
});

// Keep the event loop alive briefly so any in-flight WinRT coroutines resume
// AFTER their RadioWatcher has been destroyed. With the fix they observe the
// liveness flag and no-op; without it, this window is where the use-after-free
// crash would occur.
setTimeout(() => {
  stoppedRequestsSettled.then(() => {
    console.log('win teardown smoke test: process exited cleanly after stop()');
    process.exit(0);
  }, (error) => {
    console.error(error);
    process.exit(1);
  });
}, 2000);
