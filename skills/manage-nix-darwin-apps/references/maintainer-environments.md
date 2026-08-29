# Locked repository maintainer environments

## Contents

- [Decision boundary](#decision-boundary)
- [Repository contract](#repository-contract)
- [Fixed command contract](#fixed-command-contract)
- [Runtime versions and compatibility](#runtime-versions-and-compatibility)
- [CI and updater permissions](#ci-and-updater-permissions)
- [Cross-system evaluation](#cross-system-evaluation)
- [Validation and consumer boundary](#validation-and-consumer-boundary)

## Decision boundary

Use a repository-owned maintainer environment when a reusable remote
repository contains code that maintainers or automation must run: tests,
metadata generators, source updaters, formatters, or release checks. This
applies even when consumers import the repository as a non-flake data source.

Do not add runtimes merely because they are common or might be useful later.
Add Python, Node.js, Ruby, Lua, or another tool only when an actual repository
command needs it. A repository maintainer environment is not a reason to add a
global fallback runtime to nix-darwin or to change a consumer lock.

## Repository contract

Commit a standalone `flake.nix` and `flake.lock` in the repository that owns
the commands. Use the repository's own lock during local validation and CI;
do not borrow the consumer's nixpkgs pin or rely on a consumer `follows` edge.

Export:

- a named `devShells.<system>.maintainer`, optionally also used as `default`;
- `apps.<system>.maintainer-check` for deterministic offline checks;
- one clearly named app for each live updater or generator;
- `checks.<system>` when the same offline validation is suitable for
  `nix flake check`.

Keep the environment command-driven and minimal. Select language runtimes and
tools explicitly from the locked package set. Support only the systems that
can actually run the commands; a macOS updater that mounts and verifies a DMG
may be Darwin-only, while metadata parsing can often run on Linux and Darwin.

Document the fixed commands, for example:

```sh
nix develop --no-update-lock-file .#maintainer
nix run --no-update-lock-file .#maintainer-check
nix run --no-update-lock-file .#update-example
nix run --no-update-lock-file .#update-example -- --check
```

## Fixed command contract

Wrapper apps must invoke declared tools by their Nix Store paths, such as
`${python}/bin/python3`, rather than resolving `python3`, `node`, `ruby`, or
`lua` from `PATH`. If future code needs another runtime, add it to the flake and
wrapper in the same change. Do not satisfy the need with a global installer or
an unreviewed runner image tool.

Prevent language-specific user state from changing results. For Python entry
points, set `PYTHONNOUSERSITE=1` and `PYTHONDONTWRITEBYTECODE=1`. Apply the
equivalent isolation for other ecosystems when their default module, gem, or
package search paths can load user-managed dependencies, and redirect their
supported writable cache or state paths away from global user locations.

Adding Ruby for a separate repository tool never authorizes executing a
Homebrew Cask as Ruby. Catalog adapters must continue treating the Cask DSL as
untrusted text under the registry-and-adapter contract.

Distinguish immutable flake source from the writable checkout. Offline checks
may execute a store snapshot such as `${self}`. An updater that changes source
state must instead:

1. resolve the repository root from an explicit argument, environment
   variable, or the current working directory;
2. verify repository sentinel files before writing;
3. pass the writable source or catalog path explicitly to the updater;
4. reject an invocation from the wrong directory;
5. make `--check` or dry-run modes perform no writes;
6. never attempt to write into `${self}` or another Nix Store path.

Use absolute paths for required macOS identity tools when they are platform
facilities rather than Nix dependencies, and verify the scheduled runner's
architecture when updater apps are architecture-specific.

## Runtime versions and compatibility

Declare two separate concepts:

- the maintainer version selected by the repository's locked flake;
- the oldest language version the updater source claims to support.

The exact patch version comes from each repository's lock. Do not describe a
runtime merely present in the pinned package set as globally configured, and
do not call a Python release an LTS version unless an actual downstream
distribution provides that policy.

When compatibility matters, run the complete offline suite at the declared
minimum and the maintainer version. Select the compatibility interpreter
explicitly, assert its actual major/minor version, and invoke the returned
absolute executable path. Treat setup-action matrices as compatibility probes,
not replacements for the locked maintainer environment.

Keep the declared floor honest. Syntax, annotations, standard-library APIs,
and test files must all parse and run on it. Remove an obsolete floor or repair
the code instead of letting CI fall back to whichever system interpreter is on
`PATH`.

## CI and updater permissions

Separate read-only validation from publication:

- pull requests and ordinary pushes use `contents: read`, run the compatibility
  matrix, evaluate the locked maintainer outputs, and execute
  `.#maintainer-check`;
- scheduled and manually dispatched updater workflows may use the minimal
  write permission required to publish generated state;
- scheduled workflows run tests before the live update and validation after
  it, using only the fixed Nix app entry points;
- ordinary pushes must not trigger a workflow that can regenerate, commit, and
  push metadata.

Keep existing cadence, concurrency, timeout, meaningful-change, and heartbeat
policies unless the task explicitly changes them.

## Cross-system evaluation

Prefer `nix flake check --all-systems --no-build --no-update-lock-file` when it
can evaluate every supported output in a clean CI environment. A warm local
Nix Store can conceal an import-from-derivation or source-realization failure,
so remote cold-cache CI remains authoritative.

If an unrelated pre-existing package makes the full all-systems check realize
an unavailable cross-platform source, replace only that broad probe with
explicit evaluations of every changed maintainer output. Force each supported
system's dev shell, check, app program, and updater app program. Retain focused
package, overlay, and module probes. Record why the scoped evaluation exists;
do not remove cross-system coverage merely to make CI green. When validation
requires native platform behavior rather than Nix evaluation, use a matching
runner instead of treating a foreign-system derivation path as execution proof.

## Validation and consumer boundary

Before publishing:

1. run Nix formatting, workflow YAML parsing, generated JSON validation, and
   `git diff --check`;
2. run `.#maintainer-check` through the locked environment;
3. enter `.#maintainer` non-interactively to confirm the selected runtime
   version, Nix Store executable, and isolation variables;
4. exercise updater wrappers with `--help`, an offline fixture, or a read-only
   `--check` mode before a live write;
5. run every declared compatibility version and the locked maintainer version;
6. confirm a live or dry-run update changes only the intended source state;
7. require the final read-only remote CI run to succeed.

A maintainer-only flake, lock, workflow, or documentation change does not by
itself require refreshing a consumer input. Update the consumer lock only when
consumer-visible package, module, catalog, or source state changed, or when the
user explicitly requests that pin. Never activate nix-darwin merely to verify
a repository maintainer environment.
