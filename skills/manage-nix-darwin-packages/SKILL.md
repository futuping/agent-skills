---
name: manage-nix-darwin-packages
description: Package, publish, update, migrate, and troubleshoot non-Homebrew macOS applications for nix-darwin. Use when evaluating whether to consume nixpkgs or create an independent binary package, moving an inline callPackage definition to futuping/nix-packages, exporting package overlays or thin Darwin modules, automating upstream version and hash updates, keeping host declarations to a bare package name, or diagnosing DMG/ZIP extraction, architecture, source integrity, and macOS signature compatibility.
---

# Manage nix-darwin Packages

Use the narrowest Nix layer that preserves upstream provenance, reproducible
source verification, macOS bundle integrity, and a minimal consumer
configuration. Keep reusable package implementation and update automation in
`futuping/nix-packages`; keep host-specific package selection in the consumer.

## Inspect and classify

1. Inspect every relevant worktree before editing. Preserve unrelated and
   partially staged changes.
2. Check current nixpkgs for an adequate package before creating another one.
   Compare version, architecture, bundle layout, update cadence, signing state,
   and any known runtime incompatibility.
3. Check whether the application is an official or third-party Homebrew cask.
   If it is, use `manage-brew-nix-casks` instead of duplicating that ecosystem
   here.
4. Read official upstream release metadata and documentation. Identify stable
   release rules, exact architecture asset, URL redirects, checksums or
   digests, archive type, bundle name, CLI entry points, license, and signing
   identity.
5. Inspect the existing local derivation when migrating one. Record its
   derivation path and source hash so relocation can be checked for identity.
6. Read
   [references/remote-package-pattern.md](references/remote-package-pattern.md)
   before choosing or implementing a remote package layout.

Do not create a remote package solely because a nixpkgs package exists under a
different attribute name. Require a concrete compatibility, release, or
packaging reason.

## Choose the integration layer

| Application state | Integration |
| --- | --- |
| Adequate package in nixpkgs | Select `pkgs.<attribute>` directly |
| Homebrew cask or brew-nix package | Use `manage-brew-nix-casks` |
| Ordinary non-Homebrew app or binary | Publish a package and overlay through `futuping/nix-packages` |
| Private or experimental source unsuitable for publication | Keep a focused local package temporarily |
| Requires system paths, registration, or privileged lifecycle | Add a purpose-built nix-darwin module; do not model it as package presence alone |

An ordinary application should remain selectable by adding or deleting one
package name. Do not create `programs.<name>.enable` unless there is lifecycle
state beyond package presence.

## Publish an ordinary macOS application

Work from a clean clone of `https://github.com/futuping/nix-packages`.

1. Put stable derivation logic in `packages/<attribute>.nix`.
2. Put volatile version, URL, hash, and optional upstream validators in a small
   machine-updated source JSON file.
3. Select the exact architecture asset. Export only supported systems.
4. Install the complete `.app` under `$out/Applications`. Add `$out/bin`
   symlinks only for real upstream CLI executables.
5. Preserve a valid upstream signature when extraction permits it. Use
   `dontFixup = true` when later fixups would invalidate the bundle.
6. If extraction necessarily breaks the signature, apply only a
   package-specific complete ad-hoc signature and verify the final bundle.
7. Export `packages.<system>.<attribute>`, a focused
   `overlays.<attribute>`, and a thin `darwinModules.<attribute>` that appends
   the overlay with `lib.mkAfter`.
8. Avoid consumer-specific `specialArgs`, host names, user paths, or package
   selection inside the remote module.
9. Use a collision-resistant attribute such as `<name>-app` when nixpkgs
   already owns the natural name.

Publish the remote repository before adding or updating the consumer input.
Never lock a consumer to an unpublished working tree.

## Automate upstream updates

Keep automation in the package repository, not in a local rebuild wrapper.

1. Query an official release API or feed and accept only stable versions.
2. Require exactly the intended asset and an HTTPS URL on reviewed hosts.
3. Enforce version syntax, monotonic upgrades, response and download size
   limits, redirect allowlists, and exact expected URL structure.
4. Compute a complete SHA-256 SRI value. Cross-check an upstream digest when
   one is published.
5. Treat same-version binary replacement as a review event unless a stronger
   authenticated identity check explicitly makes that mutation acceptable.
6. Validate macOS Developer ID, Team ID, bundle ID, bundle version, and
   architecture when the artifact and runner support those checks.
7. Write source state atomically and modify no package logic during an
   automated update.
8. Add offline tests for parsing, selection, downgrade rejection, host
   validation, and mutation behavior.
9. Run the updater on a schedule and by manual dispatch. Commit only when
   source state changes; keep scheduled workflows active without rewriting
   package content.

For a quiet public repository, an empty heartbeat commit before the platform's
inactivity threshold is acceptable. Never rewrite source or package state only
to create activity.

For mutable URLs, HTTP validators may avoid unchanged downloads, but they are
not a substitute for the content hash. Do not mirror or redistribute
proprietary artifacts merely to make their URL immutable without reviewing
license and trust implications.

## Integrate the consumer

1. Add the remote flake input and make its nixpkgs input follow the consumer:

   ```nix
   nix-packages = {
     url = "github:futuping/nix-packages";
     inputs.nixpkgs.follows = "nixpkgs";
   };
   ```

2. Import the thin module centrally:

   ```nix
   modules = [
     inputs.nix-packages.darwinModules.example-app
   ];
   ```

3. Select the bare package in the ordinary Nixpkgs package list:

   ```nix
   environment.systemPackages = with pkgs; [
     example-app
   ];
   ```

4. Update only the relevant lock input:

   ```sh
   nix flake update nix-packages --flake path:./nix-darwin
   ```

5. Delete the replaced local derivation, stale imports, and empty residual
   directories. Update repository maps and maintenance documentation.
6. Remove any local updater that rewrote version/hash bindings. A normal full
   flake update should receive the remote updater's published commit.

## Validate without overstating

Always run:

1. Package-updater unit tests and syntax checks.
2. JSON/YAML parsing for source state and workflows.
3. `nixfmt --check` and `git diff --check`.
4. `nix flake check --no-build --no-update-lock-file` on the package repository
   and consumer.
5. Package and final system derivation evaluation without activation.

When migrating unchanged package logic, compare the old and new package
derivation paths. Exact equality is the strongest relocation check.

Build only when the user authorizes building. When builds are excluded, inspect
an exact existing store output if available, verify installed bundle version,
architecture, and `codesign --verify --deep --strict`, and state clearly that
no new build occurred. Never activate the Darwin system without explicit
authorization.

## Finish transactionally

1. Publish `futuping/nix-packages`.
2. Confirm its update workflow succeeds.
3. Lock and publish the consumer.
4. Confirm every repository changed by the task is synchronized, while leaving
   unrelated consumer changes untouched.

Report the upstream version and asset, package attribute, source hash policy,
signature handling, remote and consumer revisions, validation performed, and
whether a build or activation was intentionally skipped.
