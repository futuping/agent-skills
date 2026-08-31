# Compatibility decision guide

Use the ordinary workflow for an existing official Cask. Consult the detailed
decisions below when a rebuild or actual use fails, the user requests a strict
audit, or the task changes custom packaging, catalog metadata, overlays,
lifecycle modules, or updaters.

## Consume an official cask directly

When the app already has an official Homebrew Cask, add its bare token once to
`flake-brew.nix` and perform the normal target Darwin rebuild.
Use the requested or previously authorized rebuild mode, including activation
when that mode authorizes it. Adding an official Cask authorizes this rebuild
unless the user explicitly requests only an edit or asks to skip rebuilding;
do not ask again. Without activation authorization, use `nix build --no-link`
for the target system rebuild.

Do not run separate package and system builds, flake evaluations, upstream
asset or hash audits, architecture checks, or signature verification as a
preflight. After the requested rebuild succeeds, stop unless there is a
reported usage problem or an explicit request for further work. A rebuild
request does not authorize full lock updates, garbage collection, or deleting
old generations; avoid wrappers that add those operations without authority.

PKG usage, installer scripts, system-path metadata, lifecycle hooks, or a
signature warning do not by themselves justify developing `brew-nix-extra`.

Do not duplicate an official cask in `brew-api-extra` solely to work around
unsupported installation semantics. Keep official version, URL, and hash
metadata authoritative, and solve lifecycle behavior in Nix or nix-darwin.

## Add catalog metadata

Use `brew-api-extra` when the cask is absent from the official API and all of
the following are true:

- The version, SHA-256, URL, name, description, homepage, and artifact can be
  represented by a narrow adapter.
- Download URLs use HTTPS and resolve only to reviewed hosts.
- Essential metadata can be extracted without evaluating Ruby.
- The artifact is compatible with brew-nix packaging, or a dedicated module
  can consume the generated package safely.

Add a new adapter when the metadata remains compatible but its source layout
differs. An adapter is a metadata parser, not a macOS installer.

## Use a package-normalization overlay

Use a focused overlay when a reproducible rebuild or usage failure, including
a defect established during a requested audit, shows that the derivation needs
a reusable package-only adjustment such as:

- deterministic archive normalization;
- a bundle-specific extraction correction;
- a narrowly scoped signing repair;
- another override that does not create persistent system state.

Export a named overlay from `brew-nix-extra`. Keep the metadata source visible,
review token collisions, and merge rather than replace the base package
namespace. If the overlay exposes the result through `pkgs.brewCasks`, let the
consumer install or remove it through the ordinary package list.

Do not introduce a `programs.<token>.enable` option merely to select an
ordinary application package.

## Require a dedicated nix-darwin module

Use `brew-nix-extra` or another dedicated module only when an observed rebuild
or usage failure requires lifecycle management, or the user explicitly
requests management beyond package selection. A successful ordinary rebuild
with no reported usage problem remains the stopping condition even when
metadata mentions paths such as:

- `/Library/Input Methods`
- `/Library/SystemExtensions`
- `/Library/LaunchDaemons`
- kernel or driver locations
- privileged helper registration
- installer packages with scripts

Require the module to:

- expose enable and replaceable package options;
- avoid consumer-specific `specialArgs`;
- install writable copies when upstream self-update requires them;
- use an ownership marker and refuse to replace unmanaged targets;
- stage replacements before switching the target;
- make enable, upgrade, disable, and repeated activation converge safely.

Use
[`futuping/brew-nix-extra`](https://github.com/futuping/brew-nix-extra) as a
reference for remote module packaging, not as a reason to generalize
application-specific workarounds.

## Stop for review

The following are blockers for the relevant proposed custom integration,
diagnosis, or audit; they are not a preflight checklist for unchanged official
Cask metadata. Complete safe, reviewable work first and pause only at a
concrete blocker, preserving authorization already given in the session:

- a custom source cannot be pinned or its required checksum is absent or
  mutable;
- a custom download URL redirects to an unreviewed host;
- the Ruby cask must be executed to discover essential values;
- the download requires interactive authentication;
- signing or notarization state cannot be established and the proposed work
  would re-sign or materially rewrite the bundle beyond ordinary Cask
  consumption;
- the lifecycle would overwrite an unmanaged system component;
- installation would request new privacy, security, or administrator authority
  not already authorized by the user.

Do not require a signature audit before an already authorized ordinary
rebuild. If a diagnostic warning surfaces during the requested work, report
its practical effect without treating it as permission to add packaging
changes or expand activation beyond the authorized mode.
