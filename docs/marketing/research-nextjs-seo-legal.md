# Research: Next.js 15 marketing-site engineering, SEO, and legal pages (verified 2026-07-02)

Scope: everything the Loonext marketing site needs to score ~100 Lighthouse, rank, and be
legally complete for a US/Canada SMS SaaS. All claims below were verified against live
primary sources on 2026-07-02 (Google/web.dev/Next.js docs, peer legal pages). Where SEO
blogs contradicted primary sources, the primary source wins and the contradiction is noted.

---

## 1. Core Web Vitals — official thresholds (and one debunked rumor)

Official, from web.dev (fetched live; `web.dev/articles/vitals`, `web.dev/articles/lcp`
last updated 2025-09-04):

| Metric | Good | Measured at |
|---|---|---|
| LCP | **≤ 2.5 s** | 75th percentile, mobile + desktop segmented |
| INP | **≤ 200 ms** | p75 |
| CLS | **≤ 0.1** | p75 |

**Debunked:** a cluster of SEO content farms (digitalapplied.com, mevohost.com,
ideafueled.com, w3era.com) claims Google "tightened LCP to 2.0 s in the March 2026 core
update, confirmed in a Search Central post on March 18, 2026." No such post exists on
`developers.google.com/search/blog`, and web.dev still states 2.5 s. Treat 2.5 s as the
official bar — but build the site to land **LCP < 1.5 s** anyway; a static-rendered page on
Cloudflare's edge with a lightweight hero should do that easily, and it future-proofs
against any real tightening.

Lighthouse note: the Performance score is lab-based (TBT stands in for INP). The heavy
weights are TBT (~30%), LCP (~25%), CLS (~25%) — so near-zero JS on marketing pages
(static rendering, no client components above the fold) is most of the battle.

## 2. Metadata API (Next.js 15 App Router)

- **Root layout** owns the defaults: `metadataBase` (required for absolute OG/twitter URLs
  — set to the production origin), `title: { template: '%s · Loonext', default: 'Loonext —
  the shared text inbox for your whole crew' }`, sitewide `description`, `openGraph`
  defaults (siteName, locale `en_US`/`en_CA`, type website), `twitter.card:
  'summary_large_image'`, icons.
- **Every page** exports a *static* `metadata` object (zero server cost, evaluated at
  build) with a short `title` (the template appends the brand) and a unique
  `description`. Reserve `generateMetadata()` for the dynamic segments (industry pages,
  comparison pages) where title/description come from a data map.
- `title.absolute` overrides the template — use it on the homepage only (homepage should
  not be "Home · Loonext").
- **Canonical** via `alternates: { canonical: '/pricing' }` on every page (relative paths
  resolve against `metadataBase`). Prevents dupe-content ambiguity when UTM/ref params hit
  the pages.
- Viewport/theme-color live in the separate `viewport` export (not `metadata`) since
  Next 14 — theme-color should be the petrol/stone pair per light/dark.
- Copy limits that still hold in 2026: titles ≤ 60 chars, descriptions ≤ 160 chars,
  one honest sentence, no keyword stuffing.
- Since Next 15.2 metadata can stream for dynamic pages; bots still get it in the head.
  Irrelevant if every marketing page exports static metadata — which they all should.

## 3. OpenGraph images (`next/og`)

- Use the **file convention**: `opengraph-image.tsx` in a route segment auto-generates the
  `og:image`, width/height, and `twitter:image` tags. No manual meta wiring.
- `ImageResponse` from `next/og` renders JSX via Satori: **1200×630**, inline flexbox
  styles only — no Tailwind classes, no CSS Grid, no `calc()`, no CSS variables, no
  transforms. Bundle the Inter font file(s) next to the component (read via
  `fetch`/`readFile`) so the OG card is typographically on-brand (stone background,
  petrol accent, Inter 600 headline).
- Static segments generate these **at build time** — zero runtime cost on the Worker. For
  the industry/comparison segments, one `opengraph-image.tsx` in the dynamic segment can
  render per-page titles ("Business texting for plumbers").
- Fully static alternative for fixed pages: drop a pre-rendered `opengraph-image.png` in
  the segment — same auto meta tags, no Satori at all. Fine for /pricing, /legal/*.
- OpenNext/Cloudflare caveat: do NOT add `export const runtime = 'edge'` to these files
  (spec rule — OpenNext only supports the Node runtime). Default is fine.

## 4. JSON-LD for a SaaS — what's still worth shipping (big 2026 changes)

Injection pattern (per Next.js official guide, `nextjs.org/docs/app/guides/json-ld`):
plain `<script type="application/ld+json">` in the server component with
`JSON.stringify(jsonLd).replace(/</g, '\\u003c')` (XSS escape), typed with `schema-dts`
(`WithContext<Organization>`). Use a native `<script>`, not `next/script`.

Per-type verdicts, verified against Google's live docs:

- **Organization** — ship sitewide (root layout): legalName, url, logo, `sameAs`,
  `contactPoint`, `foundingDate`, address. Feeds the knowledge panel and AI answers.
  No rich-result requirements to trip over.
- **WebSite** — ship on the homepage (name + url; helps sitelinks name display).
- **SoftwareApplication / WebApplication** — Google's doc (updated Dec 2025) requires
  `name`, `offers.price`, **and `aggregateRating` OR `review`** for the rich result.
  Loonext has no third-party reviews yet. **Do not fabricate a rating — self-serving or
  invented aggregateRating violates Google's guidelines and risks a manual action.**
  Ship `SoftwareApplication` with `applicationCategory: 'BusinessApplication'`,
  `operatingSystem: 'Web'`, and a real `offers` array ($29/$79, `priceCurrency: 'USD'`)
  but no rating — it won't earn the rich result yet, but it's valid entity data for
  search/AI, and the rating slot gets filled the day real G2/Capterra reviews exist.
  Search Console will show it as "invalid for rich results"; that is expected and harmless.
- **FAQPage** — **Google removed FAQ rich results entirely on May 7, 2026** (deprecation
  notice May 2025; docs page now removed; Search Console FAQ report and Rich Results Test
  support removed June 2026). Keeping the markup is harmless and other engines/AI systems
  still parse it, but it earns nothing in Google SERPs anymore. Verdict: write excellent
  on-page FAQ content (that's what AI Overviews and LLMs actually quote); add FAQPage
  JSON-LD only if it costs nothing (a shared component can emit it from the same data).
- **BreadcrumbList** — still fully supported. Ship on every sub-page (industries/*,
  compare/*, legal/*) — it controls the breadcrumb display in SERPs and is trivial.
- Validate everything with the Rich Results Test + validator.schema.org, and make sure
  the JSON-LD never claims anything the visible page doesn't (mismatch = ignored/penalized).

## 5. `sitemap.ts` / `robots.ts`

- `app/sitemap.ts` exporting `MetadataRoute.Sitemap`: statically cached route handler.
  Enumerate marketing routes from the same data maps that drive the pages (industries,
  comparisons) so the sitemap can never drift from reality. `lastModified` from build/data;
  skip `priority`/`changeFrequency` theater (Google ignores them).
- `app/robots.ts` exporting `MetadataRoute.Robots`: allow `/`, **disallow the app shell**
  (`/inbox`, `/settings`, `/onboarding`, `/contacts`, `/templates`, `/invite`, `/login`,
  `/reset-password`, `/join`) and any api paths; point `sitemap:` at the absolute sitemap
  URL. Keep `/signup` and `/pricing` crawlable — they're conversion surfaces.
- One canonical host (apex or www, pick one, 301 the other at the Cloudflare layer);
  `metadataBase` must match it.

## 6. LCP strategy for the hero (Loonext-specific)

**Critical local constraint:** SPEC §3 sets `images.unoptimized = true` in `apps/web`
(no Cloudflare image resizing — cost decision). That kills next/image's automatic
srcset/format conversion for anything sharing that config. Plan around it:

1. **Best move: don't make a photo the LCP element.** The brand is a calm product-first
   brand; render the hero "screenshot" as a DOM/CSS product mock (the inbox, in real
   stone/petrol tokens) or inline SVG. Then the LCP element is the H1 text or a styled
   element — instant, zero bytes of image, and it dials the app's design language up
   exactly as DESIGN.md demands. This is the single highest-leverage Lighthouse decision.
2. If real images are used: pre-generate exact render sizes at build time (sharp script →
   AVIF/WebP, ~1x and 2x), **static import** them (gives intrinsic width/height and an
   automatic build-time `blurDataURL` — blur placeholders work even with
   `unoptimized: true`), and mark only the ONE above-the-fold image `priority`
   (Next 15; renamed `preload` in Next 16 — `priority` is correct on our version and
   is only a deprecation warning after an upgrade).
3. `sizes` is moot with `unoptimized` (no srcset is emitted) — so size the exported file
   to the largest render width instead, or hand-roll `<picture>` for a mobile/desktop split.
4. Never lazy-load above the fold; always explicit dimensions (or `fill` + sized parent);
   everything below the fold stays default `loading="lazy"`.
5. Don't gate the hero behind an entrance animation that starts at `opacity: 0` — the LCP
   paint doesn't count until it's visible. Server-render the hero fully visible; animate
   below-fold sections only.
6. Cloudflare serves static assets free/unlimited on Workers — same-origin assets, no
   preconnect needed, immutable content-hashed URLs from static imports.

## 7. Fonts (next/font, already in use)

Inter variable self-hosted via `next/font` (DESIGN.md G2) is already the 2026 best
practice: self-hosted single variable file, automatic preload, `font-display: swap`,
and automatic size-adjusted fallback metrics (`adjustFontFallback`) which eliminates
font-swap CLS. For the marketing site: load only the `latin` subset, expose it as a CSS
variable, and resist adding a display font — weight 400/500/600 out of the one variable
file keeps it to a single request. No `<link>` font preloads, no Google Fonts CSS.

## 8. CLS pitfalls with scroll animations

- **Only animate `transform` and `opacity`** (compositor-only). Never animate
  width/height/top/left/margin/padding for reveals.
- Trap specific to reveal-on-scroll: **CLS ignores opacity but counts movement.** A
  "fade in + rise" reveal must reserve the element's final layout box and translate
  *within* it (e.g., start at `opacity:0; transform: translateY(12px)` on an element
  already occupying its final space) — never insert/expand the element on trigger.
- Scroll-triggered shifts are **invisible to Lighthouse lab runs** (it doesn't scroll).
  A clean lab CLS does not mean clean field CLS — check CrUX/Search Console after launch.
- Prefer CSS scroll-driven animations (`animation-timeline: view()`) or a tiny
  IntersectionObserver that toggles a class; both stay compositor-only and need no
  animation library on the marketing bundle. Honor `prefers-reduced-motion` (already a
  DESIGN.md G2 rule).
- Other CLS killers to design out: sticky headers that change height on scroll;
  late-inserted banners — **the Quebec-required cookie/consent banner must be a fixed
  overlay, never layout-inserting**; embeds/iframes without reserved space; any
  "announcement bar" that mounts client-side.

## 9. Programmatic SEO without the thin-content trap

Google's scaled-content-abuse policy (spam policy since March 2024, enforcement expanded
since) targets *pages generated at scale with no unique value* — template pages that swap
one variable, mass AI text, aggregation without added context. Sites doing
template-with-variable-substitution lost 30–80% traffic in 2025–26 updates. What survives:
pages built on **real, differentiated data where each page answers a distinct query**.

For Loonext this is genuinely low-risk and high-fit:

- **Industry pages (5, not 500):** `/industries/plumbers|landscapers|cleaners|salons|hvac`.
  Five hand-finished pages is editorial content, not "scale." Make each one earn its
  slot with content only Loonext has: industry-specific saved-reply templates (real
  product feature — show 4–6 actual templates per trade), the industry's texting moments
  (quote follow-up, on-my-way, review ask — within what the product does today), an
  industry-tuned FAQ, and the same honest registration-timeline framing. Shared skeleton
  is fine; shared sentences are not.
- **Comparison pages:** `/compare/podium|heymarket|textline|quo` (high-intent queries).
  2026 best practice: don't declare yourself the winner everywhere — recommend each
  product for the situations it genuinely fits, address **total cost** (flat team pricing
  vs per-seat math is Loonext's strongest honest angle), date every competitor price
  ("as of July 2026") and re-verify quarterly. Trademark law: nominative fair use covers
  naming competitors — use their name in text only as needed, no logos-as-branding, nothing
  implying endorsement, facts not implications. Honest comparison *is* the brand voice.
- Every programmatic page needs: unique title/description, unique H1, BreadcrumbList,
  entry in sitemap.ts, and enough unique body content that two pages never read as
  siblings with swapped nouns.

## 10. Legal pages a US/Canada SMS SaaS needs (peer-verified)

Peer inventory (fetched live 2026-07-02):

| Peer | Publishes |
|---|---|
| **Textline** (`textline.com/legal/*`) | Privacy, Terms, Security/compliance, **DPA**, **Sub-processors list**, government-data-request policy; DPO contact |
| **Heymarket** (`heymarket.com/tos|aup|privacy`) | ToS, **AUP** (express consent, **explicit ban on purchased/harvested lists**, SHAFT+ restricted content, immediate opt-out honor, suspension rights), Privacy, BAA, SMS-compliance hub |
| **Quo (ex-OpenPhone)** (`quo.com/fair-use`) | Terms, Privacy, **Fair Use Policy** (fraud, regulated industries incl. cannabis/payday/crypto, spam, harassment; reserves volume limits) |
| **Telnyx** (upstream, `telnyx.com/acceptable-use-policy`) | AUP banning SHAFT-type content, spam, spoofing, deceptive traffic — Loonext's own AUP must be at least as strict so enforcement can flow down |

Loonext's checklist:

1. **Terms of Service** — month-to-month, cancel anytime (this is a positioning weapon;
   the ToS must actually say it), plan limits, outbound-segment billing + overage cap,
   the 30-day number grace period after cancellation (mirror D6 exactly), suspension for
   AUP breach, disclaimers/liability, governing law. Never promise legal compliance
   outcomes for the customer.
2. **Privacy Policy** — one policy covering both countries:
   - **PIPEDA**: openness principle (plain-language policy), the 10 fair-information
     principles, a named accountable privacy contact, and **transparency that data is
     processed in the US** (Supabase us-east-1, US subprocessors) — cross-border
     disclosure is required transparency.
   - **Quebec Law 25**: designated privacy officer published with contact (defaults to
     CEO if unnamed), consent standards, breach notification, disclosure that data leaves
     Quebec/Canada, and opt-in consent for non-essential cookies → run PostHog cookieless
     on the marketing site or gate it behind a consent overlay (fixed-position, no CLS).
     Private right of action makes this the sharpest Canadian law.
   - **US**: CCPA/state-law rights section.
   - **CTIA/10DLC-required language (non-negotiable, and vetting-checked):** the privacy
     policy must state that **mobile phone numbers and SMS opt-in/consent data will not be
     shared with or sold to third parties or affiliates for marketing/promotional
     purposes**, plus message-frequency and "message and data rates may apply"
     disclosures. TCR campaign vetting checks the brand website's privacy policy for
     this — Loonext registers its own brand (sole-prop OTP texts) *and* auto-submits
     customers' campaigns, so Loonext's own site must pass the same check it asks of
     customers. (Fast-follow content idea: a help-doc template customers can adapt for
     their own sites — Heymarket publishes exactly this.)
3. **Acceptable Use / Messaging Policy** (D4 already requires signup-time acceptance):
   express consent required before texting; **no purchased, rented, harvested, or
   third-party lists — consent cannot be bought or transferred**; SHAFT prohibited (sex,
   hate, alcohol, firearms, tobacco) plus the extended carrier-restricted list (cannabis/
   CBD, payday loans, debt collection/credit repair, gambling, get-rich-quick, deceptive
   marketing); opt-outs honored immediately (the product enforces STOP automatically —
   say so); no spoofing/fraud/harassment; suspension/termination rights. Must be at least
   as strict as Telnyx's AUP.
4. **Sub-processor list** — cheap, peer-verified trust page. Loonext's is short and
   honest: Telnyx (SMS/MMS, numbers, 10DLC), Stripe (payments/tax), Supabase (database,
   auth, file storage — AWS us-east-1), Cloudflare (hosting/CDN), Resend (transactional
   email), Sentry (error monitoring, PII-scrubbed), PostHog (product analytics, no message
   content). One line each: what it is, what data it touches, region.
5. **Nice-to-have at launch, standard among peers:** a short security page (RLS,
   encrypted at rest/in transit, PII-scrubbed monitoring — only claim what SPEC supports);
   DPA available on request (full self-serve DPA can wait).
6. **CASL applies to Loonext's own marketing** (emails/texts to prospects): consent,
   sender identification, working unsubscribe. And in marketing copy: the product "helps
   you follow CASL/TCPA rules" (STOP handling, consent attestation, identification
   footer are real features) — never "makes you compliant." Peers uniformly hedge the
   same way.

## 11. Quick-hit build checklist (ties it together)

- All marketing routes statically rendered (no dynamic APIs, no client components above
  the fold); ship near-zero JS.
- Root layout: metadataBase, title template, Organization JSON-LD, next/font Inter.
- Per page: static `metadata` + canonical; BreadcrumbList on sub-pages; OG image via file
  convention.
- `app/sitemap.ts` + `app/robots.ts` driven by the same route data maps.
- Hero: DOM-rendered product mock (preferred) or pre-sized static-import image with
  `priority` + blur placeholder; remember `images.unoptimized = true` disables srcset.
- Reveals: transform/opacity within reserved boxes; reduced-motion respected; consent
  banner overlays, never inserts.
- Legal: ToS, Privacy (PIPEDA + Law 25 + CTIA non-sharing clause), AUP (SHAFT +
  no-purchased-lists), Sub-processors. Footer links to all four.

## Sources

Primary: [web.dev — Core Web Vitals](https://web.dev/articles/vitals) · [web.dev — LCP](https://web.dev/articles/lcp) · [Google — FAQPage deprecation](https://developers.google.com/search/docs/appearance/structured-data/faqpage) · [Google — SoftwareApplication](https://developers.google.com/search/docs/appearance/structured-data/software-app) · [Google — CWV & Search](https://developers.google.com/search/docs/appearance/core-web-vitals) · [Next.js — generateMetadata](https://nextjs.org/docs/app/api-reference/functions/generate-metadata) · [Next.js — metadata & OG images](https://nextjs.org/docs/app/getting-started/metadata-and-og-images) · [Next.js — opengraph-image](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image) · [Next.js — JSON-LD guide](https://nextjs.org/docs/app/guides/json-ld) · [Next.js — sitemap](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap) · [Next.js — robots](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots) · [Next.js — Image component](https://nextjs.org/docs/app/api-reference/components/image)

Peers/legal: [Textline sub-processors](https://www.textline.com/legal/sub-processors) · [Textline DPA](https://www.textline.com/legal/dpa) · [Heymarket AUP](https://www.heymarket.com/aup/) · [Heymarket 10DLC-compliant privacy help](https://help.heymarket.com/hc/en-us/articles/39191817486989-10DLC-Compliant-Privacy-Policy-Terms) · [Quo fair use](https://www.quo.com/fair-use) · [Telnyx AUP](https://telnyx.com/acceptable-use-policy) · [Telgorithm — 10DLC privacy policy guide](https://www.telgorithm.com/news/10dlc-and-your-privacy-policy) · [OPC — CASL compliance help](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/r_o_p/canadas-anti-spam-legislation/casl-compliance-help-for-businesses/) · [ISED — texting & CASL](https://ised-isde.canada.ca/site/canada-anti-spam-legislation/en/texting-good-client-relations) · [Fasken — Canada privacy/anti-spam overview](https://www.fasken.com/en/knowledge/doing-business-in-canada/12-privacy-anti-spam-laws) · [10dlc.org — SHAFT](https://www.10dlc.org/en/shaft)

Secondary (technique): [DebugBear — next/image optimization](https://www.debugbear.com/blog/nextjs-image-optimization) · [corewebvitals.io — scroll-triggered CLS](https://www.corewebvitals.io/pagespeed/scroll-triggered-animations-cause-cls) · [SpeedCurve — CLS guide](https://www.speedcurve.com/web-performance-guide/understanding-and-improving-cumulative-layout-shift/) · [Search Engine Land — FAQ rich results](https://searchengineland.com/google-to-no-longer-support-faq-rich-results-476957) · [Dykema — comparative advertising & nominative fair use](https://www.dykema.com/a/web/nzmvwJUKdkU9WpD6NEMbNs/8zzsZa/dykema-primercomparative-advertising-and-nominative-fair-use.pdf) · [Powered by Search — comparison pages](https://www.poweredbysearch.com/learn/best-saas-comparison-pages/) · [Breakline — scaled content abuse](https://www.breaklineagency.com/guide-to-googles-scaled-content-abuse/)
