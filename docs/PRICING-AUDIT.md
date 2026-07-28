# Pricing model audit & redesign proposal (#12)

**Status:** COMPLETE — protection layer + modular plan builder shipped, adversarially reviewed (see §9)
**Cost basis dated:** 2026‑07‑04 (provider list prices; see sources inline)
**Core invariant to enforce:** _we must never pay a provider more for a tenant than that tenant pays us._

---

## 1. TL;DR — the exposure is real

Today **only outbound SMS/MMS segments are metered and billed** (`billing/plans.ts`,
`billing/meter.ts`). Every other provider cost the app incurs is **unmetered, uncapped, and
unbilled**. Of 13 cost centers found, **11 are unprotected**. The two worst:

| # | Hole | Why it's critical |
|---|------|-------------------|
| 1 | **Inbound SMS is free to the customer but costs us** ~$0.004–0.007/part (Telnyx base + T‑Mobile receive surcharge). | A company number is public. Anyone can blast unlimited inbound; we pay per part with **zero ceiling and zero revenue offset**. Net‑negative with **zero outbound**. |
| 2 | **Inbound MMS media is downloaded + stored forever, never gated.** Up to 50 MB per inbound message. | `messaging/media.ts` explicitly: _"inbound MMS is never blocked on a storage budget."_ Storage is monotonic (retained per SPEC §6) → cost grows without bound. |

Plus: **auto‑sends bypass the send cap entirely**, the **one cap that exists is defeatable**, **voice/call‑forwarding is entirely unpriced**, **egress is 4× storage cost and unmetered**, and the **recurring 10DLC campaign fee ($10/mo) is not recovered by any plan**.

---

## 2. Current model (what a customer pays today)

- Two plans: **starter**, **pro** (`PLAN_IDS`).
- **Licensed** monthly price (Stripe) + **metered** overage on **outbound segments only**.
- Included outbound segments: **starter 500 / pro 2500**; overage **starter 3¢ / pro 2.5¢** per segment.
- Hard limits: **seats** (3/10), **numbers** (1/2) — enforced server‑side (`provision_number_slot`).
- Storage **budget** (5 GB / 25 GB) — but it gates **only** the note `attachments` bucket, **not** MMS media, and it does **not** meter **egress**.
- The one send cap: `gate_outbound_send` enforces opt‑out + 250‑segment/trailing‑hour rate + an overage cap of `overage_cap_multiplier × quota` (default 3×). **Defeatable** — an owner can set `overage_cap_multiplier = NULL` ("no cap"), which disables the ceiling entirely (`messaging_functions.sql:313`).

---

## 3. Cost‑center audit (13 found · 11 unprotected)

Legend: **M** metered · **C** capped · **B** billed to customer · **U** unprotected (we eat it).

| Center | Provider | True cost | M | C | B | Risk | Notes |
|---|---|---|---|---|---|---|---|
| **Inbound SMS** | Telnyx | ~$0.004 + T‑Mo $0.003 recv | ✗ | ✗ | ✗ | 🔴 critical | biggest hole; no per‑number/sender inbound limit anywhere |
| **Inbound MMS + storage** | Telnyx + Supabase | $0.005 recv + storage + egress | ✗ | ✗ | ✗ | 🔴 critical | up to 50 MB/msg, retained forever, unbilled |
| **Away‑reply auto‑send** | Telnyx out | ~$0.007–0.0085/seg | ✓ | ✗ | ✓ | 🟠 high | `claim_auto_reply` **skips** the cap + rate gate (only a 3 h/conversation throttle) |
| **Missed‑call text‑back** | Telnyx out | ~$0.007–0.0085/seg | ✓ | ✗ | ✓ | 🟠 high | `claim_missed_call_text` **skips** cap + rate gate |
| **Voice call forwarding** | Telnyx Voice | ~$0.01–0.012/min both legs + $0.10/transfer | ✗ | ✗ | ✗ | 🟠 high | **no voice line item in any plan**; per‑minute, both legs, AMD |
| **10DLC brand + campaign** | Telnyx / TCR | $4.50 one‑time + **$10/mo recurring** | ✗ | ✗ | ✗ | 🟠 high | recurring campaign fee billed to us even for a non‑paying tenant until grace‑expiry deactivation |
| **Inbound notification emails** | Resend | $0.90/1k | ✗ | ✗ | ✗ | 🟡 med | new‑conversation always notifies → defeats the 15‑min debounce; one email/member/new thread |
| **Phone number rental** | Telnyx | $1/mo + $0.10 SMS cap | ✗ | ✓ | ✓ | 🟡 med | well‑guarded by `provision_number_slot`; residual leak = grace‑release must actually succeed |
| **Outbound SMS/MMS** | Telnyx + Stripe | ~$0.007–0.0085/seg | ✓ | ✓ | ✓ | 🟡 med | the one priced path — but cap is **defeatable** (NULL multiplier) and is a 3× ceiling, not a hard spend limit |
| **Sole‑prop 10DLC OTP SMS** | Telnyx | ~$0.007/seg | ✗ | ✗ | ✗ | 🟢 low | bounded by lifecycle; resend path lacks a lifetime cap |
| **Operational emails** | Resend | $0.90/1k | ✗ | ✗ | ✗ | 🟢 low | self‑limiting (one per transition) |
| **Portability check** | Telnyx | ~$0 (free) | ✗ | ✗ | ✗ | 🟢 low | admin‑only; free per Telnyx, but no rate limiter |
| **Nominatim geocoding** | OSM | $0 (policy‑capped) | ✗ | ✓ | ✗ | 🟢 low | free but **1 req/s ToS cap**; OSM can cut access → reliability risk, not $ risk |

**The model to copy:** hosted text‑enablement verification (`text-enablement.ts`) is the best‑protected paid action — a rate limiter keyed on the **target** (survives cancel‑and‑recreate) **plus** a durable per‑order lifetime cap. Every unprotected paid action should adopt this shape.

---

## 4. Factual provider cost basis (2026‑07‑04 · **revised 2026‑07‑28** · next review **2026‑10‑28**)

> **Review interval: 3 months, not years (#403, #445 ask 3).** Carrier A2P fees
> changed *twice* in 2026 alone — T‑Mobile and US Cellular on 19 January, AT&T
> on 1 April. A yearly review cannot track that. `break-even.test.ts` pins the
> unit costs so a change cannot land silently, but the pin only catches a change
> we *make*; the calendar is what catches a change the carriers make.

### 4.1 What the segment rates actually are (#445, measured 2026‑07‑28)

**The outbound rate was measured, not estimated, and the old figure was wrong.**
Telnyx reports the true cost of every outbound message on the delivery webhook
(`messages.provider_cost`, #216). Production, all costed outbound messages:

| Observed cost/segment | Messages |
|---|---|
| 0.91¢ | 3 |
| 0.98¢ | 8 |
| 1.05¢ | 1 |
| **1.13¢** | **11** |
| 1.135¢ | 1 (2‑segment) |
| 3.27¢ | 1 (outlier) |

Modal **1.13¢**, mean **1.05¢** excluding the outlier, over 26 segments. The
model carried **0.85¢** — an under‑count of about a third, against this file's
own rule that a never‑lose‑money model must not under‑count. Raised to **1.15¢**
(the high end of the observed range).

**This answers #445 ask 5: Telnyx passes the carrier surcharges through, it does
not absorb them.** A $0.004 base plus the previously assumed $0.003 surcharge
cannot produce a measured 1.13¢. The 2026 increases are inside what Telnyx bills
us, so they are our cost.

**Inbound cannot be measured, and that is a finding in itself.** Telnyx reports
message cost on the DELIVERY‑status webhook, which only fires for messages we
send. Production holds 21 inbound messages and **zero** costed ones. So
`api_period_provider_cost` — the "ground truth" arm of the #85 projection — is
**outbound‑only** and silently omits inbound. The projection takes the HIGHER of
estimate and actual, which is what stops that omission from under‑reporting, but
it means the inbound estimate is load‑bearing rather than a cross‑check.

Inbound is therefore estimated, now naming every carrier that charges rather
than one (#445 ask 2):

| Component | Rate | Source |
|---|---|---|
| Telnyx base receive | $0.0040 | Telnyx pricing |
| T‑Mobile MO surcharge | $0.0025 | 19 Jan 2026 |
| **AT&T MO surcharge** | **$0.0025** | **1 Apr 2026 — applies to mobile‑ORIGINATED as well as terminated** |
| US Cellular | small share | 19 Jan 2026, inside rounding |
| **Total** | **~0.95¢ ⇒ carried at 1.0¢** | |

The AT&T line is the one the old single‑carrier comment could not have
accounted for: it post‑dates the January basis and extends the charge to
traffic *coming in*, which is the line with no offsetting revenue (D50) and no
ceiling.

### 4.2 AI cost basis (#380, 2026‑07‑28)

Cloudflare Workers AI published rates, fetched 2026‑07‑28
(`developers.cloudflare.com/workers-ai/platform/pricing`):

| Model | Used by | Rate |
|---|---|---|
| `@cf/meta/llama-3.2-1b-instruct` | task enrichment | $0.027/M in · $0.201/M out |
| `@cf/meta/llama-3.1-8b-instruct-fast` | reply drafting | $0.045/M in · $0.384/M out |
| `@cf/openai/whisper-large-v3-turbo` | voicemail transcripts | $0.0005 / audio minute |

The ledger counts **requests**, not tokens, so each rate is converted to a
worst‑case cost per request using the bounds the feature code already enforces:

| Feature | Bound | Cost/request | At its monthly cap |
|---|---|---|---|
| `enrich` | ≤256 output tokens | **0.01¢** | 1,000 ⇒ $0.10 |
| `suggest_reply` | 12 msgs × 600 chars in, ≤700 out | **0.04¢** | 1,500 ⇒ $0.60 |
| `voicemail_transcript` | 5‑minute recording | **0.25¢** | 500 ⇒ $1.25 |
| | | | **$1.95 total** |

**$1.95/month is the most AI can cost one tenant**, all three features at their
caps. Against Starter's $27.71 net that is 7% — real, but not on its own
capable of flipping a tenant.

> **A stale price found in passing:** `reply-suggestions.ts` cites $0.287 per
> million output tokens; Cloudflare now publishes $0.384. The figures above use
> the published rate. Same failure mode as #445 — a dated external fact that
> moved after it was written down.

**Ask 3, the backfill, answered from production (2026‑07‑28):** across all
active tenants the current month holds 11 enrichments, 61 reply drafts and 4
voicemail transcripts — about **3.6¢ in total**. **No tenant flips from
profitable to unprofitable.** That is the genuinely useful negative result the
issue asked for: the value of this change is structural, not corrective.

It stops being negligible the month an AI feature scales with call volume
rather than crew clicks — #367's AI receptionist is the one to re‑run this for.

### 4.3 Original basis (2026‑07‑04)

**Telnyx** (`telnyx.com/pricing`, `support.telnyx.com/.../5634625`):
- Outbound US SMS **$0.004** base **+ carrier $0.003–0.0045** ⇒ **~$0.007–0.0085/segment true cost**.
- Inbound US SMS **$0.004** base (+ T‑Mobile **$0.003** receive surcharge on registered traffic).
- MMS: outbound **$0.015** + carrier up to $0.01; inbound **$0.005**.
- **Unregistered** 10DLC penalty: T‑Mobile **~$0.012/part** (3–4× registered) — never send before brand+campaign approved.
- 10DLC: brand **$4.50** one‑time · campaign vetting **$15** one‑time · campaign **$10/mo** (as low as $1.50 low‑volume).
- Number rental **$1/mo** + **$0.10/mo** SMS capability. Voice: forwarding **~$0.01–0.012/min** (both legs) + **$0.10/transfer**; toll‑free inbound **~$0.017/min**.

**Supabase** (`supabase.com/pricing`): file storage **$0.021/GB/mo** · **egress $0.09/GB** (4× storage, charged on every media view/download — currently unmetered) · DB storage $0.125/GB · edge fn $2/M · realtime $2.50/M msgs · Pro base $25/mo.

**Resend**: $0.90 per 1,000 emails (Pro), 3k/mo free.
**Nominatim/OSM**: $0, but **1 req/s** + no autocomplete + self‑host if geocoding is a primary function.

**⚠️ UNVERIFIED — confirm from a logged‑in Telnyx account before pricing voice/Canada:** (a) Canada SMS/MMS per‑part rates (sources disagree: $0.004 vs $0.0075); (b) Canada number rental; (c) exact SIP‑trunk per‑minute + toll‑free voice rates.

---

## 5. Proposed design

### 5.1 The "never lose money" protection layer (do first — mostly not a pricing decision)

These are **safety fixes**, largely independent of the final prices:

1. **Route auto‑sends through the same gate as manual sends.** `claim_auto_reply` and
   `claim_missed_call_text` must call the same cap + rate checks `gate_outbound_send` does.
   (Today they skip both — a plain bug.)
2. **Make the cap un‑defeatable.** Keep `overage_cap_multiplier` as the customer‑visible soft
   cap, but enforce a **system hard ceiling** even when it's NULL, so "no cap" can never mean
   "unbounded spend on our dollar."
3. **Meter + cap inbound** (SMS and MMS) per number: a trailing‑window inbound rate limit
   (drop/queue past it) so a public number can't be flooded into net‑negative. Count inbound
   toward a plan allowance.
4. **Meter egress + total storage** (not just the note bucket), including MMS media, and cap
   per plan. Egress is the sleeper cost (4× storage).
5. **Price voice** or hard‑cap forwarded minutes per plan; add a per‑number inbound‑call rate
   limit. Voice currently has **no billing surface at all**.
6. **Recover 10DLC**: fold the $4.50 brand + $10/mo campaign into an activation fee and/or the
   plan floor; guarantee campaign deactivation on grace‑expiry (retry until it succeeds).

### 5.2 Plan builder (the pricing decision — user owns the numbers)

Not every customer needs everything. Proposed **modular** model: a small **base** (covers the
number rental + 10DLC recurring + a starter allowance) **+ toggleable modules**, each with its
own included allowance and overage priced **above true cost**:

- **Texting** (SMS): included in base; inbound + outbound both count against a combined segment allowance; overage per segment.
- **MMS**: opt‑in module (base $0.015 out / $0.005 in + carrier) — priced separately from SMS.
- **Voice / call‑forwarding**: opt‑in module with a monthly forwarded‑minute allowance + per‑minute overage.
- **Storage**: included GB + egress allowance; overage per GB (storage **and** egress).
- **Regions**: US (requires 10DLC) and/or Canada — each region carries its own registration/number cost.

**Every included allowance must be sized against _true_ cost** (≈$0.007–0.0085/segment, not the $0.004 base), so the "free" bucket isn't sold below cost.

### 5.3 Limit‑reached UX (the user asked for this)

- Surface live usage vs allowance per module (the `usage` route already exists — extend it).
- Soft warning at ~80% (there's already `usage-alerts.ts`); a hard, clear "you've hit your
  {module} limit — upgrade or add credit" state that **blocks the cost‑incurring action** rather
  than silently overspending on our dollar.
- Never block **inbound customer content** from being received (that's the customer's brand), but
  do throttle/deprioritize processing + notify the owner when inbound is being abused.

---

## 6. Phased implementation plan

- **Phase 0 — safety (no pricing decision needed):** §5.1 items 1–2 (auto‑sends respect the cap; un‑defeatable hard ceiling). Pure abuse‑closure; ship behind tests.
- **Phase 1 — metering infrastructure:** meter inbound SMS/MMS, egress + total storage, voice minutes (record usage even before it's billed — you can't cap what you don't measure).
- **Phase 2 — caps + limit‑reached UX:** enforce per‑module caps + the §5.3 UX. Needs the **allowance numbers** (business decision).
- **Phase 3 — plan builder + Stripe catalog:** the modular plans + Stripe price wiring + checkout/plan‑builder UI. Needs the **prices/tiers** (business decision).

---

## 7. Decisions needed from the user before Phases 2–3

1. **Plan shape:** modular builder (§5.2) vs a few fixed tiers? Which modules are opt‑in vs base?
2. **Allowances & prices:** included amounts + overage for each of segments (in+out), MMS, voice minutes, storage GB, egress GB. (Must clear true cost.)
3. **Inbound policy:** what inbound volume is "normal" before we throttle/charge? Is inbound counted against the same allowance as outbound, or its own?
4. **Voice:** offer forwarding as a paid module, or hard‑cap it, or drop it?
5. **10DLC recovery:** activation fee, monthly floor, or absorb?
6. **Regions:** price US and Canada separately? Confirm the UNVERIFIED Canada/voice rates first.
7. **"No cap" customers:** keep an opt‑in unlimited tier (with a deposit/credit‑card‑on‑file guarantee), or always enforce the hard ceiling?

_Phase 0 can proceed immediately — it only closes abuse holes and needs none of the above._

---

## 8. Chosen defaults (implementation basis — TWEAK THESE)

Per the #12 decision to "make sensible defaults & build," these are the values I'm
implementing against. They are **placeholders sized to be safe + above true cost**;
change any number and the code picks it up (kept in constants / plan config, not
scattered).

**Hard safety ceiling (Increment B) — "no matter what":**
- Even when an owner sets `overage_cap_multiplier = NULL` ("no soft cap"), a
  **system hard ceiling of 10× the plan quota** always applies (starter 5,000 /
  pro 25,000 outbound segments per period). Combined with the existing 250-seg/hr
  rate limit, unpaid-overage exposure is bounded. No "truly unlimited" tier by
  default (add one deliberately later if wanted).

**Metering (Increment A) — measure everything, bill nothing yet:**
- Record **inbound** SMS (1 seg) + MMS (3 seg) per company per period, plus
  scaffolds for **egress GB** and **voice minutes** — in a NON-billing counter,
  separate from the Stripe `usage_events` pipeline. Visibility first; capping later.

**Modular plan (Increment C) — default prices ABOVE true cost (~$0.0085/seg):**
- **Base** (per plan): covers 1 number rental + the 10DLC brand/campaign recurring
  fee + an included outbound-segment allowance (starter 500 / pro 2,500, unchanged).
- **Texting overage:** starter 3¢ / pro 2.5¢ per segment (unchanged — clears cost).
  Inbound counts against the SAME allowance by default.
- **MMS module (opt-in):** 5¢ per part overage (cost ~$0.015+carrier out / $0.005 in).
- **Voice / forwarding module (opt-in):** included minutes + **5¢/min** overage
  (cost ~$0.012/min both legs), or hard-cap if the module is off.
  *(Superseded by D36, 2026-07-10: shipped as 2,500/6,000 included forwarded-leg
  minutes + 1¢/min metered overage, pause at the spending cap — founder call.)*
- **Storage:** included 5 GB / 25 GB (unchanged) + **15¢/GB** overage covering both
  storage ($0.021) and egress ($0.09) headroom.
- **Regions:** US (10DLC required) and/or Canada as toggles; each carries its own
  number + registration cost. Canada rates flagged UNVERIFIED (§4) — confirm before
  charging CA.

**Limit-reached UX (Increment D):**
- Soft warning at ~80% of any allowance (reuse `usage-alerts.ts`); a hard,
  clear "limit reached — upgrade / add credit" that **blocks the cost-incurring
  action** at 100%. The owner directive **"cap and drop"** supersedes the
  original "never block inbound" stance for cost-incurring inbound *media*: when
  a storage budget is full we DROP the picture (never the text) so the bill can
  never outrun the plan. The customer's message still arrives; only the media we
  would have to store on our dollar is shed, and the owner is alerted.

## 9. Implementation status (living)

Shipped (main):

- **Hard overage ceiling** — `overage_cap_multiplier` NOT NULL, CHECK (0,10],
  NULL→10 clamp; `gate_outbound_send` + `outbound_spend_check` enforce it, so the
  cap can't be disabled. (`69c8c4c`)
- **Auto-reply + missed-call respect the send cap** — `claim_auto_reply` /
  `claim_missed_call_text` call `outbound_spend_check` and skip when rate-limited
  or over cap, closing the two automated-send abuse holes. (`91a8f8a`, `a2abeef`)
- **Inbound metering** — `api_period_inbound_segments` + the usage route surface
  received volume (visibility, non-billing). (`7914aea`)
- **Storage cap-and-drop + owner alerts** — MMS media has its own
  `MMS_STORAGE_BUDGET_BYTES` pool (separate from the D30 attachment budget); over
  budget → inbound media dropped, text kept (`e9ca5e0`, `a0d0408`). The
  usage-alert cron gained `mms_storage` + `attachment_storage` arms at 80/100%
  (`usage_alerts.metric` column) (`fa6ad8f`); the usage page shows both pools
  honestly (`1abb491`).
- **Voice metering + cap-and-drop + alerts** — `call_records` records each
  forwarded leg's billable seconds on hangup; `api_period_voice_seconds` sums
  them; over `PLAN_VOICE_MINUTES` the inbound call is REJECTED instead of
  forwarded (the reject's hangup still fires the missed-call text). 80/100%
  `voice_minutes` owner alerts + a usage-page meter. (`09a19cd`, `012d35e`,
  `6f82019`)
  *(Amended by D36, 2026-07-10: the reject boundary moved from the allowance to
  allowance × overage_cap_multiplier; minutes between the two bill 1¢/min via
  the `voice_seconds` Stripe meter over `api_period_forward_seconds`.)*

### Protection layer: COMPLETE for every cost center we amplify

Every cost center where Loonext controls the amplified spend is now bounded:
outbound (un-defeatable hard ceiling + rate limit), auto-reply + missed-call
(send cap), MMS media + attachment storage (cap-and-drop / 409 + alerts), voice
(cap-and-drop + alerts), 10DLC campaign (deactivation is state-gated + retried
daily on grace-expiry — verified, no leak). Inbound auto-reply, media, and
notifications (15-min debounced per conversation) are all individually bounded.

**The one residual is the raw Telnyx inbound-receive charge** (~$0.004 SMS /
$0.005 MMS per message): it is incurred UPSTREAM at Telnyx before our webhook
runs, so the only way to stop it is to suspend/release the flooded number —
which would harm a legitimately busy business and is therefore an ops/abuse
decision (monitor + manual/threshold suspension), NOT a silent per-message
autonomous drop. All the DOWNSTREAM amplifiers of an inbound flood (media
storage/egress, auto-replies, per-conversation notifications) are already
capped, so a flood can no longer multiply into unbounded spend on our side.

### Plan builder (opt-in modules; user picked opt-in + "make prices yourself")

Base plan (texting + 1 US number + US 10DLC) stays; MMS, Call forwarding, extra
Storage, and Canada are opt-in modules. Shipped:

- **Catalog + enablement** — `MODULE_CATALOG` (billing/modules.ts, flat monthly
  prices: MMS $5, Voice $8, Storage $5, Canada $5), `company_modules` table with
  live-customer **grandfathering**, `isModuleEnabled` gate. (`0235b71`)
- **Stripe catalog** — `stripe:setup` creates a product + price per module; ran
  against the test account, ids in `.dev.vars` / `STRIPE_MODULE_*_PRICE_ID`.
  (`e245786`)
- **Checkout + enablement mirror** — checkout accepts `modules[]`, adds a line
  each, and `checkout.session.completed` enables the purchased modules (enable-
  only, so grandfathering is safe). (`9420d1a`)
- **Onboarding picker** — calm add-on toggles on the plan step feed checkout.
  (`96a0c5b`)
- **MMS gate** — outbound MMS requires the mms module (clear 409, no silent
  charge; text unaffected). (`db42299`)
- **Voice gate** — turning on forwarding / missed-call text-back in settings
  requires the voice module; a migration grandfathers mctb-only companies so no
  existing voice user is bitten. (`76ab721`)

Plan-builder follow-ups — ALL shipped:

- **Post-signup management** — GET/POST /v1/billing/modules add/remove a Stripe
  subscription item (prorated) + mirror company_modules; disabling voice clears
  forward_to_cell + mctb_enabled. Settings "Add-ons" card (Switch per module).
  (`a8d7942`, `9bfec0f`)
- **MMS + voice gates** — outbound MMS + turning on forwarding require their
  module (grandfathered). (`db42299`, `76ab721`)
- **extra_storage** — effectiveStorageBudgets grows both pools by 10 GB when on;
  threaded through the attachment gate, MMS drop, alerts, and usage. (`1b10699`)
- **regions_ca** — inert in the single-region model (numbers fixed to the
  company's country), so hidden from the picker; backend scaffolding kept for
  future multi-region. (`9bfec0f`)
- **Voice disable safety net** — handled by module-disable clearing the voice
  settings (no per-call check needed).

### Adversarial review (`d25aaa7`)

A 5-dimension adversarial review of the whole #12 diff confirmed + fixed three
real cost holes: MMS retry bypassed the gate; a plan downgrade dropped paid
module line items while leaving them enabled; a single forwarded call could run
unbounded past the voice cap (now `time_limit_secs`-capped at 1h).

### Documented residuals (bounded, low-risk)

- **Raw Telnyx inbound receive** — upstream, only stoppable by suspending a
  flooded number (an ops/abuse call, not a silent drop).
- **Voice cap concurrency** — the cap is a pre-answer boundary check with
  post-hangup accounting, so N simultaneous calls can each pass while under the
  sum. Bounded by simultaneous inbound-call volume to one number (self-limiting)
  and by the per-call 1h ceiling; a true fix needs an in-flight reservation
  (deferred — the catastrophic single-call case is already capped).

---

## 10. Break‑even utilisation & the fair‑use ceiling decision (#446)

Every figure below is computed from this repo's own constants
(`billing/costs.ts`, `billing/plans.ts`) and asserted in
`apps/api/src/billing/break-even.test.ts`. That test is the reason these
numbers can be trusted: change a unit cost, a plan allowance or a plan price
and it fails, which is the prompt to re‑read this section.

### 10.1 A tenant at the full published ceiling

| | Starter ($29) | Pro ($79) |
|---|---|---|
| Net revenue after Stripe | **$27.71** | **$76.01** |
| Voice at ceiling (1.2¢/min) | $30.00 (2,500 min) | $72.00 (6,000 min) |
| Outbound segments at ceiling (1.15¢) | $5.75 (500) | $28.75 (2,500) |
| Number rental ($1.10 each) | $1.10 (1) | $2.20 (2) |
| US 10DLC campaign | $10.00 | $10.00 |
| **Total cost** | **$46.85** | **$112.95** |
| **Net position** | **−$19.14** | **−$36.94** |

> **Revised 2026‑07‑28 by #445.** The outbound segment rate moved 0.85¢ → 1.15¢
> (measured, not estimated — see §4.1) and inbound 0.7¢ → 1.0¢. The positions
> above are the corrected ones; the loss at ceiling deepened by $1.50 on Starter
> and $7.50 on Pro.

The headline in #446 holds: **the included voice allowance on Starter costs
$30 against a $29 plan** — voice alone, at the stated ceiling, exceeds the
entire plan price before a single text.

### 10.2 Break‑even utilisation (ask 1)

Voice minutes at which a tenant stops being profitable, assuming they send **no
texts at all** — the most generous reading:

| Plan | Break‑even | Published ceiling | Ceiling as % of break‑even |
|---|---|---|---|
| Starter | **1,384 min** | 2,500 min | 181% |
| Pro | **5,317 min** | 6,000 min | 113% |

**Starter is the exposed plan, not Pro.** That inverts the intuition. The
reason is the $10 10DLC campaign fee, which is identical on both plans and
therefore consumes 36% of Starter's net revenue against 13% of Pro's. Any
future move to protect margin should look at Starter first.

### 10.3 The decision (ask 2)

**The published ceilings sit above break‑even, deliberately. They are
catastrophe limits, not margin limits.** They are not being lowered.

The reasoning, recorded so it is a position rather than an accident:

1. **A ceiling and a margin control are different instruments.** The fair‑use
   ceiling exists so no single tenant can cost an unbounded amount. Protecting
   the margin of a tenant who is *inside* their allowance is the projection
   model's job (#85), not the ceiling's.
2. **The published ceiling is a promise already made** at `/legal/fair-use`.
   Lowering it is a customer‑facing breach of something people bought on, for a
   loss nobody has yet incurred — the wrong trade at this stage.
3. **The detection now exists, which it did not when #446 was written.** A
   tenant projected to cost more than they pay produces a warning to them *and*
   to the founder, plus a weekly count of how many crossed (#447). The question
   "is anyone actually hitting these ceilings" is answerable without a database
   console, so this can be revisited from evidence rather than arithmetic.
4. **The unbounded cost centre was the real risk, and it is now bounded.** The
   per‑dial transfer fee scales with call *count* and the minute cap could never
   see it (#446 ask 5, #98); it has its own ceiling and alert as of #448.
5. **Nobody is near it.** 2,500 minutes is ~42 hours of talking a month for a
   three‑person crew. At seven customers the realistic ceiling‑hitter does not
   exist, and generous ceilings nobody reaches are a legitimate position.

**What would reverse this decision:** the #447 weekly digest showing repeat
crossings, or a single tenant sustaining a loss across two periods. Either is a
pricing signal; the arithmetic alone is not.

### 10.4 Standing dependencies (ask 4)

Both push these numbers the wrong way and neither is priced yet:

- **#445** — three carriers raised A2P fees in 2026 and AT&T now charges on
  inbound; the inbound cost line names only T‑Mobile.
- **#380** — AI has no term in the cost model at all.

`break-even.test.ts` pins the unit costs this decision was made against, so
neither can land quietly. When either ships, that test fails and this section
is re‑run — which is what ask 4 asked for, enforced rather than remembered.

**#445 has now landed, and the mechanism worked.** Raising the segment rates
failed the pinned assertions on the first run, which is how the figures above
came to be corrected in the same change rather than drifting. The decision in
§10.3 is UNCHANGED — a deeper loss at a ceiling nobody reaches is still a
ceiling nobody reaches, and the reasoning never rested on the size of the gap.
What would reverse it remains evidence of real crossings, not arithmetic.
**#380 (AI has no term in the model) is the one still outstanding.**

### 10.5 Ask 3 — what a crossing actually does

Answered by #447: it emails the customer's owner + admins with a plain‑language
heads‑up (no figures of ours), emails the founder the same crossing with the
cost/revenue/margin, and counts toward a weekly digest naming nobody. Nothing
is paused — warning and enforcing are deliberately separate jobs.
