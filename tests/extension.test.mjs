import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { captureExtensionValue, validateExtensionItem } from '../skills/bitwarden-login/scripts/extension.mjs';
import { LoginError } from '../skills/bitwarden-login/scripts/core.mjs';
import { runWithValues, observeState } from '../skills/bitwarden-login/scripts/engine.mjs';

const itemId = '00000000-0000-0000-0000-000000000001';
const extensionId = 'a'.repeat(32);
const args = { extensionId, itemId, username: 'alice@example.com', origin: 'https://example.com', source: 'password' };
const plan = { version: 1, spaceId: 1, pageLabel: 'p1', query: { id: itemId },
  username: args.username, origin: args.origin, states: [
    { name: 'password', match: { origin: args.origin, selector: '#password' },
      fill: [{ source: 'password', selector: '#password' }], click: { selector: '#next' } },
    { name: 'success', match: { origin: args.origin, selector: '#account', text: '$username' }, result: 'success' },
  ] };

function extensionPage({ uri = 'example.com', username = args.username, host = extensionId,
  id = itemId, version = '2026.9.2', copy, timeout = false } = {}) {
  const metrics = { osWrites: 0, osReads: 0, legacyCopies: 0, clicks: 0, clipboardClearCallbacks: 0 };
  const clipboard = {
    writeText: async () => { metrics.osWrites++; }, write: async () => { metrics.osWrites++; },
    readText: async () => { metrics.osReads++; return 'private-user-clipboard'; },
    read: async () => { metrics.osReads++; },
  };
  const button = { disabled: false, getClientRects: () => [{}], click() {
    metrics.clicks++;
    if (copy) return copy(clipboard, context.document);
    clipboard.writeText('public-canary').then(() => { metrics.clipboardClearCallbacks++; });
  } };
  const document = {
    querySelectorAll: selector => selector === '#userName' ? [{ value: username }] :
      selector === 'label' ? [{ textContent: 'Website', htmlFor: 'uri' }] :
      selector.startsWith('button[') ? [button] : [],
    getElementById: () => ({ value: uri }),
    querySelector: () => ({ closest: () => ({ querySelectorAll: () => [{ children: [], textContent: '25' }] }) }),
    execCommand: () => { metrics.legacyCopies++; return true; },
  };
  const context = vm.createContext({ document, navigator: { clipboard }, URL, URLSearchParams,
    chrome: { runtime: { getManifest: () => ({ version }) } },
    location: { protocol: 'chrome-extension:', hostname: host, hash: `#/view-cipher?cipherId=${id}` },
    getComputedStyle: () => ({ visibility: 'visible' }),
    setTimeout: timeout ? fn => setTimeout(fn, 5) : setTimeout, clearTimeout,
  });
  return { context, clipboard, metrics, capture: options => vm.runInContext(
    `(${captureExtensionValue.toString()})(${JSON.stringify({ ...args, ...options })})`, context) };
}

test('extension metadata binds the exact item, username and HTTPS origin', () => {
  const valid = { ok: true, itemId, version: '2026.9.2', username: args.username, uris: ['accounts.other.test', 'example.com/login'] };
  validateExtensionItem(plan, valid);
  for (const change of [{ itemId: 'other' }, { username: 'bob@example.com' },
    { uris: ['https://example.com.evil.test'] }, { uris: ['https://example.com@evil.test'] },
    { uris: ['http://example.com'] }]) assert.throws(() => validateExtensionItem(plan, { ...valid, ...change }));
});

test('copy reaches only local memory and does not trigger clipboard clear callbacks', async () => {
  const page = extensionPage();
  const result = await page.capture();
  assert.equal(result.value, 'public-canary');
  assert.equal(result.ok, true);
  await Promise.resolve();
  assert.deepEqual(page.metrics, { osWrites: 0, osReads: 0, legacyCopies: 0, clicks: 1, clipboardClearCallbacks: 0 });
  // Suppress unsupported clipboard APIs for the entire isolated page lifetime.
  page.clipboard.write([]); page.clipboard.readText(); page.clipboard.read();
  assert.equal(page.context.document.execCommand('copy'), false);
  assert.equal(page.metrics.osWrites + page.metrics.osReads + page.metrics.legacyCopies, 0);
});

test('mismatched item, account, extension or URI prevents even a copy click', async () => {
  for (const option of [{ username: 'bob@example.com' }, { host: 'b'.repeat(32) },
    { id: 'other' }, { uri: 'https://example.com.evil.test' }, { version: 'unverified-build' }]) {
    const page = extensionPage(option);
    const result = await page.capture();
    assert.equal(result.ok, false);
    assert.equal(page.metrics.clicks, 0);
    assert.equal(page.metrics.osWrites, 0);
  }
});

test('timeout suppresses late copies and legacy copying without returning a stale value', async () => {
  const page = extensionPage({ timeout: true, copy: (_clipboard, document) => document.execCommand('copy') });
  const result = await page.capture();
  assert.equal(result.status, 'extension_copy_timeout');
  assert.equal('value' in result, false);
  page.clipboard.writeText('late-public-canary');
  assert.equal(page.metrics.osWrites + page.metrics.legacyCopies, 0);
});

test('TOTP accepts only a code and refuses a missing countdown without copying', async () => {
  const page = extensionPage({ copy: clipboard => clipboard.writeText('123456') });
  assert.equal((await page.capture({ source: 'totp' })).value, '123456');
  const invalid = extensionPage();
  assert.equal((await invalid.capture({ source: 'totp' })).status, 'extension_copy_invalid');
  const missing = extensionPage();
  missing.context.document.querySelector = () => null;
  assert.equal((await missing.capture({ source: 'totp' })).status, 'extension_totp_timer_unavailable');
  assert.equal(missing.metrics.clicks, 0);
});

test('an unavailable clipboard hook fails before invoking the copy control', async () => {
  const page = extensionPage();
  Object.defineProperty(page.clipboard, 'writeText', { value: page.clipboard.writeText, configurable: false });
  assert.equal((await page.capture()).status, 'extension_copy_unavailable');
  assert.equal(page.metrics.clicks, 0);
});

test('value supplier failure never dispatches a form action', async () => {
  let submissions = 0, writes = 0;
  const page = { waitForFunction: async () => {}, url: async () => 'https://example.com/login',
    evaluate: async fn => { if (fn === observeState) return 'password'; writes++; } };
  await assert.rejects(runWithValues(page, plan, async () => {
    throw new LoginError('extension_copy_timeout');
  }, () => { submissions++; }), { code: 'extension_copy_timeout' });
  assert.equal(submissions + writes, 0);
});

test('mark a credential submission before a transport error, preventing an unsafe route retry', async () => {
  let submissions = 0;
  const page = { waitForFunction: async () => {}, url: async () => 'https://example.com/login',
    evaluate: async fn => { if (fn === observeState) return 'password'; throw new Error('transport error'); } };
  await assert.rejects(runWithValues(page, plan, async () => 'public-canary',
    () => { submissions++; }), { code: 'interaction_failed' });
  assert.equal(submissions, 1);
});
