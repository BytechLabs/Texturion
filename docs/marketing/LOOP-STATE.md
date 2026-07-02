# Landing-page loop state

Target: 10 iterations, each = improve → devils-advocate audit → fix.

| Iter | Status | Focus |
|---|---|---|
| 1 | done | Research (3 briefs) + BLUEPRINT.md + COPY.md, then a full devils-advocate panel (design-director, buyer, cro-seo) revision. Result: every blocker + major applied — hero is now a live-DOM two-phones thread with no raster (fixes LCP + signature-moment at once), page re-sequenced into a density wave, crew-size slider moved to home, first-month $58 math owned out loud, "500 texts" pinned to its definition everywhere, Quo "included" pricing-table error corrected, FAQPage JSON-LD dropped, /status + /contact added, bring-your-number forwarding workaround moved up. See BLUEPRINT.md "Panel resolutions". |
| 2 | done | (marketing) route group, nav/footer (zero dead links), home v1 (12 sections, live-DOM hero, 3 real interactives), /pricing, legal set (terms/privacy/aup/subprocessors/security/contact/status), SEO plumbing (metadata/sitemap/robots/OG/JSON-LD, no FAQPage). Committed f40f601, 853 tests green, clean build. Carry-forward minors: two-phones hero signature moment not fully realized (single desktop thread); ops-blocked identity placeholders (pre-launch). |
| 3 | running | SEO content pages: 4 feature + /canada, 6 trade (/for/*), 3 compare (/compare/*) — genuinely differentiated (no shared sentences, per-cell-sourced compare claims). Plus: realize the two-phones hero signature moment, wire now-real routes into nav/footer dropdowns + sitemap, real Lighthouse pass. |
| 4 | pending | **VISUAL OVERHAUL** per new binding docs/marketing/VISUALS.md — user feedback: site has zero images/illustrations/infographics, reads empty. Build: (1) real product-screenshot pipeline from the seeded app (inbox/thread/contact/mobile/onboarding, light+dark, pre-sized WebP/AVIF, committed capture script); (2) SVG spot-illustration + infographic component library (components/marketing/art/); (3) Frame (browser/phone) component; (4) placement pass dropping visuals into every surface per VISUALS §3. Keep Lighthouse ≥95 (hero LCP stays text). |
| 5–9 | pending | Audit-driven polish WITH two standing mandates every iteration: **VISUALS.md** (looks rich like top-tier SaaS, never empty) AND **CONVERSION.md** (5-second clarity, one obvious "Start for $29" CTA per view, honest complexity progressively disclosed / never confusing, every interactive ends in a conversion nudge, benefit→proof→how→price→act spine). Design-QA + a conversion-QA critic judge both every round. |
| 10 | pending | Final devils-advocate panel + Lighthouse run + sign-off |

Constraints: iterations 2+ wait for the UI mega-wave (wf_d1f7534d-0df) to release apps/web.
PO decisions relayed 2026-07-01: jobs-from-messages = v1.1 roadmap; multi-number = already supported, say it; native apps = PWA now, no fake badges.
