# Registry and adapter reference

## Layout

The metadata repository is
`https://github.com/futuping/brew-api-extra`.

```text
registry/<token>.json
scripts/update.py
scripts/adapters/
tests/fixtures/
tests/test_adapters.py
cask.json
```

`scripts.update` loads every registry entry, fetches its upstream cask, invokes
the selected adapter, sorts results by token, and writes one Homebrew
API-compatible JSON array.

## Registry schema

Common fields:

```json
{
  "token": "example",
  "adapter": "homebrew-app",
  "source": "https://raw.githubusercontent.com/owner/tap/main/Casks/example.rb",
  "download_hosts": [
    "downloads.example.com"
  ]
}
```

Requirements:

- Name the file exactly `<token>.json`.
- Use an HTTPS source.
- List only the hosts that may serve release artifacts.
- Keep adapter-specific configuration explicit.
- Never put volatile version or SHA-256 values in the registry when they can be
  read safely from the upstream cask.

## Included adapters

### `homebrew-app`

Use for a universal application with one each of:

- `version "..."`
- `sha256 "..."`
- an HTTPS `url` optionally interpolating `#{version}`
- `name`, `desc`, `homepage`, and one `app "...app"`

### `homebrew-arch-app`

Use for an application with:

- `arch arm: "...", intel: "..."`
- `sha256 arm: "...", intel: "..."`
- an HTTPS `url` interpolating `#{version}` and `#{arch}`
- `name`, `desc`, `homepage`, and one `app "...app"`

Also provide `intel_variations`, matching the Darwin version keys expected by
the pinned brew-nix/Homebrew API representation. The default entry is ARM and
the listed variations use Intel metadata.

## Adapter contract

Register an adapter in `scripts/adapters/__init__.py`. Its `build` function
accepts the upstream cask text and registry mapping, and returns one metadata
object.

Use helpers from `scripts/adapters/common.py` to:

- require fields and string lists;
- parse exact, anchored DSL patterns;
- interpolate only recognized variables;
- enforce HTTPS and the registry's download-host allowlist;
- construct metadata in stable field order.

Do not execute the cask Ruby. Do not implement a permissive pseudo-Ruby parser.
If a cask has conditionals or artifacts not represented by an existing
adapter, create a purpose-built adapter whose assumptions are visible and
tested.

For every new adapter:

1. Add a minimal offline Ruby fixture for each supported layout.
2. Test successful metadata, architecture/variation behavior, and at least one
   important rejection path.
3. Run the live generator against the real upstream source.
4. Confirm `python3 -m scripts.update --check` succeeds immediately afterward.
5. Confirm existing generated entries remain unchanged unless their upstream
   versions changed.

## CI behavior

GitHub Actions runs adapter tests and regeneration on relevant pushes, manual
dispatches, and the hourly schedule. It commits only `cask.json` when upstream
metadata changes. Registry and adapter changes therefore require a normal
human-authored commit; version refreshes are automatic.
