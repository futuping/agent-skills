---
name: manage-brew-nix-casks
description: Integrate, publish, update, and troubleshoot Homebrew Casks for brew-nix and nix-darwin. Use when consuming official casks with a bare-token, direct-build-first workflow; adding casks absent from the official API through futuping/brew-api-extra; publishing package-normalization overlays or special-lifecycle modules through futuping/brew-nix-extra only after direct integration fails; keeping cask selection in flake-brew.nix; handling input methods or other system components; selecting adapters; wiring flake inputs; or diagnosing artifact and macOS signature compatibility.
---

# Manage brew-nix Casks

Choose the narrowest integration layer that builds successfully. For an
official Cask, try the bare-token consumer declaration first. Treat successful
package and target Darwin system builds as the stopping condition: do not
develop `brew-nix-extra` merely because the Cask uses a PKG, declares system
paths or lifecycle hooks, or has a signature warning. Add catalog metadata only
when official metadata is absent, and develop an overlay or lifecycle module
only after direct integration has a reproducible failure or the user explicitly
requests behavior beyond ordinary package selection.

## Default consumer declaration

For every ordinary Cask, select the application by adding or deleting only its
bare token from `environment.systemPackages`, for example:

```nix
environment.systemPackages = with pkgs.brewCasks; [
  <token>
];
```

Keep this list and ordinary brew-nix consumer configuration in a focused
`flake-brew.nix`. Reserve `flake-nixpkgs.nix` for native nixpkgs packages and
`nix-packages.nix` for non-Homebrew applications supplied by
`futuping/nix-packages`. When classification changes, move the package and its
overlay import instead of declaring it in two files.

Do not create `programs.<token>.enable` or another enable option merely to
install an ordinary app. A remote module may be a thin overlay importer, but
package selection must remain in the consumer's cask list. Treat a lifecycle
module with an enable option as an exception that requires a demonstrated
direct-build failure or an explicit request to manage lifecycle behavior.

## Official Cask fast path

Use this path before designing any `brew-nix-extra` integration:

1. Confirm the token exists in the pinned official Homebrew API exposed through
   `pkgs.brewCasks`.
2. Add only the bare token to `environment.systemPackages` in
   `flake-brew.nix`.
3. Run formatting, `git diff --check`, and a no-build flake evaluation.
4. Build the selected package with `nix build --no-link`.
5. Build the target `darwinConfigurations.<host>.system` with
   `nix build --no-link`; do not run `darwin-rebuild switch`.
6. Confirm the expected application, binary, or package artifact exists in the
   package output when it is inspectable.

Treat the request to add a Cask as authorization for these non-activating
validation builds unless the user explicitly excludes builds. If both builds
succeed and the expected artifact exists, integration is complete. Stop and do
not create or modify `brew-api-extra` or `brew-nix-extra`. Report lifecycle or
signature observations as caveats; they do not override a successful build
gate or authorize extra development.

If the full system build fails for an unrelated dependency, diagnose that
failure separately. Attribute failure to the new Cask only when the dependency
chain or package build demonstrates the connection.

## Inspect and classify

1. Locate the consumer Nix repository and inspect its worktree. Preserve
   unrelated changes.
2. Determine whether the Cask exists in the pinned official API. Read the API
   entry and upstream tap source without evaluating untrusted Ruby.
3. When it is official, run the [Official Cask fast path](#official-cask-fast-path)
   before deeper packaging work.
4. Only after the fast path fails, inspect release metadata, artifact type, CPU
   architecture layout, URL interpolation, hashes, bundle name, installation
   paths, lifecycle hooks, and signing state.
5. Read [references/compatibility.md](references/compatibility.md) before
   choosing an extra integration layer.

Do not add an official cask to `brew-api-extra` merely because brew-nix lacks
its artifact or lifecycle semantics.

## Choose an integration layer

| Cask state | Integration |
| --- | --- |
| Official API; package and Darwin system builds succeed | Keep bare `<token>` in `environment.systemPackages`; stop without developing extra |
| Missing from official API, metadata safely representable | Publish metadata through `brew-api-extra` |
| Direct package or system build fails because reusable package normalization is required | Publish a focused `brew-nix-extra` overlay, then select bare `<token>` in the consumer |
| Direct build fails because required lifecycle cannot be represented, or the user explicitly requests lifecycle management | Publish or use a dedicated `brew-nix-extra` nix-darwin module |

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

## Exception: add a dedicated lifecycle module

Read
[references/brew-nix-integration.md](references/brew-nix-integration.md)
before changing `brew-nix-extra`.

Use this path only after the official fast path has a reproducible build or
artifact failure, or when the user explicitly requests lifecycle management.
Installer scripts, privileged paths, lifecycle metadata, a DMG extraction
concern, or a signature warning alone do not justify a module when the direct
package and Darwin system builds succeed.

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
2. Import the package namespace, overlay, or remote module explicitly. For an
   ordinary cask, keep the per-host declaration to its bare token in
   `environment.systemPackages` inside `flake-brew.nix`; do not add
   `programs.<token>.enable`.
3. Run formatting, `git diff --check`, and a no-build flake evaluation.
4. For an official Cask, build both the selected package and target Darwin
   system without activation. If both succeed and the expected artifact exists,
   stop without developing extra.
5. Run `codesign --verify --deep --strict` on available final app bundles as a
   diagnostic. Report failure, but do not use it alone to replace a successful
   direct integration with extra development.
6. When the user excludes builds, evaluate derivations and verify an exact
   existing store output if one is already available; do not imply that a new
   build ran.
7. Activate the Darwin system only when the user explicitly requests
   activation. Never use `darwin-rebuild switch` merely to validate a Cask.

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
