# Primary route: background Bitwarden extension

Use the already unlocked extension before Agent Access. Reuse a suitable website
session first unless a fresh login is requested. This route needs no `bw`, `aac`,
provider terminal or approval cache.

## Select one item

Keep one temporary **agent-created** extension page in the same task space as
the sign-in page. Preserve the user's windows: while ego is foreground, do not
hide or minimize anything to simulate background execution. Both routes use
the shared window checks in `prepareBackground`. Discover the enabled extension from
`chrome://extensions/`, or reuse its verified ID. The observed Chrome Web Store
ID is `nngceckbapebfimnlniiiahkandclblb`; version 2026.9.2 exposes:

```text
chrome-extension://<observed-extension-id>/popup/index.html
```

The extension may resume an item detail view. Use its observed Back control to
return to the vault. Search with `input[name="searchText"]`, then wait for the
specific desired result; the first rendered row does not mean search has
finished. Item view controls have labels such as
`View item - Example - user@example.com`. DOM input/change events and button
clicks work without bringing ego forward.

Open the exact item and wait for `#/view-cipher?cipherId=…` and `#userName`.
Read only the selected item's username, Website fields and item ID with
`extensionMetadata` from `scripts/extension.mjs`. An email alone is insufficient:
the same account may have unrelated website entries. Do not dump the vault or
snapshot item details: they can include a visible TOTP. Do not reveal password
fields, notes or seeds. If the extension is locked or asks for a master-password
reprompt, use the fallback or ask the user; never bypass that prompt.

The route and English control labels are extension implementation details.
The helper checks manifest version 2026.9.2 before invoking any copy control:
a different build could move copying into a background worker outside the hook.
Unexpected layout/language/version changes require inspection or fallback;
do not guess selectors or grant extra extension/clipboard permissions.

## Execute once

Build the shared [login plan](login-plan.md) with an **exact item ID**. Prepare
background/passkey protection before navigation as described in `SKILL.md`.
Then run this inside one `ego-browser nodejs` invocation, adapting the public
task/page identifiers and actual checkout path:

```js
const { homedir } = await import('node:os');
const { readFile } = await import('node:fs/promises');
const { pathToFileURL } = await import('node:url');
const root = homedir() + '/agent-skills/skills/bitwarden-login/';
const { runExtensionLogin } = await import(pathToFileURL(root + 'scripts/extension.mjs'));
const plan = JSON.parse(await readFile(homedir() + '/.cache/bitwarden-login/plan.json', 'utf8'));
const task = await taskSpace(plan.spaceId);
const result = await runExtensionLogin(task, plan, {
  vaultPageLabel: 'p2', // The agent-created page holding the selected item.
  extensionId: 'nngceckbapebfimnlniiiahkandclblb', // Verify installed ID first.
});
console.log(result); // Status only; no credential object.
if (result.ok) await task.finish({ keep: [] });
```

The helper verifies the selected item, username and HTTPS URI. Before each
copy, it rechecks that metadata. Before each fill, the shared engine checks the
website origin. It invokes the item's existing **Copy password** / **Copy
verification code** controls. A tab-local clipboard API hook delivers their
values directly to ego's local Node process, then to the intended DOM input.
No native keyboard action, system clipboard write/read or foreground popup is
used. TOTP is copied only when its displayed countdown has more than five
seconds left; the seed is never extracted.

The extension's clipboard write promise remains suspended in this isolated tab
so its post-copy callback cannot schedule a background clipboard-clear job.
The adapter also blocks legacy copy/paste and other clipboard API access in
that tab. It closes the tab in `finally`, even on timeout, to cancel delayed
copy/reprompt work. Do not operate or keep that temporary tab afterward. The
user's ordinary extension popup and persistent preferences are unchanged.

Only call `captureExtensionValue` inside the local execution program; its return
value is secret. Never print it, serialize it to a file, include it in generated
source, or expose it as a standalone tool result. `runExtensionLogin` returns
only a status, route and optional action count/fallback flag.

## When to use Agent Access

If the extension is absent or locked before execution, use
[Agent Access](agent-access.md) on the same login page. After an executor
failure, switch only when `fallbackAllowed: true`. That flag means the failure
was an unavailable extension copy path and no password/code could have been
submitted. Cleanup failure, identity/origin mismatch, website rejection,
unknown transitions and user takeover stop the workflow. Do not restart login
or blindly retry with the other route.

Do not fall back to Cmd+V, `keyboard.paste`, opening a floating extension popup,
or automatic browser shortcuts. Those may steal focus or copy TOTP to the
system clipboard. Do not enable global autofill-on-page-load to shorten this
flow. Official background approval/unlock prompts cannot be silently accepted;
if the Agent Access fallback needs attention, leave ego hidden and notify the
user in chat rather than opening a terminal.

## Verification scope

On 2026-09-26, real Copy password and Copy verification code controls in the
unlocked 2026.9.2 extension delivered the intended Google item's values through
the memory-only adapter. Output included only boolean validity results. The
macOS clipboard change count and foreground application stayed unchanged;
ego was not foregrounded.

A separate synthetic password-plus-TOTP form completed in two actions through
`runExtensionLogin`, reached an account-specific success state, closed its
extension tab, and finished its task space. Its test values were synthetic;
real website credentials were never sent to the fixture. Clipboard change
count and foreground application again stayed unchanged. This validates the
new transfer path and bounded form engine; it is not a new Google login test.
The prior Google test using native paste is not evidence of this route being
silent. Other websites and extension versions may require different selectors.

On 2026-09-27, the window-preservation regression ran a synthetic form login
and verified WebAuthn cancellation with two real ego windows present. Both
windows' bounds/state, application visibility and the foreground application
were unchanged. A simulated foreground-ego condition also skipped minimization;
the test did not activate ego or interrupt the user's app to reproduce it.
Unit tests cover foreground changes during discovery, shared/unowned windows,
full-screen preservation and unavailable ownership metadata.

[Bitwarden's autofill documentation](https://bitwarden.com/help/auto-fill-browser/)
describes its supported copy/autofill controls. This repository's memory hook
and ego adapter are custom integration code, not an official Bitwarden API.
