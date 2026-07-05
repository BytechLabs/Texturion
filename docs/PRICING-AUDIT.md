# Pricing model audit & redesign proposal (#12)

**Status:** audit complete · design proposed · awaiting business decisions before implementation
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

## 4. Factual provider cost basis (2026‑07‑04)

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
- **Storage:** included 5 GB / 25 GB (unchanged) + **15¢/GB** overage covering both
  storage ($0.021) and egress ($0.09) headroom.
- **Regions:** US (10DLC required) and/or Canada as toggles; each carries its own
  number + registration cost. Canada rates flagged UNVERIFIED (§4) — confirm before
  charging CA.

**Limit-reached UX (Increment D):**
- Soft warning at ~80% of any allowance (reuse `usage-alerts.ts`); a hard,
  clear "limit reached — upgrade / add credit" that **blocks the cost-incurring
  action** at 100%. **Never block receiving inbound customer content** (that's the
  customer's brand) — instead throttle downstream processing + notify the owner.
