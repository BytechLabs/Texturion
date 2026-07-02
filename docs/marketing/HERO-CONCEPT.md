# JobText Marketing — Hero Concept (BINDING, build-ready)

**Status: BINDING.** The build-ready spec for the home page's one signature moment. Same
authority as BLUEPRINT.md §3.1 and §0.1, which it supersedes on hero *mechanics* (the "two-phones
autoplay thread" §3.1 described is replaced by the participatory dispatch desk below; the LCP
strategy, copy voice, and honesty rules from §3.1 are preserved and made concrete). Identity
system: ART-DIRECTION.md. Copy voice: CONVERSION.md. Product truth: SPEC §1–2, §4.1.

**The hero in one line:** the visitor watches a raw, panicked customer text land as "unfiled,"
then **files it themselves in one tap** — pick who handles it, and it snaps into a clean,
assigned, crew-visible job with a petrol "FILED" stamp. The wow and the 5-second clarity test
land in the same frame, because the visitor makes the product work with their own thumb.

---

## 1. What renders (the composition)

A **split hero**. The H1 is the guaranteed LCP; the desk is a progressive enhancement.

### LEFT column (the pitch — pure text, the LCP, server-rendered, first paint)

```
[eyebrow]   Shared text inbox for your crew
[H1]        Every customer text becomes a job
            your whole crew can see.
[sub]       One business number. One shared inbox.
            $29 flat for the whole crew.
[CTA row]   ( Start for $29 )   See how it works ↓
[truth]     Get your number today. Receiving texts and
            texting Canada work right away; US texting
            turns on in about a week once carriers approve.
```

- **Eyebrow:** 13px, petrol 500, tabular-flavored, sitting on the `01` spine tick.
- **H1:** the Display scale (`clamp(44px, 5.5vw, 72px)`, 600, −0.02em, sentence case), on a thin
  petrol ledger-ruled baseline. The word **"job"** carries the petrol highlight-swipe underlay
  (CSS `background-size` transition, animates once, renders pre-swiped under reduced-motion). Max
  2 lines. **This element is the LCP** — plain text, `fetchpriority="high"`, no image behind it.
- **Sub:** lead paragraph (18–20px, 400), carries the four positioning facts (one number, one
  shared inbox, $29 flat, whole crew).
- **CTA row:** the ONE primary petrol button **"Start for $29"** → `/signup` (the magnetic
  button, §4). Secondary, visually quieter: **"See how it works ↓"** (scroll anchor to §3.4). Never
  two competing primaries; never "Book a demo."
- **Truth line:** 13px `stone-500`, the win-first US/CA timing sentence (SPEC §4.1 substance),
  under the CTAs. Leads with the win (day-one receiving + Canada), then the bounded US wait.

### RIGHT column (the wow — the DISPATCH DESK, an interactive object the visitor drives)

A single **job ticket** (the ART-DIRECTION §2 motif), built from the app's real thread
primitives, sitting in the §3.2 morning-light atmosphere. Two states:

**State A — RAW / UNFILED (how it first renders after hydration, or as the ghost-demo start):**

- A ledger row labeled **"New · unfiled"** with an **amber** status spine (unresolved), sitting
  slightly askew (~1° tilt), holding a **raw gray Messages-style bubble**:
  *"Hi — my water heater's leaking everywhere, can someone come today?? 😰"* + a small photo
  thumbnail chip.
- A small ledger counter above the row: **"Unfiled: 1".**
- Three real ticket controls beneath the bubble:
  - **ASSIGN** — three avatar chips (Priya / Dale / Marcus), the app's real assignee menu.
  - **STATUS** — pills New → Open → Waiting → Done (defaults to New).
  - **ADD NOTE** (optional) — a small field the visitor can skip.
- A one-time **pulse ring on the ASSIGN control** + a micro-hint **"tap to file →"** (§4
  discoverability kit).

**State B — FILED (after the visitor taps an assignee, or the ghost-demo completes):**

- The row **snaps square** (tilt → 0), the spine flips **amber → petrol** (resolved), and a
  petrol **"FILED"** stamp presses in (150ms scale+fade, §5).
- The chosen assignee's avatar **flies to the row's meta line**; a tabular ticket-meta line
  resolves: **`#0119 · filed · Dale · 2:14 PM`.**
- The raw gray bubble **re-renders as a clean JobText conversation**: the inbound white card, an
  **amber internal note** ("heard a hiss — send Dale, it's the tankless" — only if the visitor
  added one, otherwise a pre-seeded one drops), and **Dale's `teal-50` reply** landing with a
  **Delivered ✓**.
- The counter ticks **"Unfiled: 1 → 0".**
- Caption resolves (13px `stone-500`): **"That's a job now — your whole crew can see it."**

The entire object is one job ticket in the ledger vocabulary. It is the product's whole argument
in a gesture the visitor performed themselves.

### Behind everything

The morning-light two-wash atmosphere (ART-DIRECTION §3.2): petrol `rgba(15,118,110,0.12)`
low-left, amber `rgba(251,191,36,0.06)` upper-right, `stone-50` base. CSS gradients only,
`aria-hidden`, behind the LCP box, never over text, never animated, no `blur()` on the LCP region.
The `01` ledger spine tick sits in the left margin.

---

## 2. The LCP stays TEXT (non-negotiable)

- **The H1 text is the guaranteed LCP.** `fetchpriority="high"`, self-hosted Inter via `next/font`
  (zero font CLS). No raster image anywhere in the hero — the desk is DOM/CSS/SVG, so there is no
  90KB image that can become the largest paint and no mobile desktop-image decode.
- The **desk server-renders in its FINISHED (State B) form** as static, meaningful DOM — a filed,
  assigned, done conversation. That completed ticket is what the LCP paints, what no-JS paints,
  and what reduced-motion paints. It fully pitches on its own.
- The interactive layer hydrates **after first paint** via `next/dynamic` (`ssr: false`) on
  IntersectionObserver viewport entry. On hydration it *resets* the desk to State A (raw/unfiled)
  so the visitor can drive it — but a visitor who never scrolls, never interacts, or has JS off
  keeps the meaningful finished ticket.
- The atmosphere is a CSS gradient layer behind the box (§1.2), not an image, no blur on the LCP
  region. There is nothing in the hero that can regress LCP below the H1 text.

---

## 3. Step-by-step: the hero interaction (so an engineer builds it exactly)

**Server render (0ms, no JS):**
1. Render the LEFT column (eyebrow, H1 with pre-swiped highlight, sub, CTAs, truth line).
2. Render the RIGHT desk in **State B (FILED)** as static DOM — completed ticket, petrol spine,
   FILED stamp present (static), assignee on the meta line, the clean conversation (inbound card
   + amber note + teal reply + Delivered ✓), counter reading "Unfiled: 0".
3. Render the atmosphere gradient layer and the `01` spine tick.
   → **This is the LCP and the full no-JS/reduced-motion experience.**

**After first paint, on viewport entry (IntersectionObserver, `next/dynamic ssr:false`):**
4. Hydrate the `<DispatchDesk>` island (< 12KB gz, reducer-only state).
5. **If `prefers-reduced-motion`:** do nothing — leave State B, expose a quiet "replay" affordance
   only. Stop here.
6. Otherwise, **reset to State A (RAW/UNFILED)** with the app's 200ms fade+4px-rise: the row tilts
   ~1°, the gray raw bubble + photo chip appear, the ASSIGN/STATUS/NOTE controls appear, the
   counter reads "Unfiled: 1", the pulse ring + "tap to file →" hint show.

**The discoverability timer (critical — §4):**
7. Start a ~3s timer. **If the visitor interacts first, cancel it.**
8. If ~3s elapse untouched, **auto-play the ghost demo once:** a ghost cursor drifts to the Dale
   chip, the chip depresses, and the file animation (step 10) plays automatically — demonstrating
   the gesture. After the ghost demo, reset to State A so the visitor can still do it themselves.
   The ghost demo plays **at most once.**

**On visitor action (tap/click/keyboard Enter on an assignee chip):**
9. Cancel the ghost timer. Announce via `aria-live="polite"`: *"Filed — assigned to Dale."*
10. **The FILE animation (150ms stamp + the app's arrival grammar):**
    a. Row un-tilts to 0° and snaps square.
    b. Status spine transitions **amber → petrol**.
    c. The **"FILED" stamp** presses in: `transform: scale(1.08) → scale(1)` + `opacity 0 → 1`,
       150ms ease-out, compositor-only (no layout thrash).
    d. The chosen avatar animates to the meta line; `#0119 · filed · Dale · 2:14 PM` resolves.
    e. The raw bubble re-renders as the clean inbound white card (200ms fade + 4px rise).
    f. The amber internal note drops in (the visitor's, or the seeded default).
    g. Dale's `teal-50` reply lands with "Sending…" → "Delivered ✓".
    h. Counter ticks "Unfiled: 1 → 0".
    i. Caption resolves: *"That's a job now — your whole crew can see it."*
11. Expose a quiet **"Replay"** affordance that resets to State A.

**Keyboard path:** the ASSIGN and STATUS controls are arrow-navigable, Enter/Space activates,
focus rings are 2px petrol offset (DESIGN.md G11). The whole interaction is completable by
keyboard alone.

**Mobile:** the desk stacks **below** the H1. Tap targets ≥ 44px. Same island, same states, same
ghost demo. The atmosphere gradient degrades gracefully; the grain/dot-grid never appears here.

---

## 4. Discoverability (do-or-die) & the magnetic CTA

An interaction the visitor doesn't know to perform is a dead hero. Ship **all** of:

- A **one-time pulse ring** on the ASSIGN control on hydration (petrol, 2 pulses, then stops).
- A **"tap to file →"** micro-hint beside the controls (disappears on first interaction).
- The **~3s ghost-demo auto-play** (§3 steps 7–8) if untouched — plays once, then lets the
  visitor drive.
- **The finished State B fully pitches on its own** — so the ~40% who never interact, plus no-JS
  and reduced-motion, still get the entire argument.

**Test this on a fresh non-designer before anything else ships.** If they don't understand what to
do within a few seconds, the discoverability kit is wrong — fix it before build sign-off.

**The magnetic CTA:** the ONE primary "Start for $29" button gets a restrained pointer-move
magnetic pull (~20 lines, a tiny `translate`), **pointer-only, disabled on touch and under
`prefers-reduced-motion`.** The desk's "file it" affordance must never visually out-weigh this
button — the desk teaches value, the petrol button converts.

---

## 5. Reduced-motion / no-JS / static fallback (exact behavior)

| Condition | What the visitor gets |
|---|---|
| **No JS** | Server-rendered State B: the completed, filed, assigned conversation. Full pitch, static. |
| **`prefers-reduced-motion`** | State B on load; hydration adds only a quiet "replay" affordance; **no stamp animation, no reset to raw, no ghost demo.** Final frames only. |
| **Slow / mid-tier mobile** | Same island (< 12KB); if it never hydrates, the visitor keeps State B. No degraded-canvas path exists because there is no canvas. |
| **Full experience** | State A → visitor files → State B, with the stamp and arrival grammar, plus the ghost-demo safety net. |

There is no scenario where the hero is blank, janky, or unclear: the completed ticket is always
the floor.

---

## 6. Performance budget & tech

| Item | Budget / choice |
|---|---|
| **Tech** | 100% DOM / CSS / SVG. **No WebGL, no Canvas2D, no particle system, no animation library** (BLUEPRINT §13.9). Built from the app's real thread primitives (BLUEPRINT §1.3). |
| **LCP** | < 1.5s (field p75). LCP element = H1 text. No raster in hero. |
| **CLS** | < 0.05. Desk lives in a reserved layout box; State A↔B swaps animate transform/opacity inside it. |
| **INP** | < 200ms. Reducer-only state, compositor-only stamp keyframe, no layout thrash on file. |
| **Above-fold JS** | 0KB blocking. The desk island is `next/dynamic ssr:false`, hydrates AFTER first paint on viewport entry. |
| **Island size** | `<DispatchDesk>` **< 12KB gz.** Tiny reducer (unfiled → assigned → filed), no deps beyond the shared thread primitives. |
| **Atmosphere** | CSS gradients only, `aria-hidden`, behind LCP box, no `blur()` on LCP region, never animated. |
| **Fonts** | Self-hosted Inter variable via `next/font`, 400/500/600, zero font CLS. |
| **A11y** | Keyboard-drivable, `aria-live="polite"` announces "Filed — assigned to Dale", focus rings 2px petrol, tap targets ≥44px, reduced-motion honored. |
| **Launch gate** | Re-run a **real mobile** Lighthouse pass; hold 100/100/100/100 on home. |

**Honesty guard (BLUEPRINT §13.6, VISUALS §6):** the **visitor's own tap** does the assigning and
filing — accurate, because a human assigns. The animation must **never imply automation JobText
lacks** (no auto-reply, no auto-schedule, no missed-call text-back). The single honesty label
*"Demo — scripted conversation, real interface"* lives on the §3.4 deep-dive, not here — the hero
shows confidence, not a defensive caption (BLUEPRINT §3.1). Seed data is Reyes Plumbing / the
water-heater thread, shared with §3.4 so hero and deep-dive are one story.

---

## 7. The copy (final, CONVERSION.md voice)

- **Eyebrow:** Shared text inbox for your crew
- **H1:** Every customer text becomes a job your whole crew can see.
- **Subhead:** One business number. One shared inbox. $29 flat for the whole crew.
- **Primary CTA:** Start for $29  (→ /signup)
- **Secondary:** See how it works ↓  (scroll anchor)
- **Truth line:** Get your number today. Receiving texts and texting Canada work right away; US
  texting turns on in about a week once carriers approve.
- **Risk-reducer near CTA:** Month to month. 30-day money-back.
- **Desk raw bubble:** Hi — my water heater's leaking everywhere, can someone come today?? 😰
- **Desk hint:** tap to file →
- **Desk internal note (seeded default):** heard a hiss — send Dale, it's the tankless
- **Desk resolved caption:** That's a job now — your whole crew can see it.
- **Desk meta line (resolved):** #0119 · filed · Dale · 2:14 PM

Sentence case, contractions, second person, no jargon, no "dispatch/ledger/console" words
anywhere visible (ART-DIRECTION §10). Final H1/sub/CTA also recorded in COPY.md §H1 for A/B.

---

## 8. Why a tradesperson says "wow" then clicks "Start for $29"

- **Wow = recognition + relief, by his own hand.** He sees *his* chaos — a panicked "leaking
  everywhere, today??" — and with one tap turns it into a clean, assigned job with his crew's name
  on it. He doesn't watch the product work; he *makes* it work and feels the relief. The
  "unfiled → FILED" stamp is the small, satisfying hit of getting-on-top-of-it. It's the frame he
  screenshots and texts his brother-in-law.
- **Not agency-flex — competence.** It's built from the real app, framed like the intake pad by
  his phone. It reads "this shop is on top of things," never "nice WebGL." Warm morning light, no
  cartoon, no jargon — confident tradesman, not pretentious designer.
- **The click feels safe and obvious.** The 5-second test passes in the same frame as the wow: the
  H1 says exactly what it is, who it's for, and the one button. `$29` is right there, flat, no
  quote, no sales call. Month-to-month + 30-day money-back removes the fear. The one magnetic
  petrol "Start for $29" is the only thing on the page pulling toward the click — and after he's
  just felt the relief himself, clicking it is the obvious next move.
