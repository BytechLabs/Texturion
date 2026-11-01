# Lighthouse baseline, 2026-11-01 (mobile first load, #640)

**Status: RECORD (#640).** A dated performance baseline, kept so a later regression has something to be measured against. It is not a target and not direction. Re-run the audit rather than trusting these numbers.

Supersedes `lighthouse-2026-10-31.md` for `/` and `/pricing`. That record measured 99 and 100 locally while production scored 53 to 70 on the same day; the section "Why the October record did not predict production" explains the gap.

None of these numbers is production. The acceptance measurement for #640 is Lighthouse 13 against loonext.com after this ships, so #640 stays open until that run.

This is the third measuring round of the day. The first two sent requests toward telemetry hosts: the first sent PostHog pageviews to production, because the block list was one comma-joined flag, and the second let Chrome block PostHog's first batch instead of stopping the run. Their numbers are not used here.

## Method

- Lighthouse 13.4.0, Chrome 156 `--headless=new`, mobile form factor, simulated throttling, performance category only.
- Target: the production `next build` (Turbopack) served by `next start` on localhost, each build in its own `LOONEXT_DIST_DIR`, all four servers up at once.
- Before: `origin/main` at `0ea90656` (web 0.19.1, live on production since 2026-11-01). After: this branch at `5356999a`, built after the last source change. The CI after build is from `b25abcc8`; the one commit since only changes when PostHog starts, and the CI build has no PostHog key.
- Two environments for each side:
  - **prod-like**: production's public `NEXT_PUBLIC_APP_ORIGIN` and `NEXT_PUBLIC_BLOG_ORIGIN`, so the app links are absolute as on loonext.com and nothing prefetches `/signup` (checked in every report). GTM, PostHog and Sentry are set to placeholder values (`GTM-LH640PLACEHOLDER`, a fake `phc_` key, a DSN for project 0), so every telemetry code path ships as on loonext.com but no value names a real project. The primary measurement.
  - **ci**: the CI placeholder `NEXT_PUBLIC_*` values from `checks.yml`, no telemetry, no host split. Marketing links to `/signup` are relative here, so Next prefetches the signup route's bundle (2 requests in every ci report), which production never does.
- Every page goes through a local front, never straight from `next start`:
  - **h2**: HTTP/2 + TLS, brotli 11 and an in-memory static cache, the way Cloudflare serves production. The primary measurement.
  - **h1**: HTTP/1.1 with gzip and no cache, the transport of the earlier records. Kept for comparison: the transport alone moves LCP by about 1.2 s.
- The machine was shared with other work. During the first h2 prod-like series it ran at 62 to 100% CPU and TBT went up to 1.3 s; the second was taken once the load had dropped (3 to 66% at the end of each run). Both are reported. Lighthouse's Chrome, the servers and the fronts ran at high process priority, the same for before and after. LCP is not affected by the load: the after builds varied by under 0.15 s in every series.
- Medians of 5 runs (h2 prod-like) or 3 (h1 and ci). All configurations of a series ran in turn in every round, with the order reversed every other round. Runs Lighthouse rejected (`NO_NAVSTART`, a trace Chrome failed to record under load) were re-run, never counted.

### No request reached a telemetry service

- Every pattern is its own `--blocked-url-patterns=` argument: `*posthog.com*`, `*i.posthog.com*`, `*/ingest/*`, `*google-analytics.com*`, `*googletagmanager.com/a?*`, `*doubleclick*`, `*sentry.io*`, `*ingest.sentry*`, plus `*analytics.google.com*`, `*googletagmanager.com/td*`, `*google.com/ccm*` and `*cloudflareinsights.com*`.
- The front replaces the PostHog host and the placeholder DSN's host in every text response, at the same length, with paths on the front itself, and answers those paths without forwarding them. It also serves gtm.js: it fetches the public file for the placeholder container once, points every Google host inside it at the front, and answers the container's own pings there.
- The runner fails on any request in a report's network-requests audit that matches a telemetry host, whether it was answered, blocked or failed, and on a report whose `blockedUrlPatterns` is not the full list. The check was proved on a round-2 report, which it stopped on: its PostHog batch had been blocked by Chrome, not sent.
- Before the measured rounds, one pass on all 12 configurations: 0 telemetry matches and no request off localhost.
- The check stopped one series. With gtm.js still loaded from Google, the placeholder container sent its own load ping to `googletagmanager.com/a?` on one run; Chrome blocked it, and the runner stopped. That series, and the h2 series before it (no matches, but the same gtm.js setup), were discarded and the front changed to serve gtm.js itself. A first version of that change broke gtm.js (a host inside a regular expression); those runs were discarded too.
- Across all 79 reports of the proof pass and the series below: 0 telemetry matches. The front received the PostHog batches (95), one GTM ping and no Sentry envelope.

## Scores and key metrics

### h2 + brotli (production's transport), prod-like, medians of 5

Quieter machine:

| Page | Perf | FCP | LCP | TBT | CLS | Speed Index |
|---|---|---|---|---|---|---|
| `/` before | 80 | 1.20 s | 4.45 s | 230 ms | 0 | 2.25 s |
| `/` after | **95** | 1.20 s | **2.85 s** | 84 ms | 0 | 1.92 s |
| `/pricing` before | 83 | 0.98 s | 4.28 s | 198 ms | 0 | 1.64 s |
| `/pricing` after | **96** | 1.01 s | **2.71 s** | 77 ms | 0 | 1.24 s |

Per-run scores: `/` before 80, 80, 80, 81, 82; after 95, 96, 95, 95, 95. `/pricing` before 81, 83, 77, 87, 83; after 96, 96, 96, 95, 96.

Loaded machine (62 to 100% CPU):

| Page | Perf | FCP | LCP | TBT | CLS | Speed Index |
|---|---|---|---|---|---|---|
| `/` before | 60 | 1.20 s | 4.75 s | 1011 ms | 0 | 3.09 s |
| `/` after | 80 | 1.20 s | 2.90 s | 575 ms | 0 | 2.78 s |
| `/pricing` before | 61 | 1.10 s | 4.44 s | 1072 ms | 0 | 2.35 s |
| `/pricing` after | 84 | 1.11 s | 2.73 s | 490 ms | 0 | 1.70 s |

Per-run scores: `/` after 79, 80, 79, 85, 85. `/pricing` after 84, 75, 87, 78, 88. LCP was the same as on the quieter machine; TBT made the whole difference.

### h1 + gzip (the earlier records' transport), prod-like, medians of 3

| Page | Perf | FCP | LCP | TBT |
|---|---|---|---|---|
| `/` before | 72 | 1.53 s | 6.78 s | 243 ms |
| `/` after | **86** | 1.53 s | **4.08 s** | 90 ms |
| `/pricing` before | 74 | 1.38 s | 5.17 s | 307 ms |
| `/pricing` after | **87** | 1.38 s | **3.93 s** | 126 ms |

### h2 + brotli, ci (prefetches `/signup`), medians of 3

| Page | Perf | FCP | LCP | TBT |
|---|---|---|---|---|
| `/` before | 90 | 1.20 s | 3.47 s | 114 ms |
| `/` after | **94** | 1.20 s | **2.85 s** | 114 ms |
| `/pricing` before | 85 | 1.05 s | 3.30 s | 311 ms |
| `/pricing` after | **90** | 1.07 s | **2.73 s** | 294 ms |

**LCP element:** the hero sub-head paragraph (`p.fr-body`) on `/`, the header paragraph on `/pricing`, before and after.

**CLS:** 0 in every run.

**The p5 hero** still loads, after the LCP paint and the load event, as before.

## Where the blocking time comes from

Simulated long tasks between FCP and TTI, by the script that ran them, median blocking ms over 50 ms per task, h2 prod-like:

| | React and Next | other first-party | PostHog | Sentry | gtm.js |
|---|---|---|---|---|---|
| `/pricing` before, quieter | 104 | 0 | 35 | 54 | 0 |
| `/pricing` after, quieter | 0 | 58 | 0 | 0 | 0 |
| `/pricing` before, loaded | 105 | 280 | 266 | 178 | 33 |
| `/pricing` after, loaded | 111 | 167 | 121 | 13 | 36 |

On the loaded machine the deferred PostHog chunk is evaluated 0.3 to 1.0 s before TTI, so it still counts toward TBT. On the quieter one it ran after TTI on `/pricing` and added a median 10 ms on `/`. Evaluating it and starting it had been one task of up to 310 ms in round 2; init now runs in a task of its own (`posthog.ts`), and the two tasks are about 60 to 200 ms and 50 to 160 ms. On the loaded machine the after build's PostHog share is under half of the before build's, which evaluated the full chunk and Sentry's 117 KB one before hydration.

## What lands before the LCP paint

Lantern builds the simulated LCP from every request that finished before the LCP frame Chrome observed. Median KB transferred before that frame, prod-like over h2 (brotli):

| | Document | CSS | Fonts | Scripts | gtm.js | Other |
|---|---|---|---|---|---|---|
| `/` before | 28 | 20 | 239 | 379 | 0 | 8 |
| `/` after | 28 | 20 | 131 | 178 | 0 | 8 |
| `/pricing` before | 20 | 20 | 239 | 391 | 0 | 1 |
| `/pricing` after | 20 | 20 | 131 | 190 | 0 | 8 |

The 131 KB of fonts after is the three marketing faces (90 KB) plus Golos Text (42 KB), which Turbopack preloads on every page and the product demos on the marketing pages render.

### What the fonts are worth alone

Measured in round 2, whose prod-like runs had PostHog's first batch blocked by Chrome rather than sunk, so treat it as an estimate. The after build of `/` and `/pricing` through a front that answered the three marketing font URLs with the old files, 3 alternating rounds, prod-like over h2:

| | LCP with the new fonts | LCP with the old fonts |
|---|---|---|
| `/` | 2.90 s | 3.48 s |
| `/pricing` | 2.55 s | 3.18 s |

So about 0.6 s of the LCP gain is the fonts and the rest is the telemetry and script work.

## What changed

- **Sentry, PostHog and gtm.js wait for a marketing page to settle.** `instrumentation-client.ts` started both SDK downloads before hydration, and on a CDN both chunks arrived before the LCP frame, so both joined the simulated LCP. GTM's `afterInteractive` loader could do the same once the SDKs were gone.
  - "Settled" (`whenPageSettles()` in `lib/perf/after-lcp-and-load.ts`) is the LCP entry, the load event and one idle moment (at most 2 s), or the visitor's first tap, click or key press, whichever comes first, and 10 s after navigation start at the latest. The browser stops recording LCP at the first input, so releasing there costs nothing, and the deadline covers a page whose load event never fires.
  - Only marketing pages wait. On an app path (`lib/app-surface.ts`, the paths the D27 host split sends to app.loonext.com) both SDKs start at once, as before: no app page is scored.
  - Consent is unchanged. The GTM inline script still seeds the Consent Mode default and pushes the `gtm.js` event at once, before anything else can push. Only the download of gtm.js waits: the script leaves its loader on `window.__loonextGtm` and `<GtmBoot>` calls it, whichever runs first. The loader runs once per document and then leaves `"done"`, so the EN/FR switch and a return from the app, which remount the marketing shell, do not load the container again. Nothing is released once the shell unmounts; the tap that leaves for the app is itself a release, so on a single-host deploy gtm.js can still load as the document moves to the app, as it did before. In production the app is another host.
  - A landing URL with a campaign or ad click-id parameter (`utm_*`, `gclid`, `gbraid`, `wbraid`, `fbclid`, `msclkid` and the rest of PostHog's list) loads gtm.js at once, as before. Otherwise a visitor who followed a link before gtm.js ran would leave GA4 and Ads tags reading the next page's URL, without the click id. Lighthouse scores `/` and `/pricing` without such parameters.
  - PostHog stays cookieless and consent-free (D35). Events captured before the SDK is up wait for it. When a visitor follows a link to another page before the SDK starts, the SDK's first touch (`$initial_*`), the session's entry URL (`$session_entry_*`) and the session's campaign parameters are set from the landing page, and the landing `$pageview` goes out before the one for the page they moved to. An in-page anchor or a query change before then adds no pageview, as the SDK counts none. `posthog-landing.test.ts` checks this against the real posthog-js.
  - PostHog's init runs in its own task after its chunk evaluates (see "Where the blocking time comes from").
  - Sentry holds uncaught errors and unhandled rejections from before init (at most 10) and reports them with the mechanism its own global handlers use, so they still count as unhandled.
- **The Sentry chunk is 24 KB brotli, down from 117 KB** (427 to 78 KB raw). `import("@sentry/browser")` kept every export, Replay and rrweb included. The app imports `init` and `captureException` through `lib/observability/sentry-sdk.ts`, and `sentry.test.ts` fails on any other value import, side-effect import, `require` or re-export of the package.
- **zod left the marketing first load** (27 KB brotli). Marketing client code read `NEXT_PUBLIC_*` through `@/env`, whose schema is zod. It now reads `@/public-env`, literal `process.env` reads that Next inlines. The root layout still imports `@/env`, so a bad value still fails the build and every server render. `marketing-first-load.test.ts` walks `instrumentation-client.ts` as client code too, and fails on a client import of zod or `@/env`.
- **The marketing fonts are 90 KB instead of 198 KB, and draw the same pixels.** `apps/web/scripts/instance-marketing-fonts.mjs` narrows each file's variation axes to the values the CSS renders, from the untouched Google files in `apps/web/scripts/fonts-src/marketing/`, with fonttools 4.68.0 and brotli 1.2.1:
  - Bricolage Grotesque: wght pinned at 800 and wdth at 100, both the font's defaults, opsz 12 to 96 kept whole. 128.5 to 37.6 KiB.
  - Hanken Grotesk: wght 400 to 900. 33.9 to 23.6 KiB.
  - Spline Sans Mono: wght 400 to 700. 35.6 to 28.6 KiB.
  - The build is byte for byte reproducible: the script sets `SOURCE_DATE_EPOCH` and checks each output's SHA-256. Two separate virtualenvs gave the recorded hashes. Against the files the pixel diffs below were taken on, every table is identical except `head.modified` and its checksum.
  - The values come from a scan of the computed style of every text node on all 89 marketing routes at 390 and 1280 px: Bricolage only ever renders at 800, nothing sets a width, nothing renders below 400. `font-axes.test.ts` reads each shipped file's axes, fails on a marketing class or rule that asks for a dropped value, and fails wherever `font-display` is used without `font-extrabold` (the utility sets only the family). The `@font-face` weight ranges are unchanged, as `fr-tokens.test.ts` requires, so a display weight below 800 would now draw at 800 until the script keeps a wider range.
  - Identical, checked by pixel diff: `/`, `/pricing`, `/fr` and `/fr/tarifs` at 390 and 1280 px, full page, one build, with only the three font files swapped: 0 differing pixels in all 8. A control file (Hanken limited to wght 600) differed by 268,000 pixels, and another (Bricolage at 700, Spline at 500) by 796,000, so the diff sees a change in any of the three faces.
  - Glyph subsetting to EN and FR was measured and not done: on top of the axes it saves 4 to 5 KB per face, and it would drop letters such as á, ñ and ø that names in testimonials and posts can use.
- First-load script on `/`: 237 to 210 KB brotli. On `/pricing`: 248 to 222 KB (measured on the first round's build).

## Analytics changes on the deploy date

- PostHog's first `$pageview`, and every GTM tag on a landing without campaign parameters, GA4's page_view included, now start after the page settles or at the first input, about 0.1 to 0.4 s later than before in the first round's lab runs. A visitor who leaves before then is not counted. Expect a small step down in sessions and a step up in engagement rates in both tools from the deploy date, which is not a traffic change.
- A visitor without campaign parameters who follows a link before gtm.js runs: tags read the new page's URL. The `gtm.js` event carries the URL and referrer the visitor landed with, as `landing_page_location` and `landing_page_referrer`. Any GA4 or Ads tag added to the container later that must report the landing page has to read `page_location` from there (`docs/deploy/06-env-reference.md`). The live container has no tags today.
- Errors thrown before Sentry is up on a page the visitor leaves before it settles are not reported. Before, Sentry's download started before hydration.

## Why the October record did not predict production

The October runs measured LCP equal to FCP (1.51 s): the LCP frame was presented before the scripts finished, so Lantern left them out. Today, on the same kind of build and the same method, the before build measures LCP 3.7 to 6.8 s, because the frame now lands after the scripts have downloaded. Which of the two happens depends on timing in the unthrottled trace, which depends on the machine.

## Remaining gap

- With production's transport, the after builds' LCP is 2.7 to 2.9 s. On the quieter machine that scored 95 and 96 on every run. On the loaded machine TBT rose to 350 to 950 ms and `/pricing` scored 75 to 88, so on that series it did not reach 90. Production's TBT is not known until it is measured there, which is why #640 stays open.
- Over HTTP/1.1 and gzip the after LCP is 3.9 to 4.1 s and the score 86 to 87. Production does not serve that way.
- What is still before the LCP frame: 178 to 190 KB of first-party script (React DOM and the Next runtime are about 100 KB of it) and 131 KB of fonts.
- PostHog's chunk still evaluates before TTI. posthog-js ships a slim build at half the size (112 KB raw against 221 KB) without the extensions this config turns off; switching to it is not part of this change.
- Cloudflare's edge also injects a Web Analytics beacon on production (a zone setting, not in this repo), worth about 0.1 s of FCP there.
