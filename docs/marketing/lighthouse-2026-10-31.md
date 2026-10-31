# Lighthouse baseline, 2026-10-31 (mobile first load, #640)

**Status: RECORD (#640).** A dated performance baseline, kept so a later regression has something to be measured against. It is not a target and not direction. Re-run the audit rather than trusting these numbers.

Supersedes `lighthouse-2026-07-07.md` for `/` and `/pricing`, and adds `/fr` and `/fr/tarifs`.

## Method

- Lighthouse 13.6.0, Chrome stable `--headless=new`, default mobile emulation, simulated throttling, performance category only.
- Target: the production `next build` (Turbopack) served by `next start` on localhost, built with the CI placeholder `NEXT_PUBLIC_*` values (no GTM, PostHog or Sentry). Each build in its own `LOONEXT_DIST_DIR`, both servers up at once.
- A/B runs alternate before and after on every iteration, so both sides see the same machine load. Medians of 5 runs for the home pages and 3 for pricing. Runs Lighthouse rejected (`NO_FCP`, `NO_NAVSTART`) were re-run, never counted.
- Before: `b0f6eb02`. After: this change.

## Scores and key metrics (medians)

| Page | Perf | FCP | LCP | TBT | CLS | Speed Index |
|---|---|---|---|---|---|---|
| `/` before | 96 | 1.51 s | 1.51 s | 191 ms | 0 | 2.70 s |
| `/` after | **99** | 1.51 s | 1.51 s | **104 ms** | 0 | **2.40 s** |
| `/fr` before | 96 | 1.51 s | 1.51 s | 219 ms | 0 | 2.79 s |
| `/fr` after | **99** | 1.51 s | 1.51 s | **111 ms** | 0 | **2.37 s** |
| `/pricing` before | 99 | 1.36 s | 1.36 s | 115 ms | 0 | 1.44 s |
| `/pricing` after | **100** | 1.36 s | 1.36 s | **44 ms** | 0 | 1.46 s |
| `/fr/tarifs` before | 98 | 1.36 s | 1.36 s | 156 ms | 0 | 1.36 s |
| `/fr/tarifs` after | **99** | 1.36 s | 1.36 s | **98 ms** | 0 | 1.36 s |

Earlier in the same session, with the machine busier, an intermediate build (everything here except the pricing and boundary splits and the load gate) measured `/` 92 → 96 (TBT 310 → 191 ms) and `/fr` 86 → 96 (TBT 505 → 197 ms), 5 runs each. TBT is where the builds differ, and TBT grows with machine load.

With applied throttling (`--throttling-method=devtools`, 3 runs, same intermediate build) `/` was 68 → 67 and `/fr` 59 → 73. Applied throttling runs real network and CPU limits and is far noisier; it is recorded, not compared against.

**LCP element, before and after:** the hero sub-head paragraph (`<p class="fr-body …">`), not the H1. On a 412 px viewport the paragraph has the larger area. P5-SIGNATURE.md acceptance test 1 names the H1; it was already the paragraph before this change.

**CLS:** 0 in every run, on all four pages.

## What changed (bytes on the first load)

| | Before | After |
|---|---|---|
| `/` and `/fr` script, gzip | 479 KB (19 files) | 280 KB (17 files) |
| `/pricing` and `/fr/tarifs` script, gzip | 491 KB | 293 KB |
| p5 chunk (lazy, after load), gzip | 318 KB | 124 KB |
| Fonts preloaded | 244 KB (4 faces) | unchanged |
| Stylesheets, gzip | 26 KB | unchanged |

- **The app catalogue left the marketing first load** (591 KB raw in the before build, both languages). Three imports carried it: the root error boundaries (`useT()`), the mobile nav sheet (`components/ui/sheet.tsx`), and the thread demos' `formatCallDuration` import from `lib/format/call.ts`, which imports `@/i18n/provider`. A server component importing a `"use client"` module makes it a client reference, and Next ships every client reference a page's server graph imports, rendered or not.
- **The home catalogue left the client** (the whole home page, both languages). The hero inbox now gets its rows from the server; the pricing page's plan builder and country toggle import `fill` from `i18n/marketing/fill.ts`.
- **p5 is composed from its core** (`hero/p5-lean.ts`): shape, color, math and accessibility instead of the full browser build. The field draws as before (checked in the built pages at 390 and 1280 px); Lighthouse's script time for the p5 chunk went from a median of 842 ms to 598 ms on `/`.
- **The p5 download waits for the window load** as well as the LCP entry, so it no longer shares the connection with the page's own fonts and hydration chunks.
- Guard: `apps/web/src/app/marketing-first-load.test.ts` walks the static import graph of `/`, `/fr`, `/pricing` and `/fr/tarifs` and fails on any of the above coming back.

## Not reproduced, and why it matters

The issue measured LCP 5.7–5.8 s and scores of 64–76 on 2026-10-30. On this machine the before build measured LCP between 1.51 and 1.55 s in every valid run, including runs under a 28-thread CPU burn. Lantern builds the simulated LCP from every request that finished, and every script that started evaluating, before the LCP paint it observed. When the observed paint lands before the scripts run, LCP is the document, the stylesheets and the four fonts: about 320 KB at the simulated 1.6 Mbps, which is the 1.51 s here. When the scripts run first, all of them join the LCP graph: 479 KB of gzip script on top of those 320 KB, plus its parse time, would put LCP in the 5.8 s range the issue saw. That second case is an inference from how Lantern works; no run here produced it. Which of the two happens depends on timing in the unthrottled trace. The change above cuts what the second case costs by about 200 KB of script and the matching CPU; it does not make the first case faster, because that case was never paying for script.

## Remaining headroom

- **Fonts are about three quarters of the bytes before LCP** (247 of about 320 KB transferred). Bricolage alone is 132 KB, as a variable font with opsz, wdth and wght axes. Any change here is a type decision (DESIGN-DIRECTION §3), not a performance tweak.
- **`@loonext/shared` has no `sideEffects` field**, so the referral capture in the root layout keeps the whole package barrel, including the 40 KB area-code table, on every page. Adding the package to `optimizePackageImports` was tried and changed nothing under Turbopack: the chunk was byte-identical. Declaring `"sideEffects": false` in `packages/shared/package.json` is the likely fix and was not tried here.
- **The calculator and crew-size slider islands** still import the home catalogue in both languages. They load lazily, on approach, so they are not in these numbers.
- **The inline RSC payload** is about 144 KB of the 242 KB home HTML.
- After LCP, Next prefetches `/signup` and `/pricing` for the hero's two links, and those prefetches download the app catalogue chunk (the signup route uses it; the pricing route no longer does). That is navigation cost, not first-load cost.
