# Loonext Marketing Site — BLUEPRINT

**Status: BINDING.** This is the plan iterations 2–10 build from. Same authority as SPEC.md and
DECISIONS.md: implement, don't re-litigate. Inputs: SPEC.md §1–2, docs/DECISIONS.md (D2–D5, D11,
D12, D14), docs/DESIGN.md (G1–G12), and the three research docs in this folder
(`competitor-site-teardowns.md`, `research-site-craft.md`, `research-nextjs-seo-legal.md`).
Copy lives in `COPY.md` (home, pricing, plumbers — final quality). Everything sold here exists
in SPEC v2. Nothing here is a placeholder.

Domain: **https://loonext.app** (marketing at root; the app lives at `/inbox` etc. in the same
`apps/web` Worker under a `(marketing)` route group — LOOP-STATE iteration 2).

---

## 0. The argument

Loonext sells one sentence: **every customer text lands in one inbox the whole crew can see —
for one flat price, month to month, with no sales call between you and a working number.**

Messaging hierarchy (rank-ordered; every page leads with #1 or #2 and lands at least three):

1. **Flat team pricing.** $29/mo covers 3 people; $79/mo covers 10. Not per seat. Show the
   crew-size math, never adjectives (Quo = $15–19/user; Heymarket = $49/user with a 2-user
   minimum, as of July 2026).
2. **Transparent, self-serve, month to month.** See the price. Pay. Start texting. No demo, no
   quote, no annual contract, no sales phone number in the nav (anti-Podium, anti-Textline).
3. **The shared inbox itself.** Reply, assign, tag, note, search, close — from any phone. The
   business number stops living on the owner's personal cell. **Multi-number is real and
   under-sold:** Pro gives you two separate numbers (two locations, or an office line and a
   field line), each with its own inbox thread — Quo charges $5/mo per extra number. Say it
   where the two-location buyer will see it, not just as a card bullet.
4. **Canada-first.** Canadian businesses text customers the same day they sign up. Nobody else
   in the market says this. We own it.
5. **Honest US timeline as a trust feature.** US texting activates after carrier registration,
   typically 3–7 business days. We say it at the hero-adjacent truth bar, on pricing, and at
   checkout — before payment. Registration is automatic; the wait is the carriers', the
   handling is ours. (SimpleTexting's reframe, done straighter.)

The tone is DESIGN.md G10 dialed for persuasion: plain, warm, confident. A plumber reads it in
a truck between jobs and thinks "this thing respects my time." Never enterprise word salad
("agentic shared inboxes" is the anti-pattern — Heymarket's words, not ours).

### 0.1 The signature moment (binding — this is the site's whole reason to be beautiful)

The page has **one** engineered spectacle, and everything else supports it: **the animated
two-phones live inbox thread is the hero.** It is the frame a plumber screenshots and sends to
his brother-in-law. It is the product's entire argument in one moving object — a customer's
plain text on the left materializes as an assignable, notable, taggable conversation in the
Loonext inbox on the right, playing on the app's real motion grammar. It is inherently on-brand
because it *is* the app. There is no separate "hero screenshot" competing with it (§3.1). Every
iteration protects this moment first; if a trade-off must be made, it is made in the moment's
favor.

### 0.2 The one expressive device (binding — "dialed up" must actually be dialed)

Calm is not timid. Loonext earns one bold, on-brand expressive gesture and commits to it: the
**honest-timeline "first week" as an oversized design object** (V2, promoted onto the home page,
§3.5). The honest US wait is a core weapon; rendering it *large and beautiful* — not buried on a
sub-page — turns the brand's biggest apparent liability into its signature confidence move.
Supporting expressive beats: the price rendered as art at genuine display scale ($29 tabular,
120px petrol) in the truth bar (§3.2). These are the two places the page is allowed to be big.
Everywhere else stays quiet — that contrast is what makes the big moments land.

---

## 1. Brand on marketing

The marketing site is **the same brand, dialed up** — not a second design system. Every token
comes from DESIGN.md G2; this section defines only the marketing-scale additions.

### 1.1 Typography (Inter only — no second typeface)

One display treatment, Inter-based. The 2026 "playful serif headline" trend is rejected: a
second face breaks the brand, and Inter at 600 with tight tracking already reads confident.

| Role | Size (desktop / mobile) | Weight | Tracking | Leading |
|---|---|---|---|---|
| **Numeral display (price/timeline as art)** | `clamp(88px, 12vw, 132px)` | 600 | −0.03em | 1.0 |
| Display (hero H1) | `clamp(40px, 5vw, 64px)` | 600 | −0.02em | 1.08 |
| Section H2 | `clamp(30px, 3.5vw, 40px)` | 600 | −0.02em | 1.15 |
| Card H3 | 20px | 600 | −0.01em | 1.25 |
| Lead paragraph | 18–20px | 400 | 0 | 1.55 |
| Body | 16px | 400 | 0 | 1.6 |
| Meta / eyebrows | 13px, sentence case, `stone-500`; eyebrows in petrol 600 | | | |
| Stats & prices | tabular numerals, always (`font-variant-numeric: tabular-nums`) | 600 | | |

The **numeral display** row is the one weight/scale escalation the marketing site earns over
the app — reserved for the two expressive moments only (§0.2): the `$29` in the truth bar and
the day-count numerals in the first-week timeline. It renders in petrol at true display scale,
tabular numerals, and is never used for prose. This is deliberate: a 132px tabular numeral in
petrol is Loonext's signature graphic device, and because it appears exactly twice, it reads as
intentional art, not decoration.

Rules: sentence case everywhere including H1s. Weight never exceeds 600. Self-hosted Inter
variable via `next/font`, latin subset, one file for 400/500/600 (already the app's setup —
zero font CLS for free).

### 1.2 Color & light

- Base: `stone-50` page background, white cards, `stone-200` 1px borders, `stone-900`/`stone-500`
  text. Petrol `#0F766E` (teal-700) is the only accent; `teal-800` hover; `teal-50` tinted fills.
- **Marketing-only additions (allowed, bounded):**
  - **Hero atmosphere (upgraded — commit to the Resend technique, not the timid version):** a
    layered warm light field behind the hero's live thread, painted with **CSS gradients only,
    positioned behind the LCP box, never over it** (§11.4). Two stacked radial washes plus a
    faint directional light: a petrol core (`rgba(15,118,110,0.12)`) low-left, a warm amber
    lift (`rgba(251,191,36,0.06)`, matching the honest-timeline accent) upper-right, over the
    stone-50 base — so the hero sits in warm morning light, not a flat gray box. Rendered as a
    fixed decorative layer (`aria-hidden`), no image, no blur filter on the LCP region (a large
    `blur()` is a paint cost — use soft-stop gradients instead). Never behind body text, never
    animated, exactly one per page. This is the atmosphere the research cites Resend for; the
    old "single 120px-blurred radial" was the weakest possible version and is retired.
  - **Section washes:** `linear-gradient(180deg, #FAFAF9, #F0FDFA)` (stone-50→teal-50) allowed
    on at most two bands (pricing preview, final CTA). Subtle enough to survive a bad projector.
  - **Exactly one dark band per page:** `stone-950` background, `stone-900` surfaces,
    `stone-800` borders, `teal-500` accent — the app's real dark-mode tokens. On home this is
    the "built for the truck" section. It is literally the product at night; never a styling whim.
  - No gradients on text. No gradient buttons. No glow borders. No specular tricks. The
    "Linear look" is explicitly rejected (dark-glow developer aesthetic; wrong buyer).
- Semantic colors only where the product uses them (amber for the honest-timeline callouts —
  matching the app's registration banner; emerald for included-feature checks).

### 1.3 Screenshot & product framing

**Live-DOM vs static — the single biggest lever to stand next to Linear/Stripe/Resend.** The
product's key moments render as **live HTML/CSS using the app's real thread primitives**, not
flat image crops, so message rows, note cards, and status pills are real DOM that micro-animates
on reveal and stays crisp at every DPR. The component work is already budgeted for §3.4's demo;
reuse those exact primitives. Split:

- **Live HTML/CSS (real DOM, app primitives, reveal-animatable):** the hero thread (§3.1), the
  two large bento tiles — *Assign & track* (tile 1) and *Photos, both ways* (tile 5) — (§3.6),
  and the dark-band thread (§3.7). These are the moments people screenshot; they must move and
  be sharp.
- **Static AVIF/WebP crops (§10 shot list):** genuinely-static utility shots only — CSV import,
  registration stepper, area-code picker, search, usage meter, done-mark. These don't benefit
  from animation and stay cheap raster.

- Screenshots (the static set) are **real captures of the seeded local app** (shot list in §10).
  Never mockups of features that don't exist, never stock, never illustration-led. Live-DOM
  product visuals use the same seed data (Reyes Plumbing) so the two sets are visually identical.
- Frame: white card, 1px `stone-200` border, 10px radius (the app's own card language), a very
  soft ambient shadow (`0 24px 64px -32px rgba(28,25,23,0.25)`) — a marketing exception to the
  app's no-card-shadow rule, allowed only on framed product visuals — plus the §1.2 glow on the
  hero only.
- Desktop shots get a minimal stone-toned browser-chrome hint (three dots + a neutral URL bar
  reading `loonext.app/inbox`) — quietly reinforces "it's just the web, no download."
- Phone shots use a neutral rounded frame (stone-200 ring, 28px radius). **No Apple/Android
  device chrome** — platform-neutral keeps the PWA story honest.
- Max settle-tilt on scroll: 2°. No 3D perspective stacks (reads dated/dev-flavored).

### 1.4 Spacing rhythm

- Content max-width 1152px (`max-w-6xl`), 12-col grid, gutters 16px mobile / 24px desktop.
- Section padding: 96px top/bottom desktop, 64px mobile. Hero: 128px top desktop.
- Between a section's H2 and its content: 48px. Cards within grids: 24px gap.
- Every section alternates rhythm, not background — background changes are reserved for the
  washes and the single dark band (§1.2).
- **Density is a wave, not a ramp (binding, enforced by the §3 section order).** Real
  award-level rhythm pulses dense→sparse→dense→sparse; the page must never front-load every
  heavy section and back-load every light one. Concrete rules: (1) **no more than two low-visual
  sections are ever adjacent** — a low-visual section is one with no product visual (pure copy,
  chips, forms, accordions); (2) **every dense section gets a whitespace breather before it hits
  the next dense one** — specifically the bento (§3.6) is never slammed directly against the dark
  band (§3.7); a lighter beat sits between them; (3) **the back half carries product visuals too**
  — a reader who scrolls past the dark band still meets the product (usage-meter proof in pricing,
  the Canada area-code widget), not five straight sections of text. The §3 order below is the
  canonical wave; do not re-sequence it without re-checking these three rules.

### 1.5 Motion rules

- **Scroll reveals:** opacity 0→1 + translateY 12px→0, **300ms ease-out, once**, triggered at
  20% visibility via one tiny IntersectionObserver utility (no animation library). Stagger
  within a group: 60ms, max 4 items. Reveals animate transform/opacity **inside an
  already-reserved layout box** (CLS-safe — scroll-shift CLS only shows in field data).
- Hero never animates in (it's the LCP; it's just there).
- The inbox demo (§3.4) animates at the app's own grammar: 200ms fade + 4px rise per message.
- Micro-interactions: 150ms ease-out hovers, exactly as the app.
- `prefers-reduced-motion`: everything visible immediately, demo shows the completed
  conversation as a static thread with a "play" affordance.
- Banned: parallax, scroll-jacking, marquees, autoplaying video, count-up numbers that start
  at zero (numbers render final; a 150ms fade is plenty).

---

## 2. Page inventory

| Route | Page | Priority | Primary query target |
|---|---|---|---|
| `/` | Home | Iter 2 | shared text inbox for business, business texting for small teams |
| `/pricing` | Pricing | Iter 2 | loonext pricing, business texting pricing |
| `/features/shared-inbox` | Shared inbox | Iter 4 | shared sms inbox, team text inbox |
| `/features/business-number` | Your business number | Iter 4 | business phone number for texting, second number for business texting |
| `/features/compliance` | Compliance built in | Iter 4 | 10dlc registration for small business, business texting compliance |
| `/features/templates-and-tags` | Templates, tags & team workflow | Iter 4 | saved replies sms, sms templates for service business |
| `/canada` | Canada | Iter 3 | business texting canada, text customers canada |
| `/for/plumbers` | Plumbers | Iter 3 (template) | texting software for plumbers |
| `/for/landscapers` | Landscapers | Iter 4 | texting for landscaping business |
| `/for/cleaners` | Cleaning businesses | Iter 4 | texting software for cleaning business |
| `/for/hvac` | HVAC | Iter 4 | hvac customer texting |
| `/for/salons` | Salons | Iter 4 | salon text messaging |
| `/for/contractors` | Contractors | Iter 5 | contractor texting app |
| `/compare/podium` | Loonext vs Podium | Iter 5 | podium alternative, podium pricing |
| `/compare/heymarket` | Loonext vs Heymarket | Iter 5 | heymarket alternative, heymarket pricing |
| `/compare/quo` | Loonext vs Quo | Iter 5 | quo alternative, quo per user pricing |
| `/legal/terms` | Terms of service | Iter 2 | — |
| `/legal/privacy` | Privacy policy | Iter 2 | — |
| `/legal/aup` | Acceptable use policy | Iter 2 | — |
| `/legal/messaging` | SMS messaging policy (opt-in/opt-out disclosures) | Iter 2 | — |
| `/legal/subprocessors` | Sub-processors | Iter 3 | — |
| `/legal/refunds` | 30-day guarantee | Iter 3 | — |
| `/security` | Security | Iter 3 | — |
| `/contact` | Contact | Iter 2 | — |
| `status.loonext.app` | Status (hosted, not built) | Iter 2 | — |

**Decisions locked here:**

- **/security: yes.** One honest page (no SOC 2 claims we don't have): encryption in transit
  and at rest, tenant isolation via row-level security, US data residency named plainly,
  no message content in analytics or error tracking (D8 PII policy — a real, verifiable
  differentiator), responsible-disclosure contact. It also feeds the sub-processor page.
- **/legal/messaging: yes.** TCR campaign vetting checks the brand site for opt-in/opt-out
  language, message frequency, and "message and data rates may apply." This page is both
  compliance evidence for Loonext's own brand registration and a template customers can adapt
  (Heymarket publishes one; we match).
- **30-day money-back guarantee: adopted.** Paid-first means no "no credit card required" line;
  the market-standard substitute (SimpleTexting, Salesmsg both run one) is a guarantee. Ours is
  cleaner than both: **full refund of the first invoice, including the $29 registration fee, no
  "less credits used" clawback** (Salesmsg's fine print is the anti-pattern). Worst case COGS
  ~$20/refund — acceptable. Policy page at `/legal/refunds`, linked in footer and under every
  pricing CTA.
- Comparison pages launch as three: **Podium** and **Heymarket** ("alternative" SERPs
  undefended by the incumbents themselves) plus **Quo** (the per-user foil and the SEO
  incumbent). Textline and SimpleTexting pages are named fast-follows, not launch scope.
- Industry pages are **six hand-finished pages, never templated text** (Google scaled-content
  policy). Shared skeleton fine; shared sentences not. Each carries trade-specific example
  threads and a trade-specific saved-replies pack (a real product feature = unique data).
- Free-tool widgets (fast-follow, iter 6+, each <15KB island): SMS segment counter (on /pricing,
  reuses `packages/shared` estimator), city→area-code lookup (on /features/business-number,
  /canada, and the home Canada beat, reuses the NANP table). The crew-size flat-vs-per-user
  slider ships on the **home page** (§3.9) and /pricing — it is the converting interaction, not a
  fast-follow. The missed-text calculator is demoted to a small home breather (§3.7), not a
  headline widget.
- **/status: yes, hosted (not custom-built).** Every serious competitor ships a public status
  page (teardown line 191 names it in the launch baseline), and Loonext hard-gates outbound on
  carrier approval and sells trust-through-honesty — "is it down or is it me?" is a daily question
  for exactly this product. Use a hosted provider (Instatus/BetterStack free tier) at
  `status.loonext.app`, linked in the footer "Company & legal" column, iteration 2 scope. It does
  not need a custom build, but it must exist and be linked before launch. Shipping a
  deliverability-dependent SMS product with no status page while the whole pitch is "we're the
  honest ones" is a self-inflicted trust hole.
- **/contact: yes, a real lightweight page.** The only support channel is email (no chat, no
  phone — deliberate), so the footer "Contact us" must point at a real /contact page, not a bare
  mailto: support email, "we reply within 1 business day" (or the real SLA from ops), the legal
  entity + mailing address (shares the §9 ops blocker), and a link to /security's
  responsible-disclosure contact. These are the trust signals an SMB buyer checks before paying.
- **Home-page trust surface (honest-proof strategy, §3.12):** the home page carries two
  non-fabricated trust substitutes — a founder-signed "why we built this" line with real names,
  and a small security strip surfacing /security's verifiable differentiators (encryption at
  rest/in transit, no message content in analytics, US data residency). Both are TRUE and
  checkable; neither invents a logo, count, or badge. This closes the trust hole that four
  price/policy chips left open (a trust-poor new brand asking for a paid-first purchase needs a
  "who's behind this," not just "what does it cost").

---

## 3. Home page — section-by-section

Section order follows the conversion framework validated in research (hero → proof → problem →
product in motion → features → pricing → FAQ → close), **re-sequenced into a true density wave**
(§1.4) and tuned for a trust-poor new brand: honest product truths appear where competitors put
logo walls, and the signature live-thread moment IS the hero (§0.1).

**Canonical section order and density (the wave):**

| # | Section | Density | Note |
|---|---|---|---|
| 3.1 | Hero (live two-phones thread = the signature moment) | **dense/signature** | LCP = H1 text; thread is live DOM |
| 3.2 | Truth bar (anti-logo-bar; `$29` as art) | sparse | one expressive numeral |
| 3.3 | The problem (three pains) | sparse–med | breather, no screenshots |
| 3.4 | Live inbox demo (deeper feature section, not a 2nd hero) | dense | now a feature deep-dive |
| 3.5 | How it works + first-week timeline (expressive honesty object) | med | V2 timeline promoted here |
| 3.6 | Features bento (two large tiles = live DOM) | **dense** | whitespace beat after |
| 3.7 | Missed-text math *(optional, demoted)* — or skip to dark band | sparse | breather; see §3.7 |
| 3.8 | Dark band — built for the truck | **dense** | the one dark section |
| 3.9 | Pricing preview + live usage-meter proof | med | usage meter is real product visual |
| 3.10 | Canada + compliance, interleaved | med | area-code widget visual; not stacked text |
| 3.11 | FAQ | sparse | native `<details>` |
| 3.12 | Final CTA band (with a small product visual) | sparse | close |

After every dense section the eye rests; after every rest the scroll is rewarded with product.
The crew-size flat-vs-per-user slider — the interaction that converts this buyer — moves ONTO
the home page (§3.9); the generic missed-text calculator is demoted (§3.7).

### 3.1 Hero — the signature moment (§0.1)

- **Purpose:** state the category, the flat price, and the no-BS purchase path in five seconds —
  *and* be the beautiful, shareable frame that carries the product's whole argument (§0.1).
- **Layout:** two-part hero. Left (or top, on mobile): eyebrow → H1 (max 2 lines) → lead sub
  (max 2 lines) → CTA row → truth line. Right (or below): **the two-phones live thread** — the
  centerpiece, sitting in the §1.2 hero atmosphere, `max-w` sized so it dominates without pushing
  the H1 below the fold.
- **The centerpiece (this replaces the old static screenshot):** a **live HTML/CSS** animated
  object built from the app's real thread primitives (§1.3). The customer's plain text sits in a
  generic Messages-style bubble on the **left phone**; the same message materializes on the
  **right** as an assignable, notable, taggable Loonext conversation. Beats arrive on the app's
  real motion grammar (200ms fade + 4px rise, §1.5): the amber internal note drops in, "Priya
  assigned this to Dale" animates as an event line, and Dale's teal-50 reply lands with a
  Delivered check. That single animated object is the entire pitch. Script shares COPY.md §H4's
  opening beats (the same water-heater thread) so the hero and the §3.4 deep-dive are one story.
- **Copy:** final in COPY.md §H1. H1 direction chosen: **"Every customer text, in one inbox
  your whole crew can see."** (Alternates recorded in COPY.md for A/B later.) Sub carries: local
  number + flat $29 + month to month + no sales calls. CTAs: primary **"Get your number"** →
  /signup; secondary **"See pricing"** → /pricing (never "Book a demo", never "Contact sales").
  **No defensive caption** — the browser-chrome `loonext.app/inbox` hint (§1.3) already says
  "this is real" without a sentence apologizing for it (per the honesty-labeling finding; confidence
  is shown, not asserted). The one honesty label lives on the §3.4 deep-dive demo, not here.
- **Truth line (under CTAs, 13px stone-500):** the US/CA timing sentence — positioning weapon #5
  at maximum-attention real estate. Reframed **win-first** for the US reader (finding: lead the
  wait with the win): day-one receiving + Canada work immediately; US texting turns on in about a
  week once carriers approve. Exact copy in COPY.md §H1; matches SPEC §4.1 checkout copy in
  substance. Provisioning stated as "usually live in a minute or two" (SPEC §4.3 is an async saga
  with a documented slow path — do not claim "under a minute" as a guarantee).
- **LCP strategy (decided now, not at iteration 7):** the **H1 text is the guaranteed LCP** and
  the live-DOM thread has **no raster hero image at all** — the centerpiece is DOM/CSS, so there
  is no 90KB image to become the largest paint. The atmosphere is CSS gradient behind the box
  (§1.2), not an image. The thread's client island hydrates *after* first paint via
  `next/dynamic`; the server-render ships the **completed thread as static DOM** so the LCP and
  the no-JS/reduced-motion experience are both the finished, meaningful thread. This makes the
  `< 1.5s` budget (§11.4) real rather than wishful, and there is no mobile desktop-image decode
  problem because there is no hero image.
- **Reduced-motion / no-JS:** the server-rendered completed thread with a "play" affordance
  (§1.5). Identical to what LCP paints.
- **Interactive:** the thread auto-plays once on viewport entry, then offers replay; it is not a
  scroll-jacked or looping-forever distraction above the fold.

### 3.2 Truth bar (the anti-logo-bar) — with the price as art

- **Purpose:** occupy the logo-bar slot every competitor uses, with verifiable product truths
  instead of manufactured proof. NO fake logos, counts, or badges — ever. This is where a
  skeptical plumber decides to keep scrolling, so it **cannot be the quietest section on the
  page** (finding: no proof of scale in the proof slot).
- **Layout:** two beats. **(1) The `$29` as art** — the expressive numeral (§1.1, §0.2)
  rendered at 120px+ tabular petrol, with a small "/mo · the whole crew" tag beside it. The
  price IS the argument (weapon #1), so it gets genuine display weight here. **(2) Trade strip
  + product-number chips** — "Built for" + five trade words with lucide icons at a size that
  reads as a *designed strip*, not a text list (wrench, shovel, sparkles, fan, scissors →
  plumbers, landscapers, cleaners, HVAC, salons), each linking to its /for/ page; then three
  stat chips, tabular numerals, 600 weight.
- **Stat chips (revised — every chip is a real product number, no slogan-in-number-costume):**
  **500 texts included · 2 numbers on Pro · Month to month.** The old "Zero — sales calls,
  demos, or contracts" chip is **cut**: it dressed a slogan as a stat (violating "show the
  number, never adjectives") and repeated what the hero already says twice. "No sales calls" is
  said once, in prose, and lands harder for not being repeated. **"2 numbers on Pro"** surfaces
  the under-sold multi-number weapon (finding: say it where the two-location buyer sees it).
- **Visual:** flat, borderless, quiet apart from the one big numeral. 13px labels under the
  tabular figures.
- **Interactive:** trade links only.

### 3.3 The problem (three pains)

- **Purpose:** name the personal-cell mess before showing the fix.
- **Layout:** three cards, equal width, icon + H3 + two sentences. Copy in COPY.md §H3:
  "Buried on one phone." / "Nobody knows who answered." / "The number leaves with the phone."
- **Visual:** white cards, 1px border, 20px lucide icons in petrol. No screenshots here —
  contrast with the demo that follows.
- **Interactive:** none. Reveals stagger 60ms.

### 3.4 The inbox, up close — "What actually happens when a text lands"

- **Purpose:** the hero (§3.1) *is* the signature demo; this section is now a **deeper feature
  walk-through**, not a redundant second demo. It slows the same story down and annotates the
  mechanics the hero shows in motion — assignment, notes, delivery confirmation, tags — so the
  reader who wants detail gets it.
- **Layout:** two-column on desktop: left = sticky H2 + three-line explanation + step captions
  that highlight the mechanics; right = the annotated thread (the same primitives as the hero,
  paused/steppable rather than a fresh autoplay spectacle). Keep stone-50; save the washes
  per §1.2.
- **Build:** reuses the **exact app thread UI primitives** from the hero (§1.3, §3.1) — no new
  component budget. Where the hero auto-plays the story, this section lets the reader step the
  beats (or shows them all at rest with call-out labels). Script beats align with COPY.md §H4.
- **Honesty rule (the ONE load-bearing label — kept, quieter, singular):** "Demo — scripted
  conversation, real interface" in 13px stone-400. This is the single honesty caption on the
  page's product visuals; the hero's defensive caption and the "example — real interface"
  captions elsewhere are cut (finding: three self-justifying captions is a confidence leak).
- **Inline CTA (closes the mid-page dead zone — CTA-density finding):** a quiet, secondary-styled
  text link **"Get your number →"** under the honesty label. A high-intent reader convinced here
  should not have to scroll seven sections to the next click affordance. Secondary weight so it
  never competes with the hero/final-band primaries.
- **Performance:** client island, `next/dynamic`, loads on viewport approach; static first
  frame (the completed thread) server-rendered so the section is meaningful with JS off.
- **Interactive:** step/replay control; reduced-motion shows the finished annotated thread.

### 3.5 How it works + the first-week timeline (the expressive honesty object, §0.2)

- **Purpose:** collapse purchase anxiety — this takes minutes, not an onboarding call — and turn
  the honest US wait into the page's signature design gesture instead of fine print on a sub-page.
- **Layout, part A — three steps:** three columns joined by a dashed SVG connector (petrol, 1.75
  stroke), numbered petrol circles. Step copy final in COPY.md §H5: 1) Pick your number (type a
  city, get a local number — usually live in a minute or two). 2) Invite the crew (they open a
  link on any phone; nothing to install). 3) Text customers (put "call or text" everywhere your
  number appears).
- **Layout, part B — the first-week timeline as art (V2 promoted from /pricing, §10.2):** an
  expressive, full-width honesty object. **Day 0** rendered with the numeral-display treatment
  (§1.1): number live, receiving works, Canadian texting live — *you are not sitting idle.*
  → **Days 1–7** amber segment ("US carrier review — typically 3–7 business days, about a week")
  → **Approved:** US texting on. This is the win-first frame the buyer findings demand: lead with
  everything that works on day one, then show the bounded wait as a designed timeline, not a
  buried disclaimer. The honest timeline is a core weapon (§0 #5); here it is rendered *large and
  beautiful*.
- **Honest sub-line (matches checkout, SPEC §4.1):** amber-tinted, identical in substance to the
  checkout copy (3–7 business days; Canada immediate; receiving immediate). Marketing and
  checkout must never disagree. Provisioning is "usually live in a minute or two," never a hard
  "under a minute" (SPEC §4.3 slow path exists).
- **Visual:** SVG infographic V1 (connector) + V2 (first-week timeline) — V2 is now a home-page
  centerpiece, not a sub-page asset. Step 1 also shows a tiny real screenshot crop of the
  onboarding area-code picker with the "(416) — Toronto" hint (shot S4).
- **Interactive:** none.

### 3.6 Features bento (eight tiles; two large tiles are live DOM)

- **Purpose:** breadth in one scan; every tile is a shipping feature. Preceded and followed by a
  whitespace beat so it is never slammed against another dense section (§1.4) — in particular it
  does not butt directly against the dark band; §3.7's breather sits between.
- **Layout:** bento grid — two large tiles (2×2) + six standard. **The two large tiles render as
  live HTML/CSS** using the app's real thread primitives (§1.3), so their message rows and note
  cards micro-animate on reveal and stay crisp at every DPR; the six standard tiles are static
  AVIF utility crops. H3 + one sentence each. Order and copy in COPY.md §H6:
  1. **Assign & track** (large, **live DOM**) — assignee menu + status pills (New/Open/Waiting/Closed).
  2. **Internal notes** — amber note card in a thread; "customers never see them." (static)
  3. **Saved replies** — template picker open in composer. (static)
  4. **Tags that match how you sell** — Quote sent / Scheduled / Won / Lost chips. (static)
  5. **Photos, both ways** (large, **live DOM**) — MMS thumbnail + lightbox hint.
  6. **Search everything** — search results with snippet highlight. (static)
  7. **Contacts & CSV import** — import preview table. (static)
  8. **Mark it done** — the D14 strikethrough + petrol check on a message. (static)
- **Multi-number beat (say it, finding):** the *Assign & track* large tile carries a one-line
  callout — "Two locations, or an office line and a field line? Pro gives you two separate
  numbers, each with its own inbox." — so the two-number buyer meets their exact use case here,
  not only as a Pro-card bullet.
- **Visual:** framed per §1.3, no glow, no shadow-stacking; tile backgrounds white. **No
  "example — real interface" caption** (finding: honesty-caption stacking; the ONE label lives on
  §3.4).
- **Inline CTA (CTA-density finding):** a quiet secondary **"Get your number →"** link after the
  grid, closing the second half of the mid-page dead zone.
- **Interactive:** the two large tiles micro-animate on reveal; tiles link to the relevant
  /features page.

### 3.7 Missed-text math (demoted breather; pure arithmetic)

- **Purpose:** a whitespace breather between the bento and the dark band (§1.4), and a light
  quantify-the-pain moment — **demoted from a hero interactive to a small honest calculator**
  (finding: the generic "revenue at risk" calculator is the one section fighting the brand's own
  honesty stance; the crew-size slider is the weapon, and it moves to §3.9). Kept because it *is*
  pure arithmetic done in the open, and it earns its place as the sparse beat before the dark band.
- **Layout:** two columns: left H2 + framing copy; right a white card with three inputs and a
  live output. Physically small and quiet — not a spectacle.
- **Math (real, transparent — reframed as arithmetic, not a stat):** missed calls or texts per
  week × share that would have booked × average job value = revenue at risk per week, ×4.33 for
  monthly. Output line always shows the formula ("5 × 25% × $250 × 4.33 weeks") — we show our
  work, we never assert an industry stat. Copy leads with "this is arithmetic on your numbers,
  not a claim of ours." Sub-line compares against $29/mo flat.
- **Honesty rule:** copy says "your numbers, not ours — change them." No citation-free claims
  like "62% of calls go unanswered." No fabricated default that reads as a promise.
- **Build:** small client island, plain controlled inputs, tabular numerals, `aria-live` on the
  output. Copy final in COPY.md §H8.
- **If cut for length:** acceptable — it is the one home-page section whose removal costs nothing
  strategically. The crew-size slider (§3.9) is the interaction that must ship.

### 3.8 Dark band — "Built for the truck"

- **Purpose:** the one dark section (§1.2): mobile/PWA story + after-hours emotion, and proof
  that dark mode is real (it ships in MVP).
- **Layout:** dark stone-950 band; left copy, right a **phone-framed live-DOM dark-mode thread**
  (§1.3) — thread view, one-handed composer, push-notification banner drawn above it — reusing
  the same app primitives in their dark tokens so it micro-animates on reveal and stays crisp.
  (This is one of the three live-DOM moments per §1.3.)
- **Copy (COPY.md §H7):** PWA framed exactly as mandated: **works on every phone, no download
  needed** — "your crew is in before an app store would've finished loading." Plus web push,
  add-to-home-screen, and one-handed replies **from the job site** (the "red light (parked,
  please)" driving joke is cut — finding: a liability-flavored wink for a compliance-forward
  brand). A dark mode that doesn't blind you at 6am. **Never** framed as a missing app; no
  app-store badges anywhere on the site (competitors' badge row is our copy opportunity).
- **Visual:** teal-500 accent on dark; small glow allowed here as the phone's screen light
  (this is the same §1.2 budget — hero atmosphere is light-theme, this is the dark exception;
  both are the "one contained energy area" per theme, never more).
- **Interactive:** the thread micro-animates on reveal.

### 3.9 Pricing preview + live usage-meter proof + crew-size slider

- **Purpose:** pricing on the homepage IS the positioning (anti-Podium). Full transparency,
  zero surprises deferred to checkout. Also the back half's first real product visual and its
  one converting interaction (findings: inject product visuals into the back half; put the
  crew-size slider on the home page).
- **Layout:** stone-50→teal-50 wash band (one of the two allowed). Two plan cards (Starter
  highlighted for solo/small, Pro badged "For bigger crews"), then the **honesty strip** below:
  three lines with icons — the first-month math (see below), the win-first US timeline (amber
  accent), "Prices in USD, plus tax where applicable." Then the guarantee line + link.
- **The first-month math, owned out loud (buyer finding — do not make the reader assemble it):**
  the honesty strip states the true US first-month sum right where $29 is promised: **"US shops:
  $29/mo + a one-time $29 to register with the phone companies = $58 your first month, then $29
  every month after."** Canadian companies that skip US texting never pay the $29 and never wait.
  Owning the sum converts the "gotcha" into the trust proof (COPY.md §H9).
- **Live usage-meter proof (finding: show the meter, don't waste S10 on /pricing only):** a real
  **petrol usage-fill bar with the cap control** — the visual proof of "usage that can't surprise
  you." Rendered as live DOM or the S10 crop; sits beside the cards as the section's product
  visual so the back half isn't text-only.
- **Crew-size flat-vs-per-user slider (moved onto the home page — the converting interaction):**
  drag 1→10 people and watch the "typical per-user tool" line climb past Loonext's flat line.
  This makes weapon #1 physically undeniable. <10KB island, tabular numerals, `aria-live`. The
  per-user comparison figure is labeled and dated and links to /compare/quo for the sourced math
  (per §13.7 — no bare unverified competitor number). This replaces the generic missed-text
  calculator as the home page's flagship interactive.
- **Cards carry exactly:** price (tabular, 48px), seats, numbers, included outgoing texts
  ("500 texts a month — a plain text up to 160 characters is one; the composer shows the count
  before you send", per the segment-unit finding), overage rate, "receiving texts is free and
  unlimited," month-to-month line, CTA "Start with Starter/Pro." Full copy COPY.md §H9.
- **Interactive:** crew-size slider (as above). "See full pricing" link under the cards.

### 3.10 Canada + compliance (interleaved, not stacked)

- **Purpose:** claim the unowned Canada position and reframe the carrier stuff as work the
  product does — **interleaved into one med-density section** so the tail of the page never
  stacks look-alike text bands (§1.4 finding). Canada leads (it's the weapon); compliance
  follows as the "and here's how the rules are handled" beat.
- **Layout — Canada beat:** left-aligned H2 + two sentences + link "How Loonext works in Canada
  →". Instead of three flat text chips, a small **city→area-code widget visual** (or the
  province-chip visual with the "(416) — Toronto" hint) — a real product visual, not a text list
  (finding). One small maple-leaf lucide icon in petrol; tasteful, not flag-waving.
- **Layout — compliance beat:** left copy; right a real screenshot (shot S8: registration stepper
  "In review") stacked with a small crop of the consent checkbox (shot S9). *(The former
  "consent checkbox + STOP-footer preview" crop is superseded — the auto-append identification
  footer was removed, see DECISIONS D4 REVERSED; there is no footer preview to shoot.)*
- **Compliance copy (COPY.md §H10):** four short proof points, all real product behavior:
  registration filed automatically at signup; STOP handled instantly and future sends to
  opted-out numbers blocked; consent recorded when you *start* a conversation; opt-outs honored
  however they're phrased (one click marks a contact opted out). *(The fourth point was
  "first-text business signature added automatically" — superseded by the D4 reversal
  (DECISIONS D4 REVERSED): no message carries an auto-appended footer, so no page may claim
  it; §H10 already carries the replacement bullet.)* Positioning line: "The rules are real.
  You shouldn't need to become a compliance department to text a customer back." Never "makes you compliant" — copy says
  "helps you follow the rules (TCPA in the US, CASL in Canada)." **Quiet-hours copy is scoped to
  SPEC §5:** the nudge fires only when you *start* a new late-night conversation (8pm–8am), never
  on replies — copy must say "if you start a late-night conversation, we'll check first," not
  imply it guards every late send (finding).
- **Copy:** Canada in COPY.md §H11; compliance in COPY.md §H10.
- **Interactive:** the area-code widget (reuses the NANP table island; <15KB).

### 3.11 FAQ

- **Purpose:** objection handling that also feeds AI Overviews (content, not markup, is what
  earns citations now — FAQ rich results are gone since May 2026, so the answers must be
  excellent on-page).
- **Layout:** single column accordion (native `<details>`, styled; no JS island). All questions
  and answers final in COPY.md §H12. **The "what's my number / can I keep my number" objection is
  a top-3 buyer question and moves UP to the first cluster** (finding: it was buried at #8 out of
  10, framed cheerfully, and read like a hidden gotcha for a business whose whole identity is a
  phone number). It is answered with real, shipped porting (DECISIONS D16 — this supersedes the
  forwarding-workaround answer that stood here): bring your number free and self-serve, it keeps
  working on the old carrier until the scheduled cutover (usually a few days to two weeks for US,
  often faster in Canada), and the port's status is shown the whole way. COPY.md §H12 carries the
  final answer; never resurrect the carrier-call-forwarding workaround. Also covered: no app
  download; whole-crew $29 with the honest capacity math (not "never touch the limit" — see below); what counts as a text (pinned to the
  segment definition); why US takes about a week; Canada; photos; overages; cancellation &
  30-day number grace; the $29 registration fee.
- **Tech:** **no `FAQPage` JSON-LD** (finding). The rich result has been gone since May 2026 and
  Google now flags FAQPage as eligible only for authoritative gov/health sites — shipping it on a
  commercial page is pure downside (Search Console ineligibility notices), not "free and
  harmless." The visible accordions are the asset. Keep Organization/WebSite/SoftwareApplication/
  BreadcrumbList only (§11.2).

### 3.12 Final CTA band (with a founder line and a small product visual)

- **Purpose:** one closing moment, Linear-cadence — and the page's one honest social-proof beat
  (finding: the trust real estate holds only price/policy chips, zero "who's behind this").
- **Layout:** the second allowed wash band. Centered H2 + one sub-line + the primary CTA +
  guarantee microcopy. A **small product visual** (a single framed thread row or the done-mark)
  keeps the closing section from being pure text (§1.4 back-half rule). Copy (COPY.md §H13).
- **Founder-signed line (non-fabricated trust substitute):** a short, real "why we built this"
  with the founders' real names near the CTA — real people are stronger proof than absent logos,
  and it's honest for a two-person startup. Names supplied by ops (never fabricated); if not yet
  available at build time, ship the sentence without names rather than inventing them.
- **Security trust strip (verifiable differentiators, links /security):** a quiet one-line strip
  surfacing the true, checkable claims — encryption in transit and at rest, no message content in
  analytics or error tracking (D8), US data residency named plainly — linking to /security. These
  are TRUE and verifiable, which is exactly the honest-proof strategy's premise. No badges we
  don't hold.
- **Interactive:** the CTA.

---

## 4. Feature pages (shared template)

Template (all four /features/* pages): hero (H1 + sub + CTA + one framed screenshot specific to
the feature) → three job-named sections alternating copy/screenshot → one honest-details block
(limits stated plainly, e.g. photo size, segment counting) → mini-pricing strip → FAQ → CTA
band. Hand-written.

**Word-count floor raised to match query value (thin-content finding).** The flagship head-term
page gets more depth than the utility pages:

- **/features/shared-inbox — 900+ words, its own unique FAQ (not the shared 4-Q block), its own
  screenshots.** It targets the head term "shared sms inbox"; a 700-word shared skeleton reads
  thin for that query and risks the scaled-content signal §5 defends the trade pages against.
- The other three feature pages: ~700–900 words, hand-written, with a page-specific FAQ (no two
  feature pages share FAQ sentences).

Per-page angles:

- **shared-inbox:** the flagship (900+ words). Assignment, statuses, notes, done-marks, realtime
  ("when Dale replies, everyone's phone shows it answered"). Screenshot-rich, unique FAQ.
- **business-number:** local numbers, type-a-city area-code picker (interactive widget), what
  "local" does for answer rates (framed as common sense, not fake stats), **multi-number is
  real — say it:** Pro includes 2 numbers (two locations, or office + field), per-number
  conversation threading. **Porting is real too — say it (DECISIONS D16):** the page carries a
  "Bring your number" capability line (free, self-serve, old number keeps working until the
  cutover date). Also: the number is the business's, not an employee's.
- **compliance:** the §3.10 content at full depth: opt-out enforcement, consent attestation,
  quiet-hours nudge, registration state machine in plain words, records retained. Links
  /legal/messaging and /legal/aup. *(The "auto-identification footer" item that stood here is
  superseded — the footer was removed, DECISIONS D4 REVERSED; the page must not claim it.)*
- **templates-and-tags:** saved replies (with the `/` shortcut), pre-seeded pipeline tags
  (Quote sent → Scheduled → Won/Lost), search, CSV import, contact notes.

---

## 5. Industry pages (six, hand-finished)

Template (validated against SimpleTexting's home-services page and Quo's verticals, out-depthing
Heymarket's thin ones): pain hook in the trade's own words → an example conversation rendered
in the real thread UI (static, trade-specific) → four use-case blocks → a trade-specific
saved-replies pack (6 real templates, copy-ready — unique data per page) → features strip
mapped to the trade → pricing snippet with crew-size math → 5-question trade-specific FAQ
(with FAQPage JSON-LD) → CTA. 900–1,200 words each, zero shared sentences between pages.

| Page | Pain hook angle | Example thread | Distinct use cases |
|---|---|---|---|
| plumbers | emergency calls while elbow-deep in a job | leaking tankless heater + photo | photo triage, on-my-way, quote follow-up, after-hours queue |
| landscapers | seasonal quote volume, crews spread across sites | spring cleanup quote + yard photos | quote season, weather reschedules, crew dispatch, invoice nudge |
| cleaners | recurring clients, lockbox codes, reschedules | move-out clean booking | recurring confirmations, access instructions, add-on upsell, reschedules |
| hvac | seasonal spikes, maintenance plans | no-heat call in January | seasonal surge triage, maintenance reminders (manual, honest), filter photos, quote follow-up |
| salons | front desk is one person, no-shows | color consult + inspo photo | confirmations, waitlist fills (manual), consult photos, rebooking |
| contractors | subs, GCs, and clients on one personal cell | bathroom reno change request | client updates, photo documentation, quote follow-ups, separating job comms from personal |

The plumbers page copy in COPY.md §P is the master; iterations 4–5 write the other five to the
same bar, from scratch, per trade.

**Honesty guard for these pages:** no "automated reminders," no scheduling features —
reminders and confirmations are things you *send* (fast, with saved replies), not things
Loonext sends for you. Copy must always attribute the action to the user. *(Superseded
exception: missed-call text-back is now a real, shipped part of the $8/mo call-forwarding
module — DECISIONS D26 — and MAY be claimed, framed as an opt-in add-on; the same goes for the
owner-authored after-hours auto-reply. Everything else in this guard stands.)*

---

## 6. Comparison pages (three)

Structure (Quo's proven template, turned honest): "Who each is for" intro that **concedes
genuinely** (Podium: reviews/payments platform breadth; Heymarket: enterprise workflows, SOC 2,
integrations; Quo: it's a full phone system with calling — Loonext is texting only, and says
so) → side-by-side table (verified rows only) → **"What you'll actually pay"** math block,
every competitor price stamped **"as of July 2026"** with a visible last-checked date →
switching-objections FAQ (6) → CTA.

Verified claims bank (from `competitor-site-teardowns.md`; re-verify each iteration that touches
these pages):

| Competitor | Verified facts we may state (dated) |
|---|---|
| Podium | No public pricing; demo/sales-call purchase path; sales phone in nav; annual contracts; reported entry ~$399/mo. Counter: our two plain cards + "see the price, pay, start today." |
| Heymarket | $49–199/user/mo, 2-user minimum; messages billed separately at $0.03/segment; $10/mo 10DLC fee (**monthly, not one-time**); demo-routed CTAs. Math: 3-person crew + **500 single-segment texts** ≈ $172/mo vs $29 all-in — **state the single-segment assumption in the cell** (the segment-unit finding: don't silently assume 1 segment/text). |
| Quo | Per-user, **$15/mo (annual) / $19/mo (monthly)** Starter; per-user scaling; extra numbers $5/mo; **texting is NOT bundled — automated SMS is $0.01/segment** (teardown line 130). Concede: calling, maturity, reviews. Math: 6-person crew $90–114/mo (monthly $19/user) vs Pro $79 covering 10 seats + 2 numbers. Note we match their fee-honesty bar and beat it (their $19.50 TCR one-time fee vs our $29 once-ever with instant-Canada). **Never state "500 texts included" for Quo — it is false per the teardown; texting is metered separately.** |

Rules: competitor names in text only, no logos (nominative fair use, non-endorsing); no
scraped screenshots of their sites; every number dated; recommend the competitor outright for
the buyer it fits ("If you want calls, reviews, and payments in one platform, buy Podium.").
This candor is the conversion device.

**Per-cell sourcing (every claim verifiable, §13.7 — enforced after the pricing-table finding):**
every competitor number in a comparison table or math block either (a) cites the exact published
line item with its dated source inline, or (b) reads "texting terms vary — see comparison" /
links to the sourced page. Specifically: Quo's texting cell states its **real** terms
($0.01/segment automated SMS, extra numbers $5/mo), never "included"; the Heymarket cell states
the **single-segment assumption** explicitly; per-user figures are labeled with the billing
period ("$19/user/mo, monthly billing"). A competitor number the site cannot verify is a
false-advertising / defamation exposure and does not ship.

**No-shared-sentences guard (scaled-content defense, matching §5's guard for trades):** the three
compare pages share a skeleton but **zero sentences** — the "Who each is for" concession and the
switching-objection FAQ are written fresh per competitor, each carrying competitor-specific
verified rows. Three pages built from one identical table + FAQ shape, launched together, would
read as a template farm to Google exactly the way thin industry pages do; the guard prevents it.

---

## 7. /canada

Hero: "Canadian crews text their customers the same day they sign up." Sections: instant
activation explained (no US-carrier registration needed for CA→CA — one plain sentence, no
10DLC jargon); local numbers in every province (city→area-code widget with CA data);
CASL-aware features (consent records, STOP honored — "helps you follow CASL," never
"CASL-compliant"; the "identification footer" that was listed here is superseded — removed per
DECISIONS D4 REVERSED, do not claim it); honest data-residency disclosure ("your data is
processed in the United States" — stated, not buried); enable-US-texting-later path ($29 registration then,
3–7 business days). USD pricing acknowledged head-on with the pricing-page line. FAQ (5). This
page is the market's only Canada-first story; keep it concrete, not patriotic.

---

## 8. /pricing (full spec)

- **Layout order:** H1 + sub → two plan cards (full detail, both CTAs direct to signup) →
  crew-size slider → honesty ledger → "what you'll actually pay elsewhere" table → segment
  explainer + counter widget → guarantee block → FAQ (8) → CTA band.
- **Plan cards:** everything from SPEC §2, in human words, nothing omitted: price, seats,
  numbers, 500/2,500 outgoing texts ("billed as segments — plain text up to 160 characters is
  one segment; the pricing table says this explicitly per SPEC's copy rule"), overage 3¢/2.5¢,
  free unlimited receiving, sending photos as the opt-in picture-messages add-on ($5/mo, 150
  picture messages included, each send also meters as 3 texts — the #12 module model supersedes
  the old "photo messages count as 3" plan-included line), spending cap (default 3× included,
  you control it, alerts at 80% and 100%), month to month, upgrade path.
- **Honesty ledger (the trust centerpiece):** a bordered card titled "Every cost, before you
  pay" listing: plan price · $29 one-time US registration (what it is, who pays it, never
  charged twice — Canadian companies that skip US texting never pay it) · overage rates ·
  taxes ("plus sales tax where it applies — Stripe calculates it at checkout") · "that's the
  whole list." Below it, the timeline card using the SPEC checkout copy nearly verbatim.
  This out-discloses Quo (the current market bar) on its own device.
- **Crew-size slider (interactive):** 1–10 people → Loonext flat price line vs "typical
  per-user texting tools" line ($19/user, labeled and dated, linking to /compare/quo for the
  named math). Output in tabular numerals. <10KB island.
- **Segment counter (interactive):** textarea → "1 text (142 characters, plain)" using the real
  `packages/shared` estimator — the same code that bills. Copy says exactly that; it's a trust
  demo, not a toy.
- **Guarantee block:** 30 days, full first-invoice refund including the registration fee, email
  us, done. Links /legal/refunds.
- **JSON-LD:** SoftwareApplication with both offers (§11.2).
- Full copy in COPY.md §PR.

---

## 9. Legal & trust pages

Launch set (peer-verified against Textline/Heymarket/Quo/Telnyx in
`research-nextjs-seo-legal.md`): 

- **/legal/terms** — month-to-month explicitly stated; cancellation/grace mechanics (30-day
  number hold) in plain language; no auto-conversion tricks to disclose because none exist.
- **/legal/privacy** — one policy, both countries: PIPEDA + Quebec Law 25 (named privacy
  officer; US processing disclosed: Supabase `us-east-1`), and the TCR-checked clause verbatim
  in substance: **mobile numbers and SMS consent data are never shared with or sold to third
  parties or affiliates for marketing.** Cross-border transparency is a feature of the Canada
  story, not a footnote.
- **/legal/aup** — at least as strict as Telnyx's (upstream obligations flow down): SHAFT ban,
  extended restricted content, **explicit purchased/harvested-list ban**, "consent cannot be
  bought or transferred," immediate opt-out honor, suspension rights. Beats Quo's fair-use page
  (which omits the purchased-list ban) — consistent with the transparency positioning.
- **/legal/messaging** — SMS program disclosures: how opt-in works, STOP/HELP, message
  frequency varies, message and data rates may apply. Doubles as customer-adaptable template.
- **/legal/subprocessors** — table: Telnyx (SMS/MMS carriage, numbers), Stripe (payments, tax),
  Supabase/AWS us-east-1 (database, auth, file storage), Cloudflare (hosting/CDN), Resend
  (email), Sentry (errors — PII-scrubbed), PostHog (product analytics — no message content,
  cookieless on marketing pages). One line each on data touched. Textline-pattern; Quo lacks it.
- **/legal/refunds** — the guarantee, three paragraphs, no asterisks.
- **/security** — per §2 decision.

Footer legal-identity line: the registered legal entity name and mailing address go here at
build time (iteration 2 blocker: obtain from ops — a physical address is cheap SMB trust and
required for CASL sender identification; **do not launch with this line missing, and never
fabricate it**).

---

## 10. Visual asset production plan

### 10.1 Screenshot shot list (captured from the seeded local app after the UI wave lands)

Seed company: **"Reyes Plumbing & Heating"**, Toronto, number **(416) 555-0119** (555-01XX
range = safe fictional numbers; G10 formatting). Team: Priya (owner), Dale, Marcus. Seed data
must include: 8 inbox conversations with realistic names/snippets spanning statuses (2 New
w/ unread dots, 3 Open, 2 Waiting, 1 Closed), pre-seeded tags in use, assignee avatars
(initials), relative times (2m / 1h / Tue), usage meter at 212/500. All message content is
written (not lorem) — reuse the COPY.md §H4 script plus trade-plausible one-liners.

Live-DOM moments (§1.3) are **not** in this raster shot list — they're built from app
primitives: the hero two-phones thread (§3.1), the dark-band thread (§3.8), and bento large
tiles 1 & 5 (§3.6). S1/S3/S2(large)/photos below are retained only as the reduced-motion/no-JS
static fallbacks the server-render ships, and as the seed-data reference for the live components.

| # | Shot | Screen & state | Used in |
|---|---|---|---|
| S1 | Hero fallback | Desktop inbox, light: completed water-heater thread (photo MMS, amber note, assignment event, Delivered check) | Home hero — **no-JS/reduced-motion fallback only** (live DOM otherwise) |
| S2 | Assign/status | Thread header with assignee menu open + status pills visible in list | Bento tile 1 — **live-DOM reference / static fallback** |
| S3 | Dark mobile | 375px thread, dark mode, composer focused, push notification rendered | Dark band — **live-DOM reference / static fallback** |
| S4 | Area-code picker | Onboarding step 2 with "(416) — Toronto" hint state | How-it-works, home Canada beat, /canada, business-number |
| S5 | Saved replies | Composer with template picker open (plumbing templates seeded) | Bento 3, templates page |
| S6 | Search | Search results with highlighted snippet ("water heater") | Bento 6 |
| S7 | CSV import | Import wizard dry-run preview table | Bento 7 |
| S8 | Registration stepper | /settings/numbers, campaign "In review" state | Compliance section |
| S9 | Consent | New-conversation compose: consent checkbox (the former "+ '— Reyes Plumbing…' footer preview" is superseded — the auto-append footer was removed, DECISIONS D4 REVERSED; shoot the checkbox only) | Compliance section |
| S10 | Usage meter | Settings → Usage, petrol fill at 42%, cap control visible | **Home pricing preview (§3.9)** + /pricing |
| S11 | Done mark | Message with strikethrough + petrol check tooltip ("Done · Priya · 2:14 PM") | Bento 8, home final-CTA visual |
| S12–17 | Trade threads | One thread per trade (per §5 table scripts), light, desktop | Industry pages |

Capture spec: 2× DPR, light theme unless stated, browser chrome cropped (we add our own
minimal frame), exported → sharp pipeline → AVIF + WebP fallback, exact rendered dimensions,
build-time blur placeholders via static imports. Static tiles ≤40KB each. **No 90KB hero raster**
— the hero has no image (§3.1); S1 is the small static-thread fallback only.

### 10.2 SVG infographics (hand-crafted, app-token colors, stroke 1.75)

- **V1 How-it-works connector** — three numbered petrol circles, dashed path, responsive
  vertical stack on mobile.
- **V2 First-week timeline** — Day 0: number live, receiving works, Canada texting live →
  Days 1–7: US carrier review (amber segment, "typically 3–7 business days, about a week") →
  Approved: US texting on. **Promoted to a home-page expressive centerpiece (§3.5, §0.2)** using
  the numeral-display treatment; also on /pricing and /features/compliance. Honesty rendered as a
  design object — the day-count numerals are one of the two expressive moments (§0.2).
- **V3 Flat-vs-per-user chart** — flat petrol line vs climbing stone line over 1–10 seats;
  static SVG twin of the crew-size slider (now on the **home page** §3.9 and /pricing) for no-JS
  and OG use. The climbing line is labeled with its dated per-user source (§13.7).
- **V4 Two-phones diagram** — customer's generic messages app ↔ Loonext inbox, neutral frames,
  for /features/shared-inbox.

### 10.3 Logo, favicon, OG

- Wordmark: "Loonext" Inter 600, stone-900 (white on dark), with the app's mark — a rounded
  speech-bubble tile in petrol containing a white "J". Favicon: bubble mark at 32/180/512 +
  maskable (already the PWA icon; reuse, don't redesign).
- OG images: 1200×630, stone-50 background, petrol left rule, Inter 600 title (≤2 lines),
  bottom-left wordmark, bottom-right one truth chip ("$29/mo flat" on pricing/home; page-topic
  chip elsewhere). Built with `opengraph-image.tsx` (Satori: inline flexbox only, bundled Inter
  files) at build time for dynamic routes; one pre-rendered static PNG for home. Never
  `runtime='edge'` (OpenNext forbids it).

---

## 11. SEO & tech plan

### 11.1 Metadata

- `metadataBase: https://loonext.app`; root layout `title.template: "%s · Loonext"`.
- Home (absolute): **"Loonext — Shared text inbox for your crew | $29/mo flat"**;
  description leads with flat pricing + month to month + US/Canada.
- Every marketing page: static `metadata` export (zero runtime cost), `alternates.canonical`,
  hand-written unique descriptions (no templating), `viewport` as separate export.
- Title patterns: features "Shared inbox for business texting"; industries "Texting software
  for plumbers"; comparisons "Loonext vs Podium: pricing & honest differences (2026)".

### 11.2 JSON-LD (official Next pattern: inline `<script type="application/ld+json">` in server
components, `JSON.stringify(...).replace(/</g,'\\u003c')`, typed via `schema-dts`)

- `Organization` — root layout (name, url, logo, sameAs when real profiles exist).
- `WebSite` — home.
- `SoftwareApplication` (subtype `WebApplication`) — home + /pricing: `applicationCategory:
  BusinessApplication`, `operatingSystem: "Web"`, two real `offers`. **Each Offer must carry
  `priceCurrency: "USD"`, `price` as a string (`"29.00"` / `"79.00"`), and a
  monthly-subscription signal** (`category` note or the price qualifier) so a parser can't read
  it as a one-time charge (finding). Validate both offers in the Rich Results Test before launch.
  **No `aggregateRating`, no `review` — none exist; fabrication risks a manual action.** Add only
  when real G2/Capterra reviews accrue.
- `BreadcrumbList` — all sub-pages (still fully supported).
- **No `FAQPage` JSON-LD (dropped, finding).** The rich result died in May 2026 and Google now
  treats FAQPage as eligible only for authoritative gov/health domains; emitting it on a
  commercial page is not "free and harmless" — it invites a Search Console ineligibility notice
  for pure downside. The visible on-page answers are the entire asset (§3.11). This applies to
  every page (home, pricing, industry) — none ship FAQPage markup.

### 11.3 Sitemap, robots, LLMs

- `sitemap.ts` generated from the same route-data maps that drive nav/footer/industry/compare
  pages (single source of truth).
- `robots.ts`: allow marketing; disallow `/inbox`, `/contacts`, `/templates`, `/settings`,
  `/onboarding`, `/login`, `/signup`, `/reset-password`, `/invite`, `/join`.
- `llms.txt` at root: one page of plain-text product facts (pricing, plans, positioning, the
  honest timeline) — cheap AI-answer insurance (Quo/Clerk pattern).

### 11.4 Performance budget (hard gates for iterations 7–10)

| Metric | Budget |
|---|---|
| LCP (field, p75) | **< 1.5s** — now *real*, not wishful: the hero has no raster image (§3.1), so the LCP element is guaranteed to be H1 text / server-rendered thread DOM. (Official "good" is 2.5s; the "2.0s tightening" claim is debunked — build to web.dev numbers.) |
| CLS | **< 0.05** |
| INP | < 200ms |
| Lighthouse (perf/SEO/a11y/best-practices) | 100/100/100/100 on home + pricing |
| Client JS on marketing routes | 0KB above the fold beyond the nav toggle; each below-fold island < 15KB gz |

Techniques (all pre-decided): fully static rendering for every marketing route; **the hero is
DOM/CSS with no raster image** (§3.1) — the LCP is H1 text over a server-rendered static thread,
so the 1.5s budget is achievable on real mobile without a desktop-image decode; the hero's
animated thread hydrates *after* first paint via `next/dynamic`; **the hero atmosphere is a CSS
gradient layer positioned behind the LCP box, never over it, with no `blur()` filter on the LCP
region** (§1.2) — soft-stop gradients instead of a paint-costly blur; no client components above
the fold otherwise (mobile nav = smallest possible island or CSS-only); self-hosted Inter via
`next/font` (zero font CLS); `images.unoptimized=true` is a fact (SPEC §3) so **all static
images are pre-sized AVIF/WebP produced by a sharp build step + static imports** (dimensions +
blur baked in) — `sizes`/`srcset` do nothing, so ship one right-sized file per breakpoint via
`<picture>` (mandatory for every static product visual, not optional); reveals animate
transform/opacity in reserved boxes only; no consent banner (see §11.5) and any future banner
overlays, never inserts; verify CLS in CrUX/Search Console post-launch, not just Lighthouse
(scroll-shift is invisible in lab runs); no animation libraries, no third-party scripts except
PostHog.

### 11.5 Analytics

**PostHog, cookieless, on marketing pages** (`persistence: 'memory'`, no autocapture of text,
same D8 PII posture as the app). No cookies → no consent banner → no CLS risk, and Quebec Law
25 opt-in-cookie rules stay satisfied. Events: page views, CTA clicks, calculator/slider
interactions, signup starts. Wire the funnel to the SPEC's north-star metric events
(`checkout_completed` → `first_outbound_sent`).

---

## 12. Nav & footer

### Header

- Left: wordmark. Center-left links: **Product ▾** (4 feature pages + Security), **Pricing**,
  **Who it's for ▾** (6 trades + Canada), **Compare ▾** (3). Right: **Log in** (quiet) +
  primary button **Get your number**.
- Sticky; stone-50 at 92% opacity with blur; bottom 1px `stone-200` border appears on scroll.
  Mobile: hamburger → full-screen sheet, 44px+ targets, CTA pinned at bottom.
- No phone number in the nav. Ever. (Podium's sales line is the anti-pattern; our absence of
  one is the point.)

### Footer

Four columns + brand block:

1. **Product:** Shared inbox, Business number, Compliance built in, Templates & tags, Pricing,
   Security, Canada.
2. **Who it's for:** the six trades.
3. **Compare:** vs Podium, vs Heymarket, vs Quo.
4. **Company & legal:** Terms, Privacy, Acceptable use, SMS policy, Sub-processors, Refunds,
   Security, **Status** (`status.loonext.app`, hosted — §2), **Contact** (→ /contact, a real
   page, not a bare mailto — §2). Still no chat widget, no phone in the footer.

Brand block: wordmark + one-line restatement **"Loonext — the shared text inbox for your
crew."** + legal entity name and mailing address (§9 blocker) + sign-off line **"Month to
month. No sales calls, ever."** + copyright. Full footer copy in COPY.md §F.

---

## 13. What we do NOT do (binding prohibitions)

1. No fake anything: no invented testimonials, customer logos, review badges, star ratings,
   user counts, or "as seen in." Until real customers volunteer quotes and real review
   platforms accrue ratings, proof = verifiable product truths only.
2. No stock photography, no AI-generated hero art, no illustration-led sections. Real product
   UI or crafted SVG diagrams only.
3. No chat widget, no phone number, no "book a demo," no exit-intent popups, no email-gated
   content, no countdown timers, no "limited-time" anything.
4. No cookie-consent-requiring trackers on marketing pages (PostHog cookieless per §11.5); no
   ad pixels at launch.
5. No dark patterns: no trials that auto-convert (we have no trial), no hidden fees, no
   cancellation friction copy. The refund policy has no asterisks.
6. No selling roadmap: no jobs-from-messages, no native apps or app-store badges, no
   scheduled sends, no broadcast/bulk (we anti-sell blast marketing as a compliance stance),
   no toll-free, no CAD billing claims. PWA is always framed as "works on every phone, no
   download needed." *(Two items left this list because they shipped: number porting is real
   (DECISIONS D16) and missed-call text-back ships inside the $8/mo call-forwarding module
   (DECISIONS D26) — both may be sold as shipped, the latter always framed as an opt-in
   add-on.)*
7. No uncited competitor claims: every competitor price/fact carries "as of {month year}" and
   is re-verified whenever a compare page is touched. Names in text only; no competitor logos.
8. No enterprise cosplay: no SOC 2/HIPAA badges we don't hold, no "trusted by industry
   leaders," no jargon ("omnichannel," "AI-powered," "10DLC" naked without a plain-English
   sentence around it). **Enforced in FAQ answers and every customer-facing page, not just
   headlines:** keep "10DLC" off customer-facing copy entirely (say "the phone companies require
   every business that texts to register"); **lead with "text(s)," never "segment(s)"** — the
   160-character split is a footnote/tooltip exactly like the app's own UI copy rule (SPEC §2),
   never the headline unit; swap "carrier registration / vetting fees" for plain phrasing
   ("register with the phone companies; the fee covers what they charge to do it"). "Carrier
   approval" is acceptable once explained; insider terms ("brand and campaign vetting,"
   "campaign vetting fees") are replaced with the plain version.
9. No scroll-cinema: no parallax, scroll-jacking, GPU scenes, or animation libraries. Calm
   craft and speed are the aesthetic.
10. No divergence from checkout truth: any timeline/pricing sentence on the site must match
    SPEC §4.1 checkout copy in substance. If SPEC changes, marketing changes the same day.

---

## 14. Iteration 2 handoff (immediate next actions)

Build order (post-revision, wave-blocked on apps/web): **(a) the live thread primitives shared by
the hero (§3.1), the §3.4 deep-dive, the dark band (§3.8), and bento tiles 1 & 5 (§3.6) — build
this component ONCE, first, because four sections depend on it; (b) the (marketing) route group
+ nav/footer + home v1 skeleton; (c) the two home interactives (crew-size slider §3.9, area-code
widget §3.10); (d) /pricing, legal set, /contact, SEO plumbing; (e) hosted /status wiring.**

1. **Live-thread component first.** The signature moment (§0.1) and three other sections reuse it;
   it is the single biggest lever to stand next to Linear/Stripe/Resend (§1.3). Reuse the app's
   real thread primitives; server-render the completed thread for LCP/no-JS.
2. Scaffold `(marketing)` route group: layout (nav/footer), home v1 from COPY.md, /pricing,
   legal set, **/contact**, metadata/JSON-LD (no FAQPage, §11.2)/sitemap/robots/llms.txt
   plumbing per §11.
3. **Blockers to resolve with ops (expanded):** legal entity name + mailing address (§9, also
   feeds /contact and the footer identity line); privacy officer name for Law 25 (§9); **founder
   real names for the home founder-signed line (§3.12) — ship the sentence without names rather
   than fabricate**; refund guarantee wording + one-line Stripe refund runbook (§2); **real
   support-response SLA for /contact** ("we reply within 1 business day" placeholder until
   confirmed); **stand up `status.loonext.app` on a hosted provider (Instatus/BetterStack free
   tier) and link it in the footer before launch (§2).**
4. Screenshot capture (§10.1) is gated on the UI wave + seed script; build the seed script as
   part of iteration 3. **Note: the hero has no raster (§3.1) — capture priority is the static
   utility shots (S4–S11), not a hero image.**
5. Copy for the five remaining industry pages and three compare pages: iterations 4–5, to the
   COPY.md §P bar, with fresh competitor price verification at write time. **Compare pages carry
   per-cell dated sourcing and zero shared sentences (§6); /features/shared-inbox is 900+ words
   with its own FAQ (§4).**

---

## Panel resolutions

Every blocker and major from the devils-advocate panel is applied above; minors are applied
unless they conflict with the hard rules (honesty always wins). Where critics conflicted or a
call had to be made like an owner, the reasoning is here.

**Design vs performance — the hero (design-director blockers #1/#6 vs cro-seo LCP major).** The
design panel wants the animated live thread as the hero centerpiece; the SEO panel warns a 90KB
hero raster blows the 1.5s LCP budget and the "H1 is the LCP" claim is wishful. **Resolved in
both their favors at once:** the hero becomes the live thread *with no raster image at all*
(§3.1). DOM/CSS centerpiece → the LCP element is genuinely H1 text / server-rendered thread DOM,
the budget becomes real, and there's no mobile desktop-image decode. This is strictly better than
either "keep the raster" or "demote the demo." The atmosphere moves to a CSS gradient behind the
LCP box with no blur filter.

**Signature moment vs "no second demo" (design #1 vs redundancy).** Promoting the demo into the
hero risked leaving §3.4 a redundant second demo. Call: the hero is the *autoplay spectacle*;
§3.4 is re-scoped to a slower, annotated feature walk-through reusing the same primitives — one
story, two depths, no duplicated build.

**Missed-text calculator: demote, don't delete (design #5 / buyer).** The calculator undercuts
the honesty stance and the crew-size slider is the real weapon, so the slider moves to the home
page (§3.9). But deleting the calculator outright would remove a needed sparse breather before
the dark band. Owner's call: **keep it, demoted and reframed as pure arithmetic**, explicitly
"cut for length is acceptable." The slider is the interaction that must ship; the calculator is
the one that may go.

**Honesty labels: quieter, not louder (design minor vs the brand's honesty instinct).** The brand
wants radical honesty; three self-justifying captions read apologetic. Resolved by keeping the
**one** load-bearing label (the scripted-demo label on §3.4) and cutting the hero's "the actual
product" caption and the "example — real interface" captions. This does NOT weaken any
*substantive* honesty disclosure — the timeline, the first-month math, and the segment
definition all stay and get louder. We removed defensive captions, not truths. *(The "not yet"
on porting that was listed here is superseded: porting shipped — DECISIONS D16 — so the honest
disclosure is now the real port window, old-carrier-until-cutover reality, not a "not yet.")*

**Segment vs text — the load-bearing number (cro-seo blocker + buyer major).** Two critics, one
fix: human-facing figure stays "500 texts," but **every first appearance per page pins it** with
"a plain text up to 160 characters is one; the composer shows the count before you send," and the
"segment" noun is demoted to a tooltip/footnote everywhere (matching SPEC §2's own UI copy rule).
The plumber-FAQ "20 texts a day" claim is bounded to "plain on-my-way texts" with the same caveat.
This also fixes the "never touch the limit" overclaim → honest capacity math.

**First-month math: own the sum (buyer major).** The $29 promise and the $29 fee were disclosed
in different places, which reads as bait-and-switch even when fully true. Now the true US
first-month sum ($58, then $29) is stated *next to* the $29 the first time registration appears
(§3.9, COPY §H9). Owning it out loud is the trust proof.

**"Included" for Quo — a real legal exposure (cro-seo blocker).** The pricing table claimed Quo
includes 500 texts; the teardown says Quo texting is metered at $0.01/segment. That's a false
competitor claim. Fixed: Quo's cell now states its real metered terms; the Heymarket cell states
its single-segment assumption; per-user figures carry their billing period; §6 gains a per-cell
dated-sourcing rule.

**/status and /contact (cro-seo blocker + minor).** Both added to inventory and footer. /status is
*hosted, not custom-built* (owner's cost call for a two-person team) but must exist and be linked
before launch — a deliverability-gated SMS product selling honesty cannot have no status page.
/contact becomes a real page (not a bare mailto) because email is the only support channel.

**Trust hole (cro-seo major).** Four price/policy chips answered "what does it cost," never "who
are you." Added two non-fabricated substitutes to §3.12: a founder-signed line (real names from
ops, never invented) and a security strip surfacing /security's verifiable differentiators. Both
are true and checkable — consistent with, not a violation of, the no-fake-proof rule (§13.1).

**FAQPage JSON-LD dropped (cro-seo major).** The blueprint had shipped it "because it's free"
while also noting the rich result is dead. Since Google now flags commercial FAQPage as
ineligible, it's downside-only. Dropped everywhere; visible accordions remain the asset.

**Quiet-hours scope + provisioning speed + driving joke (cro-seo + buyer minors).** Copy is
scoped to SPEC: quiet-hours fires only when *starting* a new late-night conversation (not every
send); provisioning is "usually live in a minute or two" (SPEC §4.3 has a documented slow path),
never a bare "under a minute"; the "red light (parked, please)" line is cut as a liability-flavored
joke for a compliance-forward brand.

**Density wave (design majors #4/#8).** The section order was a monotonic ramp; §1.4 now mandates
a wave (no two low-visual sections adjacent; a breather between the bento and dark band; product
visuals in the back half — usage meter, area-code widget), and §3 is re-sequenced to match. Canada
and compliance are interleaved rather than stacked.

**Expressive device (design major #3).** "Dialed up" was one glow and a bigger font. Committed to
ONE bold on-brand gesture: the honest first-week timeline promoted to a home-page centerpiece
rendered with a new numeral-display type scale (§1.1, §0.2), plus the `$29` as art in the truth
bar. Two big moments, everywhere else quiet — the contrast is the point.

**Live DOM over static crops (design major #6).** The hero, the dark-band thread, and the two
large bento tiles now render as live HTML/CSS from the app's real primitives; only genuine utility
shots stay raster. This is the flagged single biggest lever to close the gap with the benchmark
sites, and the component was already budgeted for the demo.

**Thin-content floor (cro-seo major).** /features/shared-inbox raised to 900+ words with its own
FAQ; §6 gains the no-shared-sentences guard the trade pages already had.
