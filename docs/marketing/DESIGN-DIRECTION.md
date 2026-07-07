# DESIGN-DIRECTION v4 — FIRST RESPONSE
**Status: BINDING. Supersedes v3 ("Quiet daylight") entirely. Besley, Public Sans, Martian Mono, the porcelain/cream grounds, and the copper/petrol marketing accents are dead. This document plus COPY-DECK v2 and P5-SPEC v1 are the complete build spec: ten different engineers reading this must produce the same site.**

---

## 0. The concept in one paragraph

The whole site is built from the worst minute in a homeowner's week: 9:04 PM, water spreading across the garage floor, one text sent to the only number she has, a plumber's personal cell, face down on a kitchen counter, on silent. Every design decision dramatizes the two states of that minute: WAITING (unanswered, hot orange tension) and ANSWERED (resolved, green relief), with cobalt as the color of a text in motion between them. The visual register is a modern print magazine doing a story on the reader's business: big plainspoken grotesque headlines, a mono face for every timestamp and dollar figure (times and prices are the plot), generous white space, and zero decoration that is not information. The reader must never perceive the magazine conceit; it is scaffolding, not costume.

## 1. The ten laws (binding, in priority order)

1. **The site never talks about itself as an artifact.** No font credits, no framework credits, no "this is the real interface," no "no stock photos." The one permitted content label is a terse mono chip reading exactly `SCRIPTED DEMO` (or `EXAMPLE CONVERSATION` on trade pages). It labels the conversation as scripted. It never mentions the interface, the site, or the demo's realism. See PURGE-LIST.
2. **Marketing frames the product; it never repaints it.** Every real product embed (ConversationRow, thread UI, usage meter, template picker, composer, segment counter) renders with the app's own tokens: petrol `#0F766E` primary, the app's own bubble colors, the app's own unread-dot color, the app's dark mode inside phone frames. Marketing chrome (the white card, the shadow, the caption) wraps it. Cobalt is the marketing voice OUTSIDE the frame; petrol is the product's voice inside it. Do not recolor outbound bubbles cobalt. Ever.
3. **One live algorithm, on the home hero, and nowhere else.** The Arrival Field (see P5-SPEC) is the site's single p5 moment. The final CTA and all subpages use only its STATIC converged SVG derivative. No second canvas anywhere.
4. **Flare is rationed by whitelist** (§3.4). If a use is not on the whitelist, it is a bug.
5. **One display-scale accent per band.** A Flare display element (the calculator figure) and a cobalt display element (a band-scale CTA panel) never share a band. Standard-size CTA buttons are exempt.
6. **No em-dashes anywhere in customer-facing text.** Use periods, commas, colons, or the word "to". Ranges are written "3 to 7 business days". Sentences must read naturally as written. This applies to copy, aria-labels, alt text, meta descriptions, error strings, and legal pages. QA gate: `grep -r "—" apps/web/src` over rendered strings must return zero customer-facing hits.
7. **Factual only.** Every number on the site is a verified product or billing fact. Zero testimonials, zero logos, zero invented stats. The missed-text calculator multiplies only what the visitor types.
8. **Every home-page section earns conversion or is cut.** Each section's conversion job is stated in COPY-DECK v2; a section that stops doing its job gets removed, not decorated.
9. **The discipline test.** With the p5 layer stripped (static SVG in place), the site must stand as a finished, beautiful page. Build it that way first, then add the field. This is a pre-ship QA gate.
10. **No hairline rules anywhere.** Separation comes from space, radius, and Frost washes. No dark bands except the two named ink surfaces (dateline chip, footer) and the one cobalt close.

## 2. Palette (CSS custom properties, marketing scope only)

Define under `.marketing` scope in globals.css. These never leak into the app.

| Token | Hex | Role and rules |
|---|---|---|
| `--fr-ground` Signal White | `#FBFCFE` | Dominant ground on every page. Barely cool, blue cast, never warm. |
| `--fr-card` | `#FFFFFF` | Cards on the ground. 12px radius, shadow `0 1px 2px rgba(16,23,59,.06), 0 8px 24px rgba(16,23,59,.06)`. |
| `--fr-ink` Dispatch Ink | `#10173B` | All headlines and body text on light grounds. ~16:1 on ground (AAA). Also the ground of exactly two dark surfaces: the dateline chip and the footer band. |
| `--fr-ink-70` | `#3F4563` | Secondary text (solid mix of ink toward ground, ~9:1). |
| `--fr-ink-55` | `#5A6080` | Captions, timestamps, table labels (~6:1, AA). |
| `--fr-cobalt` Signal Cobalt | `#2740DE` | Primary CTAs (white text, 7.3:1 both ways), links, focus rings, p5 in-motion trails, the Loonext flat line in the slider chart, the ONE full-bleed final-CTA band. |
| `--fr-green` Answered Green | `#0B7A50` | Relief. Delivered/approved ticks, guarantee checkmarks, Day 0 and Approved timeline nodes, docked p5 particles, /status operational dots. 5.5:1 on white (AA text at any size). Green appears only when something got handled. |
| `--fr-flare` 9:04 Flare | `#FF4A1F` | Urgency. WHITELIST ONLY (§3.4). 3.4:1, so text use is display figures at 24px bold or larger, and non-text marks. Never body text, never backgrounds, never icons. |
| `--fr-frost` Frost | `#EDF2FB` | The only wash: alternating section bands, chip and eyebrow backgrounds, table row striping, card wells. Text on it is always Dispatch Ink (14.5:1). |

### 3.4 The Flare whitelist (exhaustive)
1. p5 particle fill while unanswered, and the matching mark in the static SVG.
2. The small status dot in the three pain-card mono artifact headers on the home page.
3. The missed-text calculator output figure (48px or larger, bold, mono).
4. The `YOU ARE HERE` tab on the first-week timeline (Flare tab, ink text on a white tag, Flare border; Flare itself carries no text below 24px).
5. The rival per-user climbing line stroke in the crew-size slider chart and compare-page charts.
Nothing else. Not the H1, not underlines, not link hovers, not badges.

### Green whitelist
Delivered ticks in captions outside frames, guarantee checks, timeline Day 0 and Approved nodes, docked p5 particles, /status "operational" dots, the Canada "day one" tick. Inside product frames, "handled" wears the app's own tokens (petrol `#0F766E`, which is also the app's `--success`), so the marketing green and the product's answered color are near family and the signup handoff feels continuous.

## 3. Type system (next/font/google)

```ts
import { Bricolage_Grotesque, Hanken_Grotesk, Spline_Sans_Mono } from "next/font/google";
const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display", axes: ["opsz", "wdth"] });
const body = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-body" });
const mono = Spline_Sans_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "500"] });
```

| Role | Face | Spec |
|---|---|---|
| H1 | Bricolage Grotesque 800 | `clamp(2.5rem, 6.5vw, 5.25rem)`, line-height 1.02, letter-spacing -0.02em above 48px, optical size at max |
| H2 | Bricolage Grotesque 800 | `clamp(1.875rem, 4vw, 3rem)`, line-height 1.08 |
| H3 / card titles | Hanken Grotesk 700 | 1.25rem, line-height 1.3 |
| Body | Hanken Grotesk 400 | 1.0625rem (17px), line-height 1.65; 500 for emphasis, 600 for UI labels |
| Mono data | Spline Sans Mono 500, `font-variant-numeric: tabular-nums` always | 0.8125rem to 0.9375rem for chips, timestamps, table figures; display numerals (prices-as-art) 3rem to 6rem |
| Eyebrows / datelines | Spline Sans Mono 500 | 0.75rem, uppercase, letter-spacing 0.08em |

**The mono law:** every countable truth wears Spline Sans Mono with tabular figures: $29, $79, 500, 2,500, 3¢, 2.5¢, $5, $8, 3 to 7 business days, 80%, 100%, phone numbers, timestamps, the segment count, the countdown. If a number could appear on an invoice, it is mono. Numbers inside FAQ prose stay in body face (prose exception), but any number pulled out as a figure, chip, or table cell is mono.

## 4. Layout, spacing, radius, motion tokens

- **Container:** max-width 72rem (1152px), padding-inline 1.5rem mobile, 2rem from md.
- **Spacing scale:** 4px base. Section padding-block: 6rem desktop, 4rem mobile. Gap between cards: 1.5rem.
- **Radius:** primary CTA pill `999px`; secondary buttons and inputs `10px`; cards `12px`; product panel frames `16px`; chips and dateline `6px`.
- **Buttons:** Primary = cobalt pill, white Hanken 600 text, padding 0.875rem 1.75rem, hover darkens to `#1F33B8`, focus ring 2px cobalt at 2px offset. Secondary = ink ghost (1.5px `#10173B` border on transparent), same geometry. On the cobalt band, primary inverts: white pill, ink text.
- **Shadows:** only the card shadow named in §2. No glows, no colored shadows.
- **Motion:** hovers 200ms ease-out; scroll reveals 400ms `cubic-bezier(0.22,1,0.36,1)`, translate-y 12px max, once only; `prefers-reduced-motion` disables all reveals and the p5 boot. No parallax, no marquees.
- **Nav:** Signal White, no border; wordmark Bricolage 800 ink; links Hanken 500; `Get your number` cobalt pill. On scroll past 24px, nav condenses to a floating frosted pill (`backdrop-blur`, white at 88%).
- **Footer:** Dispatch Ink band ("night outside the window"), white at 70% links in four columns per COPY-DECK §F, no credits of any kind.

## 5. The component kit (five primitives + fixtures)

All 25 routes assemble from these named parts. Nothing bespoke.

1. **DATELINE HEADER.** Every page opens with: a Dispatch Ink chip (mono, uppercase, white text, 6px radius, one per page, ALWAYS a load-bearing fact for that page, never decoration), then H1, then sub, then (on conversion pages) the CTA row. Home's dateline: `9:04 PM · TUESDAY`. /pricing: `$58 FIRST MONTH (US) · $29 AFTER`. /features/shared-inbox: `1 OWNER PER CONVERSATION`. If a page has no load-bearing fact, it gets no chip (legal pages get a Frost "Plain English summary" chip instead, ink text).
2. **PANEL FRAME.** The marketing chrome around every real product component: white card, 16px radius, the standard shadow, optional browser-chrome hint (`loonext.app/inbox`), optional phone frame for dark mode shots. The product inside renders with app tokens (Law 2). The only label ever attached is the `SCRIPTED DEMO` chip (Frost ground, mono ink text).
3. **HONESTY LEDGER.** The mono table treatment: Spline Sans Mono figures, Frost row striping, no rules, sourced footnotes in ink-55. Used for /pricing "every cost" ledger, compare tables, /canada province table, add-on fine print.
4. **TRUTH STRIP.** One repeated component for every honesty claim, site-wide, so candor has a learnable shape: Frost ground, 3px cobalt left edge, mono text, green tick where the news is good. Carries: $58 first month, 3 to 7 day carrier wait, USD billing, "that's the whole list", the Canada day-one line.
5. **NUMBERED STEPS / WORK CARDS.** Steps with mono numerals in cobalt circles; the first-week timeline is its flagship instance: Day 0 (green node) → Days 1 to 7 (cobalt progress track) → Approved (green node), with a `YOU ARE HERE` Flare tab (§3.4.4).

**Fixtures:** the pain-card mono artifact header (mono ink-55 line topped with a small Flare dot, e.g. `DELIVERED 9:04 PM · NO REPLY`); the settled-streamline SVG (the static converged Arrival Field derivative) used as the final-CTA backdrop and, at small scale, as the sole decorative page-header mark on subpages; the stat chip (Frost, mono figure + Hanken label).

## 6. Page-type templates (see COVERAGE-MAP for the route-to-template mapping)

- **HOME:** the twelve-band arc defined in COPY-DECK v2. Only page with live p5.
- **FEATURE (x4):** Dateline Header → one large Panel Frame with that capability's real component staged mid-task → three use-case blocks (Numbered Steps) → Truth Strip for any honest limitation → pricing snippet → feature FAQ → CTA band (Frost, not cobalt; cobalt band is home-only).
- **TRADE (x6):** Dateline Header (the trade's after-hours moment, matching its scripted thread) → pain section → "A Tuesday, in texts" static thread in a Panel Frame (label: `EXAMPLE CONVERSATION`) → use cases → saved-replies pack rendered in the REAL template-picker component → features strip → pricing snippet → trade FAQ → CTA.
- **COMPARE (x3 + index):** Dateline Header (the arithmetic) → Honesty Ledger as the centerpiece with sourced figures → slider chart (cobalt flat line vs Flare climbing line) → "when they fit better" honest section → switching/porting Truth Strip → CTA. No competitor logos, no dark patterns.
- **PRICING:** the most mono-dense page: plan cards (mono price-as-art figures), Honesty Ledger, first-week timeline, the segment-counter widget running the real billing code in a Panel Frame, crew slider, guarantee, pricing FAQ.
- **CANADA:** the flipped timeline (the waiting segment does not exist) leads; green is allowed to lead this one page; province availability as an Honesty Ledger.
- **LEGAL (x6):** quiet register: 68ch single column, Hanken 17px, mono section numbers, Frost plain-English summary chip on top, zero art. The system's restraint is the credibility.
- **SECURITY:** Dateline `ENCRYPTED IN TRANSIT AND AT REST`, verifiable claims as a checked list (green ticks), no padlock clip-art.
- **STATUS:** pure mono instrument page; green/Flare dots as literal system state (the one place the kinetic colors are data).
- **CONTACT:** short work-order form styled after the real composer, founder reply promise.

## 7. Accessibility and performance budgets (gates)

- Every text/ground pair AA minimum; Flare never below 24px bold. Focus visible everywhere (cobalt ring; yellow is not used on this site).
- LCP is the hero H1 text node on every page; p5 boots post-LCP only (P5-SPEC). CLS budget: 0.00 from the canvas layer (fixed-size container). Lighthouse perf ≥ 95 on home, ≥ 98 on subpages, mobile emulation.
- p5 ships as a lazy chunk requested only on `/`. `next/font` with `display: swap` off (use fallback adjust) to avoid FOUT jumps.
- Native `<details>` for FAQ; the thread demo adds no tab stops; all demo aria-labels describe content ("A Reyes Plumbing conversation"), never the artifact.

## 8. QA gates before ship
1. Purge grep: no customer-facing match for `real interface|Set in |Built with Next|no fake|stock photos|—`.
2. Discipline test (Law 9): screenshot review with p5 stripped.
3. Flare audit: count Flare instances per page against §3.4.
4. Token audit: no petrol in marketing chrome; no cobalt inside product frames.
5. Reduced-motion pass: hero renders the composed SVG still, nothing is blank.
