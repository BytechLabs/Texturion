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
is an accessibility failure (#238), not a polish item.

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

### 4. Why not screenshots

#320's own devil's advocate is right: pixel-diff visual regression produces
noisy diffs that get rubber-stamped, which converts a quality gate into a rubber
stamp and is worse than nothing. It also names the better instrument — assert on
**contrast ratios and token usage**, because those fail only when something is
genuinely wrong.

That is what every guard above does, and it is why the phone bugs were found by
arithmetic rather than by looking.

Screenshots still have one job no assertion can do: telling you whether a screen
*looks* right once every ratio is legal. They are used that way — deliberately,
by hand, at the point of change — via `scripts/dev-shot.mjs --dark` on web. What
remains open is running that capture automatically over a small, deliberate set
of primary surfaces on each client; see the "still open" section.

### 5. A rung that carries text is a text rung

Warm paper does not have room for seven legible greys. iOS shipped a seven-rung
muted ladder from the design canvas and used the lower rungs for body copy;
between ink and the AA floor there are **three** distinguishable steps, so
`muted600`/`500`/`400`/`300` now resolve to the third.

Hierarchy below that floor is carried by **size and weight**. A grey too faint
to read is not a hierarchy level — it is text nobody can read.

---

## Cross-platform parity

The three clients share the Paper & Olive palette (#362) but not its structure,
and the differences are deliberate. They are written down here so a future
correction is applied to all three rather than one.

| Role | Web | Android | iOS |
|---|---|---|---|
| Accent as **text** | `--app-olive-strong` `#3a430f` | `BrandColor.Olive` `#586E1B` | `BrandColor.olive` `#586E1B` |
| Accent as **decoration** (3:1) | `--app-olive` `#66801f` | *(same token)* | *(same token)* |
| Accent as **fill** | `--app-olive-accent` `#3a430f` + `--app-olive-foreground` | `secondary` + `onSecondary` | `lime` + `onLime` |
| Secondary text, dark | `--app-muted` `#c9ccba` | `DarkMuted500` `#939683` | `muted700` `#939683` |
| Error container | `--destructive` pair | `DarkDestructiveContainer` `#39231C` | `destructiveContainer` `#39231C` |

**The one real divergence:** web splits the accent into a decorative rung
(`#66801f`, 3:1) and a textual rung (`#3a430f`, 4.5:1). Both phones use a single
`olive` for both jobs, so it has to satisfy the stricter one — `#586E1B` is the
value that does while staying closest to the design canvas. Giving the phones
the same two-token split is a follow-up; until then they hold one token to the
higher bar, which is the safe direction to be wrong in.

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

## Still open

- **Automated both-theme capture** of a small, deliberate set of primary
  surfaces on each client, in CI. The instrument is chosen (`dev-shot.mjs` on
  web; Compose/XCTest snapshots on the phones) and the argument for keeping the
  set small is in §4 above. Not built.
- **The phone accent split** into decorative and textual rungs, to match web.
