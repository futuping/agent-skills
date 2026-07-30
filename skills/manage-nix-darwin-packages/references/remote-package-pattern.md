# Remote non-Homebrew package pattern

## Contents

- [Decision boundaries](#decision-boundaries)
- [Repository layout](#repository-layout)
- [Package and source state](#package-and-source-state)
- [Overlay and Darwin module](#overlay-and-darwin-module)
- [Updater acceptance policy](#updater-acceptance-policy)
- [macOS bundle policy](#macos-bundle-policy)
- [Consumer migration](#consumer-migration)

## Decision boundaries

Use this pattern for an ordinary macOS application that is not best represented
by nixpkgs or Homebrew. Keep these cases elsewhere:

- adequate nixpkgs package: consume it directly;
- Homebrew cask: use `manage-brew-nix-casks`;
- system extension, input method, driver, LaunchDaemon, or privileged helper:
  use a lifecycle module;
- private licensed artifact that must not be referenced publicly: keep its
  package definition private.

Publishing Nix expressions does not necessarily redistribute the artifact, but
public URLs, hashes, metadata, and automated downloads can still have licensing
or access implications.

## Repository layout

Prefer one small shared flake instead of one repository per application:

```text
.
├── flake.nix
├── flake.lock
├── packages/
│   └── example-app.nix
├── sources/
│   └── example-app.json
├── scripts/
│   └── update_example_app.py
├── tests/
│   └── test_update_example_app.py
└── .github/workflows/
    └── update-packages.yml
```

The package file changes only when packaging behavior changes. Automated
release updates change only source state.

## Package and source state

Example source state:

```json
{
  "version": "1.2.3",
  "url": "https://github.com/owner/project/releases/download/v1.2.3/example.dmg",
  "hash": "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
}
```

Example binary application package:

```nix
{
  fetchurl,
  lib,
  stdenvNoCC,
  undmg,
}:

let
  source = builtins.fromJSON (
    builtins.readFile ../sources/example-app.json
  );
in
stdenvNoCC.mkDerivation {
  pname = "example";
  inherit (source) version;

  src = fetchurl {
    inherit (source) url hash;
  };

  nativeBuildInputs = [ undmg ];
  sourceRoot = ".";

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/Applications"
    cp -R "Example.app" "$out/Applications/"
    runHook postInstall
  '';

  dontFixup = true;

  meta = {
    description = "Example macOS application";
    homepage = "https://example.com/";
    license = lib.licenses.mit;
    platforms = [ "aarch64-darwin" ];
    sourceProvenance = [ lib.sourceTypes.binaryNativeCode ];
  };
}
```

Use `fetchzip`, `unzip`, `7zz`, or another extractor only when it matches the
real artifact. Do not rename bundles unless the upstream or macOS integration
requires it.

## Overlay and Darwin module

Export the package and overlay from the flake:

```nix
let
  supportedSystems = [ "aarch64-darwin" ];
  forAllSystems = nixpkgs.lib.genAttrs supportedSystems;

  packageFor = system:
    let
      pkgs = import nixpkgs { inherit system; };
    in
    pkgs.callPackage ./packages/example-app.nix { };

  overlay = final: _prev: {
    example-app = final.callPackage ./packages/example-app.nix { };
  };
in
{
  packages = forAllSystems (system: {
    example-app = packageFor system;
    default = packageFor system;
  });

  overlays = {
    example-app = overlay;
    default = overlay;
  };

  darwinModules.example-app = { lib, ... }: {
    nixpkgs.overlays = lib.mkAfter [ overlay ];
  };
}
```

The module installs only the overlay. The consumer decides whether the package
is present. This keeps adding or removing an ordinary application equivalent to
adding or removing one package name.

## Updater acceptance policy

An updater should:

1. Parse source state before contacting the network.
2. Query an official stable-release endpoint.
3. Reject prereleases, downgrades, malformed versions, unexpected asset counts,
   unreviewed redirect hosts, oversized responses, and oversized downloads.
4. Match an architecture-specific asset by exact name rather than substring
   preference.
5. Stream the download while computing SHA-256.
6. Cross-check a published upstream digest when available.
7. Verify the application identity on macOS when possible.
8. Replace source JSON atomically only after all validation succeeds.
9. Exit successfully without rewriting the file when already current.

For immutable versioned release assets, fail a same-version hash change and
require review. For an intentionally mutable URL, require a documented stronger
identity check before accepting the replacement automatically.

Scheduled workflows should have:

- minimal `contents: write` permission;
- concurrency control;
- manual dispatch;
- updater unit tests before the live update;
- a bounded timeout;
- commits scoped to source state;
- an empty heartbeat commit or another strategy that prevents
  inactivity-based schedule disablement in a quiet public repository without
  rewriting package content.

## macOS bundle policy

Verify the original and final bundles separately:

```sh
/usr/bin/codesign --verify --deep --strict "/path/Example.app"
/usr/bin/codesign -dv --verbose=4 "/path/Example.app"
```

Also inspect:

- `CFBundleIdentifier`;
- `CFBundleShortVersionString`;
- `CFBundleExecutable`;
- Team ID and signing authority;
- executable architectures with `file` or `lipo -archs`.

Archive extraction or Nix fixups can invalidate a valid upstream signature.
Prefer an extraction method that preserves it. If that is impossible and an
ad-hoc signature is appropriate, sign the complete final bundle, set
`dontFixup = true`, and verify it again. An ad-hoc signature preserves bundle
integrity for execution but does not recreate upstream trust.

## Consumer migration

Publish the package repository first. Then:

1. Add its flake input with `inputs.nixpkgs.follows = "nixpkgs"`.
2. Import only the required Darwin module.
3. Replace `pkgs.callPackage ./local-package.nix { }` with the overlay
   attribute.
4. Update only the new input in `flake.lock`.
5. Evaluate the remote package derivation and compare it with the local one.
6. Delete the tracked local package file and stale module references.
7. Remove empty package/module directories from the filesystem.
8. Run no-build checks and evaluate the final Darwin system.
9. Commit the remote repository before the consumer repository.

If the consumer already has unrelated lock changes, stage only the new input's
lock hunk and leave the others untouched.
