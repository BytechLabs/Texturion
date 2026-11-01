# Lighthouse baseline, 2026-11-01 (mobile first load, #640)

**Status: RECORD (#640).** A dated performance baseline, kept so a later regression has something to be measured against. It is not a target and not direction. Re-run the audit rather than trusting these numbers.

Supersedes `lighthouse-2026-10-31.md` for `/` and `/pricing`. That record measured 99 and 100 locally while production scored 53 to 70 on the same day; the section "Why the October record did not predict production" explains the gap.

None of these numbers is production. The acceptance measurement for #640 is Lighthouse 13 against loonext.com after this ships, so #640 stays open until that run.

## Method

- Lighthouse 13.4.0, Chrome 156 `--headless=new`, mobile form factor, simulated throttling, performance category only.
- Target: the production `next build` (Turbopack) served by `next start` on localhost, each build in its own `LOONEXT_DIST_DIR`, all four servers up at once.
- Before: `origin/main` at `0ea90656` (web 0.19.1, live on production since 2026-11-01). After: this branch, built from the committed source.
- Two environments for each side:
  - **ci**: the CI placeholder `NEXT_PUBLIC_*` values from `checks.yml`, no telemetry, no host split. Marketing links to `/signup` are relative here, so Next prefetches the signup route's bundle, which production never does.
  - **prod-like**: the same placeholders plus production's public `NEXT_PUBLIC_APP_ORIGIN` and `NEXT_PUBLIC_BLOG_ORIGIN`, so the app links are absolute as on loonext.com and nothing prefetches `/signup` (checked in every report). GTM, PostHog and Sentry are set to placeholder values (`GTM-LH640PLACEHOLDER`, a fake `phc_` key, a DSN for project 0), so every telemetry code path ships as on loonext.com but no value names a real project.
- Two transports:
  - **h2**: an HTTP/2 + TLS front with brotli 11 and an in-memory static cache, the way Cloudflare serves production. This is the primary measurement.
  - **h1**: `next start` directly, HTTP/1.1 with gzip, the method of the earlier records. Kept for comparison: the transport alone moves LCP by about 1.2 s.
- Medians of 5 runs. All twelve configurations ran in turn in every round, with the order reversed every other round, so before and after saw the same machine load. Runs Lighthouse rejected (`NO_NAVSTART`, 7 of 67) were re-run, never counted.
- The machine was saturated by other work throughout. TBT is high and noisy, and it alone explains the spread of the scores. LCP is not noisy: the after builds varied by under 0.16 s across all runs.

### No request reached a telemetry service

The October runs and the first round of this record sent PostHog pageviews to production, because the block list was passed as one comma-joined flag. This time:

- Each pattern is its own `--blocked-url-patterns=` argument: `*posthog.com*`, `*i.posthog.com*`, `*/ingest/*`, `*google-analytics.com*`, `*googletagmanager.com/a?*`, `*doubleclick*`, `*sentry.io*`, `*ingest.sentry*`, plus `*analytics.google.com*`, `*googletagmanager.com/td*`, `*google.com/ccm*` and `*cloudflareinsights.com*`.
- Before measuring, one pass on each prod-like build listed every off-origin request. The only ones were the gtm.js script (a GET of a public file, for the placeholder container) and PostHog's first `/e/` batch. The DevTools log shows the PostHog request failed with `blockedReason: inspector`, with no request headers sent and no response: Chrome never put it on the wire.
- The runner checked every report: all 67 list the 12 patterns in `configSettings.blockedUrlPatterns`, and 46 telemetry requests were attempted and blocked, none answered. It stops the whole run on either failure.
- The keys are placeholders, so even an unblocked request would have named no real project.

## Scores and key metrics (medians of 5)

### h2 + brotli (production's transport)

| Page | Perf | FCP | LCP | TBT | CLS | Speed Index |
|---|---|---|---|---|---|---|
| `/` prod-like before | 67 | 1.20 s | 5.21 s | 516 ms | 0 | 2.72 s |
| `/` prod-like after | **93** | 1.20 s | **2.85 s** | 170 ms | 0 | 2.34 s |
| `/pricing` prod-like before | 78 | 1.03 s | 4.37 s | 317 ms | 0 | 1.94 s |
| `/pricing` prod-like after | **85** | 1.06 s | **2.70 s** | 478 ms | 0 | 1.70 s |
| `/` ci before | 78 | 1.21 s | 4.35 s | 418 ms | 0 | 2.94 s |
| `/` ci after | **94** | 1.20 s | **2.88 s** | 108 ms | 0 | 2.46 s |
| `/pricing` ci before | 90 | 1.04 s | 3.31 s | 154 ms | 0 | 1.52 s |
| `/pricing` ci after | **95** | 1.00 s | **2.78 s** | 109 ms | 0 | 1.44 s |

Per-run scores, prod-like: `/` before 76, 76, 67, 63, 60; after 95, 94, 93, 79, 81. `/pricing` before 82, 80, 78, 60, 63; after 95, 95, 81, 80, 85. Every after run of `/pricing` had LCP 2.55 to 2.71 s; the three below 90 had TBT of 402 to 662 ms from machine load, the two at 95 had 117 and 121 ms.

### h1 + gzip (`next start` directly, the earlier records' method)

| Page | Perf | FCP | LCP | TBT |
|---|---|---|---|---|
| `/` prod-like before | 72 | 1.51 s | 6.34 s | 256 ms |
| `/` prod-like after | **85** | 1.51 s | **4.07 s** | 154 ms |
| `/pricing` prod-like before | 74 | 1.36 s | 5.16 s | 260 ms |
| `/pricing` prod-like after | **87** | 1.36 s | **3.89 s** | 123 ms |

**LCP element:** the hero sub-head paragraph (`p.fr-body`) on `/`, the header paragraph on `/pricing`, before and after.

**CLS:** 0 in every run.

**The p5 hero** still loads, after the LCP paint and the load event, as before.

## What lands before the LCP paint

Lantern builds the simulated LCP from every request that finished before the LCP frame Chrome observed. Median KB transferred before that frame, prod-like over h2 (brotli):

| | Document | CSS | Fonts | Scripts | gtm.js | Other |
|---|---|---|---|---|---|---|
| `/` before | 28 | 20 | 239 | 379 | 0 | 8 |
| `/` after | 28 | 21 | 131 | 177 | 0 | 8 |
| `/pricing` before | 20 | 20 | 239 | 391 | 0 | 1 |
| `/pricing` after | 20 | 21 | 131 | 189 | 0 | 8 |

The 131 KB of fonts after is the three marketing faces (90 KB) plus Golos Text (42 KB), which Turbopack preloads on every page and the product demos on the marketing pages render.

### What the fonts are worth alone

The after build of `/` and `/pricing` served through a front that answers the three marketing font URLs with the old files, 3 alternating rounds, prod-like over h2:

| | LCP with the new fonts | LCP with the old fonts |
|---|---|---|
| `/` | 2.90 s | 3.48 s |
| `/pricing` | 2.55 s | 3.18 s |

So about 0.6 s of the LCP gain is the fonts and the rest is the telemetry and script work.

## What changed

- **Sentry, PostHog and gtm.js wait for a marketing page to settle.** `instrumentation-client.ts` started both SDK downloads before hydration, and on a CDN both chunks arrived before the LCP frame, so both joined the simulated LCP. GTM's `afterInteractive` loader could do the same once the SDKs were gone.
  - "Settled" (`whenPageSettles()` in `lib/perf/after-lcp-and-load.ts`) is the LCP entry, the load event and one idle moment (at most 2 s), or the visitor's first tap, click or key press, whichever comes first, and 10 s after navigation start at the latest. The browser stops recording LCP at the first input, so releasing there costs nothing, and the deadline covers a page whose load event never fires.
  - Only marketing pages wait. On an app path (`lib/app-surface.ts`, the paths the D27 host split sends to app.loonext.com) both SDKs start at once, as before: no app page is scored.
  - Consent is unchanged. The GTM inline script still seeds the Consent Mode default and pushes the `gtm.js` event at once, before anything else can push. Only the download of gtm.js waits: the script leaves its loader on `window.__loonextGtm` and `<GtmBoot>` calls it, whichever runs first. The loader runs once per document and then leaves `"done"`, so the EN/FR switch and a return from the app, which remount the marketing shell, do not load the container again. Nothing is released once the shell unmounts, so a visitor who reaches the app first never gets the container there (#577).
  - PostHog stays cookieless and consent-free (D35). Events captured before the SDK is up wait for it. When a visitor follows a link before the SDK starts, it records the landing page first, with its UTM and click-id parameters kept for the session, then the page they moved to, as it did before. In a browser check on the two prod-like builds (`/?utm_source=…&gclid=…`, a click to `/pricing` right after hydration, PostHog answered locally), both builds sent the landing `$pageview` with `utm_source` and `gclid`, then `/pricing`.
  - Sentry holds uncaught errors and unhandled rejections from before init (at most 10) and reports them with the mechanism its own global handlers use, so they still count as unhandled. In the same browser check, the before build reported one of the two early errors, the after build both, each `handled: false`.
- **The Sentry chunk is 24 KB brotli, down from 117 KB** (427 to 78 KB raw). `import("@sentry/browser")` kept every export, Replay and rrweb included. The app imports `init` and `captureException` through `lib/observability/sentry-sdk.ts`, and `sentry.test.ts` fails on any other value import or re-export of the package.
- **zod left the marketing first load** (27 KB brotli). Marketing client code read `NEXT_PUBLIC_*` through `@/env`, whose schema is zod. It now reads `@/public-env`, literal `process.env` reads that Next inlines. The root layout still imports `@/env`, so a bad value still fails the build and every server render. `marketing-first-load.test.ts` walks `instrumentation-client.ts` as client code too, and fails on a client import of zod or `@/env`.
- **The marketing fonts are 90 KB instead of 198 KB, and draw the same pixels.** `apps/web/scripts/instance-marketing-fonts.mjs` narrows each file's variation axes to the values the CSS renders, from the untouched Google files in `apps/web/scripts/fonts-src/marketing/` (fonttools 4.68.0):
  - Bricolage Grotesque: wght pinned at 800 and wdth at 100, both the font's defaults, opsz 12 to 96 kept whole. 128.5 to 37.5 KiB.
  - Hanken Grotesk: wght 400 to 900. 33.9 to 23.6 KiB.
  - Spline Sans Mono: wght 400 to 700. 35.6 to 28.6 KiB.
  - The values come from a scan of the computed style of every text node on all 89 marketing routes at 390 and 1280 px: Bricolage only ever renders at 800, nothing sets a width, nothing renders below 400. `font-axes.test.ts` fails on a class or rule that asks for a dropped value. The `@font-face` weight ranges are unchanged, as `fr-tokens.test.ts` requires, so a display weight below 800 would now draw at 800 until the script keeps a wider range.
  - Identical, checked by pixel diff: `/`, `/pricing`, `/fr` and `/fr/tarifs` at 390 and 1280 px, full page, one build, with only the three font files swapped: 0 differing pixels in all 8. A control file (Hanken limited to wght 600) differed by 268,000 pixels, and another (Bricolage at 700, Spline at 500) by 796,000, so the diff sees a change in any of the three faces. The before and after builds themselves also match, except where the before build differs from itself between two loads (the p5 hero frame at 1280 px).
  - Glyph subsetting to EN and FR was measured and not done: on top of the axes it saves 4 to 5 KB per face, and it would drop letters such as á, ñ and ø that names in testimonials and posts can use.
- First-load script on `/`: 237 to 210 KB brotli. On `/pricing`: 248 to 222 KB (measured on the first round's build).

## Analytics timing changes on the deploy date

These are timing only; what is collected, and under what consent, is unchanged.

- PostHog's first `$pageview` and every GTM tag, GA4's page_view included, now start after the page settles or at the first input, about 0.1 to 0.4 s later than before in the first round's lab runs. A visitor who leaves before then is not counted. Expect a small step down in sessions and a step up in engagement rates in both tools from the deploy date, which is not a traffic change.
- A visitor who follows a link before gtm.js runs: tags read the new page's URL. The `gtm.js` event carries the URL and referrer the visitor landed with, as `landing_page_location` and `landing_page_referrer`; a GA4 or Ads tag that needs the landing page or its click ids must read them from there. The live container has no tags today.
- Errors thrown before Sentry is up on a page the visitor leaves before it settles are not reported. Before, Sentry's download started before hydration.

## Why the October record did not predict production

The October runs measured LCP equal to FCP (1.51 s): the LCP frame was presented before the scripts finished, so Lantern left them out. Today, on the same kind of build and the same method, the before build measures LCP 4.4 to 6.3 s, because the frame now lands after the scripts have downloaded. Which of the two happens depends on timing in the unthrottled trace, which depends on the machine.

## Remaining gap

- With production's transport, the after builds' LCP is 2.7 to 2.9 s, inside the 90 band; the score then turns on TBT. On this machine TBT swung from about 100 to 660 ms with load, which is the whole spread between 79 and 95. What production's TBT will be is not known until it is measured there.
- Over HTTP/1.1 and gzip the after LCP is 3.9 to 4.1 s and the score 85 to 87. Production does not serve that way.
- What is still before the LCP frame: 177 to 189 KB of first-party script (React DOM and the Next runtime are about 100 KB of it) and 131 KB of fonts.
- Cloudflare's edge also injects a Web Analytics beacon on production (a zone setting, not in this repo), worth about 0.1 s of FCP there.
