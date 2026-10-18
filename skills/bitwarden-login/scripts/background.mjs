import { execFileSync } from 'node:child_process';
import { fail } from './core.mjs';

function installPasskeyGuard(expiresAt) {
  const key = Symbol.for('bitwarden-login.passkey-guard');
  globalThis[key]?.();
  if (!globalThis.navigator?.credentials || Date.now() >= expiresAt) return;
  const credentials = navigator.credentials;
  const saved = [];
  let active = true, timer;
  const restore = () => {
    // Bound copies retained by the extension must also stop cancelling requests.
    active = false;
    clearTimeout(timer);
    for (const undo of saved) undo();
    if (globalThis[key] === restore) delete globalThis[key];
  };
  try {
    for (const method of ['get', 'create']) {
      const descriptor = Object.getOwnPropertyDescriptor(credentials, method);
      const original = credentials[method];
      if (typeof original !== 'function' || (descriptor &&
          (!descriptor.configurable || !descriptor.writable || !('value' in descriptor)))) {
        throw new Error('passkey_guard_unavailable');
      }
      const wrap = delegate => function(options) {
        if (active && Date.now() >= expiresAt) restore();
        if (active && options?.publicKey) {
          return Promise.reject(new DOMException('Passkey interaction cancelled for this automation tab', 'NotAllowedError'));
        }
        return Reflect.apply(delegate, this, arguments);
      };
      let delegate = original, guarded = wrap(original), assigned = false;
      const get = () => guarded;
      const set = value => {
        assigned = true;
        delegate = value;
        // Freeze this delegate: Bitwarden binds the previous method before
        // assigning its own handler, whose browser fallback calls that copy.
        guarded = typeof value === 'function' ? wrap(value) : value;
      };
      Object.defineProperty(credentials, method, {
        configurable: true, enumerable: descriptor?.enumerable ?? false, get, set,
      });
      saved.push(() => {
        const current = Object.getOwnPropertyDescriptor(credentials, method);
        if (current?.get !== get || current?.set !== set) return;
        if (assigned) Object.defineProperty(credentials, method, {
          configurable: true, enumerable: descriptor?.enumerable ?? true,
          writable: true, value: delegate,
        });
        else if (descriptor) Object.defineProperty(credentials, method, descriptor);
        else delete credentials[method];
      });
    }
    Object.defineProperty(globalThis, key, { configurable: true, value: restore });
    timer = setTimeout(restore, Math.max(0, expiresAt - Date.now()));
  } catch (error) {
    restore();
    throw error;
  }
}

// One absolute lease covers every navigation in this execution round. A killed
// runner must not leave an indefinite restriction on a page later used manually.
export function passkeyGuardSource(expiresAt = Date.now() + 300_000) {
  return `(${installPasskeyGuard})(${JSON.stringify(expiresAt)})`;
}

const restorePasskeySource = `globalThis[Symbol.for('bitwarden-login.passkey-guard')]?.()`;

async function removeRegistration(page, identifier) {
  if (!identifier) return;
  try { await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
  catch (error) {
    // ego may detach the CDP session between CLI rounds. Its registration is
    // then gone even though the wrapper remains in the current document.
    if (error?.message !== 'Script not found') throw error;
  }
}

function egoIsForeground() {
  if (process.platform !== 'darwin') return null;
  try {
    // Read-only: hiding NSRunningApplication hides ALL of the user's windows.
    return JSON.parse(execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e',
      'ObjC.import("AppKit"); JSON.stringify($.NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier.js === "com.citrolabs.ego.lite");'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim());
  } catch { return null; }
}

// Foreground detection can be injected for tests without activating real apps.
export async function minimizeTaskWindow(task, page, readForeground = egoIsForeground) {
  const tabs = await task.tabs();
  const tab = tabs.find(t => t.label === page.label);
  if (!tab) fail('page_missing');
  if (task.ownership !== 'agent' || tab.openedBy !== 'agent') fail('page_not_owned');
  const preserve = reason => ({ action: 'preserved', reason });
  // Unknown activity is not permission to move a window. Background DOM work
  // remains possible while the user browses another ego window.
  if (readForeground() !== false) return preserve('foreground_or_unknown');
  const window = await task.cdp('Browser.getWindowForTarget', { targetId: tab.targetId });
  if (window.bounds?.windowState !== 'normal') return preserve('window_state');

  const owned = new Set(tabs.filter(t => t.label && t.openedBy === 'agent').map(t => t.targetId));
  const { targetInfos } = await task.cdp('Target.getTargets');
  const targets = targetInfos.filter(t => t.type === 'page' || t.type === 'tab');
  if (!targets.some(t => t.targetId === tab.targetId)) return preserve('ownership_unverified');
  // Only window IDs are needed from other tabs; do not inspect their content,
  // activate them, or treat another agent's task as owned by this task.
  const mappings = await Promise.allSettled(targets.map(async target => ({
    targetId: target.targetId,
    windowId: (await task.cdp('Browser.getWindowForTarget', { targetId: target.targetId })).windowId,
  })));
  // Do not swallow a user-control/permission error or guess window ownership.
  const failure = mappings.find(mapping => mapping.status === 'rejected');
  if (failure) throw failure.reason;
  if (mappings.some(({ value }) => value.windowId === window.windowId && !owned.has(value.targetId))) {
    return preserve('shared_window');
  }

  // Recheck after discovery: the user can foreground ego or move the task tab.
  const currentTabs = await task.tabs();
  if (!currentTabs.some(t => t.label === page.label && t.targetId === tab.targetId && t.openedBy === 'agent')) {
    return preserve('ownership_changed');
  }
  const currentOwned = new Set(currentTabs.filter(t => t.label && t.openedBy === 'agent').map(t => t.targetId));
  if ([...owned].some(id => !currentOwned.has(id))) return preserve('ownership_changed');
  const latest = (await task.cdp('Target.getTargets')).targetInfos.filter(t => t.type === 'page' || t.type === 'tab');
  const previousTargets = new Set(targets.map(t => t.targetId));
  if (latest.length !== targets.length || latest.some(t => !previousTargets.has(t.targetId))) return preserve('tabs_changed');
  const current = await task.cdp('Browser.getWindowForTarget', { targetId: tab.targetId });
  if (current.windowId !== window.windowId || current.bounds?.windowState !== 'normal') return preserve('window_changed');
  if (readForeground() !== false) return preserve('foreground_or_unknown');
  await task.cdp('Browser.setWindowBounds', { windowId: window.windowId, bounds: { windowState: 'minimized' } });
  return { action: 'minimized' };
}

export async function prepareBackground(task, page, existingIdentifier) {
  await minimizeTaskWindow(task, page);
  await removeRegistration(page, existingIdentifier);
  // Register in this execution round; an identifier from preparation may refer
  // to a detached session and cannot protect the next navigation.
  const source = passkeyGuardSource();
  const { identifier } = await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source, runImmediately: true });
  try { await page.evaluate(source); }
  catch (error) {
    // runImmediately may already have wrapped the current page and frames even
    // when the following evaluation loses its context during navigation.
    try { await removePasskeyGuard(page, identifier); }
    catch { fail('cleanup_required'); }
    throw error;
  }
  return identifier;
}

export async function removePasskeyGuard(page, identifier) {
  await removeRegistration(page, identifier);
  // runImmediately also restores existing frame contexts in this Page session.
  const cleanup = await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: restorePasskeySource, runImmediately: true,
  });
  try { await page.evaluate(restorePasskeySource); }
  finally { await removeRegistration(page, cleanup.identifier); }
}

export async function handOffForPasskey(task, page, identifier) {
  await removePasskeyGuard(page, identifier);
  await task.handOff();
}
