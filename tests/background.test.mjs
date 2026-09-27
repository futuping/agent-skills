import test from 'node:test';
import assert from 'node:assert/strict';
import { minimizeTaskWindow, prepareBackground, removePasskeyGuard } from '../skills/bitwarden-login/scripts/background.mjs';

function fixture({ state = 'normal', shared = false, owned = true, ownership = 'agent' } = {}) {
  const calls = [];
  const tabs = [{ label: 'p1', targetId: 'login', openedBy: owned ? 'agent' : 'unknown' },
    { label: 'p2', targetId: 'vault', openedBy: 'agent' }];
  const targets = [{ targetId: 'login', type: 'page' }, { targetId: 'vault', type: 'page' },
    { targetId: 'personal', type: 'page' }, { targetId: 'worker', type: 'service_worker' }];
  const windows = new Map([['login', 1], ['vault', 1], ['personal', shared ? 1 : 2]]);
  const task = { ownership, tabs: async () => tabs,
    cdp: async (method, args) => {
      calls.push({ method, args });
      if (method === 'Browser.getWindowForTarget') {
        assert.notEqual(args.targetId, 'worker');
        return { windowId: windows.get(args.targetId), bounds: { windowState: state } };
      }
      if (method === 'Target.getTargets') return { targetInfos: targets };
      assert.equal(method, 'Browser.setWindowBounds');
      return {};
    },
  };
  const page = { label: 'p1', cdp: async (method, args) => {
    calls.push({ method, args }); return { identifier: 'fresh-guard' };
  }, evaluate: async () => { calls.push({ method: 'evaluate' }); } };
  return { task, page, calls, tabs, targets, windows,
    writes: () => calls.filter(c => c.method === 'Browser.setWindowBounds') };
}

test('foreground or unknown ego activity never changes a window', async () => {
  for (const active of [true, null, undefined]) {
    const f = fixture();
    assert.equal((await minimizeTaskWindow(f.task, f.page, () => active)).action, 'preserved');
    assert.equal(f.calls.length, 0);
  }
});

test('only an exclusive task window is minimized; user windows are untouched', async () => {
  const f = fixture();
  assert.equal((await minimizeTaskWindow(f.task, f.page, () => false)).action, 'minimized');
  assert.deepEqual(f.writes(), [{ method: 'Browser.setWindowBounds',
    args: { windowId: 1, bounds: { windowState: 'minimized' } } }]);
});

test('a shared window or another agent task is never minimized', async () => {
  for (const label of ['personal', 'other-agent-task']) {
    const f = fixture({ shared: true });
    f.targets.find(t => t.targetId === 'personal').targetId = label;
    f.windows.set(label, 1);
    assert.equal((await minimizeTaskWindow(f.task, f.page, () => false)).reason, 'shared_window');
    assert.equal(f.writes().length, 0);
  }
});

test('full-screen, maximized, minimized and unknown window states are preserved', async () => {
  for (const state of ['fullscreen', 'maximized', 'minimized', 'unknown']) {
    const f = fixture({ state });
    assert.equal((await minimizeTaskWindow(f.task, f.page, () => false)).action, 'preserved');
    assert.equal(f.writes().length, 0);
  }
});

test('ego foregrounding during discovery cancels minimization', async () => {
  const f = fixture(); let reads = 0;
  assert.equal((await minimizeTaskWindow(f.task, f.page, () => ++reads > 1)).action, 'preserved');
  assert.equal(f.writes().length, 0);
});

test('ownership changes and new tabs during discovery cancel minimization', async () => {
  for (const change of ['owner', 'new-tab', 'window']) {
    const f = fixture(); let reads = 0;
    f.task.tabs = async () => {
      if (++reads === 2) {
        if (change === 'owner') f.tabs[0].openedBy = 'unknown';
        if (change === 'new-tab') f.targets.push({ targetId: 'new-user-tab', type: 'page' });
        if (change === 'window') f.windows.set('login', 2);
      }
      return f.tabs;
    };
    assert.equal((await minimizeTaskWindow(f.task, f.page, () => false)).action, 'preserved');
    assert.equal(f.writes().length, 0);
  }
});

test('missing target metadata never authorizes minimization', async () => {
  const f = fixture(); f.targets.splice(0, 1);
  assert.equal((await minimizeTaskWindow(f.task, f.page, () => false)).reason, 'ownership_unverified');
  assert.equal(f.writes().length, 0);
});

test('user-control or metadata errors stop without window changes', async () => {
  for (const message of ['user_control', 'window metadata unavailable']) {
    const f = fixture(); const cdp = f.task.cdp;
    f.task.cdp = async (method, args) => {
      if (args?.targetId === 'personal') throw new Error(message);
      return cdp(method, args);
    };
    await assert.rejects(minimizeTaskWindow(f.task, f.page, () => false), { message });
    assert.equal(f.writes().length, 0);
  }
});

test('a user-owned task or page is rejected before OS/window operations', async () => {
  for (const options of [{ ownership: 'user' }, { owned: false }]) {
    const f = fixture(options);
    await assert.rejects(minimizeTaskWindow(f.task, f.page, () => {
      assert.fail('foreground detection should not run');
    }), { code: 'page_not_owned' });
    assert.equal(f.calls.length, 0);
  }
});

test('preserving a window still installs and cleans up the passkey guard', async () => {
  const f = fixture({ state: 'fullscreen' });
  const guard = await prepareBackground(f.task, f.page);
  assert.equal(guard, 'fresh-guard');
  assert.equal(f.writes().length, 0);
  assert.equal(f.calls.filter(c => c.method === 'Page.addScriptToEvaluateOnNewDocument').length, 1);
  await removePasskeyGuard(f.page, guard);
  assert.equal(f.calls.filter(c => c.method === 'Page.removeScriptToEvaluateOnNewDocument').length, 1);
});
