# Releasing

**Status: CURRENT DIRECTION (#323).** Describes how the product works today. Where it disagrees with `docs/DECISIONS.md`, that file wins.

**A version per app, because they ship on different clocks.**

`api` and `web` deploy themselves the moment a release merges. `android` and
`ios` are built by the same run and then go through store review, which takes
days.

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

**Merging the PR is what ships (D50).** Every commit to `main` runs the whole
gate — SQL suites from zero, e2e golden paths, typecheck, lint, unit tests, both
Worker builds. What a green CI does *not* do is deploy. Production changes when
this PR merges and at no other time:

- `api` and `web` deploy themselves the moment it merges — migrations, both
  Workers, cache purge.
- `android` and `ios` are BUILT by the same run and attached to it: an Android
  release bundle and an iOS archive. You download and upload those. Uploading
  is not automated because the repo holds no signing credentials — see
  *Archiving mobile* for what that would take.
  **The run also files an issue** titled `Upload to the stores: <tags>` with the
  checklist, the run link and the artifact expiry date (#443). Close it when the
  stores actually have the build; while it is open, they do not.
  **A release also retires the handoffs it makes unshippable** (#498): filing
  `android-v0.8.0` closes the still-open `android-v0.7.0` one, because nobody
  submits a build a release behind and an open to-do nobody will ever do is how
  this list stops being believed. It is per-platform — a release that tags only
  Android comments on a both-platform issue and leaves it open for the iOS half
  rather than dropping a real upload on the floor.

So the tag means the same thing for all four: *this is what shipped*. It used to
mean "live" for the Workers and "somebody should build this eventually" for the
phones, which is exactly as confusing as it sounds.

**What that costs.** Migrations sit on `main` unapplied until you merge. A batch
of work reaches production at once, so a bad release has a wider blast radius
than a bad commit did — `wrangler rollback` is still seconds, `supabase db push`
still is not.

**One thing worth running afterwards (#586):**

```bash
node scripts/ops/verify-api-headers.mjs
```

It asks production whether the API's security response headers are actually on
the wire, reading what to expect out of `apps/api/src/http/security-headers.ts`
rather than a second copy of the list. Read-only, no credentials, two requests.

It is not in CI on purpose. Between a merge and a release it would be red for a
reason nobody needs telling — the fix is merged, production is a version behind —
and a check that is red for a known reason is one people learn to scroll past.
This is the only property in §10 of `SPEC.md` that a unit test cannot reach: the
middleware being present in the source proves nothing about the deployed build,
about something stripping a header in front, or about a route that quietly stopped
honouring the default. #586 existed because that gap was never measured.

## Reading the Actions tab (#493)

Three checks run on every push to `main`, and only the last one reaches
customers. The names say which is which:

| Check | What a green tick means | Did it ship? |
|---|---|---|
| **Gate** | Everything passed: SQL suites from zero, e2e, typecheck, lint, unit tests, both Workers built, both phone apps compiled. | No |
| **Version & changelog** | `release-please` rewrote the open release pull request. On the one push that IS that PR merging, it also cut the versions, tags and GitHub Releases. | Almost always no |
| **Ship to production** | Migrations applied, both Workers deployed, phone builds attached. | **Yes** |

**Version & changelog** used to be called just "Release", which read as "this
went live" on every push when it almost never means that. It now writes a
one-line summary on each run saying which of its two jobs it just did — so "did
this ship?" is answered on the run itself rather than inferred from a name.

**Ship to production** is SKIPPED on an ordinary push. That is the design, not a
failure: merging the release PR is what deploys (D50).

Release pull requests deliberately carry no PR checks. They are opened by a bot,
so GitHub parks those runs at "action required" until somebody clicks approve —
a check that never runs looks like a gate and gates nothing. The same gate runs
on the push that produced the PR and again on the push that merges it, before
anything ships.

**If nothing releasable has landed and you need to ship anyway** — a stretch of
`chore`/`ci`/`docs` work produces no release PR at all — run **Main** manually
from the Actions tab. It requires a written reason and records it on the run.
That door exists precisely so "no release PR" can never mean "no way to ship".

## Tell the people who reported it (#321)

**After merging, before you close the tab: reply to the reports this release
fixed.** It is one search and a handful of replies, and it is the cheapest
loyalty moment a company this size gets. Skipping it is not neutral — a report
that vanishes teaches somebody not to report the next one, and the next one is
the bug we would otherwise never hear about.

The mechanics are already laid out for you, and deliberately so:

1. Every in-product report arrives with a subject built by `supportSubjectFor`
   (`packages/shared/src/support.ts`), so all the reporters of one failure share
   an exact subject line — `Problem: the carrier suspended our US registration`.
   Search the inbox for it and you have everybody, not just whoever you
   remember.
2. Each report carries the workspace id and the app build it came from, so you
   can tell who is already on a build that has the fix and who has to update.
3. Reply on the original thread. There is no ticket id to quote because there
   are no tickets — #253 chose a mailto precisely so no queue, vendor or SLA
   exists, and the email thread IS the record.

This step is written down here rather than left to memory because the product
now promises it out loud: the Help screen on all three clients says we write
back when a fix ships. That sentence is only honest if this happens on every
release.

**What is NOT news.** Not every fix in a release is worth a reply — only the
ones somebody actually wrote in about. The changelog covers the rest, and
mailing people about repairs they never noticed is how a channel they trust
becomes one they filter.

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

**Release traceability.** `ship.yml` stamps the deployed commit into the API Worker
(`--var GIT_SHA:<sha>`) and Sentry reports it as the release, so a production
error maps to the exact commit that shipped it. That is what makes Sentry's
regression detection and suspect-commits work.

## What runs when

Three workflow files, and each name is what it does.

| File | When | What it is |
|---|---|---|
| **`checks.yml`** | every pull request, and called by `main.yml` on every push to `main` | **the gate.** SQL suites from zero, e2e golden paths, typecheck, lint, unit tests, both Workers built, both phone apps compiled and tested. Deploys nothing |
| **`main.yml`** | every push to `main` | **the pipeline.** `gate` → `release` → `ship`, in that order, ordered by `needs:` |
| **`ship.yml`** | called by `main.yml`, only when the release PR merged | **production.** Migrations, api Worker, web Worker, cache purge, and both phone release builds |

So there is one question per file: *is this ok?* (checks), *what happens on main?* (main), *what reaches customers?* (ship).

`main.yml` also takes a manual run with a written reason — the door for a stretch of `chore`/`docs`/`ci` work that produces no release PR at all and could otherwise never ship.

**Why the gate is a separate file at all:** so a pull request and a merge run *the same checks*, not two copies that drift. `main.yml` calls it rather than repeating it.

### What a direct push to `main` does not run (#601)

Most work here lands by pushing straight to `main`, and the release pull requests
are merged with `--admin`. Two checks only ever fire on a `pull_request` event, so
a direct push is never seen by either:

| Check | Where | Seen by a direct push? |
|---|---|---|
| **`Dependency review`** (`security.yml`) | pull request only | **no** — a dependency added by a direct push is never compared against the advisory database or the licence deny-list |
| **CodeQL's pull-request analysis** | pull request | the *scan* runs on push too; the pull-request diff annotations do not |

This is a property of how we merge, not a misconfiguration, and it is the reason
`pnpm audit` and the weekly `Security` schedule matter more here than they would
in a repo where everything arrives as a pull request.

`Dependency review` has a second problem worth knowing about before you read a
green tick: **the dependency graph is off for this repository**, so the check
cannot evaluate anything at all. It is an organisation-level setting, so it is not
fixable from a workflow or by any pull request. Since #601 the job **steps aside
with a warning annotation** on pull requests instead of failing them — a check
that is red on every pull request about a setting nobody can change is how people
learn to merge past red — and the weekly **`Dependency graph is on`** job fails
for as long as it stays off. That scheduled red is the whole safeguard; if you
delete it, the pull-request skip stops being honest.

To fix it: an owner with `admin:org` enables Dependency graph at
<https://github.com/organizations/BytechLabs/settings/security_analysis>. It is
free on public repositories.

**What replaced what.** There used to be four workflows chained by `workflow_run`, which is a trigger and not an ordering — nothing guaranteed the release tags existed before the deploy looked for them, a cancelled run produced no deploy and no complaint, and answering "did this ship?" meant opening three runs. On 2026-07-26 six commits in a row failed and shipped nothing while every page looked ordinary. `needs:` cannot do that.

For `android`/`ios` the released version is the one you archive and upload, and
the generated notes are the "What's new" text. Those are the only artifacts where
a version is user-facing.

## Has either app actually been submitted? (#443)

**Unknown as of 2026-07-30, and that is the honest answer rather than a gap in this
document.** The repo can prove the release configuration builds; it has no way to
know what a human did with the artifact afterwards, because the decisive act happens
at Apple and Google and produces no state we hold.

| Platform | Submitted? | To what | When |
|---|---|---|---|
| Android | **not recorded** | — | — |
| iOS | **not recorded** | — | — |

**Fill this in, once, and then keep it current by closing the handoff issue** — that
issue is now the running record, so this table only needs to say where things stood
the first time. Until it says otherwise, assume the stores are behind the tags: a
version tagged here and a version available to a customer are different facts, and
this is the only place that distinguishes them.

Why it matters beyond tidiness: release-please publishes notes that become the
store's "What's new" text. A changelog describing a build nobody can download is a
customer-facing claim about a version that does not exist for them.

**The one thing that can answer it without a dashboard** is version telemetry
(#339): `node scripts/ops/version-distribution.mjs` reports what the wild is
actually running. If a tagged version has no users a week after upload, it was
either never submitted or never approved — and that is a question worth asking
rather than assuming.

## Archiving mobile

**The artifacts expire after 90 days** (`retention-days` on both upload steps). An
unsigned archive that expires is a release that can no longer be shipped without a
rebuild — recoverable, but the clock is real and the handoff issue states the exact
date.

The build number must be overridden or the store rejects the upload:

```bash
./gradlew :app:bundleRelease -PloonextVersionCode="$(git rev-list --count HEAD)"
```

```bash
xcodebuild archive -project Loonext.xcodeproj -scheme Loonext -archivePath build/Loonext.xcarchive CURRENT_PROJECT_VERSION="$(git rev-list --count HEAD)"
```

## Before submitting to either store (#254)

Store declarations are binding legal statements about data handling, and both
platforms enforce them. Getting one wrong does not fail at submission — it gets
the app pulled weeks later in a review sweep, which for a business phone line
is an outage for every mobile customer at once with no engineering fix
available.

Run this whenever a release touches the apps. It takes a few minutes.

**The mechanical half now runs on every commit** (#502).
`packages/shared/src/store-declarations.test.ts` fails when a purpose string in
`apps/ios/project.yml` or a permission in `AndroidManifest.xml` is not named in
the declaration filed for it, when a filed purpose string has drifted from the
one the app shows, when the inventory contradicts the code, or when a deletion
surface a declaration names has moved. It was written because this list is a
checklist and #459 shipped a contacts permission that three documents then
denied for a week.

What is left below is the half a test cannot do: reading the prose and judging
whether it is still honest.

1. **Did this release change what data leaves the device?** A new permission, a
   new field stored, a new third party, a new thing sent to a model. If yes,
   update `docs/DATA-INVENTORY.md` FIRST, then both declarations, then submit
   the change with the release. Not after.
2. **Do the three still agree?** `docs/DATA-INVENTORY.md`, the two store files
   (`apps/ios/store/privacy-nutrition.md`, `apps/android/store/data-safety.md`)
   and the privacy policy are one statement made three times. A discrepancy in
   any direction is the finding.
3. **Purpose strings** in `apps/ios/project.yml` still describe what the app
   actually does with each permission, in words a person would recognise.
4. **Android permission justifications** in the Play Console still match
   `apps/android/store/data-safety.md`, especially the Contacts one.
5. **Anything new sent to a model?** That is a third-party sharing disclosure
   on both forms, not an implementation detail.

**Account deletion and the deletion URL are no longer on this list.** They were
items 5 and 6, and both are mechanical, so asking a person to re-check them
every release taught the reader that this list is busywork — which is how the
items above it get skimmed too. `store-declarations.test.ts` now asserts that
each client still RENDERS the delete-account card (a file that exists is not a
surface anybody can reach: dropping one call site in a refactor leaves the file
in the tree, the declaration still promising the route, and the button gone from
the app), and that the deletion URL filed in each declaration is a path this
site actually serves. Checking those two separately was the gap: a typo in the
declaration passed both halves, and Play does not re-check the URL until it
404s in a review sweep.

## Commit conventions — enforced

```
<type>(<scope>): <subject>
```

**`feat`, `fix`, `perf` and `revert` subjects are published verbatim in the
release notes.** A customer reads them, so they are checked like changelog copy,
not like commit messages:

- **one change per subject.** No counts ("6 fixes"), no "several"/"multiple", no
  dash or semicolon stapling two statements together, no comma lists. A release
  note is one thing a customer can understand — split the commit, or name the
  single user-visible outcome and leave the parts for the body
- **describe what the customer experiences, not the code.** The audience is
  field-service crews, so `reducer`, `middleware`, `webhook`, `endpoint`,
  `refactor`, `wire up`, `extract` and friends are rejected. (Words naming a
  user-VISIBLE symptom are fine, even technical-looking ones.)
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
good   fix(ios): an expired session no longer signs you out mid-shift

bad    fix(web): 6 round-4 fixes - a call reported but never placed, a dead-end gate
                                            <- a count, internal shorthand, AND
                                               three changes in one line
bad    fix(web): refactor the softphone provider   <- names the code, not the user
bad    feat(api): wire up the webhook endpoint     <- same
bad    fix: fixed some things                      <- past tense, vague
bad    feat(api): #221                             <- a reference, not a description
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

### A client scope must match the diff

Release-please routes a commit to a changelog by the **files** it touches, and
for the store apps those generated notes are the "What's new" text. So a
`feat(android)` that also edits `apps/ios/**` lands in the **iOS** changelog
with the word `android` as its first word — which is what shipped in af2f2b5
(#441). The subject was well-formed and the routing was right; the wrong part
was a fact about the diff, which no string check can see.

For `feat`/`fix`/`perf`/`revert`, a client scope is therefore checked against
the paths:

| Scope | May touch |
|---|---|
| `web` | `apps/web` |
| `android` | `apps/android` |
| `ios` | `apps/ios` |
| `mobile` | both phones |
| `clients` | all three |

**Cross-platform work uses `mobile` or `clients`, or is split into one commit
per client.** Picking the platform you happened to write first is the mistake
this exists to catch.

Only client scopes are checked. `api`, `db`, `shared` and feature scopes
(`contacts`, `compose`, …) make no platform claim — a server change shipping
its own migration is normal work, not a mislabel. Internal types
(`chore`/`docs`/`refactor`/…) are exempt too, since their scope reaches no
customer.

## Rolling back

A Worker rolls back in seconds — this is what makes shipping a batch safe:

```bash
pnpm --filter @loonext/api exec wrangler rollback
```

A **migration does not roll back**. That asymmetry is why `supabase db push` is
the one genuinely irreversible step in the pipeline, and why destructive
migrations get their own guard (see docs/ENVIRONMENTS.md).
