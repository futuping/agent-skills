---
name: manage-brew-nix-casks
description: Onboard, update, and troubleshoot third-party Homebrew Casks for brew-nix using a registry-and-adapter metadata catalog and a Nix Darwin consumer. Use when adding a cask that is absent from the official Homebrew API, extending futuping/brew-api-extra, generating or validating cask.json, selecting or implementing a safe cask adapter, wiring thirdPartyBrewCasks into a flake, or diagnosing artifact and macOS signature compatibility.
---

# Manage brew-nix Casks

Manage a third-party cask as a two-repository change: publish validated metadata
first, then pin and consume that revision from the Nix configuration.

## Inspect before editing

1. Locate the consumer Nix repository and inspect its worktree. Preserve
   unrelated changes.
2. Locate a clean clone of
   `https://github.com/futuping/brew-api-extra`, or clone it into a temporary
   directory.
3. Read the upstream tap's cask file and release metadata. Never evaluate
   untrusted Ruby merely to extract metadata.
4. Identify the artifact type, CPU architecture layout, URL interpolation,
   hashes, bundle name, and upstream signing state.
5. Read [references/compatibility.md](references/compatibility.md) before
   proceeding if the artifact is not a plain `.app`.

Do not claim that every Homebrew cask is compatible. Stop and explain the
required custom Nix module when the artifact is an input method, system
extension, driver, privileged helper, or another system-installed component.

## Add catalog metadata

Read
[references/registry-and-adapters.md](references/registry-and-adapters.md)
before changing the metadata repository.

1. Reuse an existing adapter only when its expected cask layout matches.
2. Add `registry/<token>.json` with the upstream source, allowed download
   hosts, and adapter-specific settings.
3. If no adapter matches, add a narrowly scoped adapter plus an offline fixture
   and tests. Prefer a new adapter over weakening an existing parser.
4. Preserve deterministic token ordering and the brew-nix-compatible output
   schema.
5. Run:

   ```sh
   python3 -m unittest discover -s tests
   python3 -m scripts.update
   python3 -m scripts.update --check
   python3 -m json.tool cask.json >/dev/null
   git diff --check
   ```

6. Review the complete diff. Confirm that existing cask entries did not change
   unexpectedly.

## Publish metadata before consuming it

Commit and push `brew-api-extra` only when the user authorizes repository
writes. Confirm its workflow passes. Record the published revision.

Do not update the consumer lock file to an unpublished working-tree state. The
consumer uses a non-flake GitHub input, so its lock must point to a reachable
commit.

## Integrate with brew-nix

Read
[references/brew-nix-integration.md](references/brew-nix-integration.md), then:

1. Update only the `brew-api-extra` input unless the user explicitly wants all
   flake inputs updated.
2. Select the generated package through
   `thirdPartyBrewCasks."<token>"`.
3. Add only the minimum application-specific override. Do not re-sign a valid
   Developer ID application.
4. Evaluate the Darwin configuration, build the package or full system, and
   inspect the resulting bundle.
5. For apps, run `codesign --verify --deep --strict` on the built bundle. Test
   launch behavior when safe and requested.
6. Activate the Darwin system only when the user requested activation.

## Finish transactionally

Keep repository history in dependency order:

1. Metadata repository commit and push.
2. Consumer lock/configuration commit and push.

Report the cask version, selected adapter, artifact type, validation performed,
published revisions, and any remaining manual macOS action. Confirm both
worktrees are clean and synchronized when the user requested a complete
publish.
