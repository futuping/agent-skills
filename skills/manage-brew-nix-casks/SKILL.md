---
name: manage-brew-nix-casks
description: Integrate, publish, update, and troubleshoot Homebrew Casks for brew-nix and nix-darwin. Use when consuming official casks, adding casks absent from the official API through futuping/brew-api-extra, publishing package-normalization overlays or special-lifecycle modules through futuping/brew-nix-extra, handling input methods or other system components, selecting adapters, wiring flake inputs, or diagnosing artifact and macOS signature compatibility.
---

# Manage brew-nix Casks

Choose the narrowest integration layer that models both package metadata and
macOS lifecycle correctly. Reuse official metadata when it exists, add catalog
metadata only when it is absent, use an overlay for reusable package-only
normalization, and use a dedicated nix-darwin module when installation requires
system-managed paths or registration.

## Inspect and classify

1. Locate the consumer Nix repository and inspect its worktree. Preserve
   unrelated changes.
2. Read the official Homebrew API entry, upstream tap cask, and release
   metadata. Never evaluate untrusted Ruby merely to extract metadata.
3. Determine whether the cask already exists in the official API.
4. Identify the artifact type, CPU architecture layout, URL interpolation,
   hashes, bundle name, installation paths, lifecycle hooks, and signing state.
5. Read [references/compatibility.md](references/compatibility.md) before
   choosing an integration layer.

Do not add an official cask to `brew-api-extra` merely because brew-nix lacks
its artifact or lifecycle semantics.

## Choose an integration layer

| Cask state | Integration |
| --- | --- |
| Official API, ordinary app/binary/pkg | Consume `pkgs.brewCasks.<token>` |
| Missing from official API, metadata safely representable | Publish metadata through `brew-api-extra` |
| Ordinary package needs reusable extraction or signing normalization | Publish a focused `brew-nix-extra` overlay |
| Requires system paths, registration, or custom lifecycle | Publish or use a dedicated `brew-nix-extra` nix-darwin module |

Combine paths when needed: publish missing metadata first, then make an overlay
or module consume that package.

## Add catalog metadata

Read
[references/registry-and-adapters.md](references/registry-and-adapters.md)
before changing `brew-api-extra`.

1. Work from a clean clone of
   `https://github.com/futuping/brew-api-extra`.
2. Reuse an existing adapter only when its expected cask layout matches.
3. Add `registry/<token>.json` with the upstream source, allowed download
   hosts, and adapter-specific settings.
4. If no adapter matches, add a narrowly scoped adapter plus an offline fixture
   and tests. Prefer a new adapter over weakening an existing parser.
5. Preserve deterministic token ordering and the brew-nix-compatible output
   schema.
6. Run:

   ```sh
   python3 -m unittest discover -s tests
   python3 -m scripts.update
   python3 -m scripts.update --check
   python3 -m json.tool cask.json >/dev/null
   git diff --check
   ```

7. Review the complete diff. Confirm that existing entries did not change
   unexpectedly.

Publish the metadata commit before consuming it. Never lock a consumer to an
unpublished working tree.

## Add a package-normalization overlay

Read
[references/brew-nix-integration.md](references/brew-nix-integration.md)
before changing `brew-nix-extra`.

1. Work from a clean clone of
   `https://github.com/futuping/brew-nix-extra`.
2. Export a focused `overlays.<token>` that selects the source package and
   applies only the required package override.
3. Merge the package into an existing namespace without replacing unrelated
   attributes. Add it to `pkgs.brewCasks` only when conventional cask-list
   selection is intentional and token collisions have been reviewed.
4. Optionally export a thin `darwinModules.<token>` that appends the overlay
   with `lib.mkAfter`.
5. Keep install selection in `environment.systemPackages`; do not create a
   `programs.<token>.enable` option for an ordinary app with no lifecycle state.
6. Preserve the resulting derivation when the task is only relocating existing
   override code.

Publish the overlay commit before adding or updating the consumer input.

## Add a dedicated lifecycle module

Read
[references/brew-nix-integration.md](references/brew-nix-integration.md)
before changing `brew-nix-extra`.

1. Work from a clean clone of
   `https://github.com/futuping/brew-nix-extra`.
2. Export a focused `darwinModules.<token>` module with an enable option and a
   replaceable package option.
3. Keep the module dependency-light and portable. Do not require
   consumer-specific `specialArgs` such as a private `machine` record.
4. Use the official `pkgs.brewCasks.<token>` package by default when available.
   For third-party metadata, allow the consumer to pass the generated package.
5. Make activation idempotent and convergent. Track ownership, refuse to
   overwrite unmanaged targets, stage updates atomically, and remove only
   module-owned artifacts when disabled.
6. Add only package-specific extraction or signing overrides. Preserve a valid
   Developer ID signature and verify the final bundle.

Publish the module commit before adding or updating the consumer input.

## Integrate and validate

Read
[references/brew-nix-integration.md](references/brew-nix-integration.md), then:

1. Update only the relevant input with `nix flake update <input> --flake
   <flake-path>` unless the user explicitly requests a full update.
2. Import the package namespace, overlay, or remote module explicitly and keep
   the per-host declaration minimal.
3. Run formatting, `git diff --check`, and a no-build flake evaluation.
4. Build the package or system only when the user authorized building. When
   building is excluded, evaluate derivations and verify an exact existing
   store output if one is already available; do not imply that a new build ran.
5. Run `codesign --verify --deep --strict` on every available final app bundle.
6. Activate the Darwin system only when the user requested activation.

## Finish transactionally

Keep repository history in dependency order:

1. Publish `brew-api-extra` when new metadata is required.
2. Publish `brew-nix-extra` when a package overlay or dedicated lifecycle
   module is required.
3. Pin and publish the consumer configuration.

Report the cask version, metadata source, artifact type, validation performed,
published revisions, and any remaining manual macOS action. Confirm every
repository changed by the task is clean and synchronized when the user
requested a complete publish.
