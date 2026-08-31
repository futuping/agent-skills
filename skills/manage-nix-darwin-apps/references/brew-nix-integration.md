# brew-nix integration reference

## Contents

- [Official cask package](#official-cask-package)
- [Ordinary official Cask workflow](#ordinary-official-cask-workflow)
- [Consumer file boundaries](#consumer-file-boundaries)
- [Third-party metadata catalog](#third-party-metadata-catalog)
- [Package-normalization overlay](#package-normalization-overlay)
- [Dedicated lifecycle module](#dedicated-lifecycle-module)
- [Lock sequence](#lock-sequence)
- [Validation sequence](#validation-sequence)
- [Signing policy](#signing-policy)
- [Artifact compatibility](#artifact-compatibility)

## Official cask package

When the requested app already has an official Homebrew Cask, select its bare
token directly. Use the qualified package path only in commands when a
targeted evaluation or build is needed:

```nix
pkgs.brewCasks.example
```

Keep the consumer package list bare:

```nix
environment.systemPackages = with pkgs.brewCasks; [
  example
];
```

Keep official metadata authoritative even when a dedicated module must add
installation lifecycle behavior.

## Ordinary official Cask workflow

1. Add the bare token once to `environment.systemPackages` in
   `flake-brew.nix`, preserving the surrounding formatting and unrelated work.
2. Run the normal target Darwin rebuild in the mode authorized in the session.
   Adding an official Cask authorizes this rebuild unless the user explicitly
   requests only an edit or asks to skip rebuilding. Do not ask again or
   replace it with separate package and system validation builds.
3. After the requested rebuild succeeds, stop. Keep the direct declaration
   unless there is a reported usage problem or an explicit request for further
   work.

Do not insert separate flake checks, package builds, release or asset audits,
architecture inspection, checksum recalculation, or signature verification
before this ordinary workflow. Use the existing official metadata and lock;
normal Nix source verification still applies. Quick local edit checks must
not expand into repository-wide validation or dependency updates.

Activation follows the requested or previously established rebuild mode:
perform an authorized switch without another permission pause, and preserve a
build-only request as build-only. Without activation authorization, use
`nix build --no-link` for the target system rebuild. A rebuild request does not
authorize a full lock update, garbage collection, or deletion of old
generations. Avoid wrappers that add those operations unless they are
separately authorized.

If the rebuild fails or actual use reveals a problem, diagnose that concrete
failure with the relevant checks below. Metadata mentioning installer scripts,
system paths, lifecycle hooks, or unusual artifacts is not itself a reason to
start an audit or develop `brew-api-extra` or `brew-nix-extra`.

## Consumer file boundaries

Keep package provenance visible in the consumer:

- `flake-brew.nix` owns brew-nix imports, ordinary cask selections, and
  cask-specific consumer options;
- `nix-packages.nix` owns overlay imports and selections for non-Homebrew
  applications published through `futuping/nix-packages`;
- `flake-nixpkgs.nix` owns packages provided directly by the pinned nixpkgs
  input;
- the main `flake.nix` wires these focused local modules and any genuine remote
  lifecycle modules into the Darwin system.

Move both the package selection and its related overlay import when an
application is reclassified. Never leave the same application in multiple
package lists.

In every ordinary consumer package list, make each application entry a bare
identifier relative to the surrounding `with` namespace. Reject qualified
package paths, generated namespaces, inline derivations, interpolated paths,
and local aliases for those expressions. Keep qualified remote module
references only in `imports` or the main flake's `modules` list.

## Third-party metadata catalog

Pin the catalog as a non-flake input:

```nix
brew-api-extra = {
  url = "github:futuping/brew-api-extra";
  flake = false;
};
```

Import brew-nix's cask generator with that catalog:

```nix
thirdPartyBrewCasks = import "${inputs.brew-nix}/casks.nix" {
  inherit pkgs;
  brew-api = inputs.brew-api-extra.outPath;
};
```

Treat the generated package as a remote implementation detail, not a consumer
selection:

```nix
thirdPartyBrewCasks."example-token"
```

Keep this namespace separate inside the remote implementation so token
collisions and metadata provenance remain visible. Expose each reviewed token
to the consumer through the existing `brew-nix-extra` third-party overlay and
thin module, or add a focused remote overlay when necessary. The overlay must
merge the token into `pkgs.brewCasks`; then `flake-brew.nix` selects only the
bare token:

```nix
environment.systemPackages = with pkgs.brewCasks; [
  example-token
];
```

Never place `thirdPartyBrewCasks."example-token"` or an alias for it in the
consumer package list.

Declare every catalog-backed token, including tokens used by focused overlays,
in one shared remote registry. Make the overlays and a standalone lock guard
consume that registry; do not introduce a token only as a literal attribute
selection inside an overlay. The guard must read the `brew-api-extra` catalog
from `brew-nix-extra`'s own standalone lock and fail with the missing tokens
listed. This verifies compatibility, not freshness: an older catalog remains
valid when it contains every required token.

Token presence alone does not prove that a newer brew-nix generator capability
is available. When implementation depends on such a capability, add an
explicit standalone probe that applies the real overlay and forces the
affected derivation using `brew-nix-extra`'s own locked inputs.

## Package-normalization overlay

Use an overlay when a reproducible rebuild or usage failure establishes that
a generated package needs a reusable correction without activation state.
A requested audit may also establish such a defect; do not introduce an
overlay speculatively from metadata alone:

```nix
normalizedPackage = sourcePackage.overrideAttrs (oldAttrs: {
  installPhase = oldAttrs.installPhase + ''
    package-specific-normalization "$out/Applications/Example.app"
  '';
});

overlay = final: prev: {
  brewCasks = prev.brewCasks // {
    example = normalizedPackage;
  };
};
```

Merge with `prev.brewCasks`; never replace the complete namespace. Review
collisions before exposing a third-party token there, and retain the metadata
source in the remote overlay implementation.

A thin nix-darwin module may install the overlay after brew-nix:

```nix
{ lib, ... }:
{
  nixpkgs.overlays = lib.mkAfter [ overlay ];
}
```

Keep application selection conventional in `flake-brew.nix`:

```nix
environment.systemPackages = with pkgs.brewCasks; [
  example
];
```

Adding or deleting the package name should be the only per-host operation. Do
not add a program enable option unless the application has lifecycle state
beyond package presence.

## Dedicated lifecycle module

Pin remote lifecycle modules as a flake input:

```nix
brew-nix-extra.url = "github:futuping/brew-nix-extra";
```

Import the required module centrally:

```nix
modules = [
  inputs.brew-nix.darwinModules.default
  inputs.brew-nix-extra.darwinModules.example
];
```

Keep per-host configuration declarative:

```nix
programs.example.enable = true;
```

A reusable module is appropriate when an observed rebuild or usage failure
requires lifecycle management, or when the user explicitly requests that
management. A successful ordinary rebuild with no reported usage problem is
the stopping condition for a routine Cask addition. The module should:

- export `darwinModules.<token>`;
- provide `programs.<token>.enable` and `programs.<token>.package`;
- default to `pkgs.brewCasks.<token>` only when official metadata exists;
- accept an explicitly generated third-party package otherwise;
- avoid consumer-specific flake inputs and `specialArgs`;
- own complete install, upgrade, disable, and removal convergence;
- isolate extraction and signing workarounds to the affected package.

For a system path, copy through a same-filesystem staging directory, validate
the staged artifact, then replace the managed target. Record ownership in a
marker that identifies the deployed package. Never remove or overwrite an
unmarked target.

## Lock sequence

For changes to custom catalogs, packages, overlays, lifecycle modules, or
updaters, close and publish each changed dependency edge before updating its
consumer. An ordinary official Cask declaration does not require this sequence
or a lock update:

1. Validate and publish `brew-api-extra` when its registry, adapter, or
   generated catalog changes.
2. In `brew-nix-extra`, update only each direct input whose new content or
   capability is now required, then inspect the lock diff:

   ```sh
   nix flake update brew-api-extra
   nix flake check --all-systems --no-build --no-update-lock-file
   ```

   Run the explicit catalog and overlay capability probes, publish
   `brew-nix-extra`, and require its push/pull-request CI to pass. If a newer
   `brew-nix` capability is required instead, update and probe that direct
   input by the same rule.
3. Only after both remote revisions are published, update the consumer inputs
   that must provide those revisions. A consumer-level catalog input followed
   by `brew-nix-extra` must contain the required tokens before updating the
   dependent flake:

```sh
nix flake update brew-api-extra --flake ./nix-darwin
nix flake update brew-nix-extra --flake ./nix-darwin
```

Run only the commands required by the changed dependency edges. Never use the
consumer commands or its `follows` overrides in place of updating and checking
`brew-nix-extra`'s own lock. Do not require locks to equal upstream HEAD; the
invariant is that each dependent repository's lock contains every capability
its implementation uses.

## Validation sequence

The ordinary official Cask workflow above requires no separate validation
gate. Use strict checks for a reported rebuild or usage failure, an explicitly
requested audit, or changes to custom packaging, catalogs, overlays, lifecycle
modules, and updaters. For diagnosis or an audit, choose checks that answer the
actual question; do not automatically run the complete sequence.

For custom implementation changes, retain these applicable checks:

1. Run Nix formatting checks.
2. Run `git diff --check`.
3. Run parsing checks and updater or adapter tests when those files change,
   using the repository's locked maintainer entry point.
4. Run `nix flake check --no-build --no-update-lock-file` from each changed
   remote repository root, without consumer overrides. Add `--all-systems`
   when the full flake is safe to evaluate in clean CI; otherwise follow
   [maintainer-environments.md](maintainer-environments.md) and explicitly
   force every changed cross-system output without silently dropping coverage.
5. Force every catalog token and changed overlay/package capability under the
   remote repository's own lock. A generic overlay function check is not
   sufficient.
6. Confirm read-only push/pull-request CI runs the same standalone check and
   probes before updating the consumer lock.
7. When the consumer integration changes, run its flake check and evaluate the
   target Darwin system derivation. These checks do not require activation.
8. Inspect the focused consumer lists for duplicate declarations and reject
   non-bare Cask entries in `flake-brew.nix`, including
   `pkgs.brewCasks.<token>`, `inputs.*.packages.*`, generated namespaces,
   inline derivations, interpolated paths, and aliases for qualified package
   expressions.

For a concrete failure, requested audit, or custom packaging change, use a
targeted package build with `nix build --no-link` when needed and authorized.
Build the target Darwin system only when needed to reproduce or validate the
integration problem. Inspect artifact layout, architecture, source hashes, or
`codesign --verify --deep --strict` results when they bear on that work. There
is no mandatory package-plus-system build pair.

When builds are excluded, use no-build evaluation or an existing exact output
only as needed for the requested diagnosis or audit. Report what was checked
and what remains unverified. Do not activate solely as a diagnostic step;
activation still follows the authorized rebuild mode.

## Signing policy

Apply this policy when diagnosing a reported failure, performing a requested
signature audit, or changing custom packaging or signing. It does not add a
signature preflight to ordinary official Cask selection. A diagnostic warning
alone does not authorize re-signing or expanding the integration scope.

- Preserve a Developer ID signature only after strict verification proves it
  remains valid in the packaged result.
- If the extracted or materialized application has a broken or incomplete
  signature, a package-specific override may apply a complete ad-hoc
  signature.
- Set `dontFixup = true` when later fixup would invalidate a verified package
  signature.
- Validate the final app after every signing override.
- Do not generalize a signing workaround to the complete package namespace.
- Re-signing cannot make an untrusted artifact trustworthy; source ownership
  and SHA-256 validation remain mandatory.

## Artifact compatibility

brew-nix commonly models ordinary `app`, `binary`, and `pkg` artifacts. Use
this table during fault diagnosis or custom integration work; do not turn it
into a prerequisite audit for a routine official Cask addition.

| Artifact or behavior | Handling |
| --- | --- |
| Official `.app`, binary, or `.pkg` | Select the bare token and run the requested ordinary rebuild; stop on success without a reported usage problem |
| Plain non-official `.app` bundle | Add or reuse a narrow catalog adapter |
| Reproducible package defect needing a reusable correction | Export and validate a focused package-normalization overlay |
| Missing or unusable command reported in actual use | Inspect the generated executable layout and address the demonstrated defect |
| `.pkg` with an observed rebuild or usage failure | Inspect the relevant scripts and paths, then choose the narrowest required correction |
| Input method, system extension, driver, or privileged helper | Use a lifecycle module only for an observed lifecycle problem or an explicit lifecycle request |
| Login/logout or approval requirement | Report it explicitly; do not hide it in rebuild behavior |
