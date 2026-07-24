# Autopilot

Project-agnostic autonomous loop: run `/autopilot` in any repo (the skill
lives at `~/.claude/skills/autopilot/SKILL.md`). It discovers the project's
own conventions, gates, and tracker on start.

This file is the Loonext-specific overlay the skill picks up here. Anything
below narrows or adds to the skill; the skill's rules otherwise apply.

## Binding overlays for this repo

- Tracker: GitHub issues on BytechLabs/Texturion via `gh`. Binding docs:
  MEMORY.md, docs/DECISIONS.md, brand/README.md, BRAND-MESSAGING.md.
- Gates: Android needs `export PATH="${PATH//\"/}"` first, then compile +
  unit tests + assembleDebug; web and api need lint + typecheck + full
  tests; api e2e needs Docker Desktop running (skip and note when it is
  not - CI covers it).
- Commits drive release-please: feat/fix/perf subjects publish verbatim to
  customers.
- Paper & Olive, the double-o brand (dark tile icon), and the wordmark rule
  are binding. No em dashes in user-facing copy. Never the one-number
  claim; marketing facts come only from BRAND-MESSAGING.md.
- Every new cost center ships with a cap and an alert before the cap.
- Posting to external channels and creating accounts stay founder-only.
- iOS cannot be compile-verified here: be conservative and route parity
  through its epic.
- Device-only verification (calling, push, telephony): ship, post the test
  protocol on the issue, leave it open, move on.

## Origination sources for this product

Competitors and adjacent products (OpenPhone, Podium, Heymarket, Textline,
Google Voice), SMB field-service workflow trends, A2P/10DLC and carrier
policy changes, Android/iOS platform capabilities, our own usage economics
and Sentry telemetry. Persona walkthroughs: a plumber's dispatcher, a solo
landscaper, a six-person HVAC crew.
