# Theming discipline (#320)

**Status: BINDING.** Every surface on every client renders in light and dark.
This document says what may hold a colour, what may not, and how the three
clients stay in step. It exists because for a long time none of that was
written down, and theme correctness depended on somebody remembering to toggle.

---

## Why this exists

Theme bugs kept arriving one at a time, each found by a person looking at a
screen: mobile auth screens unreadable in light (#218), map pins illegible in
dark (#219), hovered rows invisible in light, a hover state that never lit up, a
storage slice nobody could see. Every one was fixed properly. The pattern was
the problem.

Two of them were not cosmetic. #116 was a functional break — app tokens died
inside portals without `PortalScope` on `<body>` — and every illegible element
is an accessibility failure (#238), not a polish item. (What #116 looks like
*today* turns out to be different, and that is worth reading before trusting any
check written against it: see "What proving it revealed about #116".)

When #320 finally pointed a measurement at the phone palettes, they had never
been checked by anything, and three things fell out immediately:

| Found | Where | Measured |
|---|---|---|
| `muted500`, carrying 77 `Text` views including error messages and empty states | iOS | **3.01:1** on the canvas ground, light |
| `errorContainer` pointed at the pale-lime "New lead" chip fill — **every error box on a dark phone was green** | Android | wrong colour outright; its message 4.12:1 |
| `olive`, carrying text at ~90 call sites | iOS | 4.04:1 on canvas, 4.41:1 on paper |

The web app had grown `globals.contrast.test.ts` for exactly this class and
fixed its own equivalent step in #61. **The fix never crossed over.** That is
the whole lesson: a fix in one client is not a fix in the others, which is why
#218 and #219 each had to name both phones separately.

---

## The rules

### 1. A colour is either a fill or a label, never both

Every fill token carries a matching label token: `--fr-on-olive`,
`--app-olive-foreground`, `BrandColor.onLime`, `onPrimary`. This is **D100**,
and it earned its own decision entry because the failure is invisible: an accent
that lifts between themes takes a hardcoded white label from 10.35:1 to 1.54:1
with nothing to notice it.

A token that is used as both — as `--fr-ink` was, being body text *and* the
footer's ground — must be split before either theme is authored.

### 2. Nothing hardcodes a colour

A component that reads a token gets both themes for free, because the token is
what changes between them. A literal gets whichever mode its author had open.

Enforced on all three clients:

| Client | Guard |
|---|---|
| Web app | `apps/web/src/app/(app)/token-discipline.test.ts` |
| Web marketing | `apps/web/src/app/marketing-dark.test.ts` |
| Android | `apps/android/…/ui/theme/ColorLiteralLintTest.kt` |
| iOS | `apps/ios/LoonextTests/ColorLiteralLintTests.swift` |

Each carries an allow-list where every entry is a **claim that the file draws
somewhere the tokens do not reach** — an error boundary rendered outside the
app shell, a third-party brand mark, an OS-read manifest value, a colour the
server sends. Convenience is not a reason. A guard whose allow-list can grow
silently is a guard that has stopped guarding, so each list also fails on a
stale entry.

**Shadows are exempt**, and that is a narrowing rather than a loophole: a drop
shadow is a dark translucent smudge in both themes — that is what a shadow is —
so it is not a mode-dependent decision the way a fill is. None of the bugs above
was a shadow.

### 3. Contrast is measured, not eyeballed

| Client | Guard | What it reads |
|---|---|---|
| Web app | `globals.contrast.test.ts` | the hexes in `globals.css`, both themes |
| Web marketing | `marketing-dark.test.ts` | both `.mkt-scope` columns |
| Android | `ThemeContrastTest.kt` | the `LightColors`/`DarkColors` **scheme objects** |
| iOS | `BrandColorContrastTests.swift` | `UIColor` **resolved through both trait collections** |

The phone guards deliberately read *resolved* values rather than parsing hex out
of the source. A source parse tests the literals; resolving tests what a person
actually sees — and the green Android error box lived in the **mapping**, not in
any single colour value, so only something that read the table could find it.

Bars: **4.5:1** for text (WCAG 1.4.3) and **3:1** for marks that carry state
(1.4.11). Hairlines and disclosure chevrons are held to neither, on the ground
that 1.4.11 covers what *identifies* a control — a row is tappable because of its
layout and copy; the chevron repeats that, and a divider could be whitespace with
nothing lost. Holding a hairline to 3:1 would make every list look ruled rather
than spaced, which is the opposite of the design.

### 4. Text over a gradient derives its contrast from the WORST stop

A gradient has no single background colour, so "the contrast of this label" is
not a well-formed question until you say *against which part of it*. The answer
this codebase uses: **the stop that gives the label its lowest ratio**, because
that is the part a reader's eye actually lands on somewhere.

Three concrete rules, from the places gradients exist today:

- **Never put body copy on a gradient that crosses the contrast floor.** If the
  label must span the whole ramp, the ramp's stops all have to clear the bar for
  that text — which usually means the gradient is a *tint* of one token, not a
  blend of two. `CallBackdrop.kt`'s radial and `Shell.kt`'s vertical fade both
  do this: they ramp one colour toward the surface behind it, so the worst stop
  is the surface, which is already measured.
- **A shimmer or sweep is decoration and carries no text.** `Motion.kt`'s
  `linearGradient` sweep is a loading affordance; nothing readable sits on it,
  so 1.4.11 does not apply and a ratio would be measuring nothing.
- **A mask is not a colour.** `arrival-field.tsx` uses `linear-gradient` as a
  `mask-image` to fade edges. That paints no pixels of its own and needs no
  contrast reasoning — but it does mean the audit's ancestor walk sees through
  it to whatever is behind, which is correct.

The rendered audit handles the general case without being told any of this: it
walks up to the nearest ancestor that actually paints and composites every
translucent layer on the way, so text over a translucent tint is measured
against what is really behind it. What it cannot do is sample *across* a
gradient's stops — so a label deliberately placed on a two-token ramp is the one
case that still needs a person to check, and the rule above is written so that
case does not get created.

### 5. Why not screenshots

#320's own devil's advocate is right: pixel-diff visual regression produces
noisy diffs that get rubber-stamped, which converts a quality gate into a rubber
stamp and is worse than nothing. It also names the better instrument — assert on
**contrast ratios and token usage**, because those fail only when something is
genuinely wrong.

That is what every guard above does, and it is why the phone bugs were found by
arithmetic rather than by looking.

Screenshots still have one job no assertion can do: telling you whether a screen
*looks* right once every ratio is legal. They are used that way — deliberately,
by hand, at the point of change — via `scripts/dev-shot.mjs --dark` on web.

What replaced automated capture is `scripts/theme-audit.mjs`, below: it renders
the same surfaces in both schemes and measures them, which is the part of
capture a machine can actually judge.

### 6. A rung that carries text is a text rung

Warm paper does not have room for seven legible greys. iOS shipped a seven-rung
muted ladder from the design canvas and used the lower rungs for body copy;
between ink and the AA floor there are **three** distinguishable steps, so
`muted600`/`500`/`400`/`300` now resolve to the third.

Hierarchy below that floor is carried by **size and weight**. A grey too faint
to read is not a hierarchy level — it is text nobody can read.

---

## Cross-platform parity

The three clients share one palette but not its structure, and the differences
are deliberate. They are written down here so a future correction is applied to
all three rather than one.

### #494 — neutrals, and lime as the only hue

**Status: BINDING. Supersedes Paper & Olive (#362).** The owner's decision:

> Majority of the colors throughout the website and apps should be neutrals,
> blacks, white, grey etc. Only use lime as the brand/accent color.

Paper & Olive put ONE hue on every surface — grounds, hairlines, body text,
hover fills, chips and the accent were all the same yellow-green family. A hue
applied to everything stops being an accent and becomes a cast, which is why a
palette containing lime read as "yellow", and why the actual lime had nothing to
stand out against.

**How the values were derived, and why that matters for anyone changing them:**
every neutral is the grey of the *same WCAG luminance* as the Paper & Olive
value it replaces. That is what let a repaint across four surfaces land in two
commits — the contrast suites pin ~30 pairs and every one held. If you move a
neutral, move it along the lightness axis and re-run the suites; do not
introduce a hue.

The rounding is not free at the boundary: `DarkMuted500` came out at 4.48:1
against the dark raised surface because green contributes most of a colour's
luminance and the matched grey lost a hair of it. `ThemeContrastTest` caught it
and the colour was raised to `#979797`. Raise the colour, never the bar.

**Lime is at ~83°, not 69°.** The old `#c9de54` was a yellow-green, which is
precisely what reads as yellow on a screen full of it. `#84cc16` light,
`#a3e635` dark.

**Lime is a FILL, never a label** (D100). It is bright enough that it can only
carry a dark label and can never be one on paper. That split is what lets the
accent be genuinely lime instead of a compromise dark enough to double as text:
web's `--fr-olive` stays the ink that carries links and focus rings, and
`--fr-brand` is the lime that carries the primary CTA and nothing else.

**What deliberately kept its hue:** the semantic states. Coral means attention,
green means handled, amber means waiting, clay means destructive. None of them
is the brand, and greying them would cost meaning to buy consistency.

| Role | Web | Android | iOS |
|---|---|---|---|
| Accent as **text** | `--app-olive-strong` `#1a1a1a` | `BrandColor.Olive` `#666666` | `BrandColor.olive` `#666666` |
| Accent as **decoration** (3:1) | `--app-olive` `#777777` | *(same token)* | *(same token)* |
| Brand **fill** | `--fr-brand` `#84cc16` + `--fr-on-brand` | `Lime` + `OnLimeChip` | `lime` + `onLime` |
| Secondary text, dark | `--app-muted` `#cacaca` | `DarkMuted500` `#979797` | `muted700` `#979797` |
| Error container | `--destructive` pair | `DarkDestructiveContainer` `#39231C` | `destructiveContainer` `#39231C` |

The token NAMES still say "olive" and "fr". They are historical; renaming them
is a mechanical change across ~40 files and is deliberately not bundled with a
value change, so that this repaint stayed reviewable as one thing.

**The one real divergence:** web splits the accent into a decorative rung
(`#777777`, 3:1) and a textual rung (`#1a1a1a`, 4.5:1). Both phones use a single
`olive` for both jobs, so it has to satisfy the stricter one — `#666666` is the
grey of the same luminance as the `#586E1B` it replaces, which is why that bar
did not move. Giving the phones the same two-token split is a follow-up; until
then they hold one token to the higher bar, which is the safe direction to be
wrong in.

`ThemeContrastTest.kt` asserts the Android values equal iOS's, so the two phones
cannot drift apart silently. The web/phone difference above is the one that is
allowed, and only because it is stated here.

---

## Where the values live

| Client | File |
|---|---|
| Web (app + marketing) | `apps/web/src/app/globals.css` |
| Android | `apps/android/…/ui/theme/Color.kt` → `Theme.kt` role mapping |
| iOS | `apps/ios/Loonext/Theme/BrandColor.swift` |

`docs/MOBILE-DESIGN.md` says the phone values are verbatim from the design
canvas and must not be eyeball-adjusted. That still holds — **and it is not what
happened here.** Each change above was derived (same hue, minimum move) and
measured, in the same way `--app-muted-2` was corrected on web in #61, and each
carries its ratio in a comment next to the value. A canvas value that cannot be
read is not a value the canvas intended.

---

## Rendered verification: `scripts/theme-audit.mjs`

Everything above reasons about tokens. This renders the app in a real browser,
in both schemes, and asks what colour things actually are. It found three faults
in its first run that every token suite had passed:

| Found | Measured |
|---|---|
| the missed-text calculator's `$1,353` at 72px/700 on the Frost band | 2.96:1 (large text needs 3:1) |
| the "Internal note · Priya" label, using the amber MARK colour as text | 2.66:1 |
| Settings' "Close this workspace" — a white label on the destructive fill | 4.41:1 |

None of those is visible from the token file, because each is legal against the
ground the token was reasoned about and wrong against the surface it was
actually placed on.

It reports five kinds of fault, and two of them exist because the audit lied
before they were added:

- `EMPTY` — the surface never rendered. With the API worker down every
  authenticated route shows "Loading your workspace…", and the audit found no
  contrast faults there and reported **green**. A check that silently examines
  nothing is worse than no check, because it also tells you everything is fine.
- `NOT-OPENED` — an overlay's trigger did not match, so the surface was never
  shown. Same reasoning: a missed click is a failure, not a skip.
- `ESCAPED-SCOPE` — a portal resolved its tokens outside `.app-scope` (#116).
- `CONTRAST` — text below its threshold against the background really behind it.
- `ERROR` / `AUTH` — the page threw, or the session bounced to `/login`.

### What proving it revealed about #116

Removing `PortalScope` and re-running was expected to reproduce the original bug.
It did not: **the colour half of #116 can no longer happen.** Since #362
converged the palettes, `:root` and `.app-scope` define the *same* values, so a
portal that escapes the scope now inherits an identical palette. That is worth
knowing — it means the fix is structural, not merely unbroken.

The **font** half is still live. `--font-golos` is mounted by next/font on the
layout element and exists nowhere in `:root`, so an escaped portal silently
falls back to the default sans. That is what `ESCAPED-SCOPE` now tests, and
removing `PortalScope` fails it on both portals in both themes.

### What runs where

Both halves run on every commit:

- **`build` job** — `--public`: marketing, `/login`, `/signup`. Needs only the
  built app; no database, no Worker, no secrets. 8 surface/theme combinations.
- **`theme` job** — `--authed`: the app shell and both portals, against local
  Supabase + `dev-seed` + the Worker + the web app. 12 combinations.

`scripts/ci-dev-vars.mjs` makes the second possible without any Cloudflare
credentials. It writes a `.dev.vars` of local URLs and visibly fake vendor keys
(refusing outright if Supabase is not localhost, and never overwriting an
existing file), and **derives** `wrangler.ci.jsonc` from the real config with
the Workers AI binding removed — that binding has no local emulation, so its
presence makes `wrangler dev` open a remote proxy session. Derived rather than
copied, because a duplicated config is correct on the day it is written and
wrong at the next binding change; the script exits non-zero if the line it
removes ever moves.

### Scope escapes, on all three clients

A colour can be correct and still arrive wrong, because it resolved in the
wrong place. Each client has one boundary where that can happen, and each now
has a guard:

| Client | The boundary | Guard |
|---|---|---|
| Web | Radix portals render into `<body>`, outside `.app-scope` | `PortalScope`, checked by `ESCAPED-SCOPE` in the audit |
| Android | `MaterialTheme.colorScheme` is a CompositionLocal; a composition outside `LoonextTheme` gets Material's purple defaults | `ColorLiteralLintTest.every composition root renders inside LoonextTheme` |
| iOS | `BrandColor` resolves per trait collection; a view pinning `.preferredColorScheme` freezes every token under it | `ColorLiteralLintTests.testNoViewPinsTheColourSchemeForTheUser` |

Neither phone guard found a bug. That is the point: both were correct by luck
rather than by rule, because nothing had ever asked.

---

## Still open

- **Phone snapshot rendering.** Both phone guards read *resolved* values and
  both scope boundaries are now guarded, which covers the failure modes
  rendering would catch. What is still missing is exercising a real layout —
  Compose/XCTest snapshots. Deliberately not built: adding a snapshot framework
  to a Material3-alpha / Xcode-26 toolchain is a standing maintenance cost, and
  #320's own devil's advocate is right that pixel diffs get rubber-stamped.
- **The phone accent split** into decorative and textual rungs, to match web.
