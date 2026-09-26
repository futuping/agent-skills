import { fail, originOf, safeFailure, validatePlan } from './core.mjs';
import { runWithValues } from './engine.mjs';
import { prepareBackground, removePasskeyGuard } from './background.mjs';

// Page-side metadata only. Do not return Password, TOTP, Notes, or page text.
export function extensionMetadata({ extensionId }) {
  if (location.protocol !== 'chrome-extension:' || location.hostname !== extensionId) {
    return { ok: false, status: 'extension_origin_mismatch' };
  }
  if (!location.hash.startsWith('#/view-cipher?')) {
    return { ok: false, status: 'extension_item_not_open' };
  }
  const usernames = document.querySelectorAll('#userName');
  if (usernames.length !== 1) return { ok: false, status: 'extension_locked_or_unavailable' };
  const uris = [...document.querySelectorAll('label')]
    .filter(el => el.textContent.trim() === 'Website')
    .map(el => document.getElementById(el.htmlFor)?.value).filter(Boolean);
  return {
    ok: true, username: usernames[0].value, uris,
    version: globalThis.chrome?.runtime?.getManifest?.().version,
    itemId: new URLSearchParams(location.hash.split('?')[1]).get('cipherId'),
  };
}

export function validateExtensionItem(plan, metadata) {
  if (!metadata?.ok) fail(metadata?.status || 'extension_unavailable');
  if (metadata.version !== '2026.9.2') fail('extension_version_unsupported');
  if (metadata.username !== plan.username) fail('account_mismatch');
  if (metadata.itemId !== plan.query.id) fail('item_mismatch');
  if (!metadata.uris.some(uri => {
    try { return originOf(uri) === plan.origin; } catch { return false; }
  })) fail('credential_origin_mismatch');
}

// This function returns a secret ONLY to ego's embedded local Node process.
// Never console.log it, call it as a model-facing tool, or snapshot its page.
// The temporary extension page MUST be closed after use, even on failure.
export async function captureExtensionValue({ extensionId, itemId, username, origin, source }) {
  const error = status => ({ ok: false, status });
  const verify = () => {
    if (location.protocol !== 'chrome-extension:' || location.hostname !== extensionId) return 'extension_origin_mismatch';
    // A different build could move copying into an unhooked background worker.
    // Verify new versions before adding them, rather than probing with secrets.
    if (globalThis.chrome?.runtime?.getManifest?.().version !== '2026.9.2') return 'extension_version_unsupported';
    if (!location.hash.startsWith('#/view-cipher?') ||
        new URLSearchParams(location.hash.split('?')[1]).get('cipherId') !== itemId) return 'item_mismatch';
    const names = document.querySelectorAll('#userName');
    if (names.length !== 1) return 'extension_locked_or_unavailable';
    if (names[0].value !== username) return 'account_mismatch';
    const matched = [...document.querySelectorAll('label')].filter(el => el.textContent.trim() === 'Website').some(el => {
      const uri = document.getElementById(el.htmlFor)?.value;
      if (!uri || /\s/.test(uri)) return false;
      try {
        const url = new URL(uri.includes('://') ? uri : `https://${uri}`);
        return url.protocol === 'https:' && !url.username && !url.password && url.origin === origin;
      } catch { return false; }
    });
    return matched ? null : 'credential_origin_mismatch';
  };
  let mismatch = verify();
  if (mismatch) return error(mismatch);
  if (!['password', 'totp'].includes(source)) return error('extension_copy_unavailable');

  if (source === 'totp') {
    // Read the extension's displayed countdown, never its TOTP seed or input.
    const remaining = () => {
      const root = document.querySelector('#totp')?.closest('bit-form-field');
      const spans = [...(root?.querySelectorAll('span.tw-absolute') || [])]
        .filter(el => el.children.length === 0 && /^\d{1,3}$/.test(el.textContent.trim()));
      return spans.length === 1 ? Number(spans[0].textContent.trim()) : null;
    };
    let seconds = remaining();
    if (seconds === null) return error('extension_totp_timer_unavailable');
    if (seconds <= 5) {
      await new Promise(resolve => setTimeout(resolve, (seconds + 1) * 1000));
      seconds = remaining();
      if (seconds === null || seconds <= 5) return error('extension_totp_timer_unavailable');
    }
    mismatch = verify();
    if (mismatch) return error(mismatch);
  }

  const selector = source === 'password' ? 'button[aria-label="Copy password"]' :
    'button[aria-label="Copy verification code"]';
  const buttons = [...document.querySelectorAll(selector)].filter(el =>
    el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.disabled);
  if (buttons.length !== 1) return error('extension_copy_unavailable');

  const key = Symbol.for('bitwarden-login.quiet-copy');
  if (!globalThis[key]) {
    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') return error('extension_copy_unavailable');
    const changes = [], state = { pending: null };
    const patch = (object, name, value) => {
      changes.push([object, name, Object.getOwnPropertyDescriptor(object, name)]);
      Object.defineProperty(object, name, { configurable: true, value });
    };
    // Do not resolve the extension's write promise: its post-copy callback
    // schedules a background clipboard clear containing the copied secret.
    // The local capture resolves independently. Closing this isolated page
    // destroys these pending promises and cancels late copy continuations.
    const suspended = () => new Promise(() => {});
    try {
      patch(clipboard, 'writeText', value => {
        state.pending?.(typeof value === 'string' ? value : '');
        return suspended();
      });
      for (const method of ['write', 'read', 'readText']) patch(clipboard, method, suspended);
      const execCommand = document.execCommand;
      patch(document, 'execCommand', function(command, ...args) {
        if (['copy', 'cut', 'paste'].includes(String(command).toLowerCase())) return false;
        return execCommand.call(this, command, ...args);
      });
      Object.defineProperty(globalThis, key, { configurable: true, value: state });
    } catch {
      for (const [object, name, descriptor] of changes.reverse()) {
        if (descriptor) Object.defineProperty(object, name, descriptor);
        else delete object[name];
      }
      return error('extension_copy_unavailable');
    }
  }
  const state = globalThis[key];
  if (state.pending) return error('extension_copy_busy');
  return new Promise(resolve => {
    const finish = result => { clearTimeout(timer); state.pending = null; resolve(result); };
    const timer = setTimeout(() => finish(error('extension_copy_timeout')), 4000);
    state.pending = value => {
      if (!value || (source === 'totp' && !/^\d{6,8}$/.test(value))) finish(error('extension_copy_invalid'));
      else finish({ ok: true, value });
    };
    try { buttons[0].click(); } catch { finish(error('extension_copy_unavailable')); }
  });
}

// A route change is safe only before a password/code could have been submitted.
const unavailable = new Set(['extension_unavailable', 'extension_item_not_open',
  'extension_version_unsupported',
  'extension_locked_or_unavailable', 'extension_copy_unavailable',
  'extension_copy_timeout', 'extension_totp_timer_unavailable']);

export async function runExtensionLogin(task, plan, { vaultPageLabel, extensionId }) {
  let page, vault, guard, result, submitted = false;
  try {
    validatePlan(plan);
    if (!plan.query.id || !/^[a-p]{32}$/.test(extensionId) ||
        !/^p\d+$/.test(vaultPageLabel) || vaultPageLabel === plan.pageLabel ||
        task.spaceId !== plan.spaceId) fail('invalid_plan');
    const tab = (await task.tabs()).find(t => t.label === vaultPageLabel);
    if (!tab || tab.openedBy !== 'agent') fail('extension_page_not_owned');
    vault = task.page(vaultPageLabel);
    page = task.page(plan.pageLabel);
    guard = await prepareBackground(task, page, plan.guardIdentifier);
    validateExtensionItem(plan, await vault.evaluate(extensionMetadata, { extensionId }));
    result = await runWithValues(page, plan, async source => {
      if (source === 'username') return plan.username;
      let captured;
      try {
        captured = await vault.evaluate(captureExtensionValue, { extensionId,
          itemId: plan.query.id, username: plan.username, origin: plan.origin, source });
        if (!captured?.ok) fail(captured?.status || 'extension_copy_unavailable');
        return captured.value;
      } finally { if (captured) captured.value = ''; }
    }, () => { submitted = true; });
  } catch (error) {
    result = { ...safeFailure(error), fallbackAllowed: !submitted && unavailable.has(error?.code) };
  } finally {
    // Do not restore a live tab's clipboard APIs: a timed-out copy/reprompt
    // might otherwise write to the user's clipboard after we returned.
    if (vault) {
      try { await vault.close(); }
      catch { result = { ok: false, status: 'cleanup_required', loginStatus: result?.status, fallbackAllowed: false }; }
    }
    if (guard) {
      try { await removePasskeyGuard(page, guard); }
      catch { result = { ok: false, status: 'cleanup_required', loginStatus: result?.status, fallbackAllowed: false }; }
    }
  }
  return { ...result, route: 'extension' };
}
