# Remote non-Homebrew package pattern

## Contents

- [Decision boundaries](#decision-boundaries)
- [Repository layout](#repository-layout)
- [Package and source state](#package-and-source-state)
- [Overlay and shared Darwin entry point](#overlay-and-shared-darwin-entry-point)
- [Package-selected lifecycle](#package-selected-lifecycle)
- [Updater acceptance policy](#updater-acceptance-policy)
- [macOS bundle policy](#macos-bundle-policy)
- [Maintainer environment](#maintainer-environment)
- [Remote lock closure](#remote-lock-closure)
- [Consumer migration](#consumer-migration)

## Decision boundaries

Use this pattern for an ordinary macOS application that is not best represented
by nixpkgs or Homebrew. Keep these cases elsewhere:

- adequate nixpkgs package: consume it directly;
- Homebrew cask: follow the Homebrew Cask route in this skill;
- system extension, input method, driver, LaunchDaemon, or privileged helper:
  keep any required lifecycle module in the remote shared entry point, normally
  activated by package selection;
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
    ├── check-flake.yml
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

## Overlay and shared Darwin entry point

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

  applicationModule = { lib, ... }: {
    nixpkgs.overlays = lib.mkAfter [ overlay ];
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

  # Named exports may remain for compatibility; consumers use the shared entry.
  darwinModules.example-app = applicationModule;
  darwinModules.default = {
    imports = [ applicationModule ];
  };
}
```

The shared entry point registers the repository's overlays and lifecycle
modules without selecting any applications. A source-level consumer import of
`inputs.nix-packages.darwinModules.default` is made once. Thereafter adding or
removing an application changes only its bare name in the focused
`flake-packages.nix` (or the repository's existing equivalent). Keep
application-specific imports inside the remote repository, never in the host.

The remote integration is incomplete until the consumer can select the package
by a bare identifier. When forwarding an upstream flake package instead of
calling a local package expression, expose it through the same overlay/module
boundary:

```nix
upstreamOverlay = final: _prev: {
  example-app =
    upstream.packages.${final.stdenv.hostPlatform.system}.example-app;
};
```

Export that overlay and register it through the shared Darwin entry point.
The forwarded derivation remains owned by the upstream flake; the overlay
provides the stable bare consumer attribute.

## Package-selected lifecycle

An application may need lifecycle management without needing a separate local
enable declaration. Detect the selected package in `environment.systemPackages`
inside the remote module and derive the default enable state from that
selection. Do not also add the package based on that computed state: doing
both creates a dependency cycle.

For an application that needs a writable installation, a small selection
package can carry a passthru reference to the original payload without exposing
a second immutable `.app` through the system application environment. Keep
this wrapper, payload, lifecycle script, options, and tests remote. Guard
attribute inspection for package values that are paths or strings, use stable
payload identities when comparing selections, and reject ambiguous selections
unless the user supplies an explicit override.

Keep the shared module loaded after the package is removed so it can clean up
only owned artifacts. Preserve replaceable package options and existing explicit
enable overrides for compatibility, but do not emit those options in the normal
consumer example. Document a separate enable declaration only when there is a
demonstrated limitation, such as the existing Wetype contract, or an explicit
user preference.

Evaluate the shared entry point itself: no package selected must keep the app
disabled without creating state or installing anything on a machine that has
never managed it. The bare selection must activate the correct payload,
removal must retain cleanup for previously owned state, and explicit overrides
must still work. Also force each registered overlay's package derivation and
confirm package lists do not grow from importing the shared module. Type-only
export checks are insufficient.

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

- minimal `contents: write` permission only for scheduled or manually
  dispatched publication;
- read-only push/pull-request validation in a separate workflow;
- concurrency control;
- manual dispatch;
- updater unit tests before the live update;
- a bounded timeout;
- commits scoped to source state;
- an empty heartbeat commit or another strategy that prevents
  inactivity-based schedule disablement in a quiet public repository without
  rewriting package content.

## Maintainer environment

Run updater tests and live updates through the repository's locked Nix entry
points, not a host `python3` or other ambient runtime. Follow
[maintainer-environments.md](maintainer-environments.md) for the dev shell,
wrapper, compatibility, writable-checkout, CI permission, and cross-system
evaluation contract.

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

## Remote lock closure

When the package repository forwards an upstream flake, update its own direct
input whenever the implementation starts requiring a newer package attribute
or capability. Do not update unrelated inputs merely for freshness. Before
publishing the package repository:

1. Run its flake check standalone from the repository root against its own
   lock, without consumer `follows` edges or `--override-input`.
2. Use `--all-systems` or explicit evaluations to force every supported-system
   package derivation, changed maintainer output, and the real overlay result.
   A type-only overlay/module check can pass while a forwarded attribute
   remains missing because Nix is lazy.
3. Run the same no-update check and explicit probes in read-only
   push/pull-request CI. Scheduled release-update automation does not replace
   this gate.
4. Publish this verified remote revision before adding or refreshing any
   consumer `follows` edge or lock pin.

Consumer deduplication may change the effective inputs and make a broken remote
lock appear healthy. Treat it as a graph optimization only, never as remote
lock validation.

## Consumer migration

Publish the package repository first. Then:

1. Add its flake input with `inputs.nixpkgs.follows = "nixpkgs"`.
2. Reuse the source's shared remote Darwin entry point; add it once at the
   source-wiring level only if absent. Do not add an app-specific import.
3. Add the bare package attribute to the matching focused list. Reject
   `inputs.*.packages.*`, `pkgs.<name>`, `pkgs.callPackage`,
   inline derivations, interpolated package paths, and local aliases for
   qualified package expressions.
4. Preserve existing focused consumer file names. Reserve `flake-nixpkgs.nix`
   for native nixpkgs packages and `flake-brew.nix` for Homebrew packages.
5. Replace `pkgs.callPackage ./local-package.nix { }` with the overlay
   attribute.
6. Update only the affected input in `flake.lock` and its required dependency
   nodes; preserve unrelated lock changes.
7. Evaluate the remote package derivation and compare it with the local one.
8. Remove the migrated app's local implementation and dedicated imports,
   options, manifests, scripts, tests, and empty directories. Include untracked
   and ignored remnants in the inventory; preserve unrelated files and shared
   maintenance checkouts. Confirm its bare name is the only app-specific
   consumer declaration, except a justified explicit-enable case.
9. Run no-build checks and evaluate the final Darwin system.
10. When a consumer commit is authorized, commit the validated remote change
    first. Migration does not by itself require committing unrelated consumer
    work or changing its existing index.

If committing the consumer is authorized and it already has unrelated lock
changes, stage only the intended input and required dependency changes. Leave
unrelated lock hunks and the existing index intact.
