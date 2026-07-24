# Releasing

**One version for the whole product.** Loonext 0.4.0 means the same thing in the
web app, the API, and both store listings — because to a customer it *is* one
product. Independent per-app versions would only make "what version are we on?"
a question with several answers.

## The whole process

**Merge the release PR.** That's it.

`release-please` keeps a PR open against `main` titled
`chore(main): release X.Y.Z`, and rewrites it on every push. It always shows the
next version and the exact changelog that would ship, so the open PR *is* the
preview — there is nothing to run to see what a release would contain.

Merging it writes `CHANGELOG.md`, bumps `version.txt` plus the Android
`versionName` and iOS `MARKETING_VERSION`, tags `v<version>`, and publishes the
GitHub Release.

If no release-worthy commits have landed (only `chore`/`ci`/`docs`/`test`), no
PR appears — which is the correct answer, not a failure.

## What is automatic and never needs thinking about

**Build numbers.** Android `versionCode` and iOS `CURRENT_PROJECT_VERSION` come
from `git rev-list --count HEAD` at build time. Both stores reject an upload
whose build number is not strictly greater than the last accepted one, so this
must never be hand-managed; the commit count is monotonic by construction, needs
no stored state, and can't collide across branches. CI passes it automatically.

The `1` committed in `build.gradle.kts` / `project.yml` is a local-dev fallback
and is never what gets uploaded.

**Which version bump.** Inferred from the commits: any `feat` gives a minor,
otherwise patch.

**We are pre-1.0, deliberately.** The product is not public yet, so it lives in
`0.x` — where semver's contract is "anything may change". A breaking change
(`feat!`, or a `BREAKING CHANGE:` footer) therefore bumps the **minor**
(`0.1.0` → `0.2.0`) rather than jumping to `1.0.0`, which would announce a
stability promise that isn't being made yet.

Going 1.0.0 is a deliberate act: add a `Release-As: 1.0.0` footer to a commit
when the product is genuinely ready for public consumption. The same footer
forces any specific version.

**Where releases start.** `v0.1.0` is tagged as the baseline. Without it the
first release PR would sweep up all 506 commits of pre-launch history — whose PR
body exceeds GitHub's 65,536-character limit, which is exactly how the first
attempt failed. Releases begin from that tag.

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
