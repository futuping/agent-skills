---
name: bitwarden-login
description: Sign in to a user-authorized website with an existing Bitwarden browser-extension login and, when configured, TOTP. Use for fast browser login with an unlocked vault while keeping secrets out of model output. Does not set up accounts, change credentials, or manage passkeys.
---

# Bitwarden website login

Complete the requested login using the existing Bitwarden extension. Reuse an
authenticated session when it already satisfies the request; perform a fresh
login only when requested or needed. This is a local browser workflow built on
official Bitwarden features, not an official Bitwarden agent integration.

## Start with the current state

- Read the installed `ego-browser` skill once and use its current API. Keep one
  task space for the login, resuming the existing space when applicable. If
  ego-browser is unavailable, report the missing prerequisite instead of
  installing tools or silently switching browsers.
- Reuse the user's requested website, account, profile, and current login step.
  Do not sign out other accounts, reset the flow, or switch to account recovery
  to obtain an easier page. An abandoned passkey flow can use the site's visible
  **Try another way** option to select password and authenticator code.
- Confirm the HTTPS origin is the intended website or its legitimate sign-in
  provider before filling. Check both the saved website URI and the requested
  username when selecting a Bitwarden item; matching an email alone is not
  sufficient. Do not override an origin/iframe warning or weaken URI matching.

## Choose the shortest reliable path

1. **Use native autofill when the correct item is identifiable.** Prefer an
   already-visible, account-specific Bitwarden suggestion. The default shortcut
   is `ControlOrMeta+Shift+L`; use it only when the intended item is unambiguous.
   Multiple matching logins use the last-used item, and repeating the shortcut
   cycles them. Do not blindly cycle accounts or use an ambiguous shortcut on a
   password-only page. Confirm the non-secret username when the form exposes it.
2. **Handle split forms at their existing steps.** Fill the known username
   directly if that saves opening the vault. Submit it once, then fill the
   password on the next step. Observe only where the next action depends on the
   result; combine known actions, an observable wait, and the final observation
   into one invocation. If native autofill has no effect, inspect once and use
   the fallback below instead of repeatedly trying shortcuts.
3. **Complete TOTP from the same item.** Use native TOTP autofill if available.
   When Bitwarden's existing settings copied TOTP automatically during autofill,
   paste it promptly only if its provenance is known. Otherwise copy a fresh
   verification code from the selected item. Fetch it when the TOTP field is
   ready, then paste and submit in the same invocation. Never output the code or
   its seed. A site reporting an expired code permits one fresh-code retry;
   stop for other failures or a second rejection.
4. **Skip optional enrollment.** Use a visible **Not now** or **Skip** choice for
   optional recovery, selfie, or passkey setup shown after authentication. A
   mandatory verification step instead needs its legitimate completion; do not
   treat an enrollment offer or a changed URL alone as login success.
5. **Stop on one clear success signal.** A successful authentication message or
   the intended account's signed-in page is sufficient. Wait for an observed
   page element or known URL transition, not a guessed phrase in body text.
   Finish the task space once, retaining only the result page the user needs.
   Report whether a fresh
   login or session reuse succeeded and identify any user intervention.

For inaccessible autofill UI, read [the extension fallback](references/extension-fallback.md).
Skip it when native autofill succeeds.

## Keep credentials out of recorded context

- Let Bitwarden autofill, or transfer through its **Copy password** / **Copy
  verification code** controls and the browser's native paste shortcut. Do not
  read clipboard contents into the model, use a secret as a tool argument, or
  print password/TOTP input values. Verify only booleans such as `filled`.
- Avoid vault detail snapshots, screenshots, full-page text extraction, and
  network/console dumps: they can contain TOTP, notes, or credentials even when
  the password is masked. Observe only the metadata needed to select the item
  and the specific controls needed to act.
- Clear copied secrets from the clipboard after use, including failure paths.
  If autofill copied TOTP for the next step, paste it promptly and clear it, or
  discard it and copy a fresh code when the field is ready. Do not restore a
  copied secret from a clipboard backup. Do not export the
  vault, read extension storage, or use internal decryption/message APIs.
- Use the existing setup. Login authorization does not authorize editing vault
  items, disabling protections, enabling autofill on page load, installing
  Agent Access/MCP, or changing browser-wide settings.
- If the vault needs unlocking, a CAPTCHA appears, or a browser-owned/biometric
  prompt needs the user, hand off through ego-browser. State the exact pending
  action; resume the same space after confirmation. Do not solve or bypass a
  CAPTCHA, repeatedly restart login, or claim success while awaiting approval.

## Official basis and practical limits

Bitwarden documents [extension autofill and shortcuts](https://bitwarden.com/help/auto-fill-browser/),
[TOTP autofill and copying](https://bitwarden.com/help/integrated-authenticator/),
and [website URI matching](https://bitwarden.com/help/uri-match-detection/).
Its [Agent Access project](https://github.com/bitwarden/agent-access) recommends
keeping credentials out of LLM context and is a separate, early-preview
integration. Do not describe this skill as using Agent Access or MCP.

Shortest means fewest reliable actions for the current setup. It does not mean
skipping account/origin checks, weakening security, or promising a fixed login
time. Clipboard transfer avoids returning secrets to the model but still uses
the local system clipboard; it is not equivalent to credential isolation.
