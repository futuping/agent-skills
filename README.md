# agent-skills

Reusable Codex skills maintained by futuping.

## Skills

- [`bitwarden-login`](skills/bitwarden-login): sign in to websites with an
  existing Bitwarden browser-extension login and TOTP, using native autofill
  or a scoped clipboard fallback without printing secrets.
- [`manage-nix-darwin-apps`](skills/manage-nix-darwin-apps): classify,
  package, publish, update, and integrate Homebrew and non-Homebrew macOS
  applications with nix-darwin.

## Local installation

Clone this repository, then link the skill directory into `~/.codex/skills/`.
Restart Codex or begin a new task if the installed skill does not appear
immediately.
