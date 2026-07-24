# Releasing

Four deployables, two release models. Keeping them separate is deliberate.

| | `apps/api`, `apps/web` | `apps/android`, `apps/ios` |
|---|---|---|
| Ships by | Continuous deploy on every green CI | App Store / Google Play review |
| Versions live at once | Exactly one | Many — old builds persist for months |
| Semver means | Little (no consumer to signal compatibility to) | Real, and user-facing |
| What a release is | A **record**: tag + changelog answering "what shipped when" | An **artifact** users install |

Nothing here gates deployment. `api`/`web` deploy exactly as before; releases are
the record, not a gate in front of it.

## What is automated

**Changelog + version bumps** — `release-please` watches `main` and keeps a
`chore: release` PR open, restating what would ship based on the Conventional
Commits landed since the last tag. Merging it writes the per-package
`CHANGELOG.md` files, bumps versions, and tags the release.

Commits are routed to a package by the **files they touch**, not by the commit
scope, so both `fix(web):` and `fix(#214):` land in the right changelog with no
change to how commits are written.

**Build numbers** — `versionCode` (Android) and `CURRENT_PROJECT_VERSION` (iOS)
are *not* managed by release-please. Both stores reject an upload whose build
number is not strictly greater than the last accepted one, so they come from
`git rev-list --count HEAD`: monotonic by construction, no stored state to
coordinate, and identical across the two platforms. CI passes it automatically.

**Release traceability** — the Deploy workflow stamps the deployed commit into
the API Worker (`--var GIT_SHA:<sha>`), which is reported to Sentry as the
release. A production error therefore maps to the exact commit that shipped it,
and Sentry's regression detection and suspect-commits work. Without it every
error was untagged.

## Cutting a release

1. Merge the open `chore: release` PR. That tags and writes the changelogs.
2. For mobile, archive and upload (see below). The generated `CHANGELOG.md`
   entry is the "What's new" text.

`api`/`web` need no step — they already deployed when their commit went green.

## Archiving mobile locally

The build number must be overridden, or the store will reject a second upload.

Android:

```bash
./gradlew :app:bundleRelease -PloonextVersionCode="$(git rev-list --count HEAD)"
```

iOS:

```bash
xcodebuild archive -project Loonext.xcodeproj -scheme Loonext -archivePath build/Loonext.xcarchive CURRENT_PROJECT_VERSION="$(git rev-list --count HEAD)"
```

Committed values (`versionCode = 1`, `CURRENT_PROJECT_VERSION: 1`) are the
local-dev fallback only. They are never what gets uploaded.

## Commit conventions

Already at ~199/200 adherence — this just documents it.

```
<type>(<scope>): <summary>
```

`type` is one of `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `ci`,
`build`, `chore`, `revert`. Only `feat`, `fix`, `perf` and `revert` appear in a
changelog; the rest are collected but hidden.

A breaking change is `feat!:` or a `BREAKING CHANGE:` footer, and drives a major
bump.

Prefer a **component** scope — `web`, `api`, `android`, `ios`, `shared` — and put
issue references in the body (`Refs: #214`) rather than the scope. Routing works
either way, but component scopes read far better in a changelog.
