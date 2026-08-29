# brew-nix integration reference

## Contents

- [Official cask package](#official-cask-package)
- [Official direct-build gate](#official-direct-build-gate)
- [Consumer file boundaries](#consumer-file-boundaries)
- [Third-party metadata catalog](#third-party-metadata-catalog)
- [Package-normalization overlay](#package-normalization-overlay)
- [Dedicated lifecycle module](#dedicated-lifecycle-module)
- [Lock sequence](#lock-sequence)
- [Validation sequence](#validation-sequence)
- [Signing policy](#signing-policy)
- [Artifact compatibility](#artifact-compatibility)

## Official cask package

When Homebrew publishes the cask and brew-nix supports its artifact, use the
qualified package path only for evaluation or build commands:

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

## Official direct-build gate

Before creating an overlay or lifecycle module for an official Cask:

1. Add the bare token to `environment.systemPackages` in `flake-brew.nix`.
2. Run formatting, `git diff --check`, and a no-build flake evaluation.
3. Build `darwinConfigurations.<host>.pkgs.brewCasks.<token>` with
   `nix build --no-link`.
4. Build `darwinConfigurations.<host>.system` with `nix build --no-link`.
5. Inspect the package output for the expected application, binary, or package
   artifact when available.

If both builds succeed and the expected artifact exists, stop. Keep the bare
declaration and do not develop `brew-api-extra` or `brew-nix-extra`. Treat Cask
installer scripts, system paths, lifecycle hooks, and signature results as
diagnostic information rather than reasons to replace a successful direct
integration. Do not run `darwin-rebuild switch` for this gate.

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

Use an overlay when the official direct-build gate fails and a generated
ordinary package needs a reusable override but does not need activation state:

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

A reusable module is appropriate only after the direct-build gate fails for a
lifecycle reason, or when the user explicitly requests lifecycle management.
It should:

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

Close and publish every dependency edge before updating the next dependent
repository:

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

Always:

1. Run Nix formatting checks.
2. Run `git diff --check`.
3. Run `nix flake check --no-build --no-update-lock-file` from each changed
   remote repository root, without consumer overrides. Add `--all-systems`
   when the full flake is safe to evaluate in clean CI; otherwise follow
   [maintainer-environments.md](maintainer-environments.md) and explicitly
   force every changed cross-system output without silently dropping coverage.
4. Force every catalog token and changed overlay/package capability under the
   remote repository's own lock. A generic overlay function check is not
   sufficient.
5. Confirm read-only push/pull-request CI runs the same standalone check and
   probes before updating the consumer lock.
6. Run the consumer flake check and evaluate the target Darwin system
   derivation without activation.
7. Inspect `flake-brew.nix` and reject non-bare Cask entries, including
   `pkgs.brewCasks.<token>`, `inputs.*.packages.*`, generated namespaces,
   inline derivations, interpolated paths, and aliases for qualified package
   expressions.

For every official Cask unless builds were explicitly excluded:

1. Build the selected package with `nix build --no-link`.
2. Build the complete target Darwin system with `nix build --no-link`.
3. Confirm the expected artifact exists.
4. Stop without extra development when those checks succeed.

When additional inspection is useful:

1. Build the smallest affected package before considering a full system build.
2. Inspect the resulting bundle or artifact layout.
3. Run `codesign --verify --deep --strict` on final app bundles. After a
   successful direct-build gate, report failures as caveats rather than using
   them alone to justify extra development.

When building is explicitly excluded:

1. Evaluate the package derivation and output path.
2. If the exact output is already valid in the Nix store, inspect it and verify
   its signature.
3. Report clearly that no new build or activation ran.

Do not activate merely to discover whether evaluation or building succeeds.
In particular, never run `darwin-rebuild switch` for the direct-build gate.

## Signing policy

Apply this policy when direct integration fails and extra normalization is
actually required. A diagnostic signature failure after successful package and
Darwin system builds does not itself authorize an overlay or module.

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

brew-nix commonly models ordinary `app`, `binary`, and `pkg` artifacts. A
matching JSON shape does not guarantee correct macOS lifecycle behavior.

| Artifact or behavior | Handling |
| --- | --- |
| Plain official `.app` bundle | Consume `pkgs.brewCasks.<token>` |
| Plain non-official `.app` bundle | Add or reuse a narrow catalog adapter |
| Ordinary package needing a narrow reusable override | Export a package-normalization overlay |
| Standalone binary | Verify generated executable layout |
| Official `.pkg` installer whose package and system builds succeed | Keep the bare declaration; report scripts and system paths as caveats |
| `.pkg` whose direct build fails | Inspect scripts and system paths, then choose the narrowest required extra layer |
| Input method | Use a dedicated nix-darwin module for `/Library/Input Methods` |
| System extension, driver, privileged helper | Try the official direct-build gate first; use a lifecycle module only after failure or an explicit lifecycle request |
| Login/logout or approval requirement | Report it explicitly; do not hide it in rebuild behavior |
