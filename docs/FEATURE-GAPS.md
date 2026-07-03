# JobText — Feature Gaps: the small features worth adding

Owner: product. Decided 2026-07-03. Lens: what a plumber / HVAC / landscaper /
cleaner / electrician / salon owner actually needs from a shared SMS inbox that
JobText does **not** provide today. Grounded in the current-audit (verified in
`apps/api/src`), the competitor scan, and the trades ICP. Every option honors the
product's one hard constraint: **lowest possible upkeep — reuse Supabase / Telnyx
/ Stripe / Workers-cron, add no new vendor.**

This is a decisive roadmap, not a wishlist. Each feature gets: what it is (in the
customer's words), the job it serves, the lowest-upkeep build on our stack, the
compliance note, and a verdict — **BUILD-NOW**, **FAST-FOLLOW**, or **SKIP**.

---

## The compliance backbone (why most of this is safe)

One rule from D4 makes almost everything here legal without new consent:

> **Replying within an existing inbound conversation is unrestricted.** Quiet
> hours and consent attestation gate only *new outbound conversations*.

Every high-value feature below fires **into a thread the customer started** — they
texted us, or they called our number. That is a reply, not a cold outbound. So:

- Missed-call text-back, after-hours reply, keyword reply → the customer just
  contacted us. Reply-exempt. No consent attestation, no quiet-hours confirm.
- Review link and pay link → sent inside an open conversation with a customer we
  already served. Reply-exempt.
- The one place we must be careful is **scheduled send** and **@mentions** — noted
  inline.

Telnyx's own STOP/HELP keyword auto-handling stays on and profile-scoped (D3); none
of the app auto-replies below duplicate it or fire on an opted-out contact.

---

## Verdicts at a glance

| # | Feature | Verdict | Why |
|---|---------|---------|-----|
| 1 | Missed-call text-back (+ inbound call forward) | **BUILD-NOW** | The #1 buyer gap; our number ignores calls; Telnyx voice is already ours |
| 2 | After-hours / away auto-reply | **BUILD-NOW** | 9pm "no hot water" gets silence today; churns to the rival who auto-replies |
| 3 | Review-request link (one-tap Google review) | **BUILD-NOW** | Highest-ROI post-job text; reviews are existential for a local shop |
| 4 | Text-to-pay link (Stripe) | **BUILD-NOW** | Only "get paid" path; uniquely cheap because Stripe is already wired |
| 5 | Scheduled send / send-later | **FAST-FOLLOW** | Named fast-follow in D11; real value but not a churn driver alone |
| 6 | Template merge-fields (`{first_name}` etc.) | **FAST-FOLLOW** | Removes friction on the most frequent action; tiny, but not load-bearing |
| 7 | @mentions in notes | **FAST-FOLLOW** | Shared-inbox table-stakes; notification pipeline already exists to carry it |
| 8 | Keyword auto-reply | **FAST-FOLLOW** | Useful, but drifts toward marketing-automation bloat for a 1–10 crew |
| 9 | Light reporting (response time / lead volume) | **FAST-FOLLOW** | Owner retention lever; derivable, but not why they *pick* us over a rival |
| 10 | Conversation snooze | **FAST-FOLLOW** | Nice inbox hygiene; not a conversion driver (Quo doesn't even ship it) |
| 11 | Bulk multi-select actions | **SKIP (for now)** | Low volume at 1–10 staff; build only if support tickets ask |
| 12 | Contact merge / dedupe | **SKIP (for now)** | `UNIQUE(company_id, phone)` makes dupes structural-rare; edge-case tool |
| 13 | Appointment-reminder engine | **SKIP (conscious no)** | Needs a scheduler we don't have; the 90% is covered by scheduled send |
| — | Make search more global/prominent | **SKIP (already solved)** | Command-K + FTS + trigram already ship; it's global. Don't re-touch |

---

## BUILD-NOW (the four that move retention)

These four are what a solo owner keeps paying for. They map directly to money
won, money collected, and reputation. Each is small and on-stack.

### 1. Missed-call text-back (+ minimal inbound call forwarding)

**What it is (customer language):** "When a customer calls the number on my truck
and I'm on a roof, they get an instant text back — 'Sorry we missed you, text us
what you need and we'll get right on it' — and it lands in the same inbox."

**The job it serves:** The ICP's number is on trucks, yard signs, and Google.
Customers *call* it. Callers rarely leave voicemail — they dial the next plumber.
Today a call to our Telnyx number is a dead end; we catch texts only. This is the
single biggest hole, and JobText's own D11 already names missed-call text-back
"the headline differentiator for v1.x." Every serious rival (Podium, Weave, Quo)
leads with it.

**Lowest-upkeep build:** Telnyx numbers can already do voice — no new vendor.
- Attach a **voice profile / call-control app** to the per-company number and point
  a `call.hangup` (no-answer) webhook at the Worker.
- On an unanswered inbound call, reuse the existing `dispatchOutbound` path to fire
  **one** canned SMS into (or creating) that contact's thread. Log a
  `conversation_event` so the crew sees "missed call → auto-texted."
- Ship the honest minimum for "the number should answer calls too": **forward-to-
  owner-cell** (Telnyx call forward) with MCTB on no-answer. **Not** an IVR / PBX —
  that's bloat for a 1–10 shop.

**Compliance:** The caller initiated contact → the auto-text is a reply, not cold
outbound (D4). Skip MCTB if the number is on the opt-out mirror. Voice needs a
Telnyx voice profile + connection on the number (SMS-only provisioning must be
extended — see build plan). Standard voice per-min cost (~$0.002/min) is trivial.

**Verdict: BUILD-NOW.** Highest value, lowest upkeep, already promised.

---

### 2. After-hours / away auto-reply

**What it is:** "When someone texts us at 9pm or on Sunday, they instantly hear
'Got your message — we're closed, we'll reply first thing at 8am,' instead of
silence."

**The job it serves:** A solo trade can't watch the inbox after 6pm. Today
JobText's answer is "it waits safely in the inbox" — honest, but the customer hears
nothing and texts a competitor who auto-replies. Table-stakes: every FSM/texting
rival ships a business-hours-aware away message.

**Lowest-upkeep build:** We already compute destination-local hours
(`destinationLocalHour` in `compose.ts`) and store `companies.timezone` (D15).
- Add a company **away-hours / business-hours** setting + one away-message field.
- In the existing inbound webhook path, if the message is the first inbound outside
  business hours and we haven't already auto-replied recently, send one auto-reply.
- Throttle to **once per contact per few hours** so a chatty thread isn't spammed.

**Compliance:** Inbound-triggered reply → reply-exempt (D4). Respect the opt-out
mirror. Do not fire on STOP/HELP (Telnyx handles those). Pairs with MCTB — same
acknowledgement path.

**Verdict: BUILD-NOW.** Cheap, reuses machinery we already have, stops after-hours
churn.

---

### 3. Review-request link (one-tap Google review)

**What it is:** "One tap on a finished job texts the customer our Google review
link — 'Thanks for choosing us! A quick review means a lot: {link}.'"

**The job it serves:** Google star count drives local lead flow; SMS review
requests beat email ~3:1 and routinely *double* review volume. This is the single
highest-ROI post-job text and a top reason trades buy Podium/Weave/Birdeye. Today
we ship it only as a saved reply a human must remember to paste a link into.

**Lowest-upkeep build:** Nearly free on our stack.
- Store the company's **Google review deep-link once** in settings (Place ID →
  `search.google.com/local/writereview?placeid=…`, or the `g.page/r` short link).
  No vendor, no review-aggregation dashboard (that's the Podium bloat we skip).
- Add a one-tap **"Ask for a review"** action in a conversation that sends a saved
  message with `{review_link}` merged in. Reuses templates + send + merge-fields (#6).

**Compliance:** Sent inside an open conversation with a served customer → reply-
exempt. Single-thread, one message — no bulk, compliance-safe under D4. Honor opt-out.

**Verdict: BUILD-NOW.** Small surface, existential value for the ICP. *(We do NOT
build review monitoring/aggregation — copy already says we don't do review
management; keep it that way.)*

---

### 4. Text-to-pay link (Stripe)

**What it is:** "Before I leave the driveway, I tap 'Request payment,' type $180,
and the customer gets a pay link in the thread — paid on the spot."

**The job it serves:** "Get paid" is currently **zero coverage**. The tradesperson
invoices on completion and chases money by email. Text-to-pay is table-stakes in the
trade (a large share of some tools' invoices get paid over text; it beats email
~3:1). This is the feature most likely to make a $29/mo tool feel like it prints
money.

**Lowest-upkeep build:** Uniquely cheap because **Stripe is already in our stack**
for our own billing — no new vendor.
- Owner enters an amount → mint a **Stripe Payment Link / Checkout URL** → drop it
  into the thread via the existing send path.
- Mark paid via the **Stripe webhooks we already handle**. Ship the simple "text a
  link → mark paid" flow; **skip full invoicing / AR** (that's a bigger product).

**Compliance:** Sent inside an existing conversation → reply-exempt. Payment goes
through Stripe's hosted page (PCI handled by Stripe). Standard opt-out honored.

**Verdict: BUILD-NOW.** Best upkeep-to-payoff ratio on the whole list; directly
monetizable and a strong reason-to-switch line.

---

## FAST-FOLLOW (real value, but not this sprint)

### 5. Scheduled send / send-later — **FAST-FOLLOW**
Draft the "on my way" or morning-of confirmation the night before; send a quote
follow-up at a decent hour. Named an explicit out-of-scope fast-follow in D11.
**Build:** a `scheduled_messages` row drained by the existing Workers-cron sweep
(house style), or Telnyx's native `send_at`. **Compliance:** single-recipient only,
NOT broadcast (D4 excludes bulk). A scheduled *new* outbound still runs the consent
+ quiet-hours checks at send time. Real value, but scheduling alone doesn't save a
churning account — sequence it after the money features.

### 6. Template merge-fields (`{first_name}`, `{business_name}`, `{review_link}`) — **FAST-FOLLOW**
Today `templates` store only `{name, body}` with no substitution, so every "Hi
{first name}" is hand-edited on the most frequent action. **Build:** simple token
substitution in the composer over data already loaded (contact + company). Tiny,
and it's a **dependency of #3** (the review link is a merge token), so it rides
along with BUILD-NOW #3 in practice even though standalone it's a fast-follow.

### 7. @mentions in notes — **FAST-FOLLOW**
"@Sam, can you take this quote?" inside a thread, with a notification. This is a
SHARED crew inbox and D24 explicitly says "@mention if/when mentions ship." **Build:**
parse mentions on note write, reuse the existing email/web-push/bell + realtime
broadcast — no new pipeline. **Compliance:** internal-only (direction='note'), never
leaves the tenant. High collaboration value for the 2–10 band; small.

### 8. Keyword auto-reply — **FAST-FOLLOW**
Customer texts HOURS / QUOTE / BOOK and instantly gets the answer. **Build:** a small
`keyword_rules` table matched in the inbound webhook. Useful, but less universally
missed than MCTB/away-reply for a tiny shop, and it's the feature most at risk of
drifting into marketing-automation bloat. Ship after the away-reply proves the
inbound-trigger path.

### 9. Light reporting (response time / lead volume) — **FAST-FOLLOW**
One calm card: median first-response time, new conversations this week, unanswered
>X hrs, review-asks sent. Owners get **zero** reporting today (D14 even defers
done-counts). **Build:** aggregate queries over existing `conversations` /
`conversation_events` / reads — no new store, per the "derive over new heavy tables"
precedent. Keep it to 3–4 numbers; a full analytics suite is bloat for this ICP.
A retention/expansion lever for the owner, but not why they pick us.

### 10. Conversation snooze — **FAST-FOLLOW**
"Remind me about this lead Thursday 8am" without closing it — fills the gap between
passive "waiting" and a full task. **Build:** a `snoozed_until` column the already-
running hourly cron flips back to open. Nice inbox quality, but Quo doesn't even
ship it, so it's a polish touch, not a conversion driver.

---

## SKIP (conscious cuts, with reasons)

### 11. Bulk multi-select actions — **SKIP for now**
Multi-select close/tag/assign is quality-of-life, but the 1–10-staff ICP has low
thread volume so payoff is modest. It's compliance-safe (hygiene, not bulk-SEND
which D4 forbids). **Build only if support tickets ask.** Cheap additive route
taking an id array — trivial to add later; no reason to spend a slot now.

### 12. Contact merge / dedupe — **SKIP for now**
Contacts are `UNIQUE(company_id, phone_e164)` (D7), so duplication is largely
structural-prevented; the mobile-vs-landline case is a rare edge. A manual merge is
a minor tool, not a conversion driver. **Build if CSV/vCard import (D20) actually
generates merge complaints** — until then it's speculative.

### 13. Appointment-reminder *engine* — **SKIP (conscious no)**
Flagged so it's a decision, not an oversight. A full reminder engine (auto reminders
+ smart yes/no confirmation reading) needs a scheduling/calendar system we don't have
and shouldn't build — the ICP runs off Jobber / Housecall Pro / Google Calendar, not
a JobText calendar. **The 90% version is already covered by Scheduled Send (#5):** let
them schedule a manual "confirming your 2pm tomorrow." Building the engine breaks the
low-upkeep rule and turns us into an appointment product. Do not build.

### Search — already global; do not re-touch
The prompt asks whether search needs to be more global/prominent. **No.** JobText
already ships **command-K global search with FTS + trigram** across the inbox
(verified in current-audit). It is already the prominent, global entry point. There
is no gap here — spending effort making it "more global" is motion without value.
Leave it.

---

## BUILD-NOW build plan (dependency-ordered)

The four BUILD-NOW features share two new primitives: an **inbound-trigger auto-send
path** and **merge-field substitution**. Order the work so each step unlocks the next.

**Step 0 — Foundations (shared, do first)**
- **0a. Merge-field substitution** in the composer/send path (`{first_name}`,
  `{business_name}`, `{review_link}`, `{pay_link}`). Small; unblocks #3 and #4's
  message bodies. *(This is fast-follow #6, pulled forward because BUILD-NOW needs it.)*
- **0b. Auto-send guard**: one helper that sends an auto-message into a thread only if
  the contact is not opted out, not STOP/HELP, and not already auto-replied within the
  throttle window. Every auto-reply below routes through it. Reuses `dispatchOutbound`.

**Step 1 — After-hours / away auto-reply (#2)**
- Add `business_hours` + `away_message` to company settings.
- Branch in the inbound webhook: outside hours + first inbound + guard passes → send.
- **Why first:** lowest risk, proves the inbound-trigger + auto-send-guard path end to
  end before we bolt on voice.

**Step 2 — Review-request link (#3) and Text-to-pay link (#4)** *(parallel; both are
one-tap in-thread actions on top of Step 0)*
- **#3:** store `google_review_link` in settings; add "Ask for a review" action →
  send saved message with `{review_link}`.
- **#4:** "Request payment" action → mint Stripe Payment Link → send `{pay_link}`;
  mark paid via existing Stripe webhook.
- **Why together:** both are pure additive send-actions reusing Step 0; no new
  triggers, no voice.

**Step 3 — Missed-call text-back + minimal call forward (#1)** *(largest, do last)*
- Extend number provisioning: attach a Telnyx **voice profile / call-control** app +
  `connection_id` to the per-company number (today it's SMS-only —
  `filter[features]=sms`).
- Add `call.hangup` / no-answer webhook → route through the Step-0b auto-send guard to
  fire the canned MCTB SMS into the thread; log a `conversation_event`.
- Add owner **forward-to-cell** setting (Telnyx call forward) with MCTB on no-answer.
- **Why last:** it's the only one that touches provisioning and adds a new channel
  (voice); by now the auto-send path (Step 1) and thread-creation are proven, so the
  voice work is isolated to Telnyx config + one webhook.

---

## 12-line summary (BUILD-NOW set + top reason each)

1. BUILD-NOW set = 4 features: Missed-call text-back, After-hours auto-reply, Review link, Text-to-pay.
2. Missed-call text-back — the #1 buyer gap: our number ignores calls; every rival leads with it; D11 already names it the headline differentiator; Telnyx voice is already ours (no vendor).
3. After-hours auto-reply — a 9pm "no hot water" gets silence today and churns to the rival who auto-replies; reuses timezone + quiet-hours machinery we already have.
4. Review-request link — the single highest-ROI post-job text; Google reviews are existential for a local shop; near-free (store one link, reuse send + templates).
5. Text-to-pay link — the only "get paid" path, currently zero coverage; uniquely cheap because Stripe is already wired for our own billing.
6. All four are compliance-safe: each fires into a thread the customer started (call or text), so under D4 they are replies, not gated cold outbound.
7. All four honor the lowest-upkeep rule: Telnyx voice-on-existing-numbers, Stripe payment links, Workers-cron/inbound webhooks, Supabase — no new vendor.
8. Build order: (0) merge-fields + a shared auto-send guard, (1) after-hours reply, (2) review + pay links in parallel, (3) missed-call text-back + call forward last.
9. Fast-follows (next, not now): scheduled send, merge-fields as a standalone, @mentions, keyword auto-reply, light reporting, snooze.
10. Skips with reason: bulk actions (low volume) and contact merge (dupes are structurally rare) — build only if support asks.
11. Conscious no: a full appointment-reminder engine — needs a scheduler we shouldn't build; scheduled send covers the 90%.
12. Search needs nothing — command-K + FTS + trigram already ship as a global, prominent surface; leave it alone.
