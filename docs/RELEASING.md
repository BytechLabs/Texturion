# Releasing

**A version per app, because they ship on different clocks.**

`api` and `web` deploy continuously — many times a day, always together, from
the same commit. `android` and `ios` go through store review every few weeks.

A single shared version sounds tidier but is a lie in practice: after forty web
releases the repo would read `0.9.0` while the App Store still served `0.1.0`,
so the mobile source tree would claim a version no user is running. Worse than
separate numbers, because it looks authoritative.

So each app carries its own, and **a commit only bumps the app whose files it
touched** — an API fix never bumps the mobile versions, and never implies a
store upload. Nothing is "released" unless its own code changed.

## The whole process

**Merge the release PR.** That's it.

`release-please` keeps a single PR open against `main` and rewrites it on every
push. It lists every app that has unreleased changes, with its next version and
exact changelog — so the open PR *is* the preview; there is nothing to run to
see what a release would contain. Apps with no changes are simply absent from
it.

Merging writes each app's `CHANGELOG.md`, bumps its version, tags it
(`api-v0.2.0`, `android-v0.3.0`, …), and publishes the GitHub Releases.

If nothing release-worthy has landed (only `chore`/`ci`/`docs`/`test`), no PR
appears — that is the correct answer, not a failure.

**Merging does not oblige you to upload anything.** A mobile version bump means
"this app has unreleased changes"; you upload when you actually want to ship.
`api`/`web` are already live either way — they deployed when their commit went
green.

## What is automatic and never needs thinking about

**Build numbers.** Android `versionCode` and iOS `CURRENT_PROJECT_VERSION` come
from `git rev-list --count HEAD` at build time. Both stores reject an upload
whose build number is not strictly greater than the last accepted one, so this
must never be hand-managed; the commit count is monotonic by construction, needs
no stored state, and can't collide across branches. CI passes it automatically.

The `1` committed in `build.gradle.kts` / `project.yml` is a local-dev fallback
and is never what gets uploaded.

**Which version bump.** release-please decides, from the commits: a `feat` gives
a minor, a `fix` a patch, a `feat!`/`BREAKING CHANGE:` a major. Nothing to
choose. (`Release-As: X.Y.Z` in a commit footer forces a specific version if you
ever need it.)

Starting at `0.1.0` because the product isn't public yet.

**Where releases start.** Each app has a baseline tag at launch —
`api-v0.1.0`, `web-v0.1.0`, `shared-v0.1.0`, `android-v0.1.0`, `ios-v0.1.0`.
Those are load-bearing: with no tag it can find, release-please treats the
entire history as unreleased and builds a PR body past GitHub's 65,536-character
limit, which is exactly how the first attempts failed (silently, with an empty
error message). The tag names must match the config's component names.

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

## Commit conventions — enforced

```
<type>(<scope>): <subject>
```

**`feat`, `fix`, `perf` and `revert` subjects are published verbatim in the
release notes.** A customer reads them, so they are checked like changelog copy,
not like commit messages:

- 12-72 characters — long enough to say something, short enough to read in a list
- present tense (`add`, not `added`), lowercase start, no trailing period
- no vague filler (`stuff`, `things`, `various`, `misc`, `wip`, `minor`)
- no internal shorthand (`round-3`, `batch 2`, `phase 1`, `follow-up`) — it means
  nothing outside this repo
- not just an issue reference — describe the change, keep `Refs: #214` in the body

`chore`, `ci`, `docs`, `test`, `refactor`, `build` and `style` are hidden from the
changelog and only have to be well-formed Conventional Commits. Internal work
stays frictionless; the bar applies to what users actually read.

```
good   fix(web): the dialer no longer reports a call it never placed
good   feat(ios): tap a map pin to get directions to the job site
bad    fix(web): 6 round-4 fixes            <- internal shorthand
bad    fix: fixed some things               <- past tense, vague
bad    feat(api): #221                      <- a reference, not a description
```

Enforced in two places, because either alone is insufficient:

- **`commit-msg` hook** — rejects it before the commit exists. Installed by the
  root `prepare` script on `pnpm install` (`core.hooksPath=.githooks`).
- **CI** — re-checks the commits in the push, the gate `--no-verify` cannot skip.
  Only new commits are checked; history predates the rule.

Check a branch by hand:

```bash
node scripts/check-commit-message.mjs --range origin/main..HEAD
```

Prefer a component scope (`web`, `api`, `android`, `ios`, `shared`) — the
changelog reads better and the diff's intent is obvious.

## Rolling back

A Worker rolls back in seconds — this is the reason continuous deploy is safe:

```bash
pnpm --filter @loonext/api exec wrangler rollback
```

A **migration does not roll back**. That asymmetry is why `supabase db push` is
the one genuinely irreversible step in the pipeline, and why destructive
migrations get their own guard (see docs/ENVIRONMENTS.md).
