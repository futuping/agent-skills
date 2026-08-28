---
name: manage-nix-darwin-apps
description: Integrate, package, publish, update, migrate, and troubleshoot macOS applications in nix-darwin across pinned nixpkgs, brew-nix/Homebrew Casks, futuping/nix-packages, brew-api-extra, and brew-nix-extra while enforcing bare-name consumer selections. Use when adding or updating an app, classifying its source, choosing a package, overlay, or lifecycle module, wiring flake inputs, automating upstream releases, or diagnosing artifacts, architecture, hashes, and macOS signatures.
---

# Manage nix-darwin Apps

Choose the narrowest integration layer that preserves upstream provenance,
reproducible source verification, macOS bundle integrity, and a minimal
consumer configuration. Classify the application before editing so the user
does not need to know whether it belongs to nixpkgs, brew-nix, or an independent
package repository.

## Preserve worktrees and authority

1. Inspect every relevant worktree before editing. Preserve unrelated and
   partially staged changes.
2. Resolve the exact package, input, host, and repository before changing
   state. Do not duplicate an application across ecosystems merely because its
   attribute name differs.
3. Publish reusable remote implementation before locking the consumer. Never
   point a consumer lock at an unpublished worktree.
4. Never activate the Darwin system unless the user explicitly requests it.
5. Apply build authority by route:
   - Treat a request to add an official Cask as authorization for non-activating
     package and system builds unless the user excludes builds.
   - Build native nixpkgs or independent packages only when the user authorizes
     building.

## Enforce bare consumer selections

Treat bare application names as a hard invariant in every ordinary local
package list:

```nix
# flake-nixpkgs.nix
environment.systemPackages = with pkgs; [
  example
];

# flake-brew.nix
environment.systemPackages = with pkgs.brewCasks; [
  example
];

# nix-packages.nix
environment.systemPackages = with pkgs; [
  example-app
];
```

Never place qualified package paths, `inputs.*.packages.*`, `pkgs.<name>`,
`pkgs.brewCasks.<token>`, generated namespaces, `pkgs.callPackage`, inline
derivations, interpolated system-specific paths, or local aliases for those
expressions in these lists. Allow qualified package paths only in remote
implementation or evaluation/build commands. Allow qualified remote module
references only in `imports` or the main flake's `modules` list.

If a package is available only through a qualified expression, expose it
through an overlay and a thin Darwin module before selecting it locally:

- merge a Cask token into `pkgs.brewCasks`;
- add an independent package as a top-level `pkgs.<attribute>`;
- make the thin module append only the overlay, without selecting the package.

Do not hide a qualified expression behind a local binding. Keep private or
experimental implementation outside the package list and expose it through the
same local overlay boundary. Declare each ordinary application in exactly one
of the three focused files.

Use `programs.<name>.enable` only for genuine lifecycle state beyond package
presence. It is not an alternative syntax for selecting an ordinary app.

## Inspect and route

1. Check the pinned nixpkgs package set for an adequate package.
2. Check the pinned official Homebrew API exposed by brew-nix, then any pinned
   third-party catalog.
3. Read official upstream release metadata and documentation. Identify the
   stable release rule, exact architecture asset, URL and redirect hosts,
   checksum, archive type, bundle or executable name, license, and signing
   identity.
4. When migrating an existing package, record its source hash and derivation
   path before changing the integration layer.
5. Choose one route:

| Application state | Route |
| --- | --- |
| Adequate pinned nixpkgs package | Select its bare attribute in `flake-nixpkgs.nix` |
| Official Cask | Run the official Cask direct-build gate |
| Cask missing from the official API | Publish metadata through `brew-api-extra`, then expose its bare token through `brew-nix-extra` |
| Cask needs a reproducible package-only correction after direct failure | Publish a focused `brew-nix-extra` overlay |
| Ordinary non-Homebrew app or binary | Publish package, overlay, and thin module through `futuping/nix-packages` |
| Private or experimental package | Keep focused implementation temporarily, but still expose a bare consumer attribute |
| Genuine system lifecycle state | Use a purpose-built nix-darwin module |

Read only the references required by the chosen route, but read each selected
reference completely before acting:

- For any Cask route, read
  [references/brew-nix-integration.md](references/brew-nix-integration.md).
- Before choosing a Cask overlay or lifecycle module, also read
  [references/compatibility.md](references/compatibility.md).
- When a Cask token is absent from the official API, also read
  [references/registry-and-adapters.md](references/registry-and-adapters.md).
- For an independent package, migration, upstream flake forwarding, updater,
  or non-Homebrew bundle repair, read
  [references/remote-package-pattern.md](references/remote-package-pattern.md).

For a Cask, run its direct-build gate before treating system paths, installer
scripts, lifecycle metadata, or signature warnings as reasons to build an
extra integration layer.

## Use the native nixpkgs route

1. Confirm the pinned package is adequate for the required version,
   architecture, bundle layout, and runtime behavior.
2. Add only its bare attribute to `flake-nixpkgs.nix` under `with pkgs`.
3. Do not create a remote package solely to rename the attribute.
4. Format, evaluate the package and target system, and build only with user
   authorization.

## Use the Homebrew Cask route

For an official Cask:

1. Add only the bare token to `flake-brew.nix` under `with pkgs.brewCasks`.
2. Run formatting, `git diff --check`, and a no-build flake evaluation.
3. Build the selected package with `nix build --no-link` unless builds were
   excluded.
4. Build the target Darwin system with `nix build --no-link`; never switch to
   it for validation.
5. Confirm the expected app, binary, or package artifact exists. If both builds
   succeed, stop without developing `brew-api-extra` or `brew-nix-extra`.

Keep official metadata authoritative. Do not duplicate an official Cask in
`brew-api-extra` to work around installation behavior.

When metadata is absent, publish a narrow, deterministic adapter through
`brew-api-extra` without executing upstream Ruby. Require HTTPS, reviewed
download hosts, offline fixtures, rejection tests, and stable generated output.
Treat the generated package expression as remote implementation only; expose
the reviewed token through the existing or a focused `brew-nix-extra` overlay
and thin module so the consumer still selects a bare token.

Create a package-normalization overlay only after a reproducible direct package
or system build failure demonstrates that it is required. Merge into
`prev.brewCasks`; never replace the namespace. Publish in this order when each
layer changes:

1. `brew-api-extra`
2. `brew-nix-extra`
3. consumer configuration

## Use the independent package route

Publish ordinary non-Homebrew applications through
`futuping/nix-packages`:

1. Keep stable derivation logic in `packages/<attribute>.nix` and volatile
   version, URL, and hash in machine-updated source state.
2. Select the exact supported architecture asset and install a complete `.app`
   under `$out/Applications`. Add `$out/bin` links only for real upstream CLI
   executables.
3. Preserve a valid upstream signature when possible. Apply only a complete,
   package-specific ad-hoc signature when extraction necessarily invalidates
   it, and verify the final bundle.
4. Export `packages.<system>.<attribute>`, `overlays.<attribute>`, and a thin
   `darwinModules.<attribute>` that appends the overlay with `lib.mkAfter`.
   Treat a package-only export as incomplete.
5. When forwarding an upstream flake package, keep the qualified expression in
   the remote overlay and expose only the stable bare attribute to the
   consumer.
6. Keep update automation in the package repository. Accept stable releases,
   enforce reviewed hosts and size limits, compute complete SHA-256 SRI, reject
   downgrades and unreviewed same-version mutations, update source state
   atomically, and test parsing and rejection paths offline.
7. Publish `futuping/nix-packages` before updating its consumer lock.

Avoid consumer host names, user paths, `specialArgs`, and package selection in
remote modules.

## Use a lifecycle module only when required

Use a dedicated module for persistent system paths, registration, privileged
helpers, input methods, drivers, system extensions, or other state that package
presence cannot represent. For Casks, the successful direct-build gate remains
the stopping condition unless the user explicitly requests lifecycle
management.

Require lifecycle modules to be portable, idempotent, and convergent. Stage
updates atomically, track ownership, refuse to overwrite unmanaged targets, and
remove only module-owned artifacts. Keep package options replaceable and avoid
consumer-specific `specialArgs`.

## Integrate the consumer

1. Keep `flake-nixpkgs.nix`, `flake-brew.nix`, and `nix-packages.nix` separated
   by provenance.
2. Import only the required remote overlay modules. Keep qualified module
   references in `imports` or the main flake's `modules` list.
3. Select the application once by its bare name in the matching focused list.
4. Make reusable flake inputs follow the consumer's nixpkgs input when the
   remote contract supports it.
5. Update only the relevant lock input; do not run a full flake update unless
   requested.
6. Remove replaced local derivations, stale imports, updater code, and empty
   residual directories after the remote replacement is published and locked.

## Validate and report accurately

Always:

1. Run package-updater tests and JSON/YAML parsing when those files change.
2. Run Nix formatting checks and `git diff --check`.
3. Run `nix flake check --no-build --no-update-lock-file` on every affected
   flake.
4. Evaluate the selected package and final Darwin system derivations without
   activation.
5. Inspect all three focused consumer files and reject every non-bare ordinary
   application entry or duplicate declaration.
6. When migrating unchanged package logic, compare the old and new derivation
   paths; exact equality is the strongest relocation check.
7. Inspect available final app bundles and run
   `codesign --verify --deep --strict` as a diagnostic. Apply the route-specific
   signature policy before changing packaging.

Run builds only under the route-specific authority stated above. Distinguish a
no-build evaluation, inspection of an existing store output, a new build, and
system activation in the final report. Never imply that a skipped check ran.

Finish dependency repositories before the consumer. Confirm every repository
changed by the task is clean and synchronized. Report the selected route,
upstream version and asset, package attribute or Cask token, source and hash
policy, signature handling, published revisions, validation performed, and any
intentionally skipped build or activation.
