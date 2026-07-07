# Lighthouse baseline — 2026-07-07 (post v3 restyle, launch candidate)

Supersedes `lighthouse-iter3.md` (which audited the retired "two-phones" hero).
Run after the full v3 "Quiet daylight" restyle (#27), the pricing-truth wave
(#24/#28), and the marketing leaf-visual migration — i.e. the site as it will
launch.

## Method

- Lighthouse 12 (`npx lighthouse@12`), headless Chrome (`--headless=new`),
  default mobile emulation + simulated throttling.
- Target: the production `next build` output served by `next start` on
  localhost (no CDN, no Brotli/edge caching — Cloudflare will only improve the
  performance numbers in production).

## Scores

| Page | Performance | Accessibility | Best Practices | SEO |
|---|---|---|---|---|
| `/` (home) | 90 | 100 | 100 | 100 |
| `/pricing` | 90 | 100 | 100 | 100 |

## Key metrics (mobile, simulated throttling)

| Metric | `/` | `/pricing` |
|---|---|---|
| First Contentful Paint | 2.1 s | 2.2 s |
| Largest Contentful Paint | 3.3 s | 3.3 s |
| Total Blocking Time | 80 ms | 70 ms |
| Cumulative Layout Shift | **0** | **0** |

## Notes

- **CLS 0 on both pages** — the pre-sized AVIF/WebP + blur-up image discipline
  and the text-node LCP survived the restyle.
- The prior SEO deduction (`link-text`: the one-word "Start" CTA is on
  Lighthouse's generic-text blocklist) was fixed by renaming the persistent
  CTA to **"Start now"** (nav, mobile-nav sheet, footer) with a descriptive
  `aria-label` — copy-deck voice preserved, audit clean.
- Remaining performance headroom (the 10 points): ~3.3 s simulated-mobile LCP
  driven by render-critical CSS/JS on localhost without edge caching, and
  ~77 KiB unused JS flagged on home. Neither is a launch blocker; production
  Cloudflare (HTTP/3, Brotli, edge cache) measures faster than local
  `next start`. Re-measure on the live origin after deploy and record it here.
