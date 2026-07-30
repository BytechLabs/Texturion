---
name: Capability (user-visible)
about: Something a customer can see or do. Names the clients, so closing cannot skip one.
title: ""
labels: []
---

<!--
#338. Use this for anything a customer can SEE or DO. For a platform-specific
defect (an Android IME bug, an iOS layout glitch), use a blank issue instead —
this template would only add ceremony to a one-client fix.

Why it exists: #198 was closed as done with iOS never implemented (#337), and
that was the third instance of the same class. "Done" was defined per pull
request rather than per capability, so whether the other two clients received a
change was nobody's checked responsibility. Every instance was caught later by a
person noticing, or by an expensive sweep.
-->

## What and why

<!-- What a customer can do afterwards that they cannot do now, and why it
matters to them. -->

## Clients

Every user-visible capability answers for all three. **"Not applicable" is a
perfectly good answer — silence is not.** If a box is unticked at close time, the
issue is not done.

- [ ] **Web** — <!-- done, or why it does not apply -->
- [ ] **Android** — <!-- done, or why it does not apply -->
- [ ] **iOS** — <!-- done, or why it does not apply -->

<!--
iOS is the one that goes missing. Swift compiles only in Mobile CI, so iOS work
ships compile-checked and visually unverified — it is the platform most likely to
be quietly skipped and the least likely for anyone to notice.

If the capability adds a new feature DIRECTORY on any client, register it in
scripts/check-client-parity.mjs. That check fails until you do, and filling it in
is where you say what the other two clients do.
-->

## Acceptance

<!-- What has to be true.

If this touches a rule in packages/shared, it is a THREE-EDIT change by
construction, not by judgement (#376): TypeScript for web and the API, Kotlin
for Android, Swift for iOS. The rules that must agree exactly are listed in
scripts/generate-parity-vectors.mjs, with a reason beside each inclusion and
each exclusion. If yours is one of them, regenerate the vectors — CI fails on a
stale file, and the Kotlin and Swift suites assert their ports against it. If it
is not, adding it there is a function and a list entry. -->

## Priority

<!-- P0 broken/unsafe · P1 bug or regression · P2 incomplete system · P3 tests,
UX, refactor · P4 new -->
