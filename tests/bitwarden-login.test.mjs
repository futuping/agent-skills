import test from 'node:test';
import assert from 'node:assert/strict';
import { stat, access } from 'node:fs/promises';
import { dirname } from 'node:path';
import vm from 'node:vm';
import { consumeCredential, originOf, safeFailure, totp, validateCredential, validatePlan } from '../skills/bitwarden-login/scripts/core.mjs';
import { receiveOnce, serveOnce } from '../skills/bitwarden-login/scripts/channel.mjs';
import { applyAction, observeState, runPlan } from '../skills/bitwarden-login/scripts/engine.mjs';
import { passkeyGuardSource, removePasskeyGuard } from '../skills/bitwarden-login/scripts/background.mjs';
import { googlePlan } from '../skills/bitwarden-login/scripts/google-plan.mjs';

const plan = () => ({ version: 1, spaceId: 1, pageLabel: 'p1', username: 'alice@example.com',
  origin: 'https://example.com', query: { domain: 'example.com' }, states: [
    { name: 'password', match: { origin: 'https://example.com', selector: '#password' }, fill: [{ source: 'password', selector: '#password' }], click: { selector: '#next' } },
    { name: 'success', match: { origin: 'https://example.com', selector: '#account', text: '$username' }, result: 'success' },
  ] });
const credential = () => ({ username: 'alice@example.com', password: 'public-test-password', uri: 'https://example.com/login', totp: 'JBSWY3DPEHPK3PXP' });

test('saved URI supports bare host but rejects HTTP, userinfo and similar domains', () => {
  assert.equal(originOf('example.com/login'), 'https://example.com');
  for (const uri of ['http://example.com', 'https://example.com@evil.test', '']) {
    assert.throws(() => validateCredential(plan(), { ...credential(), uri }));
  }
  assert.throws(() => validateCredential(plan(), { ...credential(), uri: 'https://example.com.evil.test' }));
});

test('account, item and credential origin must match before browser execution', () => {
  assert.throws(() => validateCredential(plan(), { ...credential(), username: 'bob@example.com' }));
  const p = plan(); p.query = { id: '12345678-1234-1234-1234-123456789abc' };
  assert.throws(() => validateCredential(p, credential()));
  validateCredential(p, { ...credential(), credential_id: p.query.id });
});

test('plan requires account evidence for success and limits credential writes to origin', () => {
  validatePlan(plan());
  const p = plan(); p.states[0].match.origin = 'https://other.example';
  assert.throws(() => validatePlan(p));
  const q = plan(); delete q.states[1].match.text;
  assert.throws(() => validatePlan(q));
});

test('TOTP matches RFC 6238 SHA1 vectors and rejects unsupported or malformed seeds', () => {
  const seed = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const uri = `otpauth://totp/RFC?secret=${seed}&digits=8`;
  for (const [seconds, expected] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']]) {
    assert.equal(totp(uri, seconds * 1000).code, expected);
  }
  assert.equal(totp(uri, 59000).remainingMs, 1000);
  for (const value of ['', '123456', 'steam://secret', 'otpauth://hotp/a?secret=ABC', `${uri}&algorithm=MD5`]) assert.throws(() => totp(value));
});

test('credential env is consumed and raw diagnostic errors are not surfaced', () => {
  const env = { BWLOGIN_PASSWORD: 'do-not-print', PATH: '/bin' };
  assert.equal(consumeCredential(env).password, 'do-not-print');
  assert.deepEqual(env, { PATH: '/bin' });
  assert.deepEqual(safeFailure(new Error('do-not-print')), { ok: false, status: 'execution_failed' });
});

test('credential channel is private, rejects a wrong nonce, and is single use', async () => {
  const channel = await serveOnce({ credential: credential() });
  try {
    assert.equal((await stat(dirname(channel.socketPath))).mode & 0o777, 0o700);
    assert.equal((await stat(channel.socketPath)).mode & 0o777, 0o600);
    await assert.rejects(receiveOnce({ ...channel, nonce: '0'.repeat(64) }));
    assert.deepEqual(await receiveOnce(channel), { credential: credential() });
    await assert.rejects(receiveOnce(channel));
  } finally { await channel.close(); }
  await assert.rejects(access(channel.socketPath));
});

test('passkey guard cancels WebAuthn, preserves other credentials, and restores methods', async () => {
  class CredentialsContainer { get() { return Promise.resolve('original-get'); } create() { return Promise.resolve('original-create'); } }
  const original = CredentialsContainer.prototype.get;
  const context = vm.createContext({ CredentialsContainer, DOMException });
  vm.runInContext(passkeyGuardSource, context);
  const container = new CredentialsContainer();
  await assert.rejects(container.get({ publicKey: {} }), { name: 'NotAllowedError' });
  await assert.rejects(container.create({ publicKey: {} }), { name: 'NotAllowedError' });
  assert.equal(await container.get({ password: true }), 'original-get');
  vm.runInContext('globalThis[Symbol.for("bitwarden-login.passkey-guard")]()', context);
  assert.equal(CredentialsContainer.prototype.get, original);
});

test('guard cleanup restores the document after a CDP session was detached', async () => {
  let restored = false;
  const page = {
    cdp: async () => { throw new Error('Script not found'); },
    evaluate: async () => { restored = true; },
  };
  await removePasskeyGuard(page, 'previous-session-id');
  assert.equal(restored, true);
  restored = false;
  page.cdp = async () => { throw new Error('user_control'); };
  await assert.rejects(removePasskeyGuard(page, 'id'), /user_control/);
  assert.equal(restored, false);
});

test('Google account rejection stops without attempting recovery or filling again', async () => {
  const itemId = '12345678-1234-1234-1234-123456789abc';
  const p = googlePlan({ spaceId: 1, username: 'alice@example.com', itemId });
  const page = {
    waitForFunction: async () => {},
    evaluate: async fn => { assert.equal(fn, observeState); return 'google_rejected'; },
  };
  const c = { ...credential(), uri: 'accounts.google.com', credential_id: itemId };
  assert.deepEqual(await runPlan(page, p, c), { ok: false, status: 'rejected', actions: 0 });
});

test('engine submits once, verifies account state and does not return secrets', async () => {
  let state = 'password', submissions = 0;
  const page = {
    waitForFunction: async () => {}, url: async () => 'https://example.com/login',
    evaluate: async (fn, args) => {
      if (fn === observeState) return state;
      assert.equal(fn, applyAction);
      assert.equal(args.fields[0].value, credential().password);
      submissions++; state = 'success'; return { ok: true };
    },
  };
  assert.deepEqual(await runPlan(page, plan(), credential()), { ok: true, status: 'success', actions: 1 });
  assert.equal(submissions, 1);
});

test('navigation to a foreign origin stops before credential submission', async () => {
  let writes = 0;
  const page = { waitForFunction: async () => {}, url: async () => 'https://evil.test/',
    evaluate: async fn => { if (fn === observeState) return 'password'; writes++; } };
  await assert.rejects(runPlan(page, plan(), credential()), { code: 'origin_changed' });
  assert.equal(writes, 0);
});

test('a failed transition does not submit the password a second time', async () => {
  let waits = 0, writes = 0;
  const page = { waitForFunction: async () => { if (++waits > 1) throw new Error('timeout'); },
    url: async () => 'https://example.com/login',
    evaluate: async fn => { if (fn === observeState) return 'password'; writes++; return { ok: true }; } };
  await assert.rejects(runPlan(page, plan(), credential()), { code: 'unrecognized_page' });
  assert.equal(writes, 1);
});
