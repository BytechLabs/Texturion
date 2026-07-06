# Loonext Marketing — Art Direction (BINDING)

**Status: BINDING.** Same authority as BLUEPRINT.md, VISUALS.md, and CONVERSION.md: implement,
don't re-litigate. This is the distinctive identity system iteration 5 builds the whole
marketing site from. It sits ABOVE the section-by-section blueprint: BLUEPRINT.md §3 says *what*
each section contains; this doc says *what the whole thing looks and feels like* so twelve
sections read as ONE authored object, not a template stack. Where a specific §3 layout detail
conflicts with an identity rule here, this doc wins on look/feel and BLUEPRINT wins on content
and copy. HERO-CONCEPT.md is the build-ready spec for the one signature moment; this doc is the
system everything else obeys.

The problem this solves, stated plainly: the current site reads as generic "section after
section" with no identity. The user called the hero AWFUL and asked for BREATHTAKING — a
distinctive brand, a "wow" moment that converts, while staying honest, fast (Lighthouse 100),
and unmistakably connected to the calm app. This doc is the resolution of a three-concept
creative bake-off (The Signal / two Dispatch concepts) judged by three panels. The decision and
its reasoning are in §0.

---

## 0. The decision (read this first)

**Winning direction: THE DISPATCH DESK — a warm editorial "job ledger" identity whose signature
moment is a hero the visitor drives with their own thumb: a raw, panicked customer text becomes
an assigned, filed job the whole crew can see.** It is a synthesis, taking the best of all three
bake-off concepts and rejecting the one element that cannot ship:

- **From Concept B (the winner across all three panels):** the *soul and the wow* — the site is
  built like the beautifully-typeset intake ledger a busy shop keeps by the phone, and the hero
  is **participatory, not spectatorial**. The visitor performs the relief (a text goes from
  "unfiled" to "filed & assigned"), so the wow and the 5-second clarity test land in the same
  frame. This is the only concept whose spectacle IS the conversion event instead of decorating
  around it.
- **From Concept A:** the *one genuinely great, fully-buildable, zero-cost idea* — the static
  **SVG spine** threading all twelve sections, and the **signal-dot-resolves-into-a-check**
  motif. This is the strongest antidote any concept proposed to "section after section," and it
  costs no JS. A's Canvas2D particle field is **rejected** — see below.
- **From Concept C:** the *warmth that keeps an editorial system from reading cold for a
  plumber* — the morning-light two-wash atmosphere (petrol low-left, amber upper-right, CSS
  only) and the discipline of ONE repeated motif carried edge to edge.

**Rejected outright: Concept A's above-the-fold Canvas2D particle "catch."** It is the most
beautiful idea on paper and it is not shippable. It collides head-on with the binding
prohibition (BLUEPRINT §13.9: "No scroll-cinema: no parallax, scroll-jacking, GPU scenes, or
animation libraries. Calm craft and speed are the aesthetic.") and with §11.4 ("0KB above the
fold beyond the nav toggle"). Canvas2D-instead-of-WebGL is a lawyer's dodge; the rule's intent —
no ambient generative motion above the fold — still bites. A's own risk register concedes the
collision and asks to "confirm with whoever owns BLUEPRINT before build," and offers to ship its
static fallback as the default. A centerpiece that needs a waiver of an already-litigated rule,
and that degrades away first on a mid-tier Android on 4G (exactly our buyer), is not a direction.
We take A's spine and its motif — both free — and leave the particles. **No canvas, no WebGL, no
particle system anywhere on the site.**

Everything below is the system that decision produces.

---

## 1. The big idea / the soul

**Loonext is the front desk your trade never had.** The whole site is built like a warm,
beautifully-typeset **job ledger** — the physical intake pad a busy shop keeps by the phone,
where every customer text becomes a job ticket that gets claimed, assigned, and closed out where
the whole crew can see it.

The one sentence the brand renders, everywhere, in every medium:

> **A raw, panicked customer text becomes a filed job your whole crew can see. That's a job
> now — not a missed call.**

This reframes the app's calm as **competence, not softness.** The app's promise is "this
respects my time." The marketing brand's promise is "this shop is *on top of things*" — the
relief of a business that never drops a customer, rendered as a ledger that's always squared
away. The emotional target for the ICP: *recognition* ("that's my chaos") immediately followed
by *relief* ("and this catches it, with my crew's name on it"). Not "nice software." "That's the
front desk I can't afford to hire, for $29."

The ledger is **felt, never named.** See §10 (conversion guardrails) — the words "dispatch,"
"ledger," "console," "unfiled queue" never appear in visible copy. A plumber sees ruled rows, a
status spine, a tabular ticket number, a "FILED" stamp — and understands them the way he already
understands the intake pad by his phone. The moment he reads insider vocabulary, the brand tips
into pretentious-designer failure. The metaphor is the *structure*; the copy stays plain, warm,
sentence-case (DESIGN.md G10, CONVERSION.md §3).

---

## 2. The signature motif — the JOB TICKET / ruled ledger row

One grammar, repeated until it becomes the brand fingerprint. This is the Stripe-wave /
Linear-arrow / Resend-gradient discipline: **pick one motif, repeat it everywhere, so a varied
page still reads as ONE designed thing.** For Loonext that motif is the **job ticket** and its
partner, the **ledger spine**.

### 2.1 The ticket (every surface wears it)

Every card, screenshot frame, bento cell, feature row, pricing card, and FAQ item is a **ticket**:

- **10px radius** (the app's exact `--radius`), **1px `stone-200` border**, white surface.
- A thin **petrol "status spine"** down the left edge (2px, `#0F766E`) — the vertical rule that
  says "this is a tracked thing." On a ticket that represents an *unresolved* state it's amber;
  *resolved* it's petrol; *closed/muted* it's `stone-300`. This spine is the single most
  repeated brand element on the page.
- A small **tabular ticket-meta line**: a monospaced-flavored ID (`#0119`, reusing the seed
  number range), a timestamp, and an assignee initial-chip (`P` / `D` / `M` for Priya / Dale /
  Marcus from the §10.1 seed). Tabular numerals always (`font-variant-numeric: tabular-nums`).
- One soft ambient shadow on framed *product* visuals only (`0 24px 64px -32px rgba(28,25,23,
  0.25)`, the BLUEPRINT §1.3 marketing exception). Plain content tickets stay border-only, no
  shadow, exactly like the app's cards.

### 2.2 The spine (the device that kills "section after section")

Threading the entire page, top to bottom, is a single **static SVG ledger spine** — a faint
vertical `stone-200` rule in the left margin (desktop) with a small petrol tick and a tabular
**section number** (`01` / `02` / `03` …) at each section boundary. This is the page's backbone;
it is what makes twelve sections read as one authored *document* rather than a stack of unrelated
bands. It is Concept A's flow-line spine, executed in the ledger's vocabulary.

- **Tech:** one inline `<svg>` per page, server-rendered, `stroke-dasharray` for the ruled look,
  zero JS, zero runtime cost, `aria-hidden`. Optionally drawn in on scroll via the **native CSS
  scroll-driven-animation API** (`animation-timeline: view()`) — this is a CSS feature, NOT a
  library and NOT scroll-jacking, so it stays inside §13.9 and costs nothing in Lighthouse. Under
  `prefers-reduced-motion` the full line renders statically.
- **Mobile:** the margin spine collapses; the section-number ticks move to a small inline
  `01`-style eyebrow label above each H2 (they carry the same fingerprint without needing margin
  room). The spine is desktop richness, never a mobile layout cost.

### 2.3 Section dividers, bullets, checkmarks

- **Dividers:** a single petrol hairline rule with the tabular section number sitting on it —
  the magazine/ledger fingerprint. Never a full-width background change (backgrounds change only
  for the two washes and the one dark band, per BLUEPRINT §1.2).
- **Bullets & "done" marks:** every list bullet is a tiny ticket-corner; every completed/included
  item is the **signal-check** — a petrol dot that resolves into a check (Concept A's caught-
  signal shape, adopted as the universal "done" glyph). This is the same visual idea as the app's
  D14 done-mark (strikethrough + petrol check), so it's honest and on-brand.
- **Favicon / wordmark:** unchanged — the existing app mark (rounded petrol speech-bubble tile,
  white "J"). Reuse, never redesign (BLUEPRINT §10.3). The ticket motif is the *page* fingerprint;
  the bubble mark stays the *logo*.

**Anti-fatigue rule (binding):** the ticket frame on *everything* risks monotony. Reserve the
**status-spine and the FILED stamp for genuine product moments only** — real conversations,
real feature tiles — never on a plain copy card. Vary ticket density and scale across the density
wave (BLUEPRINT §1.4). The two giant tabular numerals (§4.2) and the one petrol flood (§3.4) are
the release valves.

---

## 3. Color, light & texture — how petrol scales up expressively while staying trustworthy

The rule from BLUEPRINT §1.2 holds and is *amplified*, not replaced: **the marketing site is the
app's palette dialed up, with radical two-color discipline.** Petrol owns the page; everything
else is stone and light.

### 3.1 The core palette (unchanged from the app — this is the trust anchor)

- Base `stone-50` (#FAFAF9) page, white ticket surfaces, `stone-200` 1px borders,
  `stone-900` / `stone-500` text.
- **Petrol `#0F766E` (teal-700) is the ONLY accent.** `teal-800` hover, `teal-50` tinted fills.
  It is the status spine, the stamp, the CTA, the section ticks, the checkmarks, the eyebrows.
- **Amber is the honesty color, and only that.** It is the app's real registration-banner amber —
  so using it is honest, not decorative. Amber appears on exactly three things: internal-note
  cards, the "unresolved" ticket spine, and the first-week US-timeline. Nowhere else.
- Two-color discipline is the point: petrol + stone, with amber as the single honest exception.
  No third accent, no gradient buttons, no glow borders, no specular tricks. The "Linear dark-glow
  developer look" is explicitly rejected (wrong buyer).

### 3.2 The morning-light atmosphere (the warm signature — from Concept C, per BLUEPRINT §1.2)

The one place petrol becomes *light* instead of ink. Behind the hero (and echoed faintly on the
final CTA band) sits a **directional two-wash light field** — the Resend technique, committed to,
not the timid single-blur version:

- Two stacked soft-stop radial washes plus a faint directional lift: a **petrol core**
  `rgba(15,118,110,0.12)` low-left, a **warm amber lift** `rgba(251,191,36,0.06)` upper-right,
  over the `stone-50` base. The hero sits in warm morning light through a shop window — not a
  flat gray SaaS box, and not a centered blur.
- **CSS gradients only**, a fixed decorative layer, `aria-hidden`, positioned **behind the LCP
  box, never over it or over any body text**, never animated, exactly one per page. **No `blur()`
  filter on the LCP region** — soft-stop gradients achieve the glow without the paint cost
  (§11.4). This is what keeps the editorial ledger reading *warm and human* rather than clinical
  — the single most important thing preventing "too designery for a plumber."

### 3.3 Section washes & the one dark band

- **Section washes:** `linear-gradient(180deg, #FAFAF9, #F0FDFA)` (stone-50 → teal-50) on **at
  most two bands** — the pricing preview and the final CTA. Subtle enough to survive a bad
  projector.
- **Exactly one dark band per page** ("Built for the truck", BLUEPRINT §3.8): `stone-950`
  background, `stone-900` surfaces, `stone-800` borders, `teal-500` accent — the app's real
  dark-mode tokens. It is literally the product at night. This is where petrol glows brightest
  (the phone screen's light) and where the one whisper of texture lives (§3.4).
- **The petrol FLOOD (from Concept B — the release valve):** the final CTA may go **full-bleed
  petrol** — the whole band solid `#0F766E`, white type, one white "Start for $29" button. After
  a whole page of disciplined stone-and-petrol restraint, one band where petrol floods
  edge-to-edge is the earned crescendo. This is distinct from the dark band; a page has at most
  one dark band AND at most one petrol flood, and they are not adjacent.

### 3.4 Texture (kills "empty," costs nothing)

Richness comes from real product DOM and generous negative space, never from decoration. The
only literal texture on the page:

- A **whisper of grain + a faint dot-grid** on the **dark band only** — a tiny inline SVG
  `feTurbulence` at low opacity plus a CSS dot-grid. It reads crafted, kills the "empty dark
  rectangle" feeling, and is **off on mobile**. Never large raster, never animated.
- Everywhere else: whitespace and the ledger spine are the texture.

---

## 4. Typography — Inter, pushed to editorial scale

**Inter only. No second typeface.** (BLUEPRINT §1.1 is binding and correct: a second face breaks
the brand; the 2026 "playful serif headline" trend is rejected; Inter 600 with tight tracking
already reads confident.) The escalation the marketing site earns is *scale and ruling*, not a
new face. This is the editorial lane — type is the loudest lever, so we push it exactly here and
nowhere else.

### 4.1 The type scale (from BLUEPRINT §1.1, with the ledger treatment layered on)

| Role | Size (desktop / mobile) | Weight | Tracking | Leading | Notes |
|---|---|---|---|---|---|
| **Numeral display** (price/timeline as art) | `clamp(88px, 12vw, 132px)` | 600 | −0.03em | 1.0 | petrol, tabular, **used exactly twice** |
| Display (hero H1) | `clamp(44px, 5.5vw, 72px)` | 600 | −0.02em | 1.05 | sentence case, ledger-ruled baseline |
| Section H2 | `clamp(30px, 3.5vw, 40px)` | 600 | −0.02em | 1.15 | |
| Card H3 | 20px | 600 | −0.01em | 1.25 | |
| Lead paragraph | 18–20px | 400 | 0 | 1.55 | measure ≤ 66ch (magazine measure) |
| Body | 16px | 400 | 0 | 1.6 | |
| **Ledger meta / eyebrows** | 13px | 500 | +0.02em | — | tabular, sentence case; the ticket-meta and `01` section labels live here, in `stone-500` with petrol ticks |
| Stats & prices | tabular numerals always | 600 | | | `font-variant-numeric: tabular-nums` |

- Self-hosted Inter variable via `next/font`, one file for 400/500/600 — already the app's setup,
  **zero font CLS for free.** `font-feature-settings: "cv11","ss01"` and `tabular-nums` per the
  app (DESIGN.md G2).
- **Sentence case everywhere, including H1s.** Weight never exceeds 600.
- **The ledger-ruled baseline** is the one new typographic device: the hero H1 (and section H2s)
  sit on a thin petrol hairline like a ledger line, and one key noun in the H1 carries a petrol
  **highlight-swipe** underlay (a CSS `background-size` transition that animates once, renders
  pre-swiped under reduced-motion). This is the editorial fingerprint applied to type.

### 4.2 The numeral-display device — the signature graphic (used EXACTLY twice)

The one weight/scale escalation over the app. A **132px tabular petrol numeral** is Loonext's
signature graphic device, and it appears **exactly twice** so it reads as intentional art, not
decoration (BLUEPRINT §0.2):

1. **`$29`** in the truth bar (§3.2 of BLUEPRINT) — the price IS the argument.
2. **The day-count** in the first-week timeline (§3.5) — the honest wait rendered large and
   confident.

It renders as plain HTML text (Inter tabular, `clamp()` sizing), final on paint — **never a
count-up-from-zero**, never canvas, never an image. Do not let a third display numeral creep in
anywhere (this is a hard rule — the contrast of *two big moments, everywhere else quiet* is the
identity). No other display device is added; A's "numeral everywhere" temptation is rejected.

---

## 5. Motion language — the STAMP, and two honest speeds

The app's own grammar is the brand's motion signature: **200ms fade + 4px rise arrivals, 150ms
ease-out hovers, no bounce, `prefers-reduced-motion` disables all.** The marketing site adds
exactly one characterful beat on top of that grammar.

### 5.1 The one signature beat: the FILE / STAMP

When a ticket resolves — in the hero when the visitor files a job, and on the two live bento
tiles — the row **snaps square and a petrol "FILED" stamp presses in**: a 150ms `scale(1.08→1)`
+ `opacity(0→1)` compositor-only keyframe, borrowed directly from the app's arrival grammar. It
is viscerally satisfying (the small dopamine hit of getting-on-top-of-it) and it is the brand's
one moment of *character*. Reserved for genuine product-state changes only; never decorative.

### 5.2 Two speeds, honestly separated

The design tension of the whole brand — chaos tamed into order — is expressed in the motion
itself, but WITHOUT any ambient/generative motion (no particles, per §0):

- **Raw speed** — the *incoming* raw text (the hero's unfiled bubble) arrives slightly askew,
  plain gray, a touch restless. This is "the mess."
- **Filed speed** — the instant it's filed, everything moves in the app's crisp, calm grammar:
  square, aligned, 200ms fade + 4px rise, the stamp, the status pill blooming to "New," the
  assignee chip landing. This is "on top of it."

The contrast between the two is the felt argument. Under `prefers-reduced-motion`, raw-speed
collapses to zero and only the calm, filed result shows.

### 5.3 Scroll reveals & micro-interactions (unchanged from BLUEPRINT §1.5)

- Scroll reveals: `opacity 0→1 + translateY 12px→0`, 300ms ease-out, **once**, at 20% visibility,
  via one tiny shared IntersectionObserver utility (no animation library). Stagger 60ms, max 4.
  Animate transform/opacity inside an already-reserved layout box (CLS-safe).
- Hero never animates in (it's the LCP; it's just there).
- Micro-interactions: 150ms ease-out hovers, exactly as the app.
- **Banned (BLUEPRINT §13.9, reaffirmed):** parallax, scroll-jacking, marquees, autoplaying
  video, count-up-from-zero numbers, WebGL, Canvas2D animation, particle fields, any animation
  library.

---

## 6. Iconography & illustration language

- **Icons:** lucide-react at the app's `stroke-width={1.75}`, always petrol, each sitting in a
  **`teal-50` rounded chip** — the exact chip used for the app's status pills and the mega-menu
  rows (VISUALS §5b). Using one chip shape across nav, app, and marketing makes them feel like one
  object. Trade icons: wrench / shovel / sparkles / fan / scissors for plumbers / landscapers /
  cleaners / HVAC / salons.
- **Illustration = crafted inline SVG only** (VISUALS §1B), in stone + petrol, geometric, warm,
  confident line/fill (Stripe's restraint, never clip-art). Same stroke weight, same 10px corner
  radius, same 2–3 color depth across the whole set. **No stock photography, no AI-generated art,
  no illustration-led sections** (BLUEPRINT §13.2). The richness is real product DOM and crafted
  SVG, framed in the ticket grammar.
- **Infographics** (VISUALS §1C) all inline SVG, themeable via `currentColor`, stroke 1.75,
  reduced-motion-aware: the how-it-works connector (dashed petrol path), the first-week timeline
  (the numeral-display centerpiece), the flat-vs-per-user chart. These wear the ledger vocabulary
  — the timeline is a ledger rail, the connector is a dashed status line.
- **No mascot.** Concept C's 12px bubble character is **cut.** The panels flagged it as C's single
  biggest ICP liability ("too cute for a plumber") and C pre-authorized deleting it. A plumber
  choosing who handles his customers' texts does not need a cartoon nodding at him. The brand's
  warmth comes from the morning light, the amber honesty notes, and the founder line — never from
  a character.

---

## 7. Page narrative & rhythm — breaking the generic section-stack

The page is authored as **a tradesperson's real day, threaded on the ledger spine** — not a
section stack. The canonical section order and the density wave are BLUEPRINT §3 / §1.4 (do not
re-sequence). This doc adds the *identity treatment* that turns that order into one authored
document:

1. **The spine is the through-line.** Every section boundary carries a tabular section number
   (`01`…`12`) on the spine (§2.2). A reader scrolling feels a single ledger unspooling, not
   twelve separate pages. This is the primary antidote to "section after section."
2. **Density is a wave, enforced** (BLUEPRINT §1.4): dense → sparse → dense → sparse. No two
   low-visual sections adjacent; a breather before each dense section; product visuals in the
   back half. The signature hero (dense) → truth bar (`$29` as art, sparse) → problem (sparse) →
   inbox deep-dive (dense) → how-it-works + timeline (med, the honesty crescendo) → bento (dense)
   → missed-text breather (sparse) → **dark band** (dense, the night scene) → pricing + slider
   (med) → Canada + compliance (med) → FAQ (sparse) → **final CTA petrol flood** (sparse close).
3. **Dark/light interplay:** the page is warm light throughout, with exactly one dark band (the
   truck/night scene) and exactly one petrol flood (the close) as the two tonal releases. These
   are the crescendos; everywhere else is disciplined stone-and-petrol calm. The contrast is what
   makes them land.
4. **Signature moments, rationed** (BLUEPRINT §0.2): the participatory hero, the two
   numeral-display moments, the one stamp beat, the dark band, the petrol flood. Five deliberate
   peaks across a calm page. Restraint is the identity.
5. **The back half carries product** — the usage meter, the crew-size slider, the area-code
   widget are all real product visuals, so a reader past the dark band still meets the product,
   not five bands of text.

---

## 8. How it stays connected to the calm app brand (while being far bolder)

The bar (constraint 3): bolder than the app, but unmistakably the *same* brand — petrol, quality,
trust. How every bold move stays tethered:

- **Same tokens.** Every color, radius, weight, and motion curve is DESIGN.md G2 — petrol
  `#0F766E`, 10px radius, Inter 400/500/600, 200ms/150ms ease-out. Nothing new is invented; the
  marketing site is the *same design system at a different volume.*
- **Same primitives.** The hero, the two live bento tiles, and the dark-band thread are built
  from the **app's real thread UI components** (BLUEPRINT §1.3) with the app's real seed data
  (Reyes Plumbing). The wow is literally the product — so it cannot be off-brand.
- **The ledger is the app's own logic surfaced.** Status pills, assignee chips, notes, done-marks,
  delivery checks — the "ticket" vocabulary is just the app's real conversation model given an
  editorial frame. It's bolder *typography and composition* around *the same product*.
- **Bolder is bounded.** The three escalations over the app — (1) the numeral-display scale, (2)
  the morning-light atmosphere, (3) the editorial ledger composition — are each used sparingly
  and each trace to something honest (the real price, the real registration amber, the real
  conversation model). Boldness never means a new color, a new face, or a fabricated flourish.

---

## 9. What makes this breathtaking and NOT generic

- **A wow that is the product working, driven by the visitor's own hand.** Nobody in
  business-texting owns "the visitor files their own chaos into order in one tap." Competitors
  show static bubbles or stock photos. Watching a panicked "water heater's leaking!!" become a
  clean, assigned, filed job *you just filed* is recognition + relief in one frame — the exact
  screenshot a plumber sends his brother-in-law. It's the product's argument made physical, not a
  decorative gradient.
- **An ownable editorial identity in a category that has none.** The job-ledger system (status
  spine, tabular ticket meta, section numbers `01`/`02`, the FILED stamp) is genuinely
  distinctive AND maps to something the ICP already runs by their phone — the intake pad. It reads
  as *competence*, the disarming Family.co move, not art-direction.
- **The spine makes the page an authored document.** One ledger rule threading twelve numbered
  sections is what turns a stack into a story. This is the direct cure for the user's actual
  complaint.
- **Two big numerals and two tonal floods, on a disciplined calm page.** `$29` at 132px, the
  day-count at 132px, one dark night-scene band, one petrol flood close — rationed peaks that hit
  *because* everything around them is quiet. That contrast is craft; a page that shouts everywhere
  shouts nowhere.
- **Bold AND fast AND honest — the rare trifecta.** Distinctive identity, a genuinely delightful
  signature interaction that IS the product, radical two-color discipline, Stripe-grade restraint
  — all shipping at Lighthouse 100 with zero WebGL and no fabricated proof. Craft judges reward
  the discipline; it proves bold ≠ slow and beautiful ≠ dishonest.

**Why it is NOT generic:** generic SaaS is a centered blurred gradient, a stock hero, a logo wall,
and a section stack with no through-line. This is a directional morning-light field, real product
DOM you operate yourself, a ledger spine numbering every beat, and verifiable-truth proof where
the logo wall would go. Every one of those is the opposite of the generic move.

---

## 10. Conversion guardrails (clarity + CTA are never sacrificed for art)

Binding, and they override any art instinct on conflict (CONVERSION.md is equal authority; when
richness fights clarity, **clarity wins**):

1. **The 5-second test passes in the same frame as the wow.** The hero H1 states exactly what it
   is ("a shared text inbox for your crew"), who it's for, and the one button, with **zero
   reliance on the animation.** The interaction decorates the clarity; it never replaces it. A
   static hero must fully pitch (§HERO-CONCEPT: server-rendered filed state).
2. **One primary CTA, everywhere, same words: "Start for $29"** (CONVERSION §2). It is the one
   magnetic petrol button. The hero's "file it" affordance must never visually compete with the
   real CTA — the desk *teaches value*, the petrol button *converts*. Pair every CTA with the
   risk-reducer ("Month to month. 30-day money-back.").
3. **The ledger is felt, never named.** No "dispatch," "ledger," "console," "unfiled queue," or
   any insider vocabulary in visible copy. Sentence-case, plain-warm, second person (DESIGN.md
   G10). Kill any beat that reads as a flex.
4. **The interaction must be instruction-free** (or it dies silently). Ship the discoverability
   kit: a one-time pulse on the ASSIGN control, a "tap to file →" micro-hint, and a single
   ghost-demo auto-play if untouched after ~3s. The finished state is already meaningful so the
   ~40% who never interact — plus no-JS and reduced-motion — still get the entire pitch. **Test on
   a fresh non-designer before anything else ships.**
5. **Honesty is absolute** (BLUEPRINT §13, VISUALS §6): no fake logos, counts, testimonials,
   badges, or stock. The stamp/ticket must never imply automation Loonext lacks (no auto-reply,
   no auto-schedule) — the *visitor's own tap* does the filing, which is accurate (a human
   assigns). Every infographic number traces to SPEC or user input. Warmth and proof come from
   verifiable truths (transparent $29, the owned $58→$29 first-month math, the security strip, the
   founder line, the honest US timeline), never fabrication.
6. **Expressive spend is capped at the two sanctioned numerals** (§4.2) + the one stamp + the two
   tonal floods. No creep. The restraint is the brand.
7. **Performance is a hard gate, not a taste** (BLUEPRINT §11.4): LCP < 1.5s (H1 text), CLS < 0.05,
   INP < 200ms, Lighthouse 100/100/100/100 on home + pricing, 0KB above-fold JS beyond the nav
   toggle, each below-fold island < 15KB gz. Any art element that threatens this degrades to its
   static form. Re-run a **real mobile** Lighthouse pass as a launch gate.

If a proposed visual can't satisfy all seven, it doesn't ship — simplify, don't add.
