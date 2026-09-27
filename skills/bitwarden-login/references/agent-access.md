# Fallback: Agent Access setup and execution

Use this route when the primary background extension path is unavailable, or
the user explicitly selects Agent Access. It uses official `aac run`, a local
Node child, a one-use Unix socket and the existing ego runtime. It remains in
the background and does not use the system clipboard.

Reuse a live paired provider. Do not start Terminal/Warp, foreground ego, or
restart the website login when switching routes. If the provider needs user
attention, explain the required terminal action in chat and wait. An unlocked
extension does not require this setup when the primary route works.

## Runtime and one-time user setup

The repository's `flake.lock` pins the toolchain. On Apple Silicon macOS:

```sh
nix develop ~/agent-skills#login --command aac --version
```

Agent Access is pinned to official release 0.11.0 with its published SHA-256;
Bitwarden CLI comes from locked nixpkgs. No global install or system rebuild is
needed. Use the actual checkout path if it differs from `~/agent-skills`.

Run the provider in the **user's own terminal**, not an agent-recorded PTY:

```sh
nix develop ~/agent-skills#login --command bash \
  ~/agent-skills/skills/bitwarden-login/scripts/provider.sh
```

For an **EU account**, append `--region eu` to that command:

```sh
nix develop ~/agent-skills#login --command bash \
  ~/agent-skills/skills/bitwarden-login/scripts/provider.sh --region eu
```

This configures and verifies `https://vault.bitwarden.eu` before asking for
credentials. `--region us` selects the US cloud. Without a region argument, the
script preserves the existing server. It displays the server before login and
refuses to switch an authenticated CLI session to a different server. Stop an
old login prompt with Ctrl+C before restarting with the correct region.

macOS Terminal and Warp can both run these commands. Terminal is sufficient;
open a second tab with Command+T for pairing. In Warp, run them as ordinary
shell commands rather than an AI request. There is no need to install another
terminal or run both applications.

The script prompts through `bw` for CLI login/unlock, captures the session key
without printing it, then starts the official approval interface. It locks the
CLI when the provider exits. For a self-hosted vault, configure the CLI's server
in that terminal before login using the official `bw config server` workflow.
The CLI session is independent of the browser extension.

Run only one provider for this workflow. A startup lock prevents duplicate
instances from unlocking the same CLI storage concurrently. After unlock, the
script syncs the vault and verifies the session before accepting requests.
If an older provider predates this lock, stop it before starting the script.
Agent Access 0.11.0 can map `bw get item` failures to not-found when it has a
cached session. `credential_lookup_failed` therefore requires checking the
provider session and sync, not assuming the item is missing or the website
password is wrong.

Pair once from a second user-controlled terminal:

```sh
nix develop ~/agent-skills#login --command aac connect
```

Enter the provider's rendezvous code there, compare the displayed fingerprints,
and approve the intended connection. Keep tokens out of chat, files and shell
history. After pairing, `/exit` is fine in the **second (`aac connect`) terminal**.
Keep the **first (`provider.sh` / `aac listen`) terminal running**; exiting it
stops credential access and locks the CLI. If it was closed, rerun `provider.sh`
with the same region and unlock; the saved pairing does not need to be repeated.
Future `aac run` invocations can reuse the cached connection. If there
are several, set the intended public session fingerprint in the plan.

When a credential request arrives, verify the displayed website and account.
In version 0.11.0, `y` approves once and `a` approves with the displayed cache
duration (initially ten minutes). Up adds five minutes; down subtracts one.
The cache is scoped to requester/query and disappears on provider restart;
there is no built-in permanent per-item approval setting. The user can choose
a longer session duration in this interface. Pairing persistence does not mean
credential approval persists. The agent must not press approval keys for real
credentials or enable blanket approval. The test harness only does this for the
official public **example** provider and refuses an existing Agent Access state
directory.

## Prepare ego and build a plan

Use one task space for the entire goal. This example assumes the caller already
owns it. Do not create another space to recover from an error or user takeover.

```js
const { homedir } = await import('node:os');
const { pathToFileURL } = await import('node:url');
const root = homedir() + '/agent-skills/skills/bitwarden-login/';
const { prepareBackground } = await import(pathToFileURL(root + 'scripts/background.mjs'));
const task = await taskSpace(existingSpaceId);
const page = task.page(existingPageLabel);
const guardIdentifier = await prepareBackground(task, page);
// Navigate now; observe the login controls without extracting secrets.
```

Build the [shared login plan](login-plan.md). Keep the same task/page and plan
when falling back from the extension, provided it reported `fallbackAllowed`.
Update selectors only from current observations; do not resubmit a password/code
or retry website rejection by switching routes.

Run without putting any credential in the command:

```sh
nix develop ~/agent-skills#login --command node \
  ~/agent-skills/skills/bitwarden-login/scripts/login.mjs \
  ~/.cache/bitwarden-login/plan.json
```

The wrapper uses `aac run --id … --env BWLOGIN_PASSWORD=password …` internally.
No `--env-all`, `aac connect --output json` credential dump, or `bw list items`
is needed. Ordinary output is only a status such as:

```json
{"ok":true,"status":"success","actions":3}
```

## Implementation details that affect safety and speed

- ego's embedded Node process does **not** inherit the CLI child's environment.
  `bridge.mjs` consumes the `aac run` environment, validates account/origin/item,
  and sends only the required payload over an authenticated one-use socket in
  a 0700 directory with a 0600 socket. It strips credential variables before
  launching ego. The nonce is generated and transferred inside local processes,
  never printed. The socket is removed after execution, including failures.
- Official 0.11.0's Bitwarden provider returns `login.totp`, a seed or
  `otpauth://` URI, not a freshly generated code. `core.mjs` derives the code
  locally when the TOTP form is ready. It supports standard SHA1/SHA256/SHA512
  TOTP with 6–8 digits; unsupported formats stop. Expiring codes wait for the
  next period before submission.
- The engine permits at most twelve actions and one submission per credential
  state. It selects only explicitly configured website alternatives. Unknown
  pages, rejected credentials and navigation to another origin stop execution.
  It does not infer actions from page instructions or dump diagnostics.
- Disabling Bitwarden's passkey notification is a persistent extension
  preference, reversible in Settings → Notifications. The WebAuthn guard is
  temporary and applies only to the managed page. It cancels public-key
  requests; password credentials remain available. Cleanup removes its
  new-document script and restores methods in the current document. Each
  execution round renews the registration because ego may detach CDP sessions
  between rounds. Cleanup still restores the current document when the old
  registration has already disappeared. If another cleanup error occurs,
  `cleanup_required` includes the original `loginStatus`.
- The user controls real-vault unlock, pairing and approval. Once authorized,
  credential lookup and form execution run without an extension popout or
  system clipboard. Shared preparation preserves user windows and leaves all
  window state alone when ego is foreground. Only a verified exclusive normal
  task window is eligible for minimization when ego is not foreground. It
  never hides the entire application or exits full screen. macOS window creation
  may still cause an initial appearance; there is no verified fully headless API.

## Verification scope

On 2026-09-26, the official 0.11.0 **example provider** completed a live
end-to-end test through `aac run`, the local socket, and a synthetic form in
ego lite. The form reached its account-specific success state, ego stayed out
of the foreground, and the foreground application was unchanged. A separate
live page check confirmed that both WebAuthn `get` and `create` requests were
cancelled by the temporary guard.

The automated tests cover credential/origin checks, RFC 6238 TOTP vectors,
socket permissions and authentication, passkey restoration across detached CDP
sessions, account rejection, and bounded form execution.

A subsequent test connected the real EU Bitwarden provider after user unlock,
pairing, and item approval. Credential delivery and validation succeeded, and
the first Google account reached a rejection page because Google could not
verify account ownership. No recovery or repeated authentication was attempted
for that account.

The user then selected another Google account. With a single synced provider,
**the real Agent Access login succeeded in six browser actions**, including a
TOTP challenge recorded in the page's navigation history. The executor verified
the requested account on its signed-in page, removed the temporary guard, and
the agent closed the test space. ego remained out of the foreground. Personal
account names and vault IDs are intentionally excluded from this repository.
The extension route's tests are separate from this Agent Access result.

Official references: [Agent Access](https://github.com/bitwarden/agent-access),
[Bitwarden CLI](https://bitwarden.com/help/cli/),
[passkey notification settings](https://bitwarden.com/help/storing-passkeys/),
and [the pinned Bitwarden provider implementation](https://github.com/bitwarden/agent-access/blob/v0.11.0/crates/ap-cli/src/providers/bitwarden.rs).
