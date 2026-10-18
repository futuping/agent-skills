import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { passkeyGuardSource, prepareBackground, removePasskeyGuard, handOffForPasskey } from '../skills/bitwarden-login/scripts/background.mjs';

// Separate VMs model page/frame realms; no browser, authenticator or vault is used.
function realm() {
  const clock = { now: 1_000 };
  const timers = new Map();
  let timerId = 0;
  const context = vm.createContext({
    DOMException,
    Date: class extends Date { static now() { return clock.now; } },
    setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(`
    globalThis.metrics = { get: 0, create: 0, extensionGet: 0, extensionCreate: 0 };
    class CredentialsContainer {
      get(options) {
        if (!(this instanceof CredentialsContainer)) throw new TypeError('wrong receiver');
        metrics.get++;
        return Promise.resolve('public-get-result');
      }
      create(options) {
        if (!(this instanceof CredentialsContainer)) throw new TypeError('wrong receiver');
        metrics.create++;
        return Promise.resolve('public-create-result');
      }
    }
    globalThis.CredentialsContainer = CredentialsContainer;
    globalThis.navigator = { credentials: new CredentialsContainer() };
    globalThis.otherCredentials = new CredentialsContainer();
  `, context);
  const run = source => vm.runInContext(source, context);
  const install = (expiresAt = clock.now + 1_000) => run(passkeyGuardSource(expiresAt));
  const restore = () => run('globalThis[Symbol.for("bitwarden-login.passkey-guard")]?.()');
  const active = () => run('typeof globalThis[Symbol.for("bitwarden-login.passkey-guard")] === "function"');
  return { context, clock, timers, run, install, restore, active };
}

function assignExtension(r) {
  r.run(`
    const capturedGet = navigator.credentials.get.bind(navigator.credentials);
    const capturedCreate = navigator.credentials.create.bind(navigator.credentials);
    globalThis.extensionGet = function(options) { metrics.extensionGet++; return capturedGet(options); };
    globalThis.extensionCreate = function(options) { metrics.extensionCreate++; return capturedCreate(options); };
    navigator.credentials.get = extensionGet;
    navigator.credentials.create = extensionCreate;
  `);
}

test('passkey suppression is confined to the guarded credentials instance and realm', async () => {
  const guarded = realm(), unrelated = realm();
  assert.equal(await guarded.run('navigator.credentials.get({ publicKey: {} })'), 'public-get-result');
  guarded.install();
  await assert.rejects(guarded.run('navigator.credentials.get({ publicKey: {} })'), { name: 'NotAllowedError' });
  await assert.rejects(guarded.run('navigator.credentials.create({ publicKey: {} })'), { name: 'NotAllowedError' });
  assert.equal(await guarded.run('navigator.credentials.get({ password: true })'), 'public-get-result');
  assert.equal(await guarded.run('navigator.credentials.create({ password: {} })'), 'public-create-result');
  assert.equal(await guarded.run('otherCredentials.get({ publicKey: {} })'), 'public-get-result');
  assert.equal(await unrelated.run('navigator.credentials.get({ publicKey: {} })'), 'public-get-result');
  assert.equal(unrelated.active(), false);
  guarded.restore();
  assert.equal(guarded.active(), false);
  assert.equal(await guarded.run('navigator.credentials.get({ publicKey: {} })'), 'public-get-result');
  assert.equal(await guarded.run('navigator.credentials.create({ publicKey: {} })'), 'public-create-result');
});

test('an extension assigned before installation is preserved after cleanup', async () => {
  const r = realm();
  assignExtension(r);
  r.install();
  await assert.rejects(r.run('navigator.credentials.get({ publicKey: {} })'), { name: 'NotAllowedError' });
  assert.equal(r.run('metrics.extensionGet'), 0);
  assert.equal(await r.run('navigator.credentials.get({ password: true })'), 'public-get-result');
  r.restore();
  assert.equal(r.run('navigator.credentials.get === extensionGet'), true);
  assert.equal(r.run('navigator.credentials.create === extensionCreate'), true);
  assert.equal(await r.run('navigator.credentials.get({ publicKey: {} })'), 'public-get-result');
  assert.equal(await r.run('navigator.credentials.create({ publicKey: {} })'), 'public-create-result');
});

test('later extension assignments use frozen delegates instead of recursing through the current delegate', async () => {
  const r = realm();
  r.install();
  assignExtension(r);
  await assert.rejects(r.run('navigator.credentials.get({ publicKey: {} })'), { name: 'NotAllowedError' });
  await assert.rejects(r.run('navigator.credentials.create({ publicKey: {} })'), { name: 'NotAllowedError' });
  assert.equal(r.run('metrics.extensionGet + metrics.extensionCreate'), 0);
  assert.equal(await r.run('navigator.credentials.get({ password: true })'), 'public-get-result');
  assert.equal(await r.run('navigator.credentials.create({ password: {} })'), 'public-create-result');
  assert.equal(r.run('metrics.get + metrics.create'), 2);
  r.run('globalThis.oldGet = navigator.credentials.get.bind(navigator.credentials)');
  r.restore();
  assert.equal(r.run('navigator.credentials.get === extensionGet'), true);
  assert.equal(r.run('navigator.credentials.create === extensionCreate'), true);
  assert.equal(await r.run('oldGet({ publicKey: {} })'), 'public-get-result');
  assert.equal(await r.run('navigator.credentials.create({ publicKey: {} })'), 'public-create-result');
});

test('cleanup preserves the latest of several extension assignments', async () => {
  const r = realm();
  r.install();
  assignExtension(r);
  r.run(`
    const firstExtensionGet = navigator.credentials.get.bind(navigator.credentials);
    globalThis.latestGet = function(options) { return firstExtensionGet(options); };
    navigator.credentials.get = latestGet;
  `);
  r.restore();
  assert.equal(r.run('navigator.credentials.get === latestGet'), true);
  assert.equal(await r.run('navigator.credentials.get({ publicKey: {} })'), 'public-get-result');
  assert.equal(r.run('metrics.extensionGet'), 1);
  assert.equal(r.run('metrics.get'), 1);
});

test('absolute expiry lets captured bound wrappers fall through even before a delayed timer runs', async () => {
  const r = realm();
  r.install(2_000);
  r.run(`
    globalThis.oldGet = navigator.credentials.get.bind(navigator.credentials);
    globalThis.oldCreate = navigator.credentials.create.bind(navigator.credentials);
  `);
  assignExtension(r);
  r.clock.now = 2_001;
  assert.equal(await r.run('oldGet({ publicKey: {} })'), 'public-get-result');
  assert.equal(await r.run('oldCreate({ publicKey: {} })'), 'public-create-result');
  assert.equal(await r.run('navigator.credentials.get({ publicKey: {} })'), 'public-get-result');
  assert.equal(r.active(), false);
  assert.equal(r.run('navigator.credentials.get === extensionGet'), true);
});

test('expiry timer restores the latest extension methods without a credential call', async () => {
  const r = realm();
  r.install(2_000);
  assignExtension(r);
  assert.ok(r.timers.size > 0);
  r.clock.now = 2_000;
  for (const { callback } of [...r.timers.values()]) callback();
  assert.equal(r.active(), false);
  assert.equal(r.run('navigator.credentials.get === extensionGet'), true);
  assert.equal(r.run('navigator.credentials.create === extensionCreate'), true);
  assert.equal(await r.run('navigator.credentials.get({ publicKey: {} })'), 'public-get-result');
});

test('reusing a navigation script cannot renew its absolute lease in a later document', async () => {
  const source = passkeyGuardSource(2_000);
  const during = realm();
  during.clock.now = 1_900;
  during.run(source);
  await assert.rejects(during.run('navigator.credentials.get({ publicKey: {} })'), { name: 'NotAllowedError' });
  const later = realm();
  later.clock.now = 2_001;
  later.run(source);
  assert.equal(later.active(), false);
  assert.equal(later.timers.size, 0);
  assert.equal(await later.run('navigator.credentials.get({ publicKey: {} })'), 'public-get-result');
});

test('unsupported descriptors fail installation atomically and leave no suppression behind', () => {
  for (const descriptor of [
    '{ value: CredentialsContainer.prototype.create, writable: true, configurable: false }',
    '{ value: CredentialsContainer.prototype.create, writable: false, configurable: true }',
    '{ get() { return CredentialsContainer.prototype.create; }, configurable: true }',
  ]) {
    const r = realm();
    r.run(`
      Object.defineProperty(navigator.credentials, 'create', ${descriptor});
      globalThis.beforeGet = Object.getOwnPropertyDescriptor(navigator.credentials, 'get');
      globalThis.beforeCreate = Object.getOwnPropertyDescriptor(navigator.credentials, 'create');
    `);
    assert.throws(() => r.install());
    assert.deepEqual(r.run('Object.getOwnPropertyDescriptor(navigator.credentials, "get")'), r.run('beforeGet'));
    assert.deepEqual(r.run('Object.getOwnPropertyDescriptor(navigator.credentials, "create")'), r.run('beforeCreate'));
    assert.equal(r.active(), false);
    assert.equal(r.timers.size, 0);
  }
});

function cleanupPage(realms, { failAt, registrationMissing = false } = {}) {
  const calls = [];
  const registrations = new Set(registrationMissing ? [] : ['old-registration']);
  const page = { cdp: async (method, args) => {
    calls.push({ method, args });
    if (failAt === 'remove-old' && args.identifier === 'old-registration') throw new Error('cleanup failure');
    if (method === 'Page.removeScriptToEvaluateOnNewDocument') {
      if (registrationMissing && args.identifier === 'old-registration') throw new Error('Script not found');
      if (failAt === 'remove-restore' && args.identifier === 'restore-registration') throw new Error('cleanup failure');
      registrations.delete(args.identifier);
      return {};
    }
    assert.equal(method, 'Page.addScriptToEvaluateOnNewDocument');
    if (failAt === 'restore-frames') throw new Error('cleanup failure');
    assert.equal(args.runImmediately, true);
    assert.equal(typeof args.source, 'string');
    for (const r of realms) r.run(args.source);
    registrations.add('restore-registration');
    return { identifier: 'restore-registration' };
  }, evaluate: async source => {
    calls.push({ method: 'evaluate' });
    if (failAt === 'restore-current') throw new Error('cleanup failure');
    return realms[0].run(typeof source === 'function' ? `(${source})()` : source);
  } };
  return { page, calls, registrations };
}

test('cleanup restores every existing frame and removes both guard and temporary restore registrations', async () => {
  const realms = [realm(), realm()];
  for (const r of realms) { r.install(); assignExtension(r); }
  const f = cleanupPage(realms);
  await removePasskeyGuard(f.page, 'old-registration');
  assert.deepEqual(f.calls.filter(x => x.method.startsWith('Page.')).map(x => x.method), [
    'Page.removeScriptToEvaluateOnNewDocument',
    'Page.addScriptToEvaluateOnNewDocument',
    'Page.removeScriptToEvaluateOnNewDocument',
  ]);
  assert.equal(f.registrations.size, 0);
  for (const r of realms) {
    assert.equal(r.active(), false);
    assert.equal(await r.run('navigator.credentials.get({ publicKey: {} })'), 'public-get-result');
    assert.equal(r.run('navigator.credentials.get === extensionGet'), true);
  }
});

test('handoff waits for frame restoration even when an old CDP registration is already detached', async () => {
  const r = realm(); r.install();
  const f = cleanupPage([r], { registrationMissing: true });
  const task = { handOff: async () => {
    assert.equal(r.active(), false);
    assert.equal(f.registrations.has('restore-registration'), false);
    f.calls.push({ method: 'handOff' });
  } };
  await handOffForPasskey(task, f.page, 'old-registration');
  assert.equal(f.calls.at(-1).method, 'handOff');
});

test('cleanup failure prevents handing a guarded page to the user', async () => {
  for (const failAt of ['remove-old', 'restore-frames', 'restore-current', 'remove-restore']) {
    const r = realm(); r.install();
    const f = cleanupPage([r], { failAt });
    let handoffs = 0;
    await assert.rejects(handOffForPasskey({ handOff: async () => { handoffs++; } }, f.page, 'old-registration'));
    assert.equal(handoffs, 0);
  }
});

function failedSetup({ cleanupFailure } = {}) {
  const realms = [realm(), realm()];
  for (const r of realms) assignExtension(r);
  const registrations = new Set();
  const setupError = new Error('navigation invalidated the current execution context');
  let additions = 0, evaluations = 0;
  const page = { label: 'p1', cdp: async (method, args) => {
    if (method === 'Page.removeScriptToEvaluateOnNewDocument') {
      if (cleanupFailure === 'remove-initial' && args.identifier === 'setup-registration') throw new Error('cleanup failure');
      if (cleanupFailure === 'remove-restore' && args.identifier === 'restore-registration') throw new Error('cleanup failure');
      registrations.delete(args.identifier);
      return {};
    }
    assert.equal(method, 'Page.addScriptToEvaluateOnNewDocument');
    assert.equal(args.runImmediately, true);
    additions++;
    if (additions > 1 && cleanupFailure === 'restore-frames') throw new Error('cleanup failure');
    for (const r of realms) r.run(args.source);
    const identifier = additions === 1 ? 'setup-registration' : 'restore-registration';
    registrations.add(identifier);
    return { identifier };
  }, evaluate: async source => {
    evaluations++;
    if (evaluations === 1) {
      // runImmediately has already installed the guard in both contexts.
      assert.equal(realms.every(r => r.active()), true);
      throw setupError;
    }
    if (cleanupFailure === 'restore-current') throw new Error('cleanup failure');
    return realms[0].run(source);
  } };
  const task = {
    ownership: 'agent',
    tabs: async () => [{ label: 'p1', targetId: 'login', openedBy: 'agent' }],
    cdp: async (method, args) => {
      // Foreground state may skip this query; either way no window is changed.
      assert.equal(method, 'Browser.getWindowForTarget');
      assert.equal(args.targetId, 'login');
      return { windowId: 1, bounds: { windowState: 'fullscreen' } };
    },
  };
  return { realms, registrations, setupError, task, page };
}

test('setup evaluation failure restores all installed contexts before rethrowing the original error', async () => {
  const f = failedSetup();
  await assert.rejects(prepareBackground(f.task, f.page), error => error === f.setupError);
  assert.equal(f.registrations.size, 0);
  for (const r of f.realms) {
    assert.equal(r.active(), false);
    assert.equal(r.run('navigator.credentials.get === extensionGet'), true);
    assert.equal(r.run('navigator.credentials.create === extensionCreate'), true);
    assert.equal(await r.run('navigator.credentials.get({ publicKey: {} })'), 'public-get-result');
    assert.equal(await r.run('navigator.credentials.create({ publicKey: {} })'), 'public-create-result');
  }
});

test('setup rollback failure reports cleanup_required instead of success or only the setup error', async () => {
  for (const cleanupFailure of ['remove-initial', 'restore-frames', 'restore-current', 'remove-restore']) {
    const f = failedSetup({ cleanupFailure });
    await assert.rejects(prepareBackground(f.task, f.page), { code: 'cleanup_required' });
  }
});
