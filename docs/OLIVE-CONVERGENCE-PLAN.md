# Olive convergence — the migration plan (#362)

**Status: PLAN, not yet executed.** Recorded here because the survey behind it
cost real work and because the change it describes repaints a public marketing
site, so the reasoning has to outlive the session that produced it.

**The decision** is the repo owner's, on #362:

> NO THE ENTIRE MARKETING SITE AND WEBAPP MUST FOLLOW THE APP STYLE. STAY
> CONSISTENT TO THE APP STYLES. REMOVE REFERENCES TO ANY OTHER STYLE, ONLY KEEP
> OLIVE (BOTH LIGHT/DARK MODES)

That overrides `APP-UI-ELEVATION.md` §6, `APP-SHELL-REDESIGN.md` and the v4
"FIRST RESPONSE" marketing spec, all three of which are marked BINDING and all
three of which mandate the opposite. Section 4 below lists every line that has
to die, by file and number, so the supersession is deliberate rather than
discovered later by somebody reading a document that is still confidently wrong.

Every hex below is sourced from the shipped mobile palette (`Color.kt`,
`BrandColor.swift`, `Theme.kt`) or `docs/MOBILE-DESIGN.md`. None is invented.
Every contrast ratio is computed with the same formula
`apps/web/src/app/globals.contrast.test.ts` already uses.

---

## AMENDMENT 3 — phase 8's real trap: `--fr-ink` is TWO things (found 2026-07-30)

Phases 1-7 and 9 are shipped. Phase 8 (marketing dark mode) is the only one left,
and the thing most likely to make a first attempt ship broken is not the 748
token reads — it is that **`--fr-ink` is used both as text and as a surface.**

`DESIGN-DIRECTION` says so itself: *"Dispatch Ink — headlines/body; also the ONLY
two dark surfaces (dateline chip, footer)"*. In the shipped code:

- `footer.tsx:76` — `background-color: var(--fr-ink)`
- `fr/chips.tsx:42` — `bg-[color:var(--fr-ink)] text-white` for `tone === "ink"`

A dark column that flips `--fr-ink` to a light value (`#F0F1E5`, as the app scope
does) **inverts those two surfaces** and leaves `text-white` on a near-white
background. The footer alone carries three `text-white/*` reads
(`footer.tsx:114,137,141`), and every one becomes invisible.

**So the first edit of phase 8 is not the dark block.** It is splitting the two
meanings:

- `--fr-ink` keeps the TEXT meaning and flips with the theme.
- A new constant token — `--fr-inverse` / `--fr-on-inverse` — takes the SURFACE
  meaning and does **not** flip, because a deliberately-dark band is dark in both
  modes. Point `footer.tsx` and the `ink` chip tone at it, replace their
  `text-white` with `--fr-on-inverse`, and only then author the dark column.

Verify by grepping for `var(--fr-ink)` in a `background`/`bg-` position before
and after; the count must reach zero.

**And phase 8 still has no mechanical gate.** `.mkt-scope` is light-locked by
construction (`color-scheme: light` at globals.css, plus an `@custom-variant
dark` that deliberately excludes marketing from the global `.dark`), so the
palette has never rendered dark and no test can tell you it looks right. 42 pages
need looking at. That is why it is sequenced last and why it is called a project
rather than a phase.

## AMENDMENT 2 — the repaint needs NO call-site edits (proved 2026-07-30)

Amendment 1 is right that phases 3 and 4 are one commit. It is wrong about how
big that commit is. Phase 4 as written moves ~200 call sites (77 `bg-primary`,
84 `text-primary`, 15 `bg-app-petrol`, 41 `text-app-petrol`, 43
`--app-petrol-deep`) because it assumes the accent cannot be both a text colour
and a fill.

**One palette member can be both.** `#3A430F` — the lime-chip text from
`Color.kt:56` — clears AA as text on every ground AND takes a paper label as a
fill:

| `#3A430F` (light) | ratio |
|---|---|
| as text on ground `#F3F3EE` | 9.48 ✅ |
| as text on paper `#FDFDF9` | 10.35 ✅ |
| as text on inset `#F0F0E8` | 9.21 ✅ |
| as a fill, paper `#FDFDF9` label | 10.35 ✅ |

Dark uses `#D6E77E` the same way: 13.53 / 11.99 / 11.43 as text, and 12.90 with
an ink label as a fill.

And `--app-petrol-deep`, the one genuinely double-meaning token (hover fill in
some places, text-on-tint in others), is served by **ink** in both roles:
paper-on-ink 17.05 as a fill, ink-on-tint 14.19 as text, ink-on-ground 15.61.

### So the whole repaint is a token-value change

| token | light | dark |
|---|---|---|
| `--primary`, `--app-petrol` | `#3A430F` | `#D6E77E` |
| `--primary-foreground`, `--app-petrol-foreground` | `#FDFDF9` | `#191B14` |
| `--app-petrol-deep` | `#191B14` | `#F0F1E5` |

Every existing `bg-*` and `text-*` call site keeps its class and lands on a
compliant pair. The forcing rule at `globals.css:833` can stay as one selector,
because there is again one fill foreground per theme — it was only the
ink/lime split that required two.

**Why this beats the ink-primary mapping.** Amendment 1 followed `Theme.kt`,
where Material's `primary` is Ink because it paints the outbound bubble. The
web's `--primary` is shadcn's brand-action colour, which is a different role: it
paints buttons AND is read as `text-primary` for links and counts in 84 places.
Ink there would strip the link affordance from every one of them. `#3A430F` is
a Paper & Olive palette member, reads as olive, and satisfies the owner's
"ONLY KEEP OLIVE" more literally than ink does.

The bubble itself is a separate token and can stay ink independently.

## AMENDMENT — phases 3 and 4 must land in ONE commit (proved 2026-07-30)

The plan below sequences "retarget `.app-scope`" (phase 3) and "split the
`bg-primary` / `text-primary` call sites" (phase 4) as separate steps. They
cannot be. Shipping phase 3 alone puts unreadable fills on 52 files.

**Nothing in the palette can carry AA text on olive `#66801F`.** Not a near
miss — every candidate fails:

| foreground on olive `#66801F` | ratio | AA 4.5 |
|---|---|---|
| paper `#FDFDF9` | 4.41 | ❌ |
| white `#FFFFFF` | 4.49 | ❌ |
| ink `#191B14` | 3.87 | ❌ |
| ink-soft `#4A4D3C` | 1.93 | ❌ |
| lime `#C9DE54` | 3.01 | ❌ |
| olive-strong `#3A430F` | 2.35 | ❌ |

So olive is **exclusively** a text/icon/stroke colour on a light ground. It is
not a fill with a darker or lighter label; it is not a fill at all. Ink takes a
paper label at 17.05:1 and lime takes an ink label at 11.64:1 — those are the
fills.

`--app-petrol` is a fill TODAY: `bg-app-petrol` exists in 8 files, `bg-primary`
in 44, and `globals.css:833` carries an unlayered rule forcing
`color: var(--app-petrol-foreground)` onto both. Retarget that token to olive
without first moving every fill-meaning call site to ink, and each of those 52
files renders text on a background where **no** foreground reaches AA — and the
forcing rule guarantees it, because it overrides whatever the component asked
for.

**So: one commit.** Retarget the surface and text tokens, move the fill-meaning
sites to `--primary` (ink) and the accent-meaning sites to `--app-olive` /
`--app-olive-strong`, and rewrite `globals.css:833` into two selectors — all
together. The contrast suite gates it, and phase 1 widened it precisely so this
commit cannot land wrong quietly.

## Evaluation

Three colour systems, one file. `apps/web/src/app/globals.css` holds `:root`/`.dark` (stone + oklch petrol, ~21 unscoped routes), `.app-scope`/`.dark .app-scope` (petrol hex, the signed-in product + every marketing product embed), and `.mkt-scope` (cobalt `--fr-*`, light-locked by construction). Paper & Olive has to feed all three. The good news the surveys surfaced: `FramedShot` has zero call sites, so marketing's product imagery is live DOM inside `.app-scope` — there is **no screenshot re-capture blocker**, and retargeting `.app-scope` repaints the app *and* the marketing embeds in one commit.

The bad news is that this is not a hue swap. Web `--primary` means *accent fill*; Paper & Olive's `primary` is **Ink** (`Theme.kt:23`, `primary = BrandColor.Ink`), olive is the *text* accent, and lime is the *highlight* fill. Three roles currently collapsed into one token. I confirmed the grammar in shipped code, not just the doc: `MessageBubbles.kt:120` — *"inbound on paper, outbound on ink, note a cream well"* — and `:161` fills the outbound bubble with `colorScheme.primary`, i.e. Ink, with `onPrimary` text. So `--app-bubble-out` is not a lime bubble; it is an ink bubble, and it should point at `var(--primary)`, not at the accent.

All ratios below are computed from the surveyed hexes with the same WCAG formula `globals.contrast.test.ts:41-55` uses. Every value is a hex that exists in `Color.kt` / `BrandColor.swift` / `Theme.kt`. Nothing is invented.

---

## 0. The decision that unlocks the table

**`--primary` becomes Ink, not olive.** Olive gets a new additive token; lime gets the highlight-fill role.

| role | today (one token) | Paper & Olive (three) | source |
|---|---|---|---|
| filled button, outbound bubble | `--primary` / `--app-petrol` `#0f766e` | **Ink** `#191B14` / `#F0F1E5` | `Theme.kt:23,55`; `MessageBubbles.kt:120,161` |
| link, count, emphasis, orb, slider progress | same token | **Olive** `#66801F` / `#B9CF57` | `Color.kt:44`, `BrandColor.swift:50`, `Theme.kt:56` |
| Answer button, selected highlight | same token | **Lime** `#C9DE54` / `#B9CF57`, label fixed Ink `#191B14` | `Color.kt:47,78`; `Theme.kt:32,66` (`onTertiary = Ink` in **both** schemes) |

Naive `--primary: #66801F; --primary-foreground: #ffffff` computes **4.49:1** and fails `globals.contrast.test.ts:113` by 0.01. That failure is the system telling the truth: olive is not a fill that can hold text. Do not lower `AA = 4.5` at line 57.

---

## 1. Token mapping table

Reference grounds — light: ground `#F3F3EE`, paper `#FDFDF9`, inset `#F0F0E8`, inset-deep `#E7E9DC`, raised `#E4E6D7`. Dark: `#141610`, `#1F2218`, `#23261A`, `#262A1D`, `#2C2F22`. ✅ = clears the bar, ⚠️ = flagged below.

### 1a. Surfaces (no text-contrast requirement)

| token | light now → new | dark now → new | note |
|---|---|---|---|
| `--background` / `--app-stone-0` | `#fbfbf9` → **`#F3F3EE`** | `#0e1512` → **`#141610`** | ground |
| `--card` / `--app-white` | `#ffffff` → **`#FDFDF9`** | `#151d1a` → **`#1F2218`** | paper is not white; `--app-white` becomes a lie in *both* modes |
| `--popover` | `#ffffff` → **`#FDFDF9`** | `#172019` → **`#23261A`** | derived; preserves today's deliberate one-step lift over card |
| `--secondary` / `--muted` / `--app-stone-1` / `--border-subtle` / `--app-line-soft` | `#f3f2ee` → **`#F0F0E8`** | `#172019`/`#1b2521` → **`#23261A`** | mobile `outlineVariant` (`Theme.kt:47,79`) |
| `--app-hover` | `#eae8e1` → **`#E7E9DC`** | `#1f2a25` → **`#2C2F22`** | 1.21:1 vs paper light (today 1.15), 1.18:1 vs card dark — the "light deepens, dark lifts" rationale survives |
| `--border` / `--input` *(surface edge)* / `--app-line` | `#ecebe5` → **`#E7E9DC`** | `#232e29` → **`#2C2F22`** | 155 usages, the most-used `--app-*` token |
| `--accent` / `--app-tint` | `#edf3f1` → **`#E3EFA3`** | `#14322d` → **`#39421A`** | mobile `primaryContainer` (`Theme.kt:25,57`) |
| `--app-tint-line` | `#cfe4de` → **`#D6E77E`** | `#1f4a43` → **`#4A4D3C`** | ⚠️ derived — no mobile equivalent |
| `--app-ava-*` (5 slots) | `var(--app-tint)` → **`#E4E6D7`** | → **`#2C2F22`** | split from `--app-tint`; AvatarTint `Color.kt:40,72` |
| `--sidebar` | `#ffffff` → **`#FDFDF9`** | `#111a16` → **`#141610`** | ⚠️ derived — mobile has a nav pill, no sidebar |
| `--sidebar-border` | `#ecebe5` → **`#E7E9DC`** | `#232e29` → **`#2C2F22`** | derived |
| `--app-amber-bg` | `#fbf6ec` → **`#F4E8CD`** | `#21201a` → **`#3A2F16`** | `Color.kt:91,95`; ⚠️ iOS ships `#2E2712` — drift |
| `--app-amber-line` | `#f0e6d2` → **`#EFE3CE`** | `#3a3626` → **`#4A4D3C`** | cream `Color.kt:65`; dark cream collapses onto raised |

### 1b. Text on grounds — the ratios that matter

| pairing | new value | ground `#F3F3EE` | paper `#FDFDF9` | inset `#F0F0E8` | inset-deep `#E7E9DC` | verdict |
|---|---|---|---|---|---|---|
| `--foreground` / `--app-ink` body | **`#191B14`** | 15.61 | 17.05 | 15.17 | 14.14 | ✅ |
| `--app-ink-soft` | **`#4A4D3C`** | 7.80 | 8.52 | 7.58 | 7.07 | ✅ |
| `--app-muted` (212 uses) | **`#4A4D3C`** | 7.80 | 8.52 | 7.58 | 7.07 | ✅ |
| `--muted-foreground` / `--app-muted-2` (106 uses) | **`#5C5F4E`** | 5.89 | 6.43 | 5.73 | 5.34 | ✅ |
| ~~muted-600~~ as a quiet rung | ~~`#6E7163`~~ | **4.49** | 4.90 | **4.36** | **4.06** | ❌ **fails AA — do not use for text** |
| `--foreground-tertiary` (intentionally sub-AA) | **`#A6A996`** | 2.16 | 2.36 | 2.10 | 1.96 | ✅ matches today's 2.21 decorative level |
| **olive as small text** | `#66801F` | **4.04** | **4.41** | **3.92** | **3.66** | ❌ **fails AA everywhere** |
| olive as ≥18.66px bold / UI / icon / ring | `#66801F` | 4.04 | 4.41 | 3.92 | 3.66 | ✅ (3:1 bar) |
| **compliant olive for small text** | **`#3A430F`** | 9.48 | 10.35 | 9.21 | 8.59 | ✅ palette-sourced (`Color.kt:56` lime-chip-text) |

| pairing (dark) | new value | `#141610` | `#1F2218` | `#23261A` | `#2C2F22` | verdict |
|---|---|---|---|---|---|---|
| `--foreground` / `--app-ink` | **`#F0F1E5`** | 15.99 | 14.17 | 13.51 | 11.99 | ✅ |
| `--app-muted` | **`#C9CCBA`** | 11.14 | 9.87 | 9.41 | 8.35 | ✅ (⚠️ iOS-only rung, `BrandColor.swift:39`) |
| `--muted-foreground` / `--app-muted-2` | **`#8F927E`** | 5.71 | 5.06 | 4.83 | **4.28** | ✅ on the three grounds the test checks; ⚠️ sub-AA on raised |
| ~~`#7F826F`~~ as a quiet rung | ~~`#7F826F`~~ | 4.62 | **4.10** | **3.91** | **3.46** | ❌ fails AA on card |
| `--foreground-tertiary` | **`#6F7260`** | 3.69 | 3.27 | 3.12 | 2.77 | ✅ decorative-only |
| olive/lime as text | **`#B9CF57`** | 10.53 | 9.33 | 8.89 | 7.89 | ✅ — dark olive is *lime*, it does not stay `#66801F` |

**Finding:** the light olive ladder has exactly **two** AA-passing quiet rungs (`#4A4D3C`, `#5C5F4E`), and the dark ladder exactly two (`#C9CCBA`, `#8F927E`). `MOBILE-DESIGN.md:16` implies an eight-rung light ladder; only the top two are usable for text on web.

### 1c. Accent, fills and their foregrounds

| token | light | dark | ratio | verdict |
|---|---|---|---|---|
| `--primary` fill | **`#191B14`** | **`#F0F1E5`** | — | `Theme.kt:23,55` |
| `--primary-foreground` | **`#FDFDF9`** | **`#191B14`** | 17.05 / 15.24 | ✅ |
| primary hover fill | **`#4A4D3C`** | **`#C9CCBA`** | 8.52 / 10.62 | ✅ |
| `--app-petrol` → the **olive accent** | **`#66801F`** | **`#B9CF57`** | as text: 4.04 ❌ light / 10.53 ✅ dark | ⚠️ see below |
| *new* `--app-olive-strong` (small accent text) | **`#3A430F`** | **`#D6E77E`** | 9.48 / 13.53 | ✅ |
| *new* `--app-lime` highlight fill | **`#C9DE54`** | **`#B9CF57`** | — | `Color.kt:47,78` |
| on-lime label (**fixed both themes**) | **`#191B14`** | **`#191B14`** | 11.64 / 10.04 | ✅ `Theme.kt:32,66` |
| lime hover fill | **`#A9C42B`** | **`#A9C42B`** | ink on it: 8.79 | ✅ (⚠️ Android-only hex) |
| `--accent-foreground` / `--app-petrol-deep` (text on tint) | **`#3A430F`** on `#E3EFA3` | **`#D6E77E`** on `#39421A` | 8.62 / 7.92 | ✅ |
| avatar initials | **`#4A4D3C`** on `#E4E6D7` | **`#F0F1E5`** on `#2C2F22` | 6.86 / 11.99 | ✅ `Theme.kt:30,62` |
| `--app-bubble-out` | `var(--app-petrol)` → **`var(--primary)`** | idem | 17.05 / 15.24 | ✅ ink bubble, per `MessageBubbles.kt:161` |
| `--ring` / `--sidebar-ring` | **`#66801F`** | **`#B9CF57`** | vs ground 4.04 / 10.53; vs paper 4.41 / 9.33; vs chip `#E3EFA3` 3.67 | ✅ 3:1 everywhere |
| `--input` **(form control border, WCAG 1.4.11)** | **`#6E7163`** | **`#7F826F`** | ≥4.06 light / ≥3.46 dark on every ground | ✅ |
| ~~mobile `outline`~~ as an input border | ~~`#B4B7A6`~~ / ~~`#4A4D3C`~~ | | **2.01** / **1.86** on paper | ❌ **fails 3:1 — mobile's own outline is non-compliant for inputs** |

### 1d. Status roles

| token | light | dark | ratio | verdict |
|---|---|---|---|---|
| `--destructive` / `--app-clay` as text | **`#B0442B`** | **`#E08B72`** | 5.09 / 6.23 | ✅ |
| destructive fill + label | `#B0442B` + `#FDFDF9` | `#E08B72` + `#191B14` | 5.55 / 6.71 | ✅ |
| destructive container | **`#F4DAD2`** | **`#39231C`** | with `#B0442B`/`#E08B72`: 4.26 ⚠️ / 5.66 ✅ | ⚠️ light pair sub-AA; use `#191B14` for body inside the well (13.7:1) |
| `--warning` / `--app-amber` as a **mark** | **`#9A6B15`** | **`#E0B25C`** | 4.20 vs ground, 3.85 vs `#F4E8CD` | ✅ as a 3:1 glyph, ❌ as small text |
| `--app-amber-ink` (text in the note card) | **`#191B14`** | **`#F0F1E5`** | 13.70 on `#EFE3CE` | ✅ — the amber is the mark, ink is the copy |
| coral attention dot | **`#D96C47`** | **`#E0764B`** | 3.05 / 5.96 | ✅ as a dot; **never** an error mark (`MOBILE-DESIGN.md:23`) |
| `--success` / `--info` | **`#66801F`** | **`#B9CF57`** | glyph 3:1 ✅; text ❌ → `#3A430F` | ⚠️ collapses onto the accent — see risks |

### 1e. Charts — the olive→lime ramp does **not** work on a light ground

| series | light | ratio vs `#F3F3EE` | dark | ratio vs `#141610` |
|---|---|---|---|---|
| 1 | **`#66801F`** | 4.04 ✅ | **`#B9CF57`** | 10.53 ✅ |
| 2 | **`#3A430F`** | 9.48 ✅ | **`#D6E77E`** | 13.53 ✅ |
| 3 | **`#B0442B`** | 5.09 ✅ | **`#E08B72`** | 7.04 ✅ |
| 4 | **`#9A6B15`** | 4.20 ✅ | **`#E0B25C`** | 9.28 ✅ |
| 5 | **`#5C5F4E`** | 5.89 ✅ | **`#8F927E`** | 5.71 ✅ |
| ~~lime-bright~~ | ~~`#A9C42B`~~ | **1.78** ❌ | usable in dark (9.22 ✅) | |
| ~~lime~~ | ~~`#C9DE54`~~ | **1.34** ❌ | — | |

The obvious "olive→lime ramp" collapses in light mode: both lime rungs are lighter than the ground. The ramp must run **downward into the dark olives and the warm hues**, not upward into lime.

### 1f. Sidebar (derived — mobile has no sidebar)

`--sidebar` `#FDFDF9`/`#141610` · `--sidebar-foreground` `#191B14`/`#F0F1E5` · `--sidebar-primary` = `--primary` · `--sidebar-primary-foreground` `#FDFDF9`/`#191B14` · `--sidebar-accent` `#E3EFA3`/`#39421A` · `--sidebar-accent-foreground` `#3A430F`/`#D6E77E` (8.62 / 7.92 ✅) · `--sidebar-border` `#E7E9DC`/`#2C2F22` · `--sidebar-ring` = `--ring`.

### 1g. Marketing `--fr-*` — plus the dark half that does not exist yet

| token | light now → new | **dark (new, authored)** | ratio |
|---|---|---|---|
| `--fr-ground` | `#fbfcfe` → **`#F3F3EE`** | **`#141610`** | — |
| `--fr-card` | `#ffffff` → **`#FDFDF9`** | **`#1F2218`** | — |
| `--fr-ink` | `#10173b` → **`#191B14`** | **`#F0F1E5`** | 15.61 / 15.99 ✅ |
| `--fr-ink-70` | `#3f4563` → **`#4A4D3C`** | **`#C9CCBA`** | 7.80 / 11.14 ✅ |
| `--fr-ink-55` | `#5a6080` → **`#5C5F4E`** | **`#8F927E`** | 5.89 / 5.71 ✅ |
| `--fr-cobalt` (link/accent) | `#2740de` → **`#66801F`** | **`#B9CF57`** | 4.04 ⚠️ / 10.53 ✅ — small link text must use `#3A430F` |
| `--fr-cobalt-deep` (CTA hover) | `#1f33b8` → **`#4A4D3C`** | **`#C9CCBA`** | 8.52 / 10.62 ✅ |
| primary CTA fill + label | white-on-cobalt 7.31 → **`#191B14` + `#FDFDF9`** | **`#F0F1E5` + `#191B14`** | 17.05 / 15.24 ✅ |
| `--fr-green` "answered" | `#0b7a50` → **`#66801F`** | **`#B9CF57`** | ⚠️ merges with the accent |
| `--fr-flare` "waiting" | `#ff4a1f` → **`#D96C47`** | **`#E0764B`** | 3.05 / 5.96 — ⚠️ semantics decision |
| `--fr-frost` (the one wash) | `#edf2fb` → **`#F0F0E8`** | **`#23261A`** | — |
| **the "one cobalt band"** | white-on-cobalt 7.31 → **lime band `#C9DE54` + fixed ink `#191B14`** | **`#B9CF57` + `#191B14`** | **11.64 / 10.04 ✅** |
| `--fr-shadow-card` | `rgba(16,23,59,.06)` → **`rgba(25,27,20,.06)`** | same | ink `#191B14` = `rgb(25,27,20)` |

The lime band is the one genuinely good news in the marketing half: white-on-olive is 4.49 and ink-on-olive is 3.87 — both fail — but ink-on-lime is **11.64:1** and is exactly mobile's Answer-button grammar (`Theme.kt:31-32,64-66`, `onTertiary = Ink` in both schemes). The saturated accent band survives, as lime rather than a coloured-text-bearing fill.

---

## 2. Order of work, smallest blast radius first

**Phase 0 — decide, don't code.** Sign off the §0 role map and the three derivations (sidebar, popover, tint-line). Write the missing values back into `docs/MOBILE-DESIGN.md`: dark olive `#B9CF57` (line 19 says "—" while `BrandColor.swift:50` and `Theme.kt:56` ship it), dark selection wash `#39421A` (line 22), dark cream `#2C2F22` (line 24), plus the ~50 web-only roles. *Verifies:* nothing — this is the gate, not a step.

**Phase 1 — widen the guards before touching a value.** Tests only. (a) Split `globals.contrast.test.ts:102-121`: the on-ink pair and the on-lime pair are two different fills with two different foregrounds; a single `--app-petrol-foreground` cannot AA against both in light mode (paper-on-lime 1.47, ink-on-ink 1.0). (b) Add accent-as-text assertions — the test currently never checks the accent as text, which is exactly where olive fails. (c) Add 3:1 assertions for `--ring` and `--input`. (d) Move the `--app-petrol: #0f766e` assertion out of `fr-tokens.test.ts:48-52` — an app-scope assertion inside a marketing test is why the two surfaces cannot be sequenced independently. (e) Widen the dead-hex sweep at `fr-tokens.test.ts:54-59` beyond `globals.css`. *Verifies:* `pnpm -C apps/web vitest run` — **green before and after**. If phase 1 goes red, the new assertions are wrong, not the palette.

**Phase 2 — add tokens, change nothing.** Introduce `--app-olive`, `--app-olive-strong`, `--app-lime`, `--app-lime-foreground` at their olive values alongside the untouched petrol tokens. *Verifies:* `vitest run` + `tsc --noEmit`; zero visual diff by construction.

**Phase 3 — retarget `.app-scope` + `.dark .app-scope`.** Hex only, never oklch (`globals.contrast.test.ts:32-38` hard-fails a non-6-digit-hex token with a misleading message). Do not reformat the dark selector — line 60 matches `".dark .app-scope,\n.app-scope.dark,\n.app-scope .dark"` verbatim. Repaints the product *and* every marketing embed. *Verifies:* contrast suite; `dev-shot.mjs` light + `--dark` on inbox / thread / settings (web on 3100 for CORS).

**Phase 4 — the hand audit.** Split 80 `bg-primary` and 86 `text-primary` sites: fill-meaning → ink `--primary`; accent-meaning → `--app-olive` (or `--app-olive-strong` at body size). Same for the 43 `--app-petrol-deep` sites (text-on-tint vs hover-fill). Rewrite `globals.css:798-801` into two selectors. *Verifies:* `vitest run`, `eslint .`, and screenshots — no test can find these for you.

**Phase 5 — `:root` + `.dark`.** ~21 routes that never mount `.app-scope`: 5 auth pages, 11 onboarding steps, `/dashboard`, `/join`, 3 error pages. The signup funnel is the first thing a customer sees. *Verifies:* unauthenticated `dev-shot` of `/login`, `/signup`, `/onboarding/*`.

**Phase 6 — untestable literals.** `manifest.ts:24-25`, `layout.tsx:83`, `public/offline.html:6,17-31`, both `opengraph-image.tsx`, `og/blog/[slug]/route.tsx`, `error.tsx`/`global-error.tsx`/`not-found.tsx` **plus their three tests' raw-hex assertions**, `comparison-email.ts:203-212`. *Verifies:* `vitest run` — and remember `token-discipline.test.ts:175` fails when a literal is removed without deleting its ALLOWED entry, so each is a two-step edit.

**Phase 7 — `.mkt-scope`, light only.** Retarget `--fr-*`; delete the now-redundant force-light re-assertion at `globals.css:898-918` (both scopes share one palette, so re-declaring app tokens in cobalt has no purpose); rewrite `fr-tokens.test.ts:18-36` to the olive table. *Verifies:* `vitest run` + marketing screenshots.

**Phase 8 — marketing dark mode, as its own project.** Revert `@custom-variant dark` at `globals.css:19-28`, drop `color-scheme: light` at line 918, author the dark column from §1g, then audit 856 `var(--fr-*)` reads across 86 files, 38 `text-white`, 58 white/black opacity utilities, 19 raw `rgba()`, 39 hex literals — plus a dark path for the p5 hero. *Verifies:* screenshots at both schemes on all 42 pages; there is no mechanical gate for this.

**Phase 9 — renames and docs, last.** `--fr-cobalt` → `--fr-olive`, `--app-petrol*` → `--app-olive*`, `--app-stone-*` → `--app-ground/--app-inset`, `--app-white` → `--app-paper`, delete dead `--app-slate` (0 usages) and the v3 alias block. Drop the marketing exclusion at `token-discipline.test.ts:131`. **Add a CI check for undefined custom properties inside Tailwind arbitrary values first** — `pricing/page.tsx:429` already ships `var(--fr-ink-10)`, a token defined nowhere, and tsc/eslint/vitest are all green on it. A mass rename reproduces that failure mode 856 times, silently.

---

## 3. What cannot be done by retargeting

**Hand-edited source (no token reaches these):**

| file | what |
|---|---|
| `apps/web/src/app/layout.tsx:83` | `themeColor` `#0F766E` / `#0c1211` → `#F3F3EE` / `#141610` (OS reads it) |
| `apps/web/src/app/manifest.ts:24-25` | `background_color` `#FAFAF9` → `#F3F3EE`; `theme_color` `#0F766E` → `#191B14` |
| `apps/web/public/offline.html:6,17-31` | self-contained palette incl. the only hand-authored dark block outside `globals.css` |
| `apps/web/src/app/(marketing)/opengraph-image.tsx:31+` | still the **dead v3** palette (`#041F1C`, `#02110F`, `#3FD5C0`) — proof this class of miss already happened once |
| `apps/web/src/app/(marketing)/pricing/opengraph-image.tsx:16` | cobalt chrome already mixed with `BRAND_OLIVE #66801F` |
| `apps/web/src/app/og/blog/[slug]/route.tsx:39` | ALLOWED-listed "no theme to follow" — which licensed a whole retired palette |
| `error.tsx:41`, `global-error.tsx:22`, `not-found.tsx:18` **+ their 3 tests** | cobalt inlined; tests assert `#FBFCFE`/`#10173B`/`#2740DE` as raw strings |
| `components/marketing/hero/arrival-field.tsx:33` | `COBALT = [39,64,222]`, `GREEN = [11,122,80]` as RGB triples; SSR fallback `arrival-static.tsx` *does* retarget → colour flash the instant p5 boots |
| `components/marketing/consent/consent-banner.tsx:69`, `consent-preferences.tsx:39,43` | `rgba(39,64,222,…)` in inline `<style>` — hover-only, every first visit |
| `components/inbox/status-pill.tsx:16-58` **+ its byte-identical copy** `marketing/thread-demo/thread-primitives.tsx:67-70` | `text-teal-800`/`sky-700`/`amber-800`/`stone-600` — palette classes defeat the hex guard; teal text on an olive wash |
| 48 raw-palette utility sites (`settings/ownership-card.tsx:88`, `tasks/task-atoms.tsx:66-67`, `calls/softphone-status.tsx:50,54`, `notifications/pause-notice.tsx:40`, 14 more `text-amber-*`) | Paper & Olive has no amber and no emerald |
| `components/tasks/views/map-island.tsx:48-74` | `var(--app-petrol)` retargets, `#fff` rings and `rgba(41,37,36,.35)` shadows do not |
| `components/marketing/nav/nav-css.tsx:33,123`, `footer.tsx:77-87`, 3 `stroke="#fff"` sites | pure white; Paper & Olive's paper is `#FDFDF9` |
| `components/marketing/marks/marks-css.tsx:31-32` | `var(--marker-40, rgba(244,214,78,0.4))` — deleting the v3 alias block activates an **amber** fallback on the signature swipe |
| `globals.css:1393,1406` | `#fff` slider thumbs on `#FDFDF9` paper; `.css` is unscanned by `token-discipline.test.ts` |
| `globals.css:1073,1078` | `color: #ffffff` bound to "`--fr-ink` is dark" |
| `globals.css:851-880`, `932-951` | `--cab-panel #1d2650`, `--signal-aqua #a8b6ff`, `--paper-edge #e3e9f6`, 4× `rgba(39,64,222,…)` — literals no `--fr-*` retarget reaches |
| `apps/api/src/marketing/comparison-email.ts:203-212` | the only sender bypassing `email/html.ts` (already correct Paper & Olive); one-line fix to `renderEmailHtml` |

**Generated assets:**
- `apps/web/public/img/**` (30 photos × 2 widths × 2 formats + base64 blur-ups in `manifest.ts`): re-run `apps/web/scripts/build-photos.mjs` with `DUO_SHADOW` `#0B4F49` → **`#3A430F`** and `DUO_HIGHLIGHT` `#E6EBE8` → **`#F3F3EE`**; re-commit ~60 binaries.
- `apps/web/public/shots/**` (24 stale petrol screenshots) + `components/marketing/shot.tsx`: **delete**. `FramedShot` has zero non-test call sites; marketing uses live-DOM replicas inside `.app-scope`.
- Already correct, do not touch: `brand/generate.mjs` output, `favicon*.svg`, `og/loonext-og-default.png`, `apps/api/src/email/html.ts:61-74` (except its `#E8E8E0` border, which is off-palette — the value is `#F0F0E8`).

---

## 4. The honest risks

**A. Fourteen BINDING documents contradict the owner, by name and line.**

| document | line | the sentence that must die |
|---|---|---|
| `docs/marketing/DESIGN-DIRECTION.md` | **2** | "Status: BINDING. … This document plus COPY-DECK v2 and P5-SPEC v1 are the complete build spec" |
| `docs/marketing/DESIGN-DIRECTION.md` | **13** | Law 2 — "Cobalt is the marketing voice OUTSIDE the frame; petrol is the product's voice inside it. Do not recolor outbound bubbles cobalt. Ever." |
| `docs/marketing/DESIGN-DIRECTION.md` | **25** | "These never leak into the app." — the explicit non-convergence mandate |
| `docs/marketing/DESIGN-DIRECTION.md` | **34** | the nine-token cobalt table `globals.css:827-836` implements verbatim |
| `docs/marketing/DESIGN-DIRECTION.md` | **117** | §8 QA gate 4: "no petrol in marketing chrome; no cobalt inside product frames" |
| `docs/marketing/DESIGN-DIRECTION.md` | **15** | Law 10: "No hairline rules anywhere" — a **direct rule conflict**, not a colour one, with Paper & Olive's 1px `#F0F0E8` divider grammar (`Theme.kt:47,79`, `DesignSystem.swift:98`) |
| `docs/APP-UI-ELEVATION.md` | **7, 365** | "petrol `#0F766E` + warm stone + Inter only" |
| `docs/APP-SHELL-REDESIGN.md` | **7, 83** | "Keep the petrol brand and warm-stone base"; "the marketing identity does not leak into the app" |
| `docs/DESIGN.md` | **42** | G2: petrol as primary, teal-500 on dark |
| `docs/DESIGN.md` | **98** | **"The marketing site has its own palette again (#362)."** — cites this issue by number as authority for the opposite conclusion |
| `docs/APP-LAYOUT-V2.md` | **5, 525** | petrol lock as inherited invariant |
| `docs/PORTAL-UX.md` | **173** | a full competing hex roster (`ink #1A2420`, `paper #FBFBF9`) that already disagrees with `globals.css` |
| `docs/HOME-AND-VIEWS.md` | **5** | "Keep the calm Wealthsimple aesthetic (petrol/stone…)" |
| `docs/TASKS.md` | **330** | SPEC-authority petrol rationing rules |
| `docs/marketing/P5-SIGNATURE.md` | **43** | "Colors are exactly the v4 tokens … Nothing else." |
| `docs/marketing/COPY-V2.md` | **114** | "S12 · FINAL CTA (the one cobalt band)" — a dead token inside a section heading |

**B. There is a *third* palette generation nobody named.** `BLUEPRINT.md:103`, `VISUALS.md:52`, `VISUALS-V2.md:47`, `VISUALS-V3.md:66`, `CONVERSION.md:19`, `REFERENCES.md:340`, `COPY.md:57` and `art-inventory.md:29` all still mandate **petrol for marketing** — the pre-cobalt identity — and all but the last are BINDING with no supersession banner. `DECISIONS.md:4204` defers to `CONVERSION.md §7` as live authority *this month*. Fixing only the cobalt docs leaves eight documents quietly re-mandating a palette two generations dead. Use the `#372` banner pattern (`ART-DIRECTION.md:3-16`), and clear the inner `**Status: BINDING.**` line too — it survived the banner in both `ART-DIRECTION.md:19` and `HERO-CONCEPT.md:19`, so `grep "Status: BINDING"` still returns them as authoritative.

**C. Four tests will pass *vacuously* instead of failing loudly.** `status.test.tsx:38-39,128-129`, `chrome.test.tsx:145`, `security.test.tsx:62`, `legal-page.test.tsx:74` are negative assertions (`not.toContain("var(--fr-flare)")`, `not.toContain("#0f766e")`, `not.toContain("--petrol")`). Once those names exist nowhere, all become trivially true. Two of them guard an **honesty** rule, not an aesthetic one — `status.test.tsx` enforces the no-fake-liveness amendment, so a fabricated "operational" dot could ship on `/status` with a fully green CI.

**D. Olive fails AA as text, everywhere in light mode.** 4.04 on ground, 4.41 on paper, 3.92 on inset, 3.66 on inset-deep, 3.55 on avatar tint. `MOBILE-DESIGN.md:19` assigns olive to "counts, links, emphasis" — all small text — so **both phones are shipping sub-AA accent text today**. The web cannot inherit that: use `#3A430F` (a palette member, `Color.kt:56`) for small accent text and reserve `#66801F` for ≥18.66px bold, icons, rings, rails and chart fills. This should be fixed on mobile in the same decision, not worked around on web.

**E. `--success` and `--info` silently become the brand.** They are already collapsed onto petrol in `.app-scope:538,540`; under olive they become the accent. The signature success-check cascade (`globals.css:433`) will read as "brand", not "done". Paper & Olive has no dedicated success token on either platform. The distinguishing channel has to become the glyph, not the hue — decide that consciously.

**F. Coral's semantics.** `MOBILE-DESIGN.md:23` states coral is **never** error. Mapping `--fr-flare` (the 9:04 urgency mark) and `--warning` onto coral is defensible only if "unanswered" is read as an *attention* state rather than a failure — which is what it is. But `P5-SIGNATURE.md:43` builds the hero's algorithm on three named states, and the "in motion" state has **no** Paper & Olive equivalent. That is a re-derivation of the hero's meaning, on a surface memory records as shipped, mandated, and previously fragile.

**G. Cross-platform drift to resolve once, for all three clients.** Dark destructive container: iOS `#39231C` vs Android `#39421A` (`Theme.kt:82` sets an olive-green container for errors — a copy/paste slip; prefer `#39231C`). Dark amber: Android `#E0B25C`/`#3A2F16` vs iOS `#D9A441`/`#2E2712` (prefer Android's — 6.69:1 vs 6.60:1, and brighter on both wells). Muted rung **numbering** is off by one between platforms — port by hex, never by name.

**H. Type is unresolved before colour arrives.** `DESIGN.md:36`, `APP-UI-ELEVATION.md:7` and `APP-LAYOUT-V2.md:5` say Inter; `APP-SHELL-REDESIGN.md:72` says "Golos replaces Inter everywhere"; marketing runs Bricolage + Hanken + Spline, pinned by `fr-tokens.test.ts:90-103`; `MOBILE-DESIGN.md:43-46` is Golos Text with Bricolage display-only. "Follow the app style" is a type instruction too. Converging colour while leaving three answers about the body face in three BINDING docs reproduces this exact issue in six months.

**I. Scope honesty.** The marketing dark theme does not exist in *any* source of truth and was previously attempted and abandoned (`globals.css:12` records the 76 `dark:` utilities that produced dark-on-dark failures; they were deleted, not fixed — 8 survive). Phase 8 is comparable in size to the original v4 build. Everything through phase 7 is achievable as a tight sequence; phase 8 should be tracked as its own issue under #362, not estimated inside it.

---

**Principles cited.** *Applying: the 'Safety' Principle* — a palette migration must not move layout or interaction; the scope architecture already guarantees this, so keep phases 3/5/7 purely declarative and resist per-component edits. *Applying: Relationship Strength & Zen of Clarity* — the accent's job is hierarchy, and olive cannot carry small text at AA, so hierarchy shifts onto ink weight, the two-rung muted ladder, and the inset wash rather than onto saturation. *Applying: Ethical Friction* — `globals.contrast.test.ts` failing at 4.49 is the system refusing a defect; change the role map, never the threshold.