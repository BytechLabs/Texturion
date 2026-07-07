# v4 redo: purge list + coverage map

## Purge list (every meta/self-referential string dies)

# PURGE LIST — every meta/self-referential string, with replacements

Rule being enforced (Law 1): a customer never sees the site talk about itself as an artifact. Labels may describe CONTENT (a conversation is scripted); they may never describe the ARTIFACT (fonts, framework, "real interface", "not a screenshot", what the site does or doesn't fake).

1. `apps/web/src/components/marketing/night/night-shift.tsx:156` — "Demo thread. This is the real interface." → REPLACE with the mono chip `SCRIPTED DEMO` (Frost ground, Spline Sans Mono, ink text). No sentence.
2. `apps/web/src/components/marketing/night/night-shift.tsx:128-129` — "9:47 pm to 7:00 am, in the real interface. Nothing here is a screenshot." → REPLACE with: "9:47 pm to 7:00 am: a lead comes in after close and gets booked before the first coffee." (Describes the content, not the artifact.)
3. `apps/web/src/components/marketing/thread-demo/thread-deep-dive.tsx:179` — "Demo, scripted conversation, real interface." → REPLACE with the `SCRIPTED DEMO` chip.
4. `apps/web/src/components/marketing/thread-demo/thread-deep-dive-static.tsx:70` — same string → same `SCRIPTED DEMO` chip (keep the two files in sync).
5. `apps/web/src/components/marketing/trades/trade-thread.tsx:145-146` — "Example, real interface. Tap any message to mark it done; the whole crew sees what's handled." → REPLACE with: chip `EXAMPLE CONVERSATION` plus the caption "Tap any message to mark it done. The whole crew sees what's handled." (Also removes the semicolon-spliced sentence; note the doc comment at line 12 references the old label and should be updated to match.)
6. `apps/web/src/components/marketing/footer.tsx:214-215` — "Set in Besley by Owen Earl, Public Sans by USWDS, and Martian Mono by Evil Martians. Built with Next.js. No stock photos, no fake reviews." → DELETE the entire line and its container. No replacement. Nothing about fonts, frameworks, or what we don't fake, anywhere, ever.
7. `apps/web/src/lib/marketing/business.ts:47` — "Business name and mailing address pending, added before launch." → DELETE the fallback string; when ops has not supplied the legal entity and mailing address, render nothing (the footer identity block is conditionally omitted). Never ship a placeholder sentence to customers.
8. `docs/marketing/COPY.md §H4 line 120` — honesty label "Demo — scripted conversation, real interface." → superseded by COPY-DECK v2: the `SCRIPTED DEMO` chip.
9. `docs/marketing/COPY.md §P line 645` — "(Rendered in the real thread UI, static. Labeled: Example conversation — real interface.)" → superseded: label is `EXAMPLE CONVERSATION` only.
10. Home §H9 link copy (currently "See full pricing and the fine print we put in large print") → REPLACE with "See full pricing. Every cost is on that page." (The old line comments on the site's own typography.)
11. §H8 calculator lead (currently "...we don't quote industry stats we can't stand behind.") → TRIM to "This is arithmetic on your numbers, not a claim of ours. Change any of them. We only multiply what you type." (Keeps the trust posture, stops narrating our own marketing ethics.)
12. Any aria-labels or SR text containing "real interface" or "demo" phrasing that describes the artifact → aria-labels describe content only, e.g. "A Reyes Plumbing conversation in the Loonext inbox" (the existing label at night-shift.tsx:62 is fine and is the pattern).

**Sweep clauses (run before ship, treat hits as bugs):**
- `grep -ri "real interface\|not a screenshot\|no stock photos\|fake reviews\|set in \|built with next\|pending, added before launch" apps/web/src` over RENDERED strings must return zero.
- Em-dash sweep per Law 6: `grep -rn "—" apps/web/src` and hand-convert every customer-facing hit (copy, metadata, aria, alt, legal). En-dash ranges ("3–7", "9–11", "2–3") convert to "to"/"between...and" phrasing.
- The word "honest/honesty" may not appear in customer-facing copy as self-description (saying "we're honest" is the site talking about itself). Show it: the Truth Strip carries the facts without adjectives. (Current offenders are mostly code comments, which may stay.)


## Coverage map (all 25 routes)

# COVERAGE MAP — all 25 routes + nav/footer

| Route | Template (v4 §6) | Dateline | Treatment / redo scope |
|---|---|---|---|
| / | HOME (12 bands) | `9:04 PM · TUESDAY` | Full rebuild: new palette/type, Arrival Field p5 (only live canvas on site), real inbox + thread + meter + template picker embeds with app tokens, full COPY-DECK v2 home copy, purges 1, 2, 3, 4, 6, 7, 10, 11 |
| /pricing | PRICING | `$58 FIRST MONTH (US) · $29 AFTER` | Restage §PR in v4 kit: plan cards, Honesty Ledger, first-week timeline with Flare tab, real segment counter + usage meter, slider, guarantee, FAQ; dash conversion throughout |
| /canada | CANADA | `DAY ONE · NO WAIT` | Flipped timeline leads (green Day 0, no wait segment), province ledger, CASL notes, USD Truth Strip |
| /compare | COMPARE index | `3 PEOPLE · 500 TEXTS · JULY 2026` | Honesty Ledger centerpiece (sourced July 2026 figures), honest-fit section, switching Truth Strip |
| /compare/heymarket | COMPARE | `$49/USER/MO · THEIR PUBLISHED STARTER SEAT` | Ledger math $172 vs $29; "when Heymarket fits" kept |
| /compare/podium | COMPARE | `MONTHLY TOTAL: ASK THEIR SALES TEAM` | "Not published" column as the argument; honest bundle concession |
| /compare/quo | COMPARE | `$19/USER/MO + 1¢/TEXT` | Ledger with metered texting + $5/number; their $19.50 registration disclosure footnoted |
| /contact | CONTACT | `A REAL PERSON ANSWERS` | Composer-styled work-order form, founder reply promise (verify reply-time with ops) |
| /features/shared-inbox | FEATURE | `1 OWNER PER CONVERSATION` | Real inbox staged mid-task in Panel Frame; inbound-free Truth Strip |
| /features/business-number | FEATURE | `THE NUMBER BELONGS TO THE BUSINESS` | Number pick + free porting story + Pro second number; first-week Truth Strip |
| /features/compliance | FEATURE | `STOP MEANS STOP · INSTANTLY` | Four proof points, late-night send check, real registration stepper in "In review" state |
| /features/templates-and-tags | FEATURE | `TYPE / · TAP · SENT` | Real template picker (variables + preview) + real tag pills + mark-done |
| /for/plumbers | TRADE (master) | `9:04 PM · BASEMENT DRAIN` | §P restaged; `EXAMPLE CONVERSATION` chip; saved replies in real picker; purge 5 |
| /for/hvac | TRADE | `6:48 AM · NO HEAT` | Master template, HVAC script/nouns/FAQ |
| /for/landscapers | TRADE | `7:15 AM · GATE LOCKED` | Master template, landscaping script/use cases |
| /for/cleaners | TRADE | `5:56 PM · KEY UNDER MAT?` | Master template, access-notes emphasis |
| /for/salons | TRADE | `11:20 AM · RUNNING LATE` | Master template, front-desk framing, no integration claims |
| /for/contractors | TRADE | `8:02 AM · CHANGE ORDER` | Master template, decisions-in-writing emphasis + not-PM Truth Strip |
| /legal/terms | LEGAL | Plain-English summary chip | Quiet register restyle; substance unchanged; dash conversion |
| /legal/privacy | LEGAL | summary chip | Same; keeps plain "where your data lives" language |
| /legal/aup | LEGAL | summary chip | Same |
| /legal/messaging | LEGAL | summary chip | Same (STOP/consent policy language intact) |
| /legal/subprocessors | LEGAL | summary chip | Same; table as Honesty Ledger |
| /legal/refunds | LEGAL | summary chip | Same; three-paragraph promise, refund-includes-registration-fee kept |
| /security | SECURITY | `ENCRYPTED IN TRANSIT AND AT REST` | Verifiable checked claims only; links sub-processors |
| /status | STATUS | none (page is the instrument) | Mono gauges; green/Flare as literal state; zero marketing copy |

**Nav (all pages):** Signal White, wordmark Bricolage 800 ink, links Product / Pricing / Who it's for / Compare / Log in, cobalt `Get your number` pill; condenses to frosted pill on scroll. Product menu links the 4 feature pages; Who it's for links the 6 trades; Compare links the 3 rivals.
**Footer (all pages):** Dispatch Ink band, four columns per COPY-DECK §F covering every route above (Product 7 links incl. Pricing/Security/Canada; Who it's for 6; Compare 3; Company and legal 9 incl. Status/Contact/Guarantee). Identity line only when ops supplies it (purge 7). Credits line deleted (purge 6). Sign-off: "Month to month. No sales calls, ever."
**Shared decorative motif:** subpages carry only the static converged-arrival SVG mark in headers and the final-CTA backdrop; no canvas off the home page. Nothing uncovered.

