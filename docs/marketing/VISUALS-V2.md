# Loonext Marketing — Visual Language v2 (BINDING, supersedes VISUALS.md art rules)

**Why:** the hand-built SVG/CSS "art" and the custom infographics read as inconsistent and
amateur, and Inter-only has no personality. This doc reverses that. It supersedes VISUALS.md
§1B/§1C/§1D (custom SVG illustrations + hand-drawn infographics) and the "no raster / no stock"
stance. Everything else (device frames for real screenshots, performance guardrails, honesty on
fake proof) still holds. Binding for all remaining marketing iterations.

The bar: real, professional, cohesive visuals with genuine personality — like a well-funded
brand hired a photographer, an illustrator, and a type designer. Not clip-art, not CSS shapes.

---

## 1. NO self-made art (hard rule)

- **DELETE** `components/marketing/art/**` (the hand-made SVG spot illustrations + infographics)
  and any decorative live-DOM/CSS "art" (fake shapes standing in for imagery). The "ledger spine"
  and CSS motif fussiness go too if they read as homemade — simplify to real visuals + type.
- Do NOT hand-author illustrations or infographics in SVG/HTML/CSS. Use REAL, professionally-made
  assets (below). Exception: tiny UI glyphs from a real icon library (Lucide/Phosphor) and CHARTS
  drawn by a real charting lib are fine — those are not "art," they're components.
- KEEP: real product screenshots (captured from the seeded app — those are real images) in the
  browser/phone frames; the interactive product demo (it's the real UI, not decoration).

## 2. Real images (photography)

- **Source:** Unsplash + Pexels (free commercial license) — curate authentic, warm, human
  tradespeople / service-business photography: a plumber on the phone at a job, a landscaper, a
  salon owner, hands + a phone showing texts, real work sites, a crew. Warm and genuine, NOT
  corporate-stock-cheese, NOT staged handshakes. Consistent color/warmth grade so the set feels
  curated by one art director.
- **Pipeline:** download the chosen shots, optimize to pre-sized WebP + AVIF at exact display
  sizes, `width`/`height` set (zero CLS), lazy below the fold, blur-up placeholder, `alt` text.
  Store under `apps/web/public/img/` with a manifest + a credits file (photographer + source) for
  attribution and license record. Commit the assets.
- **Honesty unchanged:** real illustrative photography is fine; still NO fake customer logos,
  testimonials, ratings, or invented metrics.

## 3. Real illustrations (one cohesive professional library)

- Pick ONE professionally-designed illustration system with warmth + personality (not flat
  corporate, not childish) and use it consistently — the inconsistency complaint means ONE style
  only. Candidates (validate license + fit in the research pass): **Storyset by Freepik** (huge,
  characterful, colorable to petrol, service-business scenes, free w/ attribution), **Open Peeps /
  Humaaans** (warm hand-drawn people), **absurd.design / Open Doodles** (quirky personality),
  **Blush**, **Icons8 Ouch!**. Prefer one that (a) covers our scenes (texting, team, number,
  Canada, compliance, jobs), (b) can be tinted toward petrol/stone for brand cohesion, (c) has a
  clear commercial license. Download the specific illustrations we use as assets (SVG/PNG from the
  library — real illustrator work, NOT hand-authored by us), optimize, commit + credit.

## 4. Real infographics

- Infographics = professionally-composed graphics, not crude hand-SVG. Build them from: the chosen
  illustration library + real data + a real chart library (a lightweight one) styled on-brand, or
  designed graphic panels combining real iconography/illustration + type. The missed-text-money,
  first-week timeline, coverage map, and pricing-comparison graphics get rebuilt this way (the
  MAP already moves to real Leaflet+OSM tiles per HOME-AND-VIEWS D25 — apply the same "real, not
  hand-drawn" principle to marketing infographics).

## 5. Typography with personality (BINDING)

- The marketing site gets a **characterful DISPLAY typeface** for headlines — personality, warmth,
  a little wonk — paired with a clean body. This is where the "fun/quirk/personality" lives.
  **Decision: `Fraunces`** (Google Fonts, variable, free) as the display face — a warm "old-style"
  serif with soft/wonky optical axes; premium but full of character; excellent for big friendly
  headlines. Body/UI stays a clean grotesque (keep Inter, or a warmer grotesque if the research
  finds a better pair). If research surfaces a stronger fit, alternatives: `Bricolage Grotesque`
  (quirky modern), `Instrument Serif`, `Cabinet Grotesk`. Pick ONE display + ONE body; self-host
  via next/font; use the display at large sizes only (headlines, the numeral moments), never body.
- Give the type real personality in USE too: confident scale jumps, characterful headline
  treatments (a highlighted word, an oversized lead), tasteful italics from the serif's character
  axis. No timid uniform Inter walls.
- **The APP stays calm Inter-only** (APP-UI-ELEVATION Wealthsimple restraint). The DISPLAY font is
  MARKETING-ONLY. Two surfaces, two voices: bold expressive marketing, calm premium app.

## 6. Personality beyond type

- Warmth and quirk in the details: a friendly tone (already in COPY), real human photography,
  characterful illustrations, playful-but-tasteful micro-moments, a distinctive accent usage.
  The site should feel like it has a point of view and a sense of humor — not a sterile template.
  Keep it tasteful and on-brand for tradespeople (confident + warm + a little fun; never
  cutesy/childish or designer-precious).

## 7. Performance still holds

- Real raster imagery is fine WITH the pipeline in §2 (pre-sized WebP/AVIF, width/height, lazy,
  blur-up). The hero LCP can be a real optimized image OR stay headline-text — decide per the hero
  redesign, but keep mobile Lighthouse ≥90 (target higher). Illustrations as inline SVG from the
  library are weightless. The display font is subset + `font-display: swap`. Don't let the visual
  richness tank CWV — optimize, lazy-load, subset.

## 8. Scope of the rebuild

Replace the self-made-art layer across the WHOLE marketing site (home + feature + trade + compare
+ legal headers): remove `components/marketing/art/**`, introduce the photography set + the chosen
illustration library + real infographics + the Fraunces display font, and re-treat every section
so it's genuinely visual and full of personality. Keep real product screenshots and the
interactive product demo. This is a marketing-only rework (no app/globals-token hue changes beyond
adding the marketing display font). Serialized as its own apps/web wave.
