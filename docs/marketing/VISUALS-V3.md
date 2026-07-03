# JobText Marketing — Visual Identity v3 (BINDING, supersedes v2 on type + imagery)

**Why:** v2 swapped in Fraunces and generic stock photos — but a font swap isn't personality,
and stock photography isn't an *owned* identity. v3 defines a distinctive, ownable look with real
typographic personality and a consistent stylized image treatment that is unmistakably ours.
Supersedes VISUALS-V2 §2 (raw stock photos) and §5 (font-swap-only). The "no self-made amateur
SVG art" rule (v2 §1) and performance guardrails still hold.

The identity in one line: **"annotated editorial"** — a confident serif voice, marked up by hand
like a shop owner's notes, over warm duotone imagery in our own petrol/cream palette.

---

## 1. Typography — an EXPRESSIVE editorial system (not just a font)

**Faces:** Fraunces (display — a warm, characterful serif with a *gorgeous italic axis*) + Inter
(body/UI). Fraunces is beautiful; the personality comes from how it's USED. If design-QA finds
Fraunces isn't landing on a given surface, Newsreader or Instrument Serif are sanctioned
alternates — but ONE display face across the site.

**Headlines are composed, not typed.** Every hero/section headline mixes emphasis for rhythm and
voice. The concrete devices (use 2-3 per headline, never all):
- **Italic emphasis** — set the emotional/key word in Fraunces *italic* (its italic is the whole
  point): "Never *miss* a customer text again."
- **Highlighter swipe** — a hand-drawn petrol/amber highlighter mark behind a key word: a slightly
  rotated, soft-edged CSS/inline-SVG swipe (imperfect, marker-like), sitting *behind* the glyphs.
- **Marker underline / circle** — a rough hand-drawn petrol underline or lasso-circle on one word
  (inline SVG stroke with a slightly wobbly path; animates on scroll-in once, reduced-motion static).
- **Scale + weight contrast** — one oversized lead word or number (the $29, the day-count) at a
  dramatic size; the rest calmer. Weight jumps within a line (600 next to 400).
- **Color accent** — a single key word in petrol (rationed — one per headline max).
- **Editorial pull-quote / drop-cap** — occasional, on longer sections, for magazine feel.

Provide a `<Display>` headline component that composes these (props: `italic`, `highlight`,
`underline`, `circle`, `accent` on marked spans) so treatments are consistent + reusable, not
one-off. 6+ real headline treatments across the home page; no timid uniform lines anywhere.

**The marker language ties type + image together** — the same hand-drawn petrol marker
(underlines, circles, arrows, checkmarks, little annotations like "← your crew sees this") appears
on headlines AND as annotations pointing at product screenshots/images. This "someone marked this
up by hand" voice is the ownable personality. Keep it tasteful and confident (a few per page), not
scrapbook-busy.

## 2. Imagery — a stylized, OWNED treatment (not generic stock)

Real photography is fine as a SOURCE, but it must be processed into ONE consistent branded look so
it reads as our identity, never as stock:
- **Duotone grade (the core move):** convert every photo to a two-tone grade in our palette —
  petrol `#0F766E` in the shadows, warm cream/stone in the highlights (a third light accent only if
  needed). Consistent across every image → instantly "ours" (à la the Spotify/Stripe-early duotone
  brand move). Process at build time (sharp duotone, or an SVG `feColorMatrix`/`feComponentTransfer`
  duotone filter applied consistently) — commit the processed assets.
- **Grain + halftone:** a subtle film grain and/or a halftone-dot texture layer for editorial
  character and cohesion.
- **Consistent frame language:** one treatment for all imagery — a thin petrol keyline, a slight
  intentional tilt on hero images, a Fraunces-italic caption, and the marker annotations from §1.3
  pointing at the meaningful part.
- **Drop the generic illustration library.** Replace flat library illustrations with (a) the duotone
  photography system, (b) real product screenshots (kept, framed + optionally duotone-tinted for
  cohesion), and (c) a SMALL custom editorial graphic language — the marker motifs (underline,
  circle, arrow, check, halftone, a recurring petrol shape). This minimal deliberate graphic
  language is intentional and consistent (NOT amateur spot-illustrations). If a true illustration is
  ever needed, commission-grade single-style only — never a mixed library.
- Curate photos that duotone well (clear subject, good contrast): real tradespeople, hands + phone,
  a truck, a job site, a crew — but the DUOTONE + grain + marker treatment is what makes them ours.

## 3. Cohesion rules

- ONE display face, ONE duotone grade, ONE marker language, ONE palette — applied everywhere so the
  site is unmistakably one identity (the v2 inconsistency complaint dies here).
- The APP stays calm Inter (no Fraunces, no marker, no duotone) — this expressive identity is
  MARKETING ONLY. Two surfaces, two voices.
- Warmth + confidence + a little wit; never scrapbook-messy, childish, or corporate-stock.

## 4. Performance (still ≥90 mobile, target higher)

- Duotone/grain baked into pre-sized WebP/AVIF at build (width/height, lazy, blur-up) — no runtime
  filter cost on the image itself; CSS/SVG filters only where cheap and above-the-fold-safe.
- Marker SVGs are tiny inline strokes (weightless). Fraunces subset + `font-display: swap`.
- Hero LCP stays the H1 text (now expressively styled) or a pre-sized priority duotone image.

## 5. Scope

A marketing-only rework: build the `<Display>` expressive-headline component + the marker graphic
language, re-grade the photo set to duotone (+ grain), apply the annotated-editorial treatment
across home + feature/trade/compare, and retire the generic illustration library. Serialized as its
own apps/web wave. Honesty unchanged (no fake proof; real photos, branded-graded).
