# JobText Marketing — Reference Craft Bar (BINDING ADDENDUM)

**Status: BINDING.** Same authority as ART-DIRECTION.md, HERO-CONCEPT.md, BLUEPRINT.md, VISUALS.md,
and CONVERSION.md: implement, don't re-litigate. This doc is the **craft addendum** — it does not
change *what* the site says (BLUEPRINT/COPY) or the *identity* it wears (ART-DIRECTION), it raises
the *execution bar* those docs are built to. The user handed five reference sites — **Column,
Rollups, Cofounder, Granola, Solidroad** (plus the close cousins Attio and Clay in the teardown
set) — and one instruction: *"we don't want bland text on page section after section."* This is the
quality floor iteration 5 and every iteration after it is judged against. Design-QA scores every
round against this doc.

On conflict, the existing precedence holds: **honesty > clarity/conversion > performance gates >
look/feel.** Nothing here waives ART-DIRECTION §10 (conversion guardrails), the two-numeral cap
(§4.2), the no-WebGL/no-Canvas ban (§0), or the Lighthouse-100 gate (§11.4). The references show us
how much richer we can be *inside* those rails — they do not buy us out of them.

---

## 1. The quality bar (the shared DNA of the five references)

Strip the five references to their common denominator and one sentence falls out:

> **These sites don't describe a product — they *show it working*, framed as an editorial document,
> with type doing the personality work, and each section handing the eye a different *kind* of
> object so the scroll never repeats itself.**

Five shared traits, and what each means for us:

1. **Editorial, not "marketed."** Column reads like a technical broadsheet; Rollups like a set
   financial magazine; Cofounder like a book with numbered chapters; Granola like a well-made print
   object; Attio literally numbers its sections `[01]…[04]`. None feels like a component-library
   SaaS template. **Ours must read like the beautifully-typeset intake ledger — the ledger spine
   numbering `01…12` is our version of Attio's `[01]` index and Cofounder's Roman-numeral chapters.
   That device is already in ART-DIRECTION §2.2; the references confirm it is the single
   highest-leverage anti-bland move on the board.**

2. **Product-forward, not paragraph-forward.** The *content of most sections is a live-looking
   product surface*, not prose. Column animates an ACH ticket unfurling and a checkmark drawing
   itself; Solidroad's whole fold is a working scorecard; Granola shows a real generated note;
   Cofounder/Attio build dashboards in real DOM. **The paragraph between the product surfaces is
   short because the product does the talking.** This is exactly our "richness is real product DOM"
   rule (VISUALS §1A, BLUEPRINT §1.3) — the references prove it is the bar, not a nice-to-have.

3. **Characterful — one ownable fingerprint, repeated.** Each site has ONE motif carried edge to
   edge: Column's request/response + mono; Solidroad's score-pill row; Granola's slab serif +
   hand-drawn mark; Attio's numbered index + morphing records; Clay's machine-world illustrations.
   **Ours is the job-ticket / status-spine / ledger-row (ART-DIRECTION §2). Solidroad is the direct
   proof: reuse ONE data-row grammar in the hero and again deeper down, and a varied page reads as
   one instrument.**

4. **Fast — the character is CSS/DOM/SVG, never heavy 3D.** Column's "breathing" hero is a CSS
   hue-rotate, not WebGL. Solidroad, Granola, Attio, Cofounder carry the whole argument in DOM +
   light motion. **This is our exact budget: no canvas, no WebGL, Lighthouse 100.** The references
   are living proof that "no 3D" is not a handicap — restraint reads as *engineered and trustworthy*
   (Column) and *calm confidence* (Solidroad), which is precisely the temperature a plumber trusts.

5. **Restraint as identity — one accent, rationed peaks.** Column: one petrol base + a lime that
   *means "money moving"*. Attio: one teal on near-black. Granola: one systematized green on
   near-monochrome. Every color event is a *signal*, not decoration. **Ours is petrol + stone, amber
   as the single honest exception (ART-DIRECTION §3.1) — already correct. The references validate the
   discipline and warn against diluting it.**

**What the bar is NOT** (the failure the user named): section-after-section of centered text on
white, a stock hero, a logo wall, a feature grid with no through-line, the same layout silhouette
band after band. Every reference actively defeats this. So must we.

---

## 2. Transferable craft (numbered, each mapped to WHERE in JobText it applies)

Each item: the technique, the reference it comes from, **where in our site it lands**, and how it
reconciles with the Dispatch Desk identity + our perf gates. "ADOPT" = ship it in iter 5. "ALREADY
SPEC'D" = the reference confirms an existing decision; hold the line, don't dilute.

### Type treatment

1. **A mono-flavored ledger texture from tabular numerals — NOT a second typeface.**
   *(Column: a bespoke Suisse Mono carries every dollar figure, timestamp, ID, and 12px label,
   creating a "ledger/terminal" texture for free. Rollups & Attio: mono reserved strictly for data
   values / field names.)* We are **Inter-only and stay Inter-only** (ART-DIRECTION §4, binding). We
   get Column's ledger texture *without a second face* by reserving `font-variant-numeric:
   tabular-nums` + the 13px `+0.02em` ledger-meta style (ART-DIRECTION §4.1) for **every ticket ID
   (`#0119`), timestamp (`2:14 PM`), section number (`01…12`), price, and stat** — and *never* for
   prose. **WHERE:** the ticket-meta line in the hero desk and every product surface; the spine
   section numbers; the `$29` and day-count numerals; every stat chip in the truth bar (§3.2). This
   is the single move that buys us Column's "engineered ledger" feel on our budget. *Reconcile:*
   Attio explicitly proves reserving tabular/mono for data reads editorial **without** a second
   face — cite it as precedent that protects our Inter-only rule.

2. **Extreme two-voice type-scale contrast — big display vs tiny label, almost nothing between.**
   *(Rollups: 54px tight display vs 12px uppercase mono, no middle register — this jump is the
   primary rhythm device. Granola/Attio: oversized display headline over micro-metadata.)* We
   already have the ingredients: the `132px` numeral-display (used exactly twice, §4.2), the
   `clamp(44–72px)` H1, and the 13px ledger-meta eyebrow. **ADOPT the *discipline*: make the jump
   deliberate and visible** — a `01`-style 13px eyebrow directly above a large H2, with the meta and
   the display doing the loud/quiet work, and **kill any mid-size sub-headline clutter** that softens
   the contrast. **WHERE:** every section head across home + feature + trade + compare pages. *Do NOT
   copy Rollups' 54px ultra-tight VC-grotesque* — ART-DIRECTION §4.1 keeps our headings slightly
   more humane (−0.02em, not −1.08px, sentence case) to match tradespeople. Steal the *contrast
   structure*, not the finance temperature.

3. **The ledger-ruled baseline + one highlight-swipe as the editorial type fingerprint.**
   *(Rollups: hairline `0.5px` ledger borders with negative margins collapse into one crisp rule —
   literally an accounting grid. Column: type sits on precise technical rules.)* **ALREADY SPEC'D**
   (ART-DIRECTION §4.1: H1/H2 sit on a thin petrol hairline; one key noun in the H1 carries a
   petrol highlight-swipe). The references confirm this is *the* device that makes plain type read
   "designed." **WHERE:** hero H1 (swipe on "job"), every section H2's ruled baseline. Hold it;
   don't let it get dropped as "just a border."

### Section variety (the core anti-bland engine)

4. **Section-silhouette rotation — no two consecutive sections share a shape.**
   *(Granola: type hero → 3-col grid → full-bleed plate → logo wall → tabbed triptych → pull-quote
   carousel → 6-cell grid → one-line prompt. Cofounder: chapters → alternating L/R mockups → metric
   callouts. Attio: numbered light band → dark scale band → morphing record.)* This is the #1
   engine every reference uses and the direct cure for the user's complaint. **ADOPT as a hard
   rule** (see §3). **WHERE:** the entire home section order (BLUEPRINT §3) — which is *already*
   sequenced as a density wave; iter 5 must also enforce **silhouette** variety on top of density.
   Cross-check the canonical order so no two adjacent bands are the same *layout kind*, not just the
   same density.

5. **The alternating left/right product-mockup rhythm.**
   *(Cofounder: mockups flip right→left→right→left down Start/Build/Sell/Scale, killing centered-
   column monotony.)* **ADOPT** for the run of product sections. **WHERE:** §3.4 (inbox deep-dive,
   sticky-left / thread-right) → §3.6 bento (asymmetric) → §3.8 dark band (copy-left / phone-right).
   Deliberately alternate the product's side down the page. *Reconcile:* stays trivially inside perf
   (pure layout); reinforces the ledger by making each product surface a fresh "entry."

6. **Asymmetric fractional grids instead of even thirds.**
   *(Rollups: `2.5fr 1fr .75fr .75fr`, `.35fr 1fr`, centered `1fr auto 1fr` — uneven ratios create
   magazine asymmetry.)* **ADOPT** where we currently default to even columns. **WHERE:** the problem
   trio (§3.3) and the bento (§3.6) should use an intentional asymmetric ratio, not 1/1/1; the
   how-it-works steps (§3.5) can lean one column wider. *Reconcile:* free, CLS-safe, and it's what
   separates "editorial" from "wireframe."

7. **A tabbed / switchable section that does the work of three.**
   *(Granola before/during/after triptych; Rollups "Rollups in action" 01/02/03 tabs; Clay's
   use-case switcher; Cofounder's chapters.)* We already have the *hero* as our one big interactive.
   The references say the **back half should also carry one participatory switch** so it doesn't
   decay into text (Clay's lesson: let the visitor drive one thing, not scroll ten). **ADOPT: make
   the bento's two live tiles (§3.6) genuinely switchable/steppable, and keep the crew-size slider
   (§3.9) and area-code widget (§3.10) as the back-half participatory beats.** **WHERE:** §3.6, §3.9,
   §3.10. *Reconcile:* each is already a <15KB island (BLUEPRINT §3); this is a framing mandate, not
   new scope.

### Product presentation

8. **Product-as-hero via animated real-DOM surfaces — the demo IS the screenshot.**
   *(Column: an ACH card unfurls, a check draws itself; the demo collapses "explain" and "show".
   Solidroad: the fold is a working scorecard. Cofounder/Attio: dashboards in live HTML, crisp at
   any DPR.)* **ALREADY SPEC'D and CENTRAL** — the participatory hero (HERO-CONCEPT) and the three
   live-DOM moments (BLUEPRINT §1.3). The references are the strongest possible validation that we
   put the product *working* in the fold, not a stock hero. **Hold the line: the hero desk, the two
   bento live tiles, and the dark-band thread must actually be live app primitives, not flat crops.**

9. **One repeated data-row grammar as the brand fingerprint, reappearing down the page.**
   *(Solidroad: the name+score-pill row recurs from the hero into the "close the loop" section, so
   the page reads as one instrument. Attio: the same records rearrange between states.)* **ADOPT the
   *recurrence* explicitly.** ART-DIRECTION §2 defines the ledger row (ID + status spine + assignee
   chip); iter 5 must **make it literally reappear** — the same row grammar in the hero desk, again
   in the §3.4 deep-dive, again as the bento tile-1 header, again in the dark band. **WHERE:** every
   product surface. *Reconcile:* this is what turns twelve sections into "one ledger," reinforcing
   the spine — pure DOM, no cost. Note the ART-DIRECTION §2 anti-fatigue rule: reserve the *stamp*
   and status-spine for genuine product moments; vary ticket density so the row recurs without
   fatiguing.

10. **Self-drawing checkmark via `stroke-dashoffset`.**
    *(Column: a checkmark draws itself via `@keyframes` animating SVG `stroke-dashoffset` → 0 as the
    "verified/settled" tick.)* **ADOPT** as our universal "done" glyph. We already spec the
    signal-dot-resolves-to-a-check (ART-DIRECTION §2.3, the D14 done-mark). Column gives us the exact
    cheap, LCP-safe technique. **WHERE:** every included-feature check (pricing, bento, FAQ), and the
    "Delivered ✓" beat in the hero's filed state. *Reconcile:* one tiny CSS keyframe, reduced-motion
    renders pre-drawn — trivially inside §11.4.

11. **A card that unfurls (`max-height` keyframe) to reveal a filed job's crew-visible detail.**
    *(Column: an ACH detail card unfurls `max-height 92px → 464px` as you watch.)* **ADOPT
    (optional, one place only)** as the reveal for the hero's filed state or the §3.4 stepped
    detail. *Reconcile:* `max-height` animates without layout thrash if the box is reserved (CLS-safe
    per §11.4); use once, don't sprinkle. This is a *release-valve* beat, subject to the §5.1
    stamp-is-the-signature-motion rule — the unfurl supports the FILED stamp, never competes with it.

### Motion / scroll craft (within no-WebGL / Lighthouse-100)

12. **Pure-CSS "breathing" atmosphere — a hue/position drift, no canvas.**
    *(Column: `@keyframes background-gradient-animation` slowly hue-rotates the hero wash so it
    breathes — LCP-safe, the exact technique for a no-WebGL brief.)* **CAUTION / BOUNDED.** Our
    morning-light two-wash is committed as **not animated** (ART-DIRECTION §3.2, BLUEPRINT §1.2 — "no
    `blur()` on the LCP region, never animated, one per page"). We do **NOT** adopt an animated hero
    wash — it risks the LCP-region paint budget and our "no ambient generative motion above the fold"
    rule (§0). Column's technique is noted as *proof that CSS-only ambient motion exists*, but our
    disciplined static two-wash is the faster, committed equivalent. **Do not let this reference
    reopen the animated-background question.**

13. **Scroll-reveal choreography — small, layered, varied, cheap.**
    *(Rollups: `page-fade-in` entrance, `translateY(20px)` scroll-rises, staggered pill delays,
    hover-arrow expansions — each a small, *different* event so the page always feels alive without
    one flashy effect.)* **ALREADY SPEC'D** (ART-DIRECTION §5.3 / BLUEPRINT §1.5: opacity+`translateY
    12px`, 300ms once, 60ms stagger max 4, one shared IntersectionObserver). The references confirm
    the recipe — hold it, and make sure the stagger is actually *used* so grids arrive with rhythm,
    not all at once. **WHERE:** every below-fold section.

14. **The hover-arrow-expand CTA micro-interaction.**
    *(Rollups: an arrow starts `width:0; opacity:0` and expands on hover while the label slides,
    `cubic-bezier(.4,0,.2,1)` 0.3s — tactile, consistent across every CTA.)* **ADOPT** as the
    secondary-CTA treatment (the "See how it works →" / "Get your number →" text links). **WHERE:**
    every secondary CTA site-wide. *Reconcile:* the *primary* petrol button keeps its magnetic pull
    (HERO-CONCEPT §4) and must always out-weigh secondaries (CONVERSION §2) — the arrow-expand is for
    the quiet links, so it enriches without competing.

15. **The FILED stamp is our one signature motion beat — treat it like Column's self-drawing check
    or Solidroad's animating score.** **ALREADY SPEC'D** (ART-DIRECTION §5.1). The references teach
    that the ONE characterful beat must be reserved for the genuine product-state change and land
    with impact. Hold: `scale(1.08→1)` + fade, compositor-only, product moments only.

### Color / texture

16. **Warm-tint EVERY neutral toward the brand — text is never pure black.**
    *(Rollups: text is dark olive `#1a310f`, secondary is muted moss `#545f49` — never gray/black;
    every neutral pushed toward the hue so even a plain paragraph feels designed.)* **ADOPT — this is
    the highest-value warmth move for our "warm editorial" promise.** Our stone scale is already
    warm-tinted (stone-900/500, not `#111`), but iter 5 must **verify body and secondary text
    actually use the warm stone tokens, not a cold gray**, so a plain copy section reads warm without
    any decoration. **WHERE:** all body/secondary text, every page. *Reconcile:* zero cost, directly
    serves "warm, never clinical" (ART-DIRECTION §3.2) — the single thing preventing "too designery
    for a plumber."

17. **One accent that *means something* — reserve amber for its one signal, like Column reserves
    lime for "money moving."** **ALREADY SPEC'D and CORRECT** (ART-DIRECTION §3.1: amber = honesty
    only — internal notes, unresolved spine, US timeline; nowhere else). Column is the precedent:
    a disciplined second color that *signals* rather than decorates. Hold the three-places-only rule
    ruthlessly; every stray amber is a leak.

18. **Texture as a lightweight overlay, not a heavy plate — and only where sanctioned.**
    *(Granola: grain/painterly plates for warmth — but heavy full-bleed photos threaten Lighthouse.
    Cofounder: atmospheric cloud PNGs — flagged as weight risk. Both teardowns say: get the depth
    with lightweight CSS/SVG, not raster.)* **ALREADY SPEC'D** (ART-DIRECTION §3.4: one whisper of
    `feTurbulence` grain + dot-grid on the **dark band only**, off on mobile; everywhere else
    whitespace + the spine are the texture). The references *validate our restraint* and warn us off
    Granola's/Cofounder's raster plates. **Do not add texture beyond the sanctioned dark band.**

### Interactive moments

19. **Let the visitor DRIVE one thing instead of scrolling past ten static ones.**
    *(Clay's tab-switcher and Solidroad's animating scorecard are the structural cousins of our
    participatory hero.)* **ALREADY SPEC'D and is our whole thesis** (HERO-CONCEPT: the visitor taps
    to FILE a job). Clay's lesson extends it: **one *more* lightweight participatory module in the
    back half** so the second half stays driven, not read — our crew-size slider (§3.9) is exactly
    that. Hold both; ensure discoverability (HERO-CONCEPT §4 kit) so the hero interaction isn't a
    dead hero.

20. **Quantified, verifiable proof where the logo wall goes — not manufactured social proof.**
    *(Solidroad: the single testimonial is flanked by hard stats (1hr saved, 2000+ hrs), not a logo
    wall. Column: big mono figures ($4.5T+, 99.999%) punctuate. Clay/Attio: named+quantified proof
    over bare logos.)* **ALREADY SPEC'D** (BLUEPRINT §3.2 truth bar = real product numbers, not fake
    logos; §3.12 founder line + security strip). The references confirm this is the *premium* move,
    not a compromise for a new brand. **WHERE:** truth bar (§3.2), pricing honesty strip (§3.9), final
    CTA founder line + security strip (§3.12). *Reconcile:* our honest `$58→$29` math and the real US
    day-count ARE our Solidroad-style quantified proof — render them with confidence.

### Spacing / rhythm & narrative

21. **Metric callouts as punctuation between prose beats.**
    *(Cofounder/Attio/Column: oversized stat claims drop between sections as their own rhythm beat so
    a text run never lasts long enough to feel bland.)* **ADOPT the *placement idea* within our
    two-numeral cap** (ART-DIRECTION §4.2 — the `$29` and the day-count are our two sanctioned big
    numbers, and no third display numeral may creep in). The reference lesson we *do* take: **position
    those two numerals as punctuation** — the `$29` breaks the space right after the dense hero
    (§3.2), the day-count breaks the how-it-works stretch (§3.5). *Reconcile:* we get Cofounder's
    "big-number rhythm" effect with exactly two instances, honoring the cap. Attio confirms a big
    numeral on/near a dark band lands hardest — so the day-count sits near the §3.8 dark band's tonal
    shift.

22. **Narrative spine — the page is a day/story, section heads are opinionated sentences, not
    feature labels.**
    *(Granola: Before/During/After acts titled "Humans in the room, not bots"; Solidroad: "Review
    100% of interactions in seconds"; a philosophy sentence as H1. Cofounder: Start→Build→Sell→Scale
    chapters.)* **ALREADY SPEC'D** (ART-DIRECTION §7: the page is "a tradesperson's real day threaded
    on the ledger spine"; COPY.md headlines are outcome sentences). The references confirm the
    device. **WHERE:** verify every section H2 is a *verb/outcome sentence* ("every customer text
    becomes a job your whole crew can see"), never a noun feature-label. *Reconcile:* pure copy
    discipline, already in COPY.md — iter 5 must not let any placeholder feature-label H2 survive.

23. **Footer / structural close as a considered "table of contents," not a raw sitemap.**
    *(Cofounder: multi-column footer reinforces the curriculum metaphor to the last pixel. Rollups:
    even the 404 is composed.)* **ALREADY SPEC'D** (VISUALS §5b: branded footer with wordmark, brand
    line, Made-in-Canada motif, grouped columns). The references say the *close matters as much as
    the hero.* Hold the designed footer; extend the ledger fingerprint (a faint spine tick / section
    grammar) into it so the document "closes" rather than trails off.

---

## 3. Anti-bland rules (HARD — these kill "section after section of text")

These are pass/fail. A section that violates one is a design-QA **major** from iteration 5 on.

1. **No two adjacent sections share a layout silhouette.** Density is already a wave (BLUEPRINT
   §1.4); iter 5 adds **shape** variety on top. The rotation across the page must cycle *kinds* of
   band — participatory-hero → expressive-numeral → editorial-copy-trio → live-product-split →
   infographic-timeline → asymmetric-bento → sparse-breather → dark-product-band → pricing-with-live-
   proof → interleaved-editorial → accordion → petrol-flood-close. **Never the same silhouette twice
   running.** (Granola/Attio/Cofounder engine.)

2. **Every section earns a distinct visual device.** Each band must hand the eye a *different kind
   of object*: a live ticket, a 132px numeral, an asymmetric card trio, a stepped product thread, a
   drawn SVG timeline, a switchable bento, a dark phone scene, a slider, an area-code widget, an
   accordion, a petrol flood. **A section whose only content is centered prose on white does not
   ship** — it must carry a product surface, an infographic, an interaction, or an expressive
   typographic moment. (Column engine: the *content* of a section is the product, not paragraphs.)

3. **Alternate the section archetypes deliberately.** Rotate among: **full-bleed / band** (dark
   band §3.8, petrol flood §3.12), **bento** (§3.6), **editorial-split** (§3.4 sticky-left/product-
   right, §3.10 interleaved), **product-shot / live-DOM** (hero, bento tiles, dark thread), and
   **quote/proof band** (truth bar §3.2, founder line + security strip §3.12). No archetype appears
   twice in a row. (Granola silhouette-rotation, Cofounder L/R alternation.)

4. **The ledger spine carries momentum through the whole page.** The static SVG spine numbering
   every section `01…12` (ART-DIRECTION §2.2) is the through-line that makes twelve bands read as one
   authored document. It is **not optional decoration** — it is the primary anti-bland device and the
   direct answer to the user's complaint. Every section boundary carries its tabular section number
   on the spine (desktop) or as an inline `01`-eyebrow (mobile). (Attio's `[01]` index, Cofounder's
   Roman-numeral chapters — the board's #1 validated move.)

5. **Type-as-hero moments are rationed but present.** The two 132px numerals (§4.2) and the ledger-
   ruled hero H1 with the highlight-swipe are our "type is a graphic event" beats (Rollups/Granola).
   Use exactly the sanctioned two big numerals — no more, no fewer — and make the H1's ruled baseline
   + swipe actually render. **A page with no typographic peak is as bland as one that shouts
   everywhere.**

6. **One product-row grammar recurs down the page.** The ledger row (ID + status spine + assignee)
   must literally reappear in the hero, the deep-dive, a bento tile, and the dark band (Solidroad's
   score-pill recurrence). A page where each product surface invents a new UI reads as a template
   stack, not one instrument.

7. **Every interactive ends in a conversion nudge; the back half stays participatory.** (Clay's
   "drive one thing" + CONVERSION §5.) The hero, the crew-size slider, and the area-code widget each
   resolve toward "Start for $29." No dead-end interaction; no back half of pure text.

8. **Warm neutrals, never cold gray; one accent that signals.** Body/secondary text uses the warm
   stone tokens (Rollups tinted-neutral rule); amber appears in exactly its three sanctioned places;
   petrol is the only accent. A section that reads clinical/gray has failed the warmth bar.

9. **No section is text-on-white with no through-line.** If a band cannot carry a product surface,
   an infographic, an interaction, or a rationed type peak, **it is cut or merged** (CONVERSION §7:
   fewer, stronger, clearer). Blandness is a reason to *remove*, never to *add filler*.

---

## 4. Pressure-test: does the Dispatch Desk direction meet this bar?

Honest verdict, per reference axis. **The direction is fundamentally at or above the bar on
strategy — but the bar is an *execution* bar, and several already-spec'd moves will read generic
if iter 5 ships them at half strength.** Below: where we already win, and the specific things iter 5
must ADD or ELEVATE to actually land Column/Granola-grade.

### Where the direction already meets or beats the bar

- **The numbered ledger spine is the strongest move on the entire board**, and we have it committed
  (ART-DIRECTION §2.2). Attio numbers 4 sections; Cofounder 4 chapters. **We number all 12** with a
  literal ledger vocabulary that maps to something the ICP already runs by their phone. Executed
  well, this is *more* distinctive than any single reference. It is also the exact cure for the
  user's complaint.
- **The participatory hero out-ambitions every reference's interactivity.** Solidroad's scorecard
  and Clay's switcher are *watched* or *toggled*; ours is *performed by the visitor's own thumb*.
  No reference has a fold this participatory. This is a genuine ceiling-raiser — *if discoverability
  works* (see risks).
- **Product-as-hero, real-DOM, quantified-proof-over-logos, one-accent discipline, warm editorial
  frame** — all five reference DNA traits are already in our binding docs. We are not chasing the
  bar on principle; we are chasing it on *execution fidelity*.

### What iter 5 MUST ADD or ELEVATE to hit Column/Granola-grade (specific, actionable)

1. **ELEVATE: enforce silhouette variety, not just density variety.** The density wave (§1.4) is
   spec'd, but density ≠ shape. Two sparse sections can both be "centered H2 + text." **Iter 5 must
   pass every adjacent pair against Anti-Bland Rule #1 (distinct silhouette)** — this is the gap most
   likely to make us read generic. Concretely: audit §3.2→§3.3→§3.4 and §3.10→§3.11→§3.12 for
   repeated centered-column shapes and break them with the asymmetric-grid (craft #6) and L/R-
   alternation (craft #5) devices.

2. **ADD: the recurring ledger-row must literally reappear.** Right now the row grammar is *defined*
   (§2) but nothing in the spec guarantees Solidroad-style *recurrence*. Iter 5 must build the same
   row (ID + status spine + assignee chip) into the hero, the §3.4 deep-dive header, bento tile 1,
   and the dark band — visibly the *same instrument*. Without this, the product surfaces will read as
   four different UIs (template stack), not one ledger.

3. **ELEVATE: the ledger texture must be *felt* via tabular numerals everywhere data appears.** Iter
   5 must make the ticket-meta / section-number / price / stat treatment (craft #1) pervasive and
   consistent — every `#0119`, `2:14 PM`, `01`, `$29`, `500`, `212/500` in tabular ledger-meta style.
   This is the cheapest way to get Column's "engineered ledger" texture, and it's the difference
   between "looks like the app" and "looks like a broadsheet ledger." A page that uses proportional
   figures for IDs and timestamps has thrown away the texture for free.

4. **ELEVATE: the two 132px numerals as punctuation, and verify they actually render at scale.**
   The `$29` (§3.2) and the day-count (§3.5) are our type-as-graphic peaks (Rollups/Attio). Iter 5
   must ship them at true `clamp(88px,12vw,132px)` petrol tabular — **not a timid 48px stat.** These
   are the two moments the page is allowed to be big; if they render small, the page has no
   typographic peak and reads flat next to Granola. (And hold the cap: no third display numeral.)

5. **ADD: one back-half participatory switch beyond the hero + slider, framed as such.** Clay's and
   Granola's lesson is that ONE interactive isn't enough for a long page — the back half must stay
   driven. We have the crew-size slider (§3.9) and area-code widget (§3.10); iter 5 must make the
   **bento's two live tiles genuinely steppable/switchable** (craft #7) rather than static crops, so
   the stretch after the dark band is participatory, not read. This closes the "back half decays to
   text" failure mode the references specifically defeat.

6. **ELEVATE: the secondary-CTA and hover micro-interactions (craft #14) must actually ship.** A
   bare text link "See how it works" next to a polished hero reads unfinished (Rollups' arrow-expand
   is the fix). Small, but it's the kind of finish that separates reference-grade from
   component-library. Ship the arrow-expand on every secondary CTA; keep the primary's magnetic pull
   dominant.

7. **ELEVATE: warm-tint verification pass.** Iter 5 must confirm body + secondary text use warm
   stone tokens, not a cold gray that crept in during the iter-4 visual pass. Rollups proves a plain
   paragraph reads "designed" only when its neutrals are tinted. One `grep` for gray text colors;
   one fix. Cheap, high-impact for the "warm, not clinical" promise.

### What in the current plan would read GENERIC next to these sites — and the fix

- **Risk: the bento (§3.6) as eight even tiles reads like every SaaS feature grid.** *Fix:* apply
  the asymmetric fractional grid (craft #6) — the two live tiles as genuine 2×2 anchors with the six
  standard tiles in an *uneven* supporting ratio, not a tidy 4×2. Make the two live tiles the
  switchable participatory beat (craft #7), not static crops. (Granola's 6-cell grid works because
  it follows a full-bleed plate and a triptych — silhouette contrast; ours must too.)
- **Risk: the problem trio (§3.3) as three equal icon cards is the most generic shape on the page.**
  *Fix:* asymmetric ratio (craft #6) + the ledger-hairline divider treatment (craft #3) so it reads
  as three ledger entries, not three bootstrap cards. It's a sparse breather — but "sparse" must
  still mean "distinct silhouette," not "empty white."
- **Risk: the FAQ (§3.11) as a plain accordion is inherently low-craft.** *Fix:* wrap each
  `<details>` in the ticket grammar (ledger-row summary with a tabular index, the signal-check on
  the open state) so even the accordion wears the fingerprint. It stays native `<details>` (no JS,
  per §3.11) — the craft is in the styling, not new mechanics.
- **Risk: a truth bar (§3.2) that renders `$29` at stat-chip size, not display scale**, would waste
  our single best type-as-graphic moment. *Fix:* §4.2 scale is mandatory here (see Elevate #4).
- **Risk: the morning-light two-wash rendered as a timid centered blur** (the very thing
  ART-DIRECTION §3.2 retired) would read as generic-SaaS-gradient. *Fix:* commit to the *directional*
  two-wash (petrol low-left, amber upper-right), soft-stop gradients, no `blur()` on the LCP region —
  the Resend/warm-morning-light effect, not a centered glow. This is already binding; iter 5 must not
  regress to the timid version under perf pressure.

**Net verdict:** the Dispatch Desk *strategy* clears the bar and, on the spine + participatory hero,
exceeds it. The *risk is entirely in execution* — shipping spec'd moves at half strength (small
numerals, static bento, cold neutrals, repeated silhouettes, a bare secondary CTA, a timid wash).
The seven ELEVATE/ADD items above are the difference between a site that *is* Column/Granola-grade
and one that merely planned to be. Iteration 5 owns closing every one of them.

---

## 5. How design-QA judges against this doc

From iteration 5 on, the design-QA critic scores each round against §3 (Anti-bland rules, pass/fail)
and §4 (the seven ELEVATE/ADD items, tracked to done). A section that violates an Anti-bland rule is
a **major**. Shipping a §4 elevate-item at half strength (e.g. the `$29` at 48px, the bento as
static even tiles, cold gray body text) is a **major**. The bar is not "did we build the sections" —
it is "does the built page stand next to Column, Rollups, Cofounder, Granola, and Solidroad without
looking like a template." That is the test.
