# Solo Lifecycle 1.2.1

The maintained source is [`skills/solo-lifecycle`](../skills/solo-lifecycle).
Version 1.2.1 was updated on 2026-10-31; version 1.2.0 was integrated on
2026-10-29. The inherited external research cutoff remains 2026-10-27.
This is a locally designed workflow, not a proven optimal
development method. It retains 16 optional stages and a short entrypoint.

The original 1.2.0 delivery is `vibe_coding_guide_and_skill_2026-10-29_v1.2.0.zip`, SHA-256:

```text
e44a4380b6531e28a4fbb9cfc7d0eb0a630b1e1249653845e8a50f788adf910c
```

The original installation copied the skill byte-for-byte from that delivery,
excluding Python caches. Version 1.2.1 updates the entrypoint, routing and records
references, and work-record template in this repository. The HTML guide, public
behavior-evaluation workbench and development environment stay in the full
delivery; they are not required for skill loading.
The checker retains its own version 1.1.1 and record schema version 1; the skill
release is now 1.2.1. The checker and schema are unchanged. The archive and HTML
remain historical 1.2.0 artifacts; this update does not rebuild them.
[`solo-lifecycle-release.json`](solo-lifecycle-release.json) retains the historical
1.2.0 installation receipt and hashes, not a verification of the current revision.

## Default progress and quality reporting

The skill now reports the selected route and current stage at the start or on
resumption, updates affected stages when they change or encounter a key failure,
and summarizes stage, status, artifact, acceptance basis, actual evidence, and
remaining gaps at handoff. It names the next action and responsible party.
Small tasks can use short paragraphs; a full 16-stage table is not required.

Stages may overlap or return to earlier work. Missing evidence stays unverified,
and a change that invalidates a passed result reopens the affected scope. Technical
checks do not stand in for stage 09 user acceptance. Authorized work continues
after progress reports; per-stage approval applies only when the user requests it.

## Codex with Nix / Home Manager

Use the existing `flake-home.nix` module and the same repository-backed link
pattern as the other skills. For a Codex-only installation:

```nix
let
  soloLifecycleSkill = config.lib.file.mkOutOfStoreSymlink
    "${machine.homeDirectory}/agent-skills/skills/solo-lifecycle";
in {
  home.file.".agents/skills/solo-lifecycle".source = soloLifecycleSkill;
}
```

Here `machine` is the existing local module argument. In another setup use the
existing `config.home.homeDirectory` binding or actual checkout location. Preserve
the Home Manager-managed global instruction links. The policy source remains
`~/.nix/nix-darwin/dotfiles/agents/AGENTS.md`; do not copy it into this repository
or replace its entrypoints.

Build with the existing locked Nix configuration and apply only the intended
declaration when unrelated changes are pending. Do not run an input-updating
system rebuild merely to add a skill. A source checkout content change needs no
new Home Manager activation once the repository-backed link is deployed.

Codex scans `~/.agents/skills` and supports symlinked skill directories, as
described in the [official skill documentation](https://learn.chatgpt.com/docs/build-skills).
Invoke `$solo-lifecycle` on the next turn; if discovery has not refreshed,
restart Codex. Use this single lifecycle workflow for a task.
This installation adds only the Codex entry, with no new
Claude Code entry.

## Verification

For 1.2.1, skill format validation, all 137 record-checker tests in the original
locked validation environment, and `nix flake check` on aarch64-darwin passed.
An independent content review checked the reporting rules and provenance. These
are format, regression, and static review results, not a model behavior evaluation.

```sh
nix develop --no-update-lock-file --command python3 -B -m unittest discover -s skills/solo-lifecycle/tests -v
nix flake check --no-update-lock-file
```

The flake's standard-library check discovers 137 tests: 129 run and eight optional
schema tests skip without `jsonschema`. The original full delivery validates all
137 with its locked development dependencies. These checks do not establish
native model behavior or skill productivity gains. Installation evidence checks
the actual Codex skill registry separately from file/schema tests.
