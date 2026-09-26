import { execFileSync } from 'node:child_process';

export const passkeyGuardSource = `(() => {
  const key = Symbol.for('bitwarden-login.passkey-guard');
  if (globalThis[key] || !globalThis.CredentialsContainer) return;
  const proto = CredentialsContainer.prototype;
  const saved = [];
  for (const method of ['get', 'create']) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, method);
    if (!descriptor || typeof descriptor.value !== 'function') continue;
    const original = descriptor.value;
    const replacement = function(options) {
      if (options && options.publicKey) {
        return Promise.reject(new DOMException('Passkey interaction cancelled for this automation tab', 'NotAllowedError'));
      }
      return original.apply(this, arguments);
    };
    Object.defineProperty(proto, method, { ...descriptor, value: replacement });
    saved.push([method, descriptor, replacement]);
  }
  Object.defineProperty(globalThis, key, { configurable: true, value: () => {
    for (const [method, descriptor, replacement] of saved) {
      if (proto[method] === replacement) Object.defineProperty(proto, method, descriptor);
    }
    delete globalThis[key];
  }});
})()`;

async function removeRegistration(page, identifier) {
  if (!identifier) return;
  try { await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier }); }
  catch (error) {
    // ego may detach the CDP session between CLI rounds. Its registration is
    // then gone even though the wrapper remains in the current document.
    if (error?.message !== 'Script not found') throw error;
  }
}

export async function prepareBackground(task, page, existingIdentifier) {
  const tab = (await task.tabs()).find(t => t.label === page.label);
  if (!tab) throw new Error('page_missing');
  const { windowId } = await task.cdp('Browser.getWindowForTarget', { targetId: tab.targetId });
  await task.cdp('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
  if (process.platform === 'darwin') {
    // AppKit hides only ego; it neither clicks permission dialogs nor activates Search.
    execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e',
      'ObjC.import("AppKit"); const a=$.NSRunningApplication.runningApplicationsWithBundleIdentifier("com.citrolabs.ego.lite"); for(let i=0;i<a.count;i++) a.objectAtIndex(i).hide;'],
      { stdio: 'ignore', timeout: 5000 });
  }
  await removeRegistration(page, existingIdentifier);
  // Register in this execution round; an identifier from preparation may refer
  // to a detached session and cannot protect the next navigation.
  const { identifier } = await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: passkeyGuardSource });
  try { await page.evaluate(passkeyGuardSource); }
  catch (error) {
    await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    throw error;
  }
  return identifier;
}

export async function removePasskeyGuard(page, identifier) {
  await removeRegistration(page, identifier);
  await page.evaluate(() => globalThis[Symbol.for('bitwarden-login.passkey-guard')]?.());
}
