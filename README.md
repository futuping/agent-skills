# agent-skills

Reusable Codex skills maintained by futuping.

## Skills

- [`bitwarden-login`](skills/bitwarden-login): sign in through official
  Bitwarden Agent Access and ego lite with a background login adapter. Keeps
  credentials out of model output and retains extension autofill as a fallback.
- [`manage-nix-darwin-apps`](skills/manage-nix-darwin-apps): classify,
  package, publish, update, and integrate Homebrew and non-Homebrew macOS
  applications with nix-darwin.

## Local installation

Clone this repository, then link the skill directory into `~/.codex/skills/`.
Restart Codex or begin a new task if the installed skill does not appear
immediately.

## Development and login runtime

The locked Nix environment provides Node.js 24 and pnpm 11. Tests use Node's
built-in test runner and have no third-party JavaScript dependencies:

```sh
nix develop --command pnpm test
nix flake check --no-update-lock-file
```

On Apple Silicon macOS, `nix develop .#login` additionally provides the pinned
official Agent Access binary and Bitwarden CLI. See the
[Agent Access setup and usage](skills/bitwarden-login/references/agent-access.md)
before using real credentials. The opt-in live demo is separate from CI and
uses only the official example provider and an agent-owned test page.
