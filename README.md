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
- [`solo-delivery`](skills/solo-delivery): deliver a scoped personal software
  feature or bug fix with task-sized planning, independent acceptance criteria,
  meaningful verification, review, and durable handoff. Shared instructions work
  in Codex and Claude Code without requiring another workflow framework.

## Local installation

Keep one source directory in this repository. Current Codex discovers personal
skills in `~/.agents/skills/`; Claude Code uses `~/.claude/skills/`. Both support
symlinked skill directories. Existing installations in legacy locations do not
need to be moved to add `solo-delivery`.

For a Home Manager setup, declare both entries rather than copying the files:

```nix
{ config, ... }:
let
  soloDelivery = config.lib.file.mkOutOfStoreSymlink
    "${config.home.homeDirectory}/agent-skills/skills/solo-delivery";
in {
  home.file.".agents/skills/solo-delivery".source = soloDelivery;
  home.file.".claude/skills/solo-delivery".source = soloDelivery;
}
```

Use the checkout's actual location if it differs. Merge these entries into the
existing module, preserve global instruction links, and use the existing scoped
activation process. Content edits then come directly from the versioned source.

Start a new session if discovery has not refreshed. In Codex CLI use
`$solo-delivery`; in Claude Code use `/solo-delivery`. Desktop selection differs
by host; select the skill or explicitly provide its `SKILL.md` path. See the
[research report](docs/research/vibe-coding-research.html) for source attribution,
the recommended combination, current host instructions, and copyable prompts.

## Development and login runtime

The locked Nix environment provides Node.js 24 and pnpm 11. Tests use Node's
built-in test runner and have no third-party JavaScript dependencies:

```sh
nix develop --command pnpm test
nix flake check --no-update-lock-file
```

The default [extension workflow](skills/bitwarden-login/references/browser-extension.md)
uses ego's embedded runtime and does not need a CLI provider. On Apple Silicon
macOS, `nix develop .#login` additionally provides the pinned official Agent
Access binary and Bitwarden CLI for the fallback. See the
[Agent Access setup and usage](skills/bitwarden-login/references/agent-access.md)
when configuring that fallback. The opt-in live demo is separate from CI and
uses only the official example provider and an agent-owned test page.
