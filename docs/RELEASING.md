# Releasing

**One version for the whole product.** Loonext 1.3.0 means the same thing in the
web app, the API, and both store listings — because to a customer it *is* one
product. Independent per-app versions would only make "what version are we on?"
a question with several answers.

## The whole process

Run the **Release** workflow in GitHub Actions. Leave the bump on `auto`.

That's it. It reads the Conventional Commits since the last tag, works out the
bump, writes `CHANGELOG.md`, updates the version everywhere, tags `v<version>`,
and publishes a GitHub Release with the notes.

Locally, the same thing:

```bash
node scripts/release.mjs --dry-run
```

```bash
node scripts/release.mjs
```

`--dry-run` prints the next version and the exact changelog section without
touching anything — worth doing first.

## What is automatic and never needs thinking about

**Build numbers.** Android `versionCode` and iOS `CURRENT_PROJECT_VERSION` come
from `git rev-list --count HEAD` at build time. Both stores reject an upload
whose build number is not strictly greater than the last accepted one, so this
must never be hand-managed; the commit count is monotonic by construction, needs
no stored state, and can't collide across branches. CI passes it automatically.

The `1` committed in `build.gradle.kts` / `project.yml` is a local-dev fallback
and is never what gets uploaded.

**Which version bump.** Inferred from the commits: a `feat!:` or a
`BREAKING CHANGE:` footer gives a major, any `feat` gives a minor, otherwise
patch. Override by picking `patch`/`minor`/`major` explicitly.

**Release traceability.** Deploy stamps the deployed commit into the API Worker
(`--var GIT_SHA:<sha>`) and Sentry reports it as the release, so a production
error maps to the exact commit that shipped it. That is what makes Sentry's
regression detection and suspect-commits work.

## What a release does NOT do

It does not gate deployment. `api` and `web` deploy on every green CI, exactly as
before — one version of a service exists at a time and nobody installs it, so the
tag is the *record* of what shipped, not a gate in front of it.

For `android`/`ios` the released version is the one you archive and upload, and
the generated notes are the "What's new" text. Those are the only artifacts where
a version is user-facing.

## Archiving mobile

The build number must be overridden or the store rejects the upload:

```bash
./gradlew :app:bundleRelease -PloonextVersionCode="$(git rev-list --count HEAD)"
```

```bash
xcodebuild archive -project Loonext.xcodeproj -scheme Loonext -archivePath build/Loonext.xcarchive CURRENT_PROJECT_VERSION="$(git rev-list --count HEAD)"
```

## Commit conventions

Already at ~199/200 adherence — this documents it rather than changing it.

```
<type>(<scope>): <summary>
```

`feat`, `fix`, `perf` and `revert` appear in the changelog. `chore`, `ci`,
`docs`, `test`, `refactor`, `build` do not — they stay in git where they belong.

Prefer a component scope (`web`, `api`, `android`, `ios`, `shared`) and put issue
references in the body (`Refs: #214`). An issue-number scope still works; it just
reads worse in release notes, so the generator omits it.

## Rolling back

A Worker rolls back in seconds — this is the reason continuous deploy is safe:

```bash
pnpm --filter @loonext/api exec wrangler rollback
```

A **migration does not roll back**. That asymmetry is why `supabase db push` is
the one genuinely irreversible step in the pipeline, and why destructive
migrations get their own guard (see docs/ENVIRONMENTS.md).
