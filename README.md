# agent-skills

Reusable agent skills maintained by futuping.

## Skills

- [`bitwarden-login`](skills/bitwarden-login): sign in through the unlocked
  Bitwarden extension first, with official Agent Access as fallback. Both
  adapters keep ego lite in the background and credentials out of model output
  and the system clipboard, while preserving the user's active ego windows.
- [`manage-nix-darwin-apps`](skills/manage-nix-darwin-apps): classify,
  package, publish, update, and integrate Homebrew and non-Homebrew macOS
  applications with nix-darwin.
- [`solo-lifecycle`](skills/solo-lifecycle): version 1.2.1, covering personal
  software work from task intake (00) through retirement (15). Load only the
  current stage's references; commercial and AI product guidance is conditional.
  Reports the route, stage changes, and evidence-backed handoff by default while
  continuing authorized work. Evidence records and the read-only checker are optional. See
  [the release and installation note](docs/solo-lifecycle.md).

## Local installation

Keep one source directory in this repository. Current Codex discovers personal
skills in `~/.agents/skills/`; Claude Code uses `~/.claude/skills/`. Both support
symlinked skill directories.

For the current Codex Home Manager setup, declare the entry rather than copying
the files:

```nix
{ config, ... }:
let
  soloLifecycle = config.lib.file.mkOutOfStoreSymlink
    "${config.home.homeDirectory}/agent-skills/skills/solo-lifecycle";
in {
  home.file.".agents/skills/solo-lifecycle".source = soloLifecycle;
}
```

Use the checkout's actual location if it differs. Merge these entries into the
existing module, preserve global instruction links, and use the existing scoped
activation process. Content edits then come directly from the versioned source.

Start a new session if discovery has not refreshed. In Codex use
`$solo-lifecycle`. If separately configured in Claude Code, use `/solo-lifecycle`.
See the [release and installation note](docs/solo-lifecycle.md) for the source
delivery and verification scope.

## Development and login runtime

The locked Nix environment provides Node.js 24 and pnpm 11. Tests use Node's
built-in test runner and have no third-party JavaScript dependencies:

```sh
nix develop --command pnpm test
nix flake check --no-update-lock-file
```

The flake also checks `solo-lifecycle` using Nix Python 3.12: 129 standard-library
tests run, and eight optional JSON Schema contract tests are explicitly skipped
without `jsonschema`. The source delivery's locked validation environment runs
all 137 tests. Skill installation needs no additional Python dependencies.

The default [extension workflow](skills/bitwarden-login/references/browser-extension.md)
uses ego's embedded runtime and does not need a CLI provider. On Apple Silicon
macOS, `nix develop .#login` additionally provides the pinned official Agent
Access binary and Bitwarden CLI for the fallback. See the
[Agent Access setup and usage](skills/bitwarden-login/references/agent-access.md)
when configuring that fallback. The opt-in live demo is separate from CI and
uses only the official example provider and an agent-owned test page.
