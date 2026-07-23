# Loonext Marketing — Visual Art Direction (BINDING)

**Why this exists:** the site currently has no images, illustrations, or infographics — only
text and a few live-DOM widgets. It reads empty. Calm ≠ bare. Every marketing page from here
on must carry a real, crafted visual layer. This doc is binding for loop iterations 4+ and
overrides any earlier "no raster / live-DOM only" reading of BLUEPRINT.md. Performance is
preserved via the guardrails in §5, not by omitting visuals.

The bar: a first-time visitor should feel this looks like a top-tier 2026 SaaS site
(Linear / Stripe / Resend / Jobber tier), full of product and craft — not a text document.

---

## 1. Four visual asset types (use all four, everywhere appropriate)

### A. Real product screenshots (the #1 asset — competitors lead with these)
Honest captures of the ACTUAL running app with realistic seeded demo data.
- **Capture set** (desktop 1440 + mobile 390, light + dark): inbox list, open thread (with
  inbound/outbound/note/MMS + delivery states + a struck-through "done" message), contact
  panel, the compose flow, onboarding "setting-up" number reveal, a settings/usage meter,
  the mobile inbox + thread, a web-push notification.
- **Framing:** each screenshot sits in tasteful chrome — a browser frame (minimal, stone,
  petrol dot) for desktop shots, a clean phone frame for mobile shots. Add the ONE petrol
  glow behind, a soft 1px border, a subtle drop shadow, gentle tilt/perspective ONLY where
  it adds depth (hero, feature heroes) — most inline shots sit flat and calm.
- **Honesty:** real product, realistic-but-obviously-demo data (business "Mike's Plumbing",
  customers with plausible names/messages). Never a mocked-up screen showing capabilities
  the product lacks. Seed the data; capture the truth.

### B. Custom SVG spot illustrations (crafted, on-brand, vector)
For concepts a screenshot can't show. Hand-built inline SVG in the stone+petrol palette —
geometric, warm, confident line/fill style (think Stripe's restraint, not clip-art). Examples:
one-number-many-people, the truck/field-worker, the carrier-paperwork-handled shield,
Canada leaf/map motif, the "your text is a task" checkmark. A small consistent illustration
system (same stroke weight, same corner radius, same 2-3 color depth), NOT random clip art.

### C. SVG infographics / data-viz (the user explicitly asked for infographics)
Real information, drawn: the missed-text money math as an animated bar/coin visual; the
first-week timeline (Day 0 → live) as a designed rail; the how-it-works 3-step flow as a
connected diagram; a US+Canada coverage map (real, simple); a "flat price vs per-seat"
comparison chart on pricing; a segment/encoding explainer graphic. All inline SVG, themeable,
reduced-motion-aware.

### D. Texture & depth (kills the "empty" feeling)
Tasteful, subtle, never noisy: a faint dot-grid or topographic line texture in section
backgrounds; soft petrol→transparent gradient meshes behind key sections; a whisper of grain
on the dark band; layered cards with real elevation on overlays. One or two per section max —
depth, not decoration-for-its-own-sake.

## 2. Art direction

- **Palette:** stone-50/white base, petrol #0F766E as the single accent, teal-50 tints,
  amber only for the honesty/note accents. Illustrations use petrol + 1-2 stone tints + white.
- **Style:** calm, warm, premium, geometric. Rounded 10px language from the app. Generous
  negative space AROUND rich visuals (the richness is in the visuals, not in clutter).
- **Motion:** visuals animate once on scroll-in (300ms), respect `prefers-reduced-motion`
  (static final frame). Screenshots don't animate; illustrations/infographics may have one
  subtle reveal.
- **Dark mode:** every visual has a correct dark treatment (dark screenshots for dark mode,
  themeable SVG via currentColor / CSS vars).

## 3. Per-surface visual placement (minimum bar — add more where it helps)

- **Home hero:** the two-phones "plain text → structured conversation" live-DOM moment
  (LCP text stays text) PLUS the petrol glow + texture backdrop. Below hero: a framed real
  inbox screenshot as the first scroll reveal.
- **Home body:** every major section gets a visual — real screenshots for product sections
  (inbox, thread, mobile), the calculator infographic, the pricing comparison chart, the
  coverage map on the Canada band, spot illustrations on the problem/compliance sections,
  the dark PWA band shows a real phone-framed mobile screenshot.
- **Feature pages:** each opens with a framed hero screenshot of that feature's real screen,
  and carries 2-3 more visuals (screenshot or illustration or infographic) through the body.
  No feature page is text-only.
- **Trade pages:** each has a trade-specific hero visual (illustration or a screenshot with a
  trade-relevant scripted thread) + the live thread demo + at least one supporting graphic.
- **Comparison pages:** a designed comparison table (already planned) PLUS a small "at a
  glance" visual (e.g. flat-vs-per-seat chart) — not just a table on white.
- **Legal pages:** stay clean/text (correct) but get the branded header + a small motif so
  they don't feel orphaned.

## 4. Production plan (for the iteration that builds this)

1. **Screenshot pipeline:** boot the real seeded stack (Supabase + API + web dev), seed rich
   realistic demo data, drive the app with the Preview/Playwright tooling to capture the §1A
   set at 2× (desktop 1440, mobile 390), light + dark. Post-process to pre-sized WebP/AVIF,
   store under `apps/web/public/shots/` with explicit width/height. Commit the capture script
   so shots are reproducible.
2. **Illustration/infographic system:** build an SVG component library under
   `components/marketing/art/` — spot illustrations + infographics as React SVG components,
   themeable, reduced-motion-aware, with a shared visual grammar. No external image files for
   these (inline SVG = LCP-safe, themeable, crisp).
3. **Device frames:** a `<Frame variant="browser|phone">` component wrapping screenshots with
   the chrome + glow + border + optional tilt.
4. **Placement pass:** drop the visuals into every surface per §3.

## 5. Performance guardrails (visuals AND Lighthouse ~100 — both, not either)

- Hero LCP element stays **text** (the H1). Screenshots above/near the hero are pre-sized and
  do not become the LCP element.
- Raster screenshots: pre-sized WebP/AVIF static imports with explicit `width`/`height`
  (zero CLS), `loading="lazy"` + `decoding="async"` below the fold, a tiny blurred placeholder
  (build-time) to avoid pop-in. `images.unoptimized=true` means WE size them correctly at
  build time — export at the exact 1× and 2× display sizes; never ship a 3000px file into a
  600px slot.
- SVG illustrations/infographics are inline (no network, themeable, scale-free).
- Texture backgrounds are CSS or tiny inline SVG, never large raster.
- Re-run Lighthouse after the visual pass; performance/accessibility/best-practices/SEO must
  stay ≥95 (target 100). Visual richness and speed are BOTH required.

## 5b. Navigation & dropdowns — branded, NOT bare text (BINDING)

The current nav is bare text links and plain dropdown lists (just `<Link>{label}</Link>`).
That reads like a wireframe, not a brand. Rebuild it (iteration 4 owns this) to the standard
of Linear / Stripe / Vercel navs — the menu itself should feel designed and have personality.

**Enrich the data model first:** `nav-links.ts` items must carry `{ label, href, description,
icon }` (a lucide icon + a one-line plain-English description per item). Group where it helps.

**Desktop dropdowns = designed mega-menu panels, not text lists:**
- Rounded panel (10px), soft elevation + 1px border, generous padding, subtle enter animation
  (150–200ms fade+rise, reduced-motion safe), petrol focus/hover states.
- Each item is a two-line row: a petrol-tinted rounded icon chip on the left, the **label**
  (medium weight) on top, a muted **one-line description** beneath. Hover = teal-50 tint +
  petrol label + slight icon lift. Generous row height, real hit area.
- Multi-column where the list is long (Trades, Compare): a tidy 2-column grid.
- A **featured cell** in the Product/Features menu: a small petrol-tinted promo card ("The
  shared inbox" with a mini live-thread or a framed screenshot thumbnail + a "See it →" link)
  — this is the personality moment that makes the menu feel like a brand site.
- The Compare menu rows may show a tiny "vs" motif; the Trades menu rows use per-trade icons.

**Top-level bar:** keep it calm but give it life — the wordmark is the real brand treatment
(#206: the double-o mark + "Loonext" in Golos Text SemiBold, second o in the accent — see
`brand/README.md`), active/hover underline or pill in petrol, the primary CTA is the solid
petrol button, "Log in" is quiet. Sticky with the blur + on-scroll border is good; keep it.

**Mobile sheet:** not a flat text list — grouped sections with the same icons + descriptions,
comfortable spacing, section headers, the pinned petrol CTA at the bottom. Feels like the app.

**Footer** gets the same care: it's currently link columns; give it the wordmark mark, a short
brand line, the "Made in Canada 🇨🇦" motif, tidy grouped columns with adequate spacing, and
the theme toggle — a designed footer, not a raw sitemap.

The test: a visitor opening any dropdown should think "this is a real, polished brand," not
"this is a list of links." Bare-text dropdowns are a design-QA **major** from iteration 4 on.

## 6. Honesty rules (unchanged, absolute)

- Real product screenshots only. No stock photography. No fake dashboards, fake charts with
  invented numbers, fake logos, or fake testimonials. Demo data is clearly demo.
- Illustrations may be stylized but must not depict features the product doesn't have.
- Every infographic's numbers trace to SPEC, the research docs, or user-entered calculator
  input.
