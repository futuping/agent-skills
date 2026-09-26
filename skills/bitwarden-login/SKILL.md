---
name: bitwarden-login
description: Sign in to a user-authorized website through official Bitwarden Agent Access and ego lite, keeping passwords and TOTP out of model output. Supports background password-plus-TOTP login and an explicitly selected browser-extension fallback. Use for existing accounts, not account creation or credential changes.
---

# Bitwarden website login

Use **Agent Access → local execution program → ego lite** as the primary path.
Do not silently substitute extension copying and report that Agent Access was
used. Reuse a suitable authenticated session when the user does not require a
fresh login; distinguish that from a newly verified authentication.

Read the installed `ego-browser` skill once. Keep its task-space lifecycle and
user-control rules. The execution adapter requires ego-browser API v2, Node.js
24, and an existing agent-owned task space. It never claims user-owned pages.

## Prepare once

1. Resolve the website, intended account, and exact HTTPS sign-in origin from
   the user and current page. Reuse observations and the existing task space.
   Prefer an exact Bitwarden item ID when several logins share a domain. An
   email match alone does not identify the right website credential.
2. Use the checkout’s locked Nix `login` shell for `aac`, `bw`, and Node. Read
   [Agent Access setup](references/agent-access.md) when the provider is not yet
   paired/unlocked. An unlocked extension is not an unlocked CLI. Keep the
   master password, pairing token, and session key in the user's own terminal.
   Use the user's vault region: pass `--region eu` for a European account.
   With no region argument, the provider preserves the CLI's configured server
   and displays it before login; do not assume the default US cloud is correct.
3. For background operation, call `prepareBackground(task, page)` from
   `scripts/background.mjs` **before navigating to the sign-in flow**. It
   minimizes ego’s task window and installs a tab-local WebAuthn cancellation
   hook. Carry its returned identifier into the login plan as `guardIdentifier`
   so the executor removes the hook on completion. If login is abandoned before
   running the executor, remove it with `removePasskeyGuard` or close the
   agent-created page.
4. When the user authorizes suppressing Bitwarden passkey popouts, turn off
   **Settings → Notifications → Ask to save and use passkeys** in ego’s extension
   UI once. Verify the checkbox state. This preserves saved passkeys; it does
   not approve their use or satisfy authentication. Also use the tab-local
   cancellation hook because disabling the extension prompt alone may leave
   browser/OS WebAuthn prompts. Keep Search and other browser settings alone.

## Execute the shortest verified flow

- Inspect the current page once and build a local, non-secret login plan from
  observed selectors and transitions. Keep personal usernames, item IDs, and
  session identifiers outside the repository. The plan schema and invocation
  are in [Agent Access usage](references/agent-access.md). `google-plan.mjs`
  provides the previously observed Google password/TOTP sequence; verify that
  its controls still match the current page before using it.
- Run `scripts/login.mjs` in the Nix login shell. It invokes official `aac run`
  with only the required credential fields. The adapter checks the saved URI,
  requested username and item ID before filling; every write also checks the
  current page origin. Its one-use local socket connects the injected child
  process to ego’s separate embedded runtime, whose environment does not inherit
  the calling shell’s variables. Credentials never become script source, CLI
  arguments, clipboard contents, model-facing tool values, or plaintext files.
- Let the bounded executor combine password submission, the website’s offered
  authenticator alternative, locally generated TOTP, and optional **Not now**
  choices. It uses DOM interaction without keyboard focus or clipboard access.
  It does not retry a rejected password/code, reset the login, change recovery
  settings, or sign out other accounts. Unknown steps return a status instead
  of guessing. Do not use account recovery to find an easier login page.
- The executor returns only a small status object. `success` requires an
  account-specific page signal, not merely a new URL. After success, finish the
  task once. For background-only login, `finish({keep: []})` closes the task’s
  pages while preserving the browser’s normal login cookies. Keep a result page
  only when the user needs it.
- On `agent_access_unavailable`, resolve the provider/pairing/approval issue;
  do not switch routes unnoticed. On `unrecognized_page`, `human_required`, or
  `cleanup_required`, inspect the minimum safe state, remove any remaining hook
  while control permits, and hand off when the user must act. Never print raw
  browser/provider errors, form values, vault details, or TOTP seeds.
- On `credential_lookup_failed`, check the selected item's metadata, vault
  sync and the single provider's session. Official 0.11.0 can report a lookup
  failure as not-found even when the cause is an invalid cached CLI session.
  This is not evidence of a rejected website password; no browser retry is
  needed until credential delivery works.

## Background limits and fallbacks

The supported goal is to keep ego minimized during ordinary page operations.
There is no documented headless task-space creation switch: first launch or a
new task window may appear briefly before minimization. Preserve whichever app
is in front; do not repeatedly activate Search or fight the user for focus.
The adapter cannot silently approve provider access, unlock a vault, complete
biometrics, or solve a CAPTCHA. Those steps require the user. If a website only
supports a passkey, stop instead of manufacturing an assertion or bypassing it.

If the user chooses extension autofill/copying, use
[the extension fallback](references/extension-fallback.md). Keep ego minimized
where possible and describe that route accurately. Do not promise that the
clipboard/native keyboard fallback is fully silent.

The workflow uses [official Agent Access](https://github.com/bitwarden/agent-access)
(an early preview) plus this repository’s browser adapter. It is not an official
Bitwarden browser integration or a guarantee of fixed login time. Website
credentials stay out of model output; they still exist briefly in trusted local
process memory and in the intended website’s form. Agent Access itself stores
pairing identities/connections locally.
