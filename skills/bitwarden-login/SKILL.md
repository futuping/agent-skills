---
name: bitwarden-login
description: Sign in to a user-authorized website in background ego lite, using the unlocked Bitwarden browser extension first and official Agent Access as fallback. Keeps passwords and TOTP out of model output and the system clipboard. Use for existing accounts, not account creation or credential changes.
---

# Bitwarden website login

Use this order: **existing website session → Bitwarden extension → Agent Access**.
Reuse a suitable authenticated session unless the user requests a fresh login;
distinguish session reuse from newly verified authentication. Both credential
routes must keep ego in the background. Report which route actually ran.

Read the installed `ego-browser` skill once. Keep its task-space lifecycle and
user-control rules. The execution adapter requires ego-browser API v2, Node.js
24, and an existing agent-owned task space. It never claims user-owned pages.

## Prepare once

1. Resolve the website, intended account, and exact HTTPS sign-in origin from
   the user and current page. Reuse observations and the existing task space.
   Prefer an exact Bitwarden item ID when several logins share a domain. An
   email match alone does not identify the right website credential.
2. For background operation, call `prepareBackground(task, page)` from
   `scripts/background.mjs` **before navigating to the sign-in flow**. It
   preserves user windows and installs a tab-local WebAuthn cancellation hook.
   It may minimize only a normal window containing exclusively this task's
   agent-created tabs, and only when ego is not the foreground app. While the
   user is using ego, or window ownership/activity is unclear, leave window
   state alone and use background DOM interaction. Never hide the entire app,
   minimize a shared window, or exit full screen to hide a task.
   Carry its returned identifier into the login plan as `guardIdentifier`
   so the executor removes the hook on completion. If login is abandoned before
   running the executor, remove it with `removePasskeyGuard` or close the
   agent-created page.
3. When the user authorizes suppressing Bitwarden passkey popouts, turn off
   **Settings → Notifications → Ask to save and use passkeys** in ego’s extension
   UI once. Verify the checkbox state. This preserves saved passkeys; it does
   not approve their use or satisfy authentication. Also use the tab-local
   cancellation hook because disabling the extension prompt alone may leave
   browser/OS WebAuthn prompts. Keep Search and other browser settings alone.

## Primary: unlocked browser extension

Read [the background extension workflow](references/browser-extension.md).
Use one temporary extension page, select the exact item using metadata, and
run `scripts/extension.mjs` inside ego's embedded Node runtime. It captures the
selected item's Copy button result in local memory and fills the intended form
through DOM interaction. It never invokes native paste, focuses ego, or writes
to the system clipboard. It closes the temporary extension page after use.

An already unlocked extension needs no Agent Access provider, CLI unlock,
pairing, or terminal approval. Do not start those as extension prerequisites.
Do not replace this adapter with Cmd+V, `keyboard.paste`, a browser autofill
shortcut, or a foreground popup: those paths are not verified as silent.

## Fallback: Agent Access

Use [Agent Access setup and execution](references/agent-access.md) if the
extension is absent, locked, or cannot provide a supported silent copy. A
runner failure allows this switch only when `fallbackAllowed` is true. Reuse
the same page and plan; do not restart the website login. An identity/origin
mismatch, rejected credential, unknown website step, user takeover, or a
possible password/code submission is a stop, not a reason to retry another
route.

Use the locked Nix `login` shell and reuse the single paired provider. The
fallback uses the same window-preserving preparation and DOM filling, and avoids
the clipboard.
Never open/activate Terminal or Warp automatically. If unlock, pairing, or
approval is required, explain the one necessary action in chat and wait for
the user; do not repeatedly restart providers or send approval requests.
Keep master passwords and session keys in the user's own terminal. European
vaults require `--region eu`; an unlocked extension is independent of CLI state.

## Shared execution and completion

Build the [login plan](references/login-plan.md) from observed controls. Keep
personal accounts, item IDs and session identifiers outside the repository.
Both routes check account/item/HTTPS origin, limit actions and credential
submissions, and stop on unknown steps. Never print raw browser/provider
errors, filled forms, vault details or TOTP seeds. Credentials must not become
script source, command arguments, tool output or plaintext files.

`success` requires an account-specific page signal. After success, finish the
task once with `finish({keep: []})` for background-only login; normal website
cookies remain available. On `cleanup_required`, remove remaining guards while
control permits before proceeding. Hand off only when the user must act in the
browser; never solve a CAPTCHA or approve biometric/device prompts.

## Background limits

Background login means operating agent pages without changing the user's
foreground app or hiding their ego windows. Keep an already minimized task
window minimized; do not force the app out of view while the user is browsing.
There is no documented headless task-space creation switch: first launch or a
new task window may still appear. Preserve whichever app is in front; do not
hide ego, repeatedly activate Search, or fight the user for focus. Full-screen
and maximized windows are preserved to avoid disturbing macOS Spaces. The
helper checks ownership/activity again before minimizing an eligible window;
if discovery fails, it stops without changing window state.
The adapter cannot silently approve provider access, unlock a vault, complete
biometrics, or solve a CAPTCHA. Those steps require the user. If a website only
supports a passkey, stop instead of manufacturing an assertion or bypassing it.

The extension memory-transfer adapter is maintained by this repository and is
not an official Bitwarden headless integration. The fallback uses
[official Agent Access](https://github.com/bitwarden/agent-access), an early
preview, with a local browser adapter. Neither guarantees fixed login time. Website
credentials stay out of model output; they still exist briefly in trusted local
process memory and in the intended website’s form. Agent Access itself stores
pairing identities/connections locally.
