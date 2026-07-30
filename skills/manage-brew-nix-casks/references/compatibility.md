# Compatibility decision guide

Classify metadata availability and lifecycle requirements separately.

## Consume an official cask directly

Use `pkgs.brewCasks.<token>` when the cask is present in the official Homebrew
API and brew-nix models its artifact correctly.

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

Use a focused overlay when brew-nix already produces an ordinary app, binary,
or package but the derivation needs a reusable package-only adjustment such as:

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

Use `brew-nix-extra` or another dedicated module when software must write to
system-managed locations, register with macOS, or implement nonstandard
upgrade and removal behavior. Common examples include:

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

Stop and explain the blocker when:

- the upstream checksum is absent or mutable;
- a URL redirects to an unreviewed host;
- the Ruby cask must be executed to discover essential values;
- the download requires interactive authentication;
- signing or notarization state cannot be established;
- the lifecycle would overwrite an unmanaged system component;
- installation would request new privacy, security, or administrator authority
  not already authorized by the user.
