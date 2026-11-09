'use strict';

// Headless smoke test for the macOS (CoreBluetooth) binding: a Swift core
// behind a thin N-API glue layer.
//
// It needs neither Bluetooth hardware nor the Bluetooth permission, so it can
// run on a GitHub-hosted macOS runner, where the adapter state is something
// like 'unsupported', 'unauthorized' or 'poweredOff'. What it proves:
//
//   1. the addon loads, i.e. the Swift static library and the Swift runtime
//      were linked correctly;
//   2. stop() without start() is a safe, idempotent no-op;
//   3. start() followed by stop(), repeated, neither crashes nor deadlocks
//      (stop() waits for the CoreBluetooth queue to go quiet);
//   4. requests reject, rather than hang or throw, before start(), after
//      stop() and when their arguments are unusable;
//   5. stop() releases the event loop: the process exits on its own.
//
// It runs against the compiled package (`npm run rebuild && npm run build`
// first) and is a no-op on every other platform, so CI can invoke it
// unconditionally.

if (process.platform !== 'darwin') {
  console.log('SKIP: mac teardown smoke test only runs on darwin');
  process.exit(0);
}

const assert = require('assert');
const path = require('path');

const { withBindings } = require('../..');

const ADAPTER_STATES = ['poweredOn', 'poweredOff', 'unauthorized', 'unsupported', 'unknown', 'resetting'];
const PERIPHERAL_ID = '00112233445566778899aabbccddeeff';
const ITERATIONS = 25;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Fails when `promise` is still pending after `ms`: a request must never hang. */
function settlesWithin (promise, ms, label) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function packageLevel () {
  // stop() before start() must be a safe, idempotent no-op.
  {
    const noble = withBindings('mac');
    noble.stop();
    noble.stop();
  }

  // Reading `.state` starts the bindings synchronously; stop right behind it,
  // while CoreBluetooth is still reporting its initial state.
  for (let i = 0; i < ITERATIONS; i++) {
    const noble = withBindings('mac');
    noble.onStateChange(() => {});
    assert.strictEqual(typeof noble.state, 'string');
    noble.stop();
    noble.stop();
  }

  // A request made after stop() rejects.
  const noble = withBindings('mac');
  noble.onStateChange(() => {});
  assert.strictEqual(typeof noble.state, 'string');
  noble.stop();
  await assert.rejects(settlesWithin(noble.stopScanning(), 2000, 'stopScanning() after stop()'));

  console.log(`mac smoke test: created and tore down ${ITERATIONS + 2} noble instances`);
}

async function addonLevel () {
  const { NobleMac } = require('node-gyp-build')(path.resolve(__dirname, '..', '..'));
  assert.strictEqual(typeof NobleMac, 'function', 'the addon exports NobleMac');

  const bindings = new NobleMac({});

  // Nothing platform specific that macOS cannot do is advertised.
  for (const method of ['pair', 'broadcast', 'reset', 'setAddress', 'setScanParameters']) {
    assert.strictEqual(bindings[method], undefined, `${method} is not implemented on macOS`);
  }

  // addressToId is synchronous and works without start().
  assert.strictEqual(
    bindings.addressToId('00112233-4455-6677-8899-AABBCCDDEEFF'),
    PERIPHERAL_ID
  );
  assert.strictEqual(bindings.addressToId('aa:bb:cc:dd:ee:ff'), null);

  // Before start(): requests reject, the void methods are no-ops.
  await assert.rejects(bindings.startScanning([], false), /not started/);
  await assert.rejects(bindings.read(PERIPHERAL_ID, '180a', '2a29'), /not started/);
  bindings.disconnect(PERIPHERAL_ID);
  bindings.cancelConnect(PERIPHERAL_ID);
  bindings.stop();

  const states = [];
  const delegate = {
    onStateChange: state => states.push(state),
    onAddressChange: () => {},
    onScanStart: () => {},
    onScanStop: () => {},
    onDiscover: () => {},
    onConnect: () => {},
    onDisconnect: () => {},
    onMtu: () => {},
    onRssi: () => {},
    onNotification: () => {},
    onHandleNotification: () => {},
    onWarning: () => {}
  };

  bindings.start(delegate);
  bindings.start(delegate); // idempotent

  // Unusable arguments reject instead of throwing or hanging.
  await assert.rejects(settlesWithin(bindings.connect(42), 2000, 'connect(42)'), /Invalid arguments/);
  await assert.rejects(
    settlesWithin(bindings.write(PERIPHERAL_ID, '180a', '2a29', 'not a buffer', false), 2000, 'write(bad data)'),
    /Invalid arguments/
  );

  // These travel through the Swift core. Whatever the adapter state on this
  // machine, each of them has to settle: with a result on a powered-on Mac,
  // with the reason otherwise.
  const requests = {
    'connect(malformed id)': bindings.connect('not-a-peripheral-id'),
    'connect(unknown id)': bindings.connect(PERIPHERAL_ID),
    'updateRssi(unconnected)': bindings.updateRssi(PERIPHERAL_ID),
    'discoverServices(unconnected)': bindings.discoverServices(PERIPHERAL_ID, []),
    'discoverCharacteristics(unconnected)': bindings.discoverCharacteristics(PERIPHERAL_ID, '180a', []),
    'read(unconnected)': bindings.read(PERIPHERAL_ID, '180a', '2a29'),
    'write(unconnected)': bindings.write(PERIPHERAL_ID, '180a', '2a29', Buffer.from([1, 2, 3]), false),
    'notify(unconnected)': bindings.notify(PERIPHERAL_ID, '180a', '2a29', true),
    'readValue(unconnected)': bindings.readValue(PERIPHERAL_ID, '180a', '2a29', '2901'),
    'writeValue(unconnected)': bindings.writeValue(PERIPHERAL_ID, '180a', '2a29', '2901', Buffer.alloc(1)),
    'readHandle(unconnected)': bindings.readHandle(PERIPHERAL_ID, 3),
    'writeHandle(unconnected)': bindings.writeHandle(PERIPHERAL_ID, 3, Buffer.alloc(1), false)
  };
  // Handlers are attached right away: the rejections arrive asynchronously
  // and must not be seen as unhandled while an earlier one is awaited.
  const outcomes = Object.entries(requests).map(([label, request]) =>
    settlesWithin(request, 5000, label).then(
      () => assert.fail(`${label} unexpectedly succeeded`),
      reason => ({ label, error: reason })
    ));
  for (const { label, error } of await Promise.all(outcomes)) {
    assert.ok(error instanceof Error, `${label} rejects with an Error`);
    assert.ok(!/did not settle|unexpectedly succeeded/.test(error.message), error.message);
    assert.ok(error.message.length > 0, `${label} rejects with a message`);
  }
  bindings.disconnect(PERIPHERAL_ID);
  bindings.cancelConnect(PERIPHERAL_ID);

  // Scanning only works on a powered-on adapter; it must settle either way.
  await settlesWithin(bindings.startScanning(['180a'], true), 5000, 'startScanning()').then(
    () => console.log('mac smoke test: scanning started (Bluetooth is available here)'),
    error => console.log(`mac smoke test: startScanning() rejected as expected without Bluetooth: ${error.message}`)
  );
  await settlesWithin(bindings.stopScanning(), 5000, 'stopScanning()');

  // CoreBluetooth reports its state shortly after start(). Machines without
  // any Bluetooth stack may stay silent, so by default this is only logged.
  for (let waited = 0; states.length === 0 && waited < 5000; waited += 100) {
    await sleep(100);
  }
  if (states.length > 0) {
    for (const state of states) {
      assert.ok(ADAPTER_STATES.includes(state), `'${state}' is a known adapter state`);
    }
    console.log(`mac smoke test: adapter state reported as ${states.join(', ')}`);
  } else {
    assert.ok(!process.env.NOBLE_SMOKE_REQUIRE_STATE, 'no adapter state was reported within 5 s');
    console.log('mac smoke test: WARNING no adapter state was reported within 5 s');
  }

  // A request still pending at stop() is rejected by it.
  const pendingAtStop = bindings.stopScanning();
  bindings.stop();
  await settlesWithin(pendingAtStop.catch(() => {}), 2000, 'request pending at stop()');
  bindings.stop(); // idempotent

  // After stop(): requests reject again.
  await assert.rejects(bindings.connect(PERIPHERAL_ID), /stopped/);
  await assert.rejects(bindings.stopScanning(), /stopped/);
  bindings.disconnect(PERIPHERAL_ID);

  // start() after stop() brings the addon back, and stop() ends it for good.
  bindings.start(delegate);
  await assert.rejects(settlesWithin(bindings.updateRssi(PERIPHERAL_ID), 5000, 'updateRssi() after restart'));
  bindings.stop();

  console.log('mac smoke test: addon request / teardown checks passed');
}

// Deliberately no process.exit() on success: once everything is stopped the
// event loop has to drain by itself. The first watchdog catches a test that
// hangs; the second one (unreferenced, so it cannot keep the loop alive
// itself) catches a stopped addon that still does.
const watchdog = setTimeout(() => {
  console.error('mac smoke test: FAILED, the test did not finish within 60 s');
  process.exit(1);
}, 60000);

packageLevel()
  .then(addonLevel)
  .then(() => {
    clearTimeout(watchdog);
    const exitWatchdog = setTimeout(() => {
      console.error('mac smoke test: FAILED, the event loop is still alive 10 s after stop()');
      process.exit(1);
    }, 10000);
    exitWatchdog.unref();
    process.on('exit', code => {
      if (code === 0) {
        console.log('mac smoke test: process exited cleanly after stop()');
      }
    });
  })
  .catch(error => {
    console.error('mac smoke test: FAILED');
    console.error(error);
    process.exit(1);
  });
