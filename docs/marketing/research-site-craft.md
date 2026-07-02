# Marketing-site craft research — patterns for JobText

**Status:** research input for the marketing-site build. Verified against the live web on 2026-07-02
(WebFetch of each homepage + 2026 trend roundups). This is a pattern catalog, not a spec — but the
"Fit for JobText" verdicts are argued against the binding brand facts in `docs/DESIGN.md` (warm stone
neutrals, petrol #0F766E, Inter, calm, border-first, shadows only on overlays) and the ICP (plumbers,
landscapers, cleaners, salons, HVAC — buyers on phones, not developers).

Hard constraints this research respects: sell only what exists (no jobs-from-messages, no native
apps, no missed-call text-back), PWA = "works on every phone, no download needed", multi-number is
real, flat team pricing, month-to-month, honest US carrier-registration timeline, Canada instant.

---

## 1. Per-site teardowns (as live, July 2026)

### Linear (linear.app) — dark, cinematic, product-as-proof
- Hero: terse confident headline ("The product development system for teams and agents"), one-line
  sub, then **real product screenshots immediately** — no illustration, no stock.
- Section rhythm: 5 feature sections each named by a *job* ("Define the product direction",
  "Understand progress at scale"), each anchored by a UI screenshot. Then changelog, 3 testimonials,
  one closing CTA band ("Built for the future. Available today.").
- Social proof: only 3 quotes + one stat ("powers over 33,000 product teams"). Restraint reads as
  confidence.
- The famous "Linear look" (per frontend.horse's teardown and Medium's "rise of Linear style"):
  dark background so lighting effects pop, gradient/specular-highlight borders on cards, thin 1px
  SVG lines, glowing buttons, small "spills of color", strictly sans-serif, stylized product UI
  instead of photos.
- Footer: 6 tight columns + one-line brand restatement ("Linear – The system for product
  development").
- **Fit for JobText:** steal the *structure* (job-named sections, screenshot-anchored, few quotes,
  one closing band, one-line footer tagline). **Avoid** the dark-theme-with-glow aesthetic wholesale
  — it codes "developer tool / severe software" and fights a warm-stone brand for tradespeople. The
  one borrowable visual move: a *single* soft petrol light-glow behind the hero screenshot on a
  stone-50 background (light-mode adaptation of the glow, not the dark theme).

### Stripe (stripe.com) — the calm-light benchmark
- Hero: outcome headline ("Financial infrastructure to grow your revenue"), abstract animated
  gradient wave — the *only* loud element on an otherwise disciplined light page.
- Logo carousel immediately post-hero, then solutions grid, metrics band ("50% of Fortune 100…"),
  case studies, developer section, final CTA.
- Pattern: **light page, one contained area of gradient energy**; everything else is whitespace,
  crisp type, and restrained cards. Trust through order.
- **Fit:** the best structural model for a calm brand. JobText's version of the gradient wave =
  a warm stone→teal-50 ambient wash behind the hero, never full-spectrum rainbow. Stripe's
  metrics-band pattern maps to JobText proof points (flat pricing math, "texting live in Canada
  instantly").

### Vercel (vercel.com) — dark monochrome + luminescent accents
- Hero: two-word headline ("Agentic Infrastructure"), dark glow imagery, customer case studies as
  full-width sections each with one concrete metric (Notion, Zapier, Mintlify).
- Tab-based feature explorers; heavy black/white with glow.
- **Fit:** avoid the aesthetic (developer-coded, cold). Steal: **one concrete number per proof
  section** and the discipline of a 2-CTA hero (primary + quiet secondary "Talk to sales" — for
  JobText: "Start texting" + "See pricing", never "Contact sales", which is the anti-Podium point).

### Resend (resend.com) — light page, photographic hero atmosphere
- Hero: "Email for developers" + light-ray/floor-texture photographic background with gradient
  overlays — atmospheric depth on a **light-dominant** page (proves glow ≠ dark theme).
- Sections show the *actual artifact*: code sample → live API response → rendered email preview.
  12+ short founder quotes in a carousel. Closing band: "Email reimagined. Available today."
  Footer includes a real street address (trust signal).
- **Fit:** the light-atmospheric-hero technique is the single most transferable "beauty" move for
  JobText: warm light rays / soft petrol luminance over stone-50. And Resend's "show the artifact"
  = JobText showing a **real SMS thread** (customer bubble in, teal-50 reply out, internal amber
  note) — the marketing hero should literally be the app's thread UI, which DESIGN.md already makes
  beautiful. Physical address in footer is cheap trust for an SMB audience.

### Clerk (clerk.com) — components as hero, logos early
- Sub: "…launch faster, scale easier, and stay focused on building your business." Single CTA
  ("Start building for free"). Real UI components rendered on the page; logos + long testimonial
  wall; closing "Start now, no strings attached."
- **Fit:** "no strings attached" closing register is exactly JobText's month-to-month weapon.
  Component-as-hero → render the real inbox row/thread as live-feeling HTML (not a flat PNG) so it
  crisps on every DPI and can animate a message arriving.

### Raycast (raycast.com) — light/dark alternation done right
- Hero: "Your shortcut to everything." + interactive keyboard visualization with benefit callouts
  ("Fast. Think in milliseconds.").
- **Alternates light and dark sections** on one page: light for features/automation, dark/colored
  for AI, community, developer API, final CTA. Social proof = avatar grid of real named users with
  expandable cards. Footer has newsletter signup.
- **Fit:** the strongest model for "dark sections in a light site": use ONE dark stone-950 band
  (e.g., the "your whole crew, one number" or night-shift/notifications moment) with teal-500
  accents — DESIGN.md's dark tokens already exist, so the dark band literally shows the app's dark
  mode = same brand. Avatar-grid proof adapts well: real owner faces + trade + town.

### Arc / The Browser Company (arc.net, diabrowser.com) — personality, testimonial-as-headline
- Arc's hero headline **is a user quote**: "Arc is the Chrome replacement I've been waiting for."
  Clean light layout, feature sections with human names ("Space for the different sides of you"),
  4 tweet testimonials, closing "Enter _your_ new home on the internet."
- Dia: "A browser you won't dread opening" — feeling-first headline, mascot illustration, playful.
- **Fit:** testimonial-as-hero-headline is a proven move once JobText has one great customer quote
  ("JobText got the crew off my personal cell" — that shape). Dia's mascot/sticker energy: avoid —
  too whimsical for "this thing respects my time." The *feeling-first* headline register ("a
  business number you won't dread") is worth testing, though clarity-first likely wins for this ICP.

### Family (family.co) — the delight ceiling
- "Your favorite crypto wallet." Phone mockups everywhere, seamless state animations, 12 tweet
  quotes ("Friends of Family"), FAQ section, praised specifically for "web2 delightful UI/UX".
- **Fit:** phone-mockup framing is *directly* relevant (SMS is a phone product): show the app in a
  neutral rounded device frame — but JobText must show **both** the customer's native Messages side
  and the team's JobText inbox side (the two-phones / phone+laptop pairing tells the whole story).
  Family's animation extravagance: dial down to DESIGN.md's 150–200ms ease-out ethic. Keep the FAQ
  section idea — perfect home for the honest 10DLC timeline, segment explanation, number porting.

### Amie (amie.so) — specificity as a headline device
- Sub: "Within 47 seconds: Share summary. Keep CRM updated…" — a *specific number* as the hook.
  Light page with gradient-image dark blocks; "How it works" 3-step; day-3/day-7 timeline section;
  a real customer *email* screenshot as testimonial; footer sign-off "Designed by the beach."
- **Fit:** hyper-specific claims beat adjectives for skeptical tradespeople: "Your number in 60
  seconds. Canadian texting works immediately." A "first week with JobText" timeline section maps
  1:1 to the activation flow (day 0 number live → first customer text → invite the crew). A
  personality sign-off in the footer ("Built for the trades", "No sales calls, ever") is cheap charm.

### Notion Calendar / ex-Cron (notion.com/product/calendar) — mood headline + video
- Hero: "It's time." two-word mood headline, sub carries the info; product video as hero visual;
  sections like "Time management, simplified", "Work and life, playing nice"; small illustration
  moments (the cat) as breathing room.
- **Fit:** two-word mood headlines are risky for an unknown brand (Notion can afford ambiguity;
  JobText cannot). Steal the *rhythm*: short section headlines in plain speech + one gentle
  illustration moment max (e.g., a small line-drawn truck) as warmth, not decoration.

### Jobber (getjobber.com) — the ICP's native visual language (same buyer!)
- Hero: "Run a stronger service business" + **rotating real owner photos with company names**
  (Primero TX Landscaping, Jobe & Sons Plumbing). App-store star ratings directly under the CTA.
  Concrete stat band ("29 million+ jobs completed", "12 hours+ saved"). Benefit pillars ("Win
  Jobs", "Work Smarter"). Industry vertical links (Plumbing, HVAC, Cleaning) in the footer.
- **Fit:** this is what the *buyer already trusts*: real faces, real business names, stars,
  concrete numbers, plain verbs. JobText should marry Jobber's trust grammar with Linear/Stripe's
  visual craft (Jobber's page is effective but visually generic — JobText can beat it on beauty).
  Per-trade landing pages (/for/plumbers, /for/salons) are a proven pattern here and cheap with
  one template.

---

## 2. Technique catalog → verdicts for a calm warm-stone + petrol brand

### Hero composition
| Technique | Seen at | Verdict |
|---|---|---|
| Outcome headline + real product UI immediately | Linear, Notion, Plausible | **Adopt.** Headline names the outcome in trade language ("Every customer text, one inbox your whole crew can answer"), real thread UI below. |
| Two CTAs: primary self-serve + quiet secondary | Stripe, Vercel, Jobber | **Adopt** as "Get your number — $29/mo" + "See pricing". Price *in the CTA* is itself the anti-Podium weapon. |
| Testimonial-as-headline | Arc | Adapt later, once a killer quote exists. |
| Specific-number hook in sub | Amie ("Within 47 seconds") | **Adopt**: "Number in ~60 seconds. Canada texts instantly. US activates in 1–3 business days — we handle it." Honesty as a design element. |
| Abstract gradient hero art | Stripe wave, Vercel glow | Avoid as the main event; keep energy behind the product shot, not instead of it. |
| Mascot/illustration hero | Dia | Avoid — undermines "respects my time." |
| Interactive hero toy | Raycast keyboard | Adapt: an **animated live thread** (messages arriving, a teammate assigning) is JobText's equivalent — the product is inherently a conversation, which animates naturally. |

### Product-screenshot framing
- **The 2026 consensus** (SaaSFrame, Framiq, stan.vision roundups): real UI screenshots, not
  illustrations; "dark background makes screenshots pop" is the Linear branch; the light branch
  (Stripe/Notion/Resend) uses whitespace + subtle borders.
- For JobText (light, border-first brand): **1px stone-200 border + 10px radius + very soft petrol
  ambient glow (blurred teal at low opacity) on stone-50** — the app's own card language, dialed up
  one notch. No heavy drop shadows (violates border-first rule), no aggressive 3D tilt (Linear-era
  perspective tilts now read dated and dev-flavored; a ≤2° settle-on-scroll is the tasteful max).
- Phone frame for mobile shots (Family): neutral rounded rect, no fake Apple chrome (also dodges
  trademark fuss and keeps the "works on every phone" PWA story platform-neutral).
- Browser-chrome frames: use a minimal stone-toned toolbar hint only when showing desktop inbox;
  keeps "it's just the web — no download" honest and visible.
- Render key shots as **live HTML/CSS, not PNG** (Clerk pattern): crisp at every DPI, themable,
  animatable (a new inbound row sliding in = the product demoing itself).

### Scroll-triggered reveals
- 2026 guidance is unanimous: "minimal motion that adds meaning, not noise"; "micro animations
  showing how something works beat cinematic animations" (stan.vision).
- **Adopt:** fade + 4–8px rise on section entry (same 200ms ease-out grammar as the app), staggered
  message bubbles appearing in sequence inside the hero thread, number counters in the proof band.
  Respect `prefers-reduced-motion` (already a brand rule).
- **Avoid:** scroll-jacking, parallax depth stacks, GPU shader backgrounds, morphing scenes
  (Jeton-style awwwards fintech). Wrong audience, heavy on a truck's LTE connection.

### Interactive embeds
- Live demos convert (NitroPack's "enter URL, run test"; Amplitude's embedded demo). JobText
  equivalents that exist today and stay honest:
  1. **Pricing math toggle** — team-size slider showing JobText flat $29/$79 vs "$19/user"
     competitors climbing past it at 2+ users. Interactive proof of the flat-pricing weapon.
  2. **Segment/usage explainer** — type a message, see "1 segment"; playful, honest, reuses the
     app's real segment estimator from packages/shared.
  3. **Area-code picker teaser** — type a city, see "(416) — Toronto" (the NANP table exists).
- Avoid a fake "try the inbox" sandbox (would require faking data/flows that don't exist publicly).

### Gradient & light on calm palettes
- Proven light-site moves: Stripe (one contained gradient region), Resend (photographic light rays
  over light background), Amie (gradient imagery inside contained blocks).
- JobText recipe: stone-50 base; **one** hero ambient wash (radial teal-50→transparent, or warm
  light-ray photo treatment à la Resend in stone/amber tones); teal-50 tint panels for feature
  cards; a single stone-950 dark band mid-page. Never: rainbow gradients, purple/indigo (the
  "generic SaaS" the petrol accent was chosen against), glowing gradient borders (Linear-look
  developer coding).

### Typography scale
- Marketing sites run display sizes the app never uses. Consensus scale on the studied sites:
  hero ~56–72px desktop / ~36–40px mobile, tight leading (~1.1), section heads 32–40px, body
  17–18px. Weight restraint (Linear/Stripe use 500–600 heads, not 800 black).
- JobText: **Inter stays** (same brand), add display sizes on top of DESIGN.md's scale with
  `-0.02em` tracking on ≥36px, weights capped at 600. Tabular numerals for every price and stat
  (brand rule, and prices are the argument). Sentence case everywhere including headlines —
  Jobber/Stripe title-case reads corporate; sentence case reads human, matches G10 voice.
- Playful serif headlines (2026 trend #10 per SaaSFrame): **avoid** — a second typeface fractures
  the "same brand, dialed up" mandate.

### Section rhythm (composite of Linear + Stripe + stan.vision's conversion framework)
Recommended order for JobText's homepage:
1. Hero: outcome headline, honest-timeline sub, price-forward CTA, live thread visual
2. Trust strip: real business names/faces (Jobber grammar) or plain "built for" trade list pre-launch
3. Problem→solution: "your personal cell is the business number" → shared inbox (split-screen
   before/after, Decipad pattern — fits perfectly)
4. 3–5 feature sections, each named by a job, each with real UI: shared inbox & assignment /
   templates & notes / contacts & consent / usage that can't surprise you (cap + meters)
5. **Dark band**: the whole-crew / after-hours moment, doubles as dark-mode showcase
6. Pricing on the homepage itself — two cards, everything included, "no contracts, no sales calls,
   cancel anytime" (the entire competitive stance is a pricing-transparency argument; hiding
   pricing behind a click, like Jobber does, would surrender weapon #1)
7. Honest-timeline / how-it-starts: 3-step "tonight → this week" (Amie timeline pattern), stating
   Canada-instant and the US 1–3 day registration plainly — honesty *is* the differentiator vs
   quote-game competitors
8. FAQ (Family pattern): porting, segments, PWA "no download", who counts as a user
9. Closing CTA band, Linear-cadence copy ("One number for the whole crew. Live today.")
10. Footer

Rhythm rules observed everywhere good: generous vertical space (~120–160px between sections),
alternate full-bleed and contained layouts, never two look-alike sections adjacent, one idea per
section with ≤2 sentences of body copy.

### Footer design
- Best patterns: Linear's one-line brand restatement; Resend's real street address; Raycast's
  newsletter; Jobber's industry links; Amie's personality sign-off; Clerk's llms.txt link.
- JobText footer: 3–4 modest columns (Product/Pricing, Compare [vs Podium, vs Heymarket, vs Quo],
  Trades [/for/plumbers…], Company/Legal incl. AUP), a one-line restatement ("JobText — the shared
  text inbox for your crew"), physical/legal address, and a quiet honest sign-off ("Month to month.
  No sales calls, ever."). Skip the 25-column Stripe megafooter — small product, small footer.

### Dark sections in light sites
- Raycast is the reference: dark bands for *emphasis moments*, light for explanation. Amie/Resend
  use gradient-image blocks as contained "energy" instead.
- JobText: exactly **one** stone-950 band using the app's real dark tokens (teal-500 accent) — it
  reads as "same product at night in the truck," which is literally true and on-ICP. More than one
  dark band tips the page into developer-tool territory.

---

## 3. What to avoid entirely (with reasons)
- **Full dark theme + glow borders ("Linear look")** — codes developer/severe; frontend.horse
  documents it as a dark-background-dependent system; fights warm stone.
- **Awwwards-style scroll-jacked cinema** (2026 SOTD winners like Jeton) — beautiful, wrong buyer,
  heavy payloads on mobile/LTE, and violates "fast by feel."
- **Abstract 3D blobs / whimsical illustration systems** — 2026 roundups all note the shift to real
  UI ("Real Customer Contexts Over Abstract Illustrations", SaaSFrame trend #7).
- **Per-seat-style pricing obfuscation / "Contact sales"** — the entire positioning is against this
  (Podium $399+ annual, Heymarket/Textline quote games). Pricing on the homepage, all-in.
- **Fake app-store badges, fake download CTAs** — no native apps exist; PWA framing only.
- **Feature promises beyond SPEC** — no missed-call text-back, no jobs-from-messages, no
  broadcast/blast (explicitly out of scope in D4); do show multi-number (Pro, real), templates,
  notes, assignment, CSV import, dark mode, usage caps.
- **Second display typeface / serif headlines** — breaks "same brand, dialed up."
- **Emoji-heavy, exclamation-heavy copy** — G10 voice allows one exclamation per lifetime.

## 4. Sources (fetched 2026-07-02)
linear.app · stripe.com · vercel.com · resend.com/home · clerk.com · raycast.com · arc.net ·
diabrowser.com · family.co · amie.so · notion.com/product/calendar · getjobber.com ·
saasframe.io "10 SaaS Landing Page Trends for 2026" · framiq.app "Best SaaS landing pages 2026" ·
stan.vision "SaaS website design 2026" · frontend.horse "The Linear Look" · medium.com/design-bootcamp
"The rise of Linear style design" · awwwards.com SOTD listings (Jeton et al.) · minimal.gallery ·
godly.website (now redirects to recent.design; recent.design returned 403).
