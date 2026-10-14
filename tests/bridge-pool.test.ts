import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChromiumBridge } from '../src/server/bridge/ChromiumBridge.js';

// Deterministic lifecycle scheduling; actual Chromium/media/isolation lives in
// bridge-lifecycle and chromium-adblock tests, not in this fake factory.
function harness() {
  const bridge = new ChromiumBridge() as any;
  bridge.ensureReady = async () => {};
  const created: any[] = [];
  bridge.createSession = async () => {
    const session = { lastActive: Date.now(), currentVideoId: null, setup: Promise.resolve(), closes: 0,
      context: { close: async () => { session.closes++; } } };
    created.push(session);
    return session;
  };
  return { bridge, created };
}

test('spare ownership is atomic under competing users and capacity includes the spare', async () => {
  const { bridge, created } = harness();
  try {
    await Promise.all([bridge.warmup(), bridge.warmup()]);
    assert.equal(created.length, 1);
    const firstSpare = created[0];
    const [a, b, same] = await Promise.all([bridge.getSession('a'), bridge.getSession('b'), bridge.getSession('a')]);
    assert.equal(a, firstSpare);
    assert.equal(same, a);
    assert.notEqual(b, a);
    await bridge.warmup();
    for (let n = 0; n < 8; n++) await bridge.getSession(`user-${n}`);
    await bridge.warmup();
    assert.equal(bridge.sessionCount, 10);
    assert.equal(bridge.spareSession, null);
    assert.equal(created.length, 10, 'never exceed ten browsers, including unassigned/in-flight spare');
    await assert.rejects(bridge.getSession('overflow'), /capacity/);
  } finally {
    await bridge.close();
    assert.ok(created.every(session => session.closes === 1));
  }
});

test('close drains an in-flight warmup without publishing or resurrecting the spare', async () => {
  const { bridge, created } = harness();
  const factory = bridge.createSession;
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  bridge.createSession = async () => { entered(); await gate; return factory(); };
  const warming = bridge.warmup();
  await started;
  const closing = bridge.close();
  release();
  await assert.rejects(warming, /closed/);
  await closing;
  assert.equal(created.length, 1);
  assert.equal(created[0].closes, 1);
  assert.equal(bridge.spareSession, null);
  assert.equal(bridge.sessionCount, 0);
  await assert.rejects(bridge.warmup(), /closed/);
});

test('failed warmup releases its reservation and an explicit retry succeeds', async () => {
  const { bridge, created } = harness();
  const factory = bridge.createSession;
  bridge.createSession = async () => { throw new Error('fixture launch failure'); };
  await assert.rejects(bridge.warmup(), /fixture launch failure/);
  assert.equal(bridge.spareSession, null);
  bridge.createSession = factory;
  await bridge.warmup();
  assert.equal(created.length, 1);
  await bridge.close();
  assert.equal(created[0].closes, 1);
});
