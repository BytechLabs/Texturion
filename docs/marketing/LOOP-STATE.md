# Landing-page loop state

Target: 10 iterations, each = improve → devils-advocate audit → fix.

| Iter | Status | Focus |
|---|---|---|
| 1 | done | Research (3 briefs) + BLUEPRINT.md + COPY.md, then a full devils-advocate panel (design-director, buyer, cro-seo) revision. Result: every blocker + major applied — hero is now a live-DOM two-phones thread with no raster (fixes LCP + signature-moment at once), page re-sequenced into a density wave, crew-size slider moved to home, first-month $58 math owned out loud, "500 texts" pinned to its definition everywhere, Quo "included" pricing-table error corrected, FAQPage JSON-LD dropped, /status + /contact added, bring-your-number forwarding workaround moved up. See BLUEPRINT.md "Panel resolutions". |
| 2 | done | (marketing) route group, nav/footer (zero dead links), home v1 (12 sections, live-DOM hero, 3 real interactives), /pricing, legal set (terms/privacy/aup/subprocessors/security/contact/status), SEO plumbing (metadata/sitemap/robots/OG/JSON-LD, no FAQPage). Committed f40f601, 853 tests green, clean build. Carry-forward minors: two-phones hero signature moment not fully realized (single desktop thread); ops-blocked identity placeholders (pre-launch). |
| 3 | running | SEO content pages: 4 feature + /canada, 6 trade (/for/*), 3 compare (/compare/*) — genuinely differentiated (no shared sentences, per-cell-sourced compare claims). Plus: realize the two-phones hero signature moment, wire now-real routes into nav/footer dropdowns + sitemap, real Lighthouse pass. |
| 4 | done | **VISUAL OVERHAUL** per binding docs/marketing/VISUALS.md — user feedback: no images/illustrations/infographics (reads empty) AND the navbar/dropdowns/footer are bare text (don't look like a brand). Built: (0) rebuilt nav+footer per VISUALS §5b — mega-menu dropdowns with icon chips + descriptions + featured cell, branded footer (nav-links.ts enriched with icon+description); (1) real product-screenshot pipeline from the seeded app (inbox/thread/contact/mobile/onboarding, light+dark, pre-sized WebP/AVIF, committed capture script); (2) SVG spot-illustration + infographic library (components/marketing/art/); (3) Frame (browser/phone) component; (4) placement pass across every surface per VISUALS §3. This is the reusable foundation iteration 5 builds ON — nav/footer, art library, Frame, and screenshots are kept, not redone. |
| — | — | **CREATIVE RESET (2026-07-02).** User verdict after iter 4: the site still reads as generic "section after section" with no identity; the hero is AWFUL. A three-concept creative bake-off (The Signal / two Dispatch concepts) was judged by three panels (design-director, growth-cro, perf-eng) — **unanimous winner: the participatory "dispatch desk" hero (Concept B) as the base**, grafting in Concept A's zero-cost static-SVG spine + signal-check motif and Concept C's morning-light warmth + single-motif discipline. Concept A's above-fold Canvas2D particle field is **rejected** (violates BLUEPRINT §13.9 no-GPU-scenes / §11.4 0KB-above-fold; needed a waiver; degrades away on mid-tier mobile). Two new BINDING docs written: **docs/marketing/ART-DIRECTION.md** (the job-ledger identity system: ticket motif, ledger spine numbering all 12 sections, morning-light two-wash, Inter numeral-display used exactly twice, the FILED-stamp motion, no mascot, conversion guardrails) and **docs/marketing/HERO-CONCEPT.md** (build-ready spec: visitor taps to file a panicked customer text into an assigned job; LCP stays H1 text; server-rendered filed-state fallback; ghost-demo discoverability; <12KB island, 100/100/100/100). See ART-DIRECTION §0 for the decision + reasoning. |
| 5 | **next** | **HERO + IDENTITY RESET: execute ART-DIRECTION.md + HERO-CONCEPT.md, TO THE REFERENCES.md CRAFT BAR.** (1) Build the signature hero — the visitor-driven dispatch desk (HERO-CONCEPT §1–7), reusing iter 4's live-thread primitives; LCP stays text; ship the ghost-demo discoverability kit + server-rendered filed-state fallback; hard-gate a real-mobile Lighthouse pass. (2) Propagate the identity system across all 12 home sections (ART-DIRECTION): the ledger spine numbering every section (kills "section after section"), the ticket/status-spine motif on every product surface, the morning-light two-wash atmosphere, the two numeral-display moments ($29 + timeline day-count), the FILED-stamp beat, the one dark band + one petrol-flood close. (3) Break the generic rhythm per the density wave (BLUEPRINT §1.4) **AND the silhouette-variety + anti-bland rules (REFERENCES.md §3).** (4) **Close the seven ELEVATE/ADD items in REFERENCES.md §4** — silhouette variety enforced, the ledger-row grammar literally recurring, tabular-numeral ledger texture pervasive, the two 132px numerals rendered at true display scale, a back-half participatory switch (steppable bento), the arrow-expand secondary CTAs, and the warm-neutral pass. The built page must stand next to Column / Rollups / Cofounder / Granola / Solidroad without reading as a template. **Reuse iter 4's foundation** (nav/footer, art/infographic library, Frame component, screenshots) — this is a hero + identity layer ON TOP, not a rebuild. Keep the ledger FELT-not-named and every conversion guardrail (ART-DIRECTION §10). |
| 6–9 | pending | Audit-driven polish WITH four standing mandates every iteration: **ART-DIRECTION.md** (the job-ledger identity is applied consistently, the spine threads the page, expressive spend stays capped at the sanctioned moments, warmth never tips cold/pretentious) + **REFERENCES.md** (the Column/Rollups/Cofounder/Granola/Solidroad craft bar — no two adjacent sections share a silhouette, every section earns a distinct visual device, the ledger-row grammar recurs, the anti-bland rules §3 are pass/fail majors) + **VISUALS.md** (looks rich like top-tier SaaS, never empty) + **CONVERSION.md** (5-second clarity, one obvious "Start for $29" CTA per view, honest complexity progressively disclosed / never confusing, every interactive ends in a conversion nudge, benefit→proof→how→price→act spine). Design-QA + conversion-QA critics judge all four every round; a REFERENCES.md §3 anti-bland violation or a half-strength §4 elevate-item is a design-QA **major**. |
| 10 | pending | Final devils-advocate panel + Lighthouse run + sign-off |

Constraints: iterations 2+ wait for the UI mega-wave (wf_d1f7534d-0df) to release apps/web.
PO decisions relayed 2026-07-01: jobs-from-messages = v1.1 roadmap; multi-number = already supported, say it; native apps = PWA now, no fake badges.

Binding design authority (equal, implement-don't-re-litigate): SPEC.md, DESIGN.md (app brand),
BLUEPRINT.md (section-by-section plan), VISUALS.md (visual-asset mandate), CONVERSION.md (clarity
doctrine), and — from the 2026-07-02 creative reset — **ART-DIRECTION.md** (the distinctive
job-ledger identity system), **HERO-CONCEPT.md** (the signature hero build spec), and
**REFERENCES.md** (the craft addendum: the user's 5 reference sites — Column, Rollups, Cofounder,
Granola, Solidroad — set the quality bar; §3 anti-bland rules + §4 elevate-items are the execution
floor iter 5 and all remaining iterations must meet; design-QA judges against it). On conflict:
honesty wins, then clarity/conversion, then performance gates, then look/feel.

---

## App v2 build plan (post-critique-panel, 2026-07-02)

The app-v2 specs (`docs/DECISIONS.md` D17–D22, `docs/TASKS.md`, `docs/APP-LAYOUT-V2.md`,
`docs/APP-FEATURES-V2.md`, `docs/HOME-AND-VIEWS.md` D23–D25) are reconciled — every blocker + major
from the panel is resolved (see the resolution list in the pass notes). Build waves below are in
**dependency order**. Rule of thumb: **the whole backend wave (B) can run concurrently with any
non-DB frontend wave (F0)** — the DB/API is the long pole; UI shell/composer/filter work that does
not read the new tables should start in parallel and wire to the API as each backend slice lands.

**Wave B — backend (`apps/api` + `supabase`)** — schema + API; the long pole; start first:

- **B1. Tasks schema + API (D17/TASKS.md).** New migration: `tasks` table (`message_id` **NOT NULL**,
  `conversation_id` denormalized, **no** status/done column, soft-delete, partial-unique on
  `message_id`), `moddatetime`, RLS deny-by-default, the single **`task.changed {conversation_id}`**
  metadata broadcast trigger. Routes: `POST /v1/tasks {message_id}`, `GET /v1/tasks` (filtered,
  default Open·Mine), `GET /v1/conversations/:id/tasks`, `GET`/`PATCH`/`DELETE /v1/tasks/:id`
  (metadata + soft-delete). **No** `PATCH /v1/tasks/:id {done}` — completion is the message route.
- **B2. Generic attachments schema + API (D19).** New migration: generic `attachments` table
  (`owner_type IN ('note','task')`, append-only + soft-delete, no `updated_at`), private `attachments`
  bucket (25 MB, MIME allow-list), Storage RLS defense-in-depth. Routes: `POST /v1/attachments`
  (Worker-mediated, multipart + signed-URL), `GET /v1/attachments/:id/url`. Serves **both** note and
  task attachments; **no** `task_attachments` table or `task-media` bucket. (B1 and B2 share the same
  migration window; B1's task attachments depend on B2's table.)
- **B3. Done-audit + conversation-attachments API (D22/D21).** Extend the existing
  `PATCH /v1/messages/:id {done}` handler to append a `conversation_events` row (`type=message_done`/
  `message_undone`, `payload {message_id}`, in-txn, D14-no-op-idempotent) — this is the **one**
  completion path tasks also use. Add the task/attachment event `type` literals (canonical list in
  TASKS.md T8; **no** CHECK change). New read route `GET /v1/conversations/:id/attachments` (the
  **two-arm union**: `message_attachments` JOINed through `messages` + the generic `attachments`
  table, sorted in the API layer). Depends on B1+B2 for the union's task/note arm.
- **B4. Auth/SSO backend + config (D18).** Supabase Auth Google + Apple provider config (ops runbook,
  no product code); `/auth/callback` Route Handler is a web-app route (belongs to F below, but the
  provider setup + redirect allow-list are ops here). Worker JWKS verification unchanged.
- **B5. Contacts export + vCard import (D20).** `GET /v1/contacts/export` (filtered CSV, round-trips
  the importer), `POST /v1/contacts/import-vcard` (a second parser into the existing idempotent
  upsert). No schema change. (Independent of B1–B3; can land any time in the wave.)

**Wave F0 — frontend, NON-DB (`apps/web`)** — runs **concurrent with Wave B** (no new-table reads):

- Layout overhaul (fixed `100dvh` 3-pane shell, reading track, docked composer aligned to the 42rem
  track, receded nav rail + collapse, auto dock/float context panel — no user Fixed/Float knob).
- Composer rebuild (Google-Messages pill, `+` overflow, auto-grow, derive-send-from-content, no
  up/down buttons, passive segment hint).
- Filter redesign (kill the fly-out; segmented status tabs with the **single quiet count on Open
  only**, removable chips, `+ Filter` cmdk popover, URL-state).
- SSO buttons + `/auth/callback` route + Settings→Account email/password change + **Sign-in methods**
  UI (D18 — needs only Supabase Auth, not the new app tables).

**Wave F1 — frontend, reads Wave B (`apps/web`)** — after the matching backend slice lands:

- Per-message **done** (vertically centered, hover-reveal, auditable) — after **B3**.
- **Tasks UI** in the thread: overflow "Make a task", the **stone** promoted-message indicator (never
  a petrol badge), the conversation **checklist** (checkbox → the message PATCH) — after **B1**.
- Dedicated **`/tasks` page** (List view, canonical tabs `Open | Mine | All | Done`, deep-links,
  first-run empty state teaches promotion) + task detail — after **B1**; Board/Calendar/Map views
  (D25, lazy client islands; Board ships **To do / Done** only until the T9 richer-status decision) —
  after B1.
- **Attachments gallery** (single header-overflow entry, two-source union, `mms|note|task` origin
  tags) — after **B3** (+B2 for note/task arms).
- **In-thread filter** (All/Messages/Notes/Events — **client-side** over already-embedded data) —
  after the layout thread work (F0); no new endpoint.
- **Contacts import/export UI** (shared import surface: CSV · vCard · Pick-from-phone
  progressive-enhancement; CSV export button) — after **B5**.

**/for-you home + notifications bell (D23/D24)** ride on top once tasks + assignments read models
exist (mostly derived queries) — sequence after F1's tasks slice; treat D23–D25 numbers as
**provisional** (HOME-AND-VIEWS.md) for shell placement only.
