# JobText Marketing — Design Direction (BINDING, single source of truth)

Supersedes the templated parts of VISUALS-V2 / VISUALS-V3 (the ledger section-numbering, the
"dispatch/FILED" costume, the em-dash copy, the generic stock/library imagery). What still holds
from earlier: owned duotone-treated imagery over stock, expressive typography over a bare font
swap, real product screenshots, performance floor. This doc is the point of view; the build
follows it exactly.

## 0. Hard removals (do these everywhere, first)

- **No em-dashes.** Remove every `—` from all marketing copy (and the app copy too). Rewrite with
  periods, commas, colons, or parentheses. The em-dash-for-drama habit is an AI tell.
- **No section numbers.** Delete the ledger spine `01…12` numbering and the SpineTick. The home
  page is not a numbered sequence, so numbering encodes nothing true. Structure comes from ground
  changes and typographic rhythm, not counters.
- **No fake indicators.** Remove staged "live" dots, "FILED" stamps, fake activity badges, fake
  presence. The interactive demo may show states the visitor actually drives; it must never wear a
  decorative "live/online" costume.

## 1. The brief, pinned

Subject: a shared text-message inbox for a small service business. Audience: the owner and crew of
a plumbing, HVAC, landscaping, cleaning, electrical, or salon shop. Hands-on people, often in a
truck or on a job, phone buzzing in a dusty pocket. The page's one job: convince this skeptical
tradesperson that JobText catches every customer text that turns into paying work, and get them to
start for $29. Their world: the van and its lettering, the yard sign, the clipboard, the phone,
the job address on a scrap of paper, "on my way," the invoice, the tools. The characteristic
moment: a text arrives while your hands are full, and it either becomes money or a missed call.

## 2. The direction, and the one risk

**"Caught."** The identity dramatizes the single most characteristic thing in this world: the
customer text that would have been missed, now caught and claimed by a name so it gets handled.
Confidence, not cuteness. It borrows the way trades announce themselves to the street, bold,
legible, hand-set lettering, and marries it to the calm of a text thread that never drops a lead.

**The one aesthetic risk (spend boldness here, keep everything else quiet):** the hero and section
headlines are set in a distinctive, uncommon DISPLAY face at a confident scale, with a real
customer message as the star and a single marker-yellow highlight on the one word that carries the
promise. Trades live by their signage; a confident, unmistakable letterform grounds JobText in
their world. Justification: it is specific to this audience and no competitor in the SMS-inbox
category does it, so it cannot be mistaken for a template.

## 3. Tokens

### Palette (5 named, brand-anchored, deliberately not a default)
Chosen against the three AI defaults (warm-cream+terracotta+serif; near-black+acid accent;
broadsheet hairlines). The ground is a brand-washed pale petrol-grey, not cream and not white.

- `--petrol   #0F766E`  brand anchor (continuity with the app), links, key marks
- `--deep     #0B4F49`  the single dark band ground (used once, not site-wide)
- `--ink      #101615`  headlines on light, body-dark; a warm green-black, never pure #000
- `--paper    #E6EBE8`  the dominant ground: a pale petrol-grey "painted panel", not cream
- `--marker   #F4D64E`  legal-pad / highlighter yellow. RATIONED: highlight one word, mark the act.
- (`--graphite #444B4C` secondary text; derive tints from these five, do not add new hues)

### Type (deliberate pairing, not the reach-for families; lock via a render pass)
Three roles. A characterful DISPLAY used with restraint, an honest BODY, a utility MONO for data.
Run a font-selection render pass FIRST: render the shortlist in 3-4 real headline compositions,
screenshot, lock the most beautiful in-situ, then build. Do NOT use Fraunces, Playfair, Poppins,
Montserrat, Space Grotesk, Clash, Satoshi, Instrument Serif, Anton (overused).

- **Display shortlist** (uncommon, free/OFL, self-host via next/font/local; pick ONE): Redaction
  (halftone-grain serif), Basteleur (warm quirky serif), Bagnard (Velvetyne, bold), Le Murmure
  (striking condensed), Gambetta (high-contrast serif). Bias to one with confidence + warmth. If
  all fail QA, choose another clearly-distinctive OFL face, never a popular one.
- **Body:** a plain honest workhorse with a little more character than the marketing default.
  Prefer a warm grotesque (e.g. Hanken Grotesk or Schibsted Grotesk) over reaching for Inter again;
  Inter is an acceptable fallback only if the pairing needs it. Set a real scale with intentional
  weights and measure (~66ch).
- **Mono (data):** a distinctive mono for the numbers that matter, the $29, phone numbers, the demo
  timestamps (Commit Mono, Spline Sans Mono, or Departure Mono). This "work-order" honesty is
  grounded in the trade; avoid the common JetBrains/Space Mono.

### Layout
Editorial flow whose structure follows the content's real logic (a text arrives, someone catches
it, the job gets done, here is the price, start), not a counter. Sections are separated by GROUND
changes (paper to the one deep-petrol band and back) and by display-lettering rhythm. Eyebrows and
labels appear only where they carry something true (a real trade name, a real timestamp), never as
decoration. Generous asymmetry, a confident measure, no two adjacent sections share a silhouette.

### Signature
The "caught" thread: a real, specific incoming customer message ("hi, water heater's leaking all
over the garage, can someone come today??") lands and visibly gets claimed by a crew member's name,
the promise word marker-highlighted, the phone and time in mono, over the painted-panel paper. This
is the one thing the page is remembered by. Everything around it stays quiet.

## 4. Imagery (owned, not stock)
Keep the owned treatment: real photography re-graded to a consistent duotone in the palette
(petrol shadows, paper highlights) plus a whisper of grain, one frame language, and the occasional
hand marker annotation pointing at the meaningful part. Real product screenshots kept, framed and
optionally duotone-tinted for cohesion. No generic illustration library. The marker language
(underline, circle, arrow, check) is the only "drawn" element, used sparingly and consistently.

## 5. Motion
One orchestrated moment: the hero "catch" (the message arrives, a name attaches) plays once on
load, respects reduced motion (renders the caught state statically), and is the page's motion
budget. Scroll-reveals are quiet (a short fade-rise, once). No ambient loops, no scattered effects.
Less is more; extra motion reads as generated.

## 6. Writing
Design material, not decoration. End-user's side of the screen: name things by what people control.
Active voice, sentence case, plain verbs, specific over clever, no filler, and no em-dashes.
Buttons say exactly what happens and keep the same word through the flow ("Start for $29" stays
"Start for $29"). Errors state what went wrong and how to fix it, in the interface's voice, and do
not apologize. Empty states invite an action. Real trade content throughout (real-sounding customer
messages, real trade scenarios), never lorem or generic SaaS filler.

## 7. Self-critique vs the defaults (what I changed and why)
- Rejected cream+serif+terracotta (default 1): ground is a brand pale petrol-grey, accent is a
  rationed legal-pad yellow drawn from the trade's own pad, display is chosen by render not by
  reflex.
- Rejected near-black+acid accent (default 2): the dark petrol band is used once, not as the site;
  no acid green, no vermilion.
- Rejected broadsheet hairlines/newspaper columns (default 3): editorial but warm and asymmetric,
  radius and texture present, not a hairline grid.
- Killed the numbered ledger and the FILED costume (my own prior template), which were the loudest
  generic tells.

## 8. Scope and sequencing
Marketing-only rework (app stays calm petrol/stone Inter; this bold identity does not touch the
app). Serialized apps/web wave, after the running code review commits. Order inside the wave: (a)
em-dash + numbering + fake-indicator purge; (b) font-selection render pass, lock the display/body/
mono; (c) build the `<Display>` expressive headline system + marker language + duotone imagery + the
"caught" hero; (d) apply across home, feature, trade, compare; (e) design-QA judges "unmistakable,
subject-grounded, no AI tells, one bold thing, quiet around it," plus Lighthouse and the quality
floor (responsive, visible focus, reduced motion).
