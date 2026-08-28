# Updater cadence policy

## Default cadence

Use one daily upstream check as the default for every application updater and
release monitor. Add a new application to an existing aggregate daily workflow
instead of creating another scheduled workflow when the security boundary and
runner requirements are compatible.

Keep `workflow_dispatch` for immediate checks. Use UTC, choose a non-zero
minute, and stagger repository schedules so they do not compete for runners or
push at the same time. Run dependency layers in this order:

1. metadata catalogs;
2. package and integration repositories;
3. consumer lock updates and builds.

For the futuping repositories, preserve this daily baseline unless a reviewed
exception applies:

| Repository or layer | Daily time |
| --- | --- |
| `brew-api-extra` metadata | 05:17 UTC |
| `nix-packages` independent packages | 06:37 UTC |
| `brew-nix-extra` source-pin updaters | 07:17 UTC |
| Consumer lock proposal, if automated | After 08:17 UTC |

Do not require exact start times between dependent GitHub Actions. Leave enough
separation for normal scheduler delay, and make each workflow independently
safe to rerun.

## Allow exceptions deliberately

Use a more frequent schedule only when all of these conditions hold:

- the application is security-sensitive or has a measured high release rate;
- the updater has stable identity checks and does not create metadata-only
  churn;
- downstream lock and validation automation can consume the added freshness;
- the repository documents the reason for the exception.

Prefer every six hours for an approved high-urgency exception. Do not use an
hourly application poll by default. Require an explicit user decision, an
active incident, or measured evidence that a daily check is inadequate before
using hourly polling.

Use a weekly schedule only when checks are unusually expensive or rate-limited,
the application changes rarely, and delayed detection has low impact. Retain a
manual dispatch path.

For a release that still requires human compatibility review, run a daily
monitor but create a proposal or report rather than automatically following a
development branch. Promote only a stable release that passes the route's
artifact, architecture, hash, runtime, and signature gates.

## Separate detection from installation

A remote metadata or source-pin commit does not update a pinned consumer.
Choose the consumer lock cadence explicitly. Prefer a daily lock-update pull
request or equivalent reviewed proposal after upstream workflows finish, with
no-build evaluation and macOS builds appropriate to the changed packages.

Never schedule unattended `darwin-rebuild switch`, privileged lifecycle
activation, generation deletion, or garbage collection as part of an updater.
Keep system activation explicit even when detection, lock updates, and builds
are automated.

## Prevent schedule-driven churn

Commit only a meaningful package identity change. Version, content hash,
artifact URL, architecture, or another reviewed immutable identity field may
justify an update. A changed `Last-Modified`, response timestamp, cache header,
or other transport metadata must not trigger a commit when the version and
artifact content are unchanged.

Reject unexpected same-version content changes unless the updater has a
documented stronger identity policy for an intentionally mutable artifact.
Keep update commits scoped to volatile source state and retain the repository's
heartbeat strategy without rewriting package content.

## Validate a cadence change

Before publishing:

1. Inspect every related workflow so a new application does not duplicate an
   existing schedule.
2. Parse the changed YAML and run updater unit tests.
3. Run the updater's check or dry-run mode when available.
4. Confirm the cron is daily by default, uses UTC, and is staggered from related
   repositories.
5. Confirm only meaningful source identity changes can produce a commit.
6. Report the remote check cadence, consumer lock cadence, and whether system
   activation remains manual.
