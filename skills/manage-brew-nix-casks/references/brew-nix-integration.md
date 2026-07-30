# brew-nix integration reference

## Contents

- [Official cask package](#official-cask-package)
- [Third-party metadata catalog](#third-party-metadata-catalog)
- [Dedicated lifecycle module](#dedicated-lifecycle-module)
- [Lock sequence](#lock-sequence)
- [Validation sequence](#validation-sequence)
- [Signing policy](#signing-policy)
- [Artifact compatibility](#artifact-compatibility)

## Official cask package

When Homebrew publishes the cask and brew-nix supports its artifact, select it
from the official namespace:

```nix
pkgs.brewCasks.example
```

Keep official metadata authoritative even when a dedicated module must add
installation lifecycle behavior.

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

Select a package explicitly:

```nix
thirdPartyBrewCasks."example-token"
```

Keep this namespace separate from `pkgs.brewCasks` so token collisions and
metadata provenance remain visible.

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

A reusable module should:

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

Publish dependency repositories before updating the consumer:

```sh
nix flake update brew-api-extra --flake ./nix-darwin
nix flake update brew-nix-extra --flake ./nix-darwin
```

Run only the command for the input that changed. When both metadata and module
repositories change, publish and lock them in that order.

## Validation sequence

Always:

1. Run Nix formatting checks.
2. Run `git diff --check`.
3. Run `nix flake check --no-build --no-update-lock-file <flake>`.
4. Evaluate the target Darwin system derivation without activation.

When building is authorized:

1. Build the smallest affected package before considering a full system build.
2. Inspect the resulting bundle or artifact layout.
3. Run `codesign --verify --deep --strict` on final app bundles.

When building is explicitly excluded:

1. Evaluate the package derivation and output path.
2. If the exact output is already valid in the Nix store, inspect it and verify
   its signature.
3. Report clearly that no new build or activation ran.

Do not activate merely to discover whether evaluation or building succeeds.

## Signing policy

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
| Standalone binary | Verify generated executable layout |
| `.pkg` installer | Inspect scripts and system paths before activation |
| Input method | Use a dedicated nix-darwin module for `/Library/Input Methods` |
| System extension, driver, privileged helper | Use a purpose-built lifecycle module |
| Login/logout or approval requirement | Report it explicitly; do not hide it in rebuild behavior |
