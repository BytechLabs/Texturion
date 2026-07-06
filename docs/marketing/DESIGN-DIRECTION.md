# Loonext Marketing: Design Direction (BINDING, single source of truth)

"Quiet daylight" (v3). Supersedes both the "Caught" direction and the "Open all night" nocturne
(v2, rejected at review: dark grounds, glow effects, the sticky demo stage, and the clock-rail
chrome read as clutter). The client's standing verdict, which binds all future marketing visual
work: CLEAN, BEAUTIFUL, MINIMAL, LIGHT.

What carries over from earlier directions: the type trio (Besley 700 / Public Sans / Martian
Mono, self-hosted latin woff2), the copy deck (docs/marketing voice: night-shift plain, verbatim
honesty lines, no em-dashes, no fake social proof), the performance floor (text LCP, server-
rendered resolved states, no-JS floor, reduced-motion parity, islands only where listed), and
the two-surfaces rule (app stays Inter; marketing tokens live under .mkt-scope).

---

The client rejected the dark nocturne execution outright: "extremely ugly, needs big clean up,
CLEAN, BEAUTIFUL, MINIMAL, not shippable." This spec is the correction. The client's words are
law: clean, beautiful, minimal, light. Every decision below serves calm and craft. When in doubt,
remove.

## 1. What dies (from the current build, everywhere, no exceptions)
- All dark section grounds EXCEPT one immaculate final-CTA band. No --ink-midnight anywhere.
- The lamp engine: every radial-gradient glow, .nx-lamp*, .nx-screen (mix-blend), .nx-spill,
  .nx-rim, the hero vignette, the dawn crossfade band, the status tint overlays. Light smears over
  text are the single ugliest defect: zero glows survive.
- The night rail (night-rail.tsx + rail-tracker.tsx): removed from the page entirely.
- The 400vh sticky demo stage, the beat stepper island, beat-gated display CSS, pinned captions.
- Clock eyebrows ("9:47 PM" / "7:04 AM" section eyebrows): all removed. The hero H1 already says
  9:47 pm; that is the only clock on the page.
- The dim-then-brighten hero H1 transition. H1 renders full color, always.
- Dark cab-panel fragments inside light cards (S4): fragments restyle light like everything else.

## 2. Grounds + color (minimal palette, light page)
- Page ground: #FBFDFC (use existing --paper-2 value; set on sections explicitly or inherit
  .mkt-scope default --paper #F2F8F5 -> NO: sections use bg-white/#FBFDFC panels on --paper.
  Concretely: page keeps .mkt-scope's --paper #F2F8F5; cards/panels are white #FFFFFF).
- Cards: #FFFFFF, 1px solid rgba(11,43,38,0.08), border-radius 12px, shadow
  0 1px 2px rgba(11,43,38,0.05). Nothing heavier. Hover states may deepen the border to
  rgba(11,43,38,0.16), no lifts, no scale.
- Text: --day-ink #0B2B26 (headings), --ink-70 #3A534D (body), --ink-55 #587068 (captions, metas).
- Accents, complete list. Petrol #0F766E: buttons, links, delivered ticks, active pills, focus.
  Porch-amber #FFB454: ONLY the small unread dot (and the OG image). Copper #9A4F26: ONLY the
  pricing delta figure, the "Won" chip, and the 2px price underline. No other color exists.
- The one dark moment: the final CTA band on --ink-11pm #041F1C with --moonlight text, flat
  (no vignette, no gradient, no glow), bounded by nothing but its own padding.

## 3. Type (calm scale, same faces)
- Besley stays the display face but drops to weight 700 everywhere and a RESTRAINED scale:
  H1 clamp(2.25rem, 1.4rem + 3.2vw, 3.5rem), line-height 1.08, tracking -0.015em;
  H2 clamp(1.65rem, 1.2rem + 1.8vw, 2.375rem), lh 1.15; H3 1.25rem, lh 1.3.
- Body: Public Sans 400, 1rem-1.0625rem, line-height 1.65, measure <= 65ch. Small: 0.875rem.
- Kickers (only where a section truly needs one): Public Sans 600, 0.8125rem, --ink-55,
  sentence case, no letterspacing tricks. Not mono, not a clock.
- Martian Mono: ONLY prices, phone digits, in-thread timestamps, table figures, usage counters.
  Never headings, never captions, never eyebrows. Normal width (no condensed).
- The price figure: Besley 700, clamp(2.25rem, 4vw, 3rem), 2px copper underline offset 6px.

## 4. Motion (four things move, nothing else)
1. The existing [data-reveal] rise (opacity + 12px), staggered via RevealGroup. Default state.
2. Hero: the inbound message soft-LANDs once on load (opacity + 6px translate, 300ms, 250ms
   delay), reduced-motion/no-JS = already landed. Keep the tiny replay island for this only.
3. Delivery ticks step queued -> sent -> delivered once when revealed (existing nx-tick concept,
   restyled petrol on white).
4. The final-CTA phone number odometer ROLL (existing island), digits at clamp(2rem, 4.5vw, 3.5rem)
   — quieter than before.
Everything else is static. No repeating animation except one gentle unread-dot double-pulse in
the hero (then steady).

## 5. Kit restyle (kit.tsx + night-css.tsx; same exported API, glow props become inert)
- Thread card surface: white, 1px rgba(11,43,38,0.08) border, 12px radius.
- Inbound bubble: #F0F4F2 fill, --day-ink text, 12px radius. NO glow pseudo.
- Outbound bubble: petrol fill, white text. Append line: white at 90% opacity, 12px.
- Ticks: petrol, small mono. Note row: white, dashed rgba border, --ink-55.
- SystemLine: --ink-55 centered small. TagChip: rgba(11,43,38,0.06) bg, --ink-70 text; won =
  copper text on rgba(154,79,38,0.1). StatusPill: quiet tints (New = petrol-12 bg + petrol text;
  Open = same family; Waiting/Closed = neutral tint + --ink-55). No solid loud fills.
- QuietHoursDialog: white, border, 0 4px 12px rgba(11,43,38,0.08), petrol primary button.
- Composer: white input, 1px border, petrol send button. UsageMeter: mono figures, hairline rules.
- NightShell: becomes a clean master-detail card (white, hairlines between panes); sidebar pane
  only where a section explicitly asks (the S3 story does NOT use the sidebar anymore).
- night-css.tsx shrinks to: land keyframe, tick steps, unread double-pulse, odometer roll.

## 6. Sections (same order, same verbatim copy deck text, new dress)
- S1 hero (porcelain, no panel behind): 7/5 split. Left: H1, subhead (--ink-70), petrol CTA
  "Start with one number" + quiet link "See pricing", honesty microline small --ink-55. Right:
  ONE clean thread card — header row (Dana Whitfield · amber unread dot · "now"), inbound bubble,
  outbound reply with ticks + append line. NO conversation list, NO quiet-hours dialog, NO
  composer in the hero. The card is the only ornament the hero gets.
- S2 (was "unlit"): white ground, kicker-less H2 + kicker line, three white cards, each: H3, two
  sentences, then its small UI fragment (light-styled) + one-line caption --ink-55. Remove the
  phone SVG.
- S3 the night shift: normal-height section. H2 + intro line. Two columns: LEFT = the five steps
  as a clean vertical list (time in mono --ink-55, caption Besley H3, one detail line); RIGHT =
  the resolved thread in one clean card (all bubbles/notes/system lines/task/ticks, light kit
  styling), revealed with the standard stagger. Delete the sticky wrapper, sentinels, beat
  stepper, tints, pinned captions, stage chrome, "Demo thread" mono line -> becomes a plain
  caption under the card in --ink-55. Keep aria structure.
- S4: keep the 3x2 white card grid; fragments now light; delete the dawn band completely.
- S5 pricing: already close. Keep cards white with hairlines; price per §3; line items mono
  0.8125rem --ink-70 with hairline separators; honesty strip stays (amber 10% bg, --day-ink);
  table as a quiet receipt (hairlines, mono, right-aligned figures, copper delta).
- S6 approval clock: white band, hairline top/bottom rules (rgba(11,43,38,0.08), NOT amber);
  keep the day-tick board, petrol/amber nodes fine (the amber node here is data, allowed).
- S6.5 FAQ: moves OUT of the dark band into its own light section (white, native details/summary,
  hairline separated, plus/minus glyph, --day-ink questions, --ink-70 answers).
- S7 final CTA: THE one dark band, flat #041F1C: mono caption "Tonight, 9:47 PM" small
  (--dusk), the odometer number (--moonlight, §4 size), H2 Besley 700 --moonlight, body --dusk,
  composer-CTA (white surface input look, petrol button, works as one link to /signup as built),
  honesty + reassurance lines --dusk. Nothing else. Generous padding.
- S8 footer: light ground, top hairline, the existing columns/links, --ink-55 text, colophon
  kept, quiet.
- Nav: light skin: white at 92% + backdrop blur, bottom hairline rgba(11,43,38,0.08), wordmark
  Besley 700 --day-ink, links --ink-70 hover --day-ink, petrol Start button. Mega/mobile panels:
  white surfaces, same content.

## 7. Quality floor (unchanged, binding)
Server components; islands only hero-replay + odometer (+ existing Reveal activator). LCP = H1
text. No-JS/reduced-motion = resolved state. Focus rings petrol on light / aqua on the dark band.
Contrast: all pairs from the v2 audit still apply; new pairs (ink-55 on white 4.9:1, petrol on
white 4.8:1) pass. Sentence case, no em-dashes (except the product append line), copy deck
verbatim. tsc + eslint clean.
