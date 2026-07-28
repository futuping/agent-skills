# Compatibility decision guide

Classify the upstream cask before adding metadata.

## Proceed with an existing app adapter

Proceed when all of these are true:

- The cask installs one `.app` artifact.
- The version, SHA-256, URL, name, description, homepage, and app name are
  represented by the adapter's exact supported layout.
- Download URLs use HTTPS and resolve only to reviewed hosts.
- No installer scripts, privileged helpers, system extensions, drivers, input
  source registration, or post-install hooks are required.

## Add a new catalog adapter

Add a narrowly scoped adapter when the artifact is still compatible with
brew-nix, but its source layout differs. Examples include a universal app using
different interpolation, a standalone binary, or a package whose metadata
needs additional parsing.

An adapter is a metadata parser, not a macOS installer. Keep installation
semantics in Nix or nix-darwin.

## Require a dedicated Nix module

Use a dedicated module or activation design when the software must write to
system-managed locations or register with macOS. Common examples:

- `/Library/Input Methods`
- `/Library/SystemExtensions`
- `/Library/LaunchDaemons`
- kernel or driver locations
- privileged helper registration
- installer packages with scripts

Define removal behavior as well as installation behavior. Enabling and
disabling the option should converge without leaving stale system artifacts.

## Stop for review

Stop and explain the blocker when:

- the upstream checksum is absent or mutable;
- a URL redirects to an unreviewed host;
- the Ruby cask must be executed to discover essential values;
- the download requires interactive authentication;
- signing or notarization state cannot be established;
- installation would request new privacy, security, or administrator authority
  not already authorized by the user.
