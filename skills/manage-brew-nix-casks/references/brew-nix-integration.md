# brew-nix integration reference

## Flake input

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

## Lock and validation sequence

After publishing the metadata commit:

```sh
nix flake lock --update-input brew-api-extra <path-to-darwin-flake>
```

Use the consumer repository's own checks when present. At minimum:

1. Run Nix formatting checks.
2. Evaluate the target Darwin configuration without changing the lock again.
3. Build the new cask derivation or full Darwin system.
4. Inspect the store output under `Applications/`.
5. Verify application signatures with:

   ```sh
   /usr/bin/codesign --verify --deep --strict <built-app>
   ```

6. Run `git diff --check`.

Do not activate merely to discover whether evaluation or building succeeds.

## Signing policy

- Preserve a valid Developer ID signature.
- If upstream intentionally distributes an unsigned app and the extracted
  bundle contains an incomplete linker-generated ad-hoc signature, a
  package-specific `overrideAttrs` may apply a complete ad-hoc signature after
  installation.
- Validate the final app after any signing override.
- Do not generalize a signing workaround to the complete third-party catalog.
- Re-signing cannot make an untrusted artifact trustworthy; source ownership
  and SHA-256 validation remain mandatory.

## Artifact compatibility

brew-nix currently understands the ordinary `app`, `binary`, and `pkg`
artifact categories exposed by its cask generator. A matching JSON shape does
not guarantee correct macOS lifecycle behavior.

| Artifact or behavior | Handling |
| --- | --- |
| Plain `.app` bundle | Preferred; package, build, and verify the bundle |
| Standalone binary | Add a dedicated adapter and verify executable layout |
| `.pkg` installer | Add a dedicated adapter; inspect scripts and system paths before activation |
| Input method | Use a dedicated nix-darwin module for `/Library/Input Methods` and registration behavior |
| System extension, driver, privileged helper | Use a purpose-built activation/module design; do not model it as a plain app |
| Login/logout or approval requirement | Report it explicitly; do not hide it in unconditional rebuild behavior |

For input methods and system components, the catalog may still describe the
download, but brew-nix cask packaging alone is not the complete installation
solution.
