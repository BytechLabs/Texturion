# Loonext — Feature Gaps: the small features worth adding

Owner: product. Decided 2026-07-03 (revised after critique). Lens: what a plumber /
HVAC / landscaper / cleaner / electrician / salon owner actually needs from a shared
SMS inbox that Loonext does **not** provide today. Grounded in the current-audit
(verified in `apps/api/src`), the competitor scan, the trades ICP, and a compliance
pass. Every option honors the product's one hard constraint: **lowest possible
upkeep — reuse Supabase / Telnyx / Stripe / Workers-cron, add no new vendor.**

This is a decisive roadmap, not a wishlist. Each feature gets: what it is (in the
customer's words), the job it serves, the lowest-upkeep build on our stack, the
compliance note, and a verdict — **BUILD-NOW**, **FAST-FOLLOW**, or **SKIP**.

**What changed in this revision (read this first):**
- **Text-to-pay was moved out of BUILD-NOW** to the top FAST-FOLLOW slot. The old
  "reuse existing Stripe — no new vendor" claim does **not** survive the
  on-behalf-of-merchant test: our Stripe wiring collects *Loonext's own* subscription
  revenue into *Loonext's own* bank account. Routing a customer's $180 into the
  *plumber's* bank account is **Stripe Connect** — per-merchant KYC onboarding,
  payouts, merchant-routed refunds/disputes, and 1099-K reporting. That is the
  single largest, highest-*ongoing*-upkeep item on the list, not a cheap send-action.
  It stays near-term and monetizable, but as its own project. **The disqualifying
  test, stated once so it's reusable: "reuse existing Stripe" only holds for money
  that lands in Loonext's account. The moment money must land in the customer's
  account, it's Connect, and it's a project.**
- **BUILD-NOW is now three**: missed-call text-back, after-hours auto-reply, review
  link. This trio genuinely reuses existing machinery and is retention-load-bearing.
- **A new BUILD-NOW Step 0, "Keep your existing business number," was added** — it is
  a bigger adopt-vs-churn driver than any single feature below, and it was effectively
  absent before. Every other feature is dead if it fires from a number the owner's
  customers don't recognize.
- **The compliance backbone was split into two gates (consent vs 10DLC content)** and
  the missed-call and after-hours mechanics were corrected against how Telnyx and the
  2025 opt-out rules actually work.

---

## The compliance backbone (why most of this is safe — and the two gates it must pass)

The old backbone leaned on one rule and treated "the customer contacted us first" as
a blanket pass. That conflated **two independent gates**. A message must clear **both**:

### Gate 1 — CONSENT (TCPA): reply-exempt inside an active conversation
> **Replying within an existing inbound conversation is unrestricted for consent.**
> Quiet hours and consent attestation gate only *new outbound conversations* (D4).

Missed-call text-back, after-hours reply, and keyword reply fire **into a thread the
customer just started** (they texted or called). That is a reply → no consent
attestation, no quiet-hours confirm. **But two caveats the old doc missed:**

- **"Reply" is recency-scoped.** The exemption covers responding, in-topic, inside the
  *active* conversation window. A **review ask on a job the crew finished days ago** is
  (a) often **cold** — the last inbound may be long past — and (b) widely treated as
  **promotional**. When the thread is cold, a review send is a *new outbound*, not a
  reply. **Rule: if the last inbound is older than the reply window (product picks
  24–72h), route the send through the consent-attestation + quiet-hours path, not the
  reply-exempt path. Quiet hours apply to review sends regardless.**
- **Opt-out is "any reasonable method," not just STOP.** Per the FCC rule effective
  April 11, 2025, a customer revokes consent by any clear method — "stop texting me,"
  "take me off your list," a phone call, an email — not only the Telnyx STOP keyword,
  honored within 10 business days. Every unattended auto-send below must check a
  company opt-out mirror that captures **informal opt-outs**, not just the carrier
  keyword. This is load-bearing: every BUILD-NOW feature routes through the guard.

### Gate 2 — 10DLC CONTENT / CAMPAIGN (carrier): the number must be *registered* to emit this content
Consent is not enough. Carriers filter on whether **message content matches the
registered 10DLC campaign**. The BUILD-NOW features deliberately widen what the number
emits — a Google **review URL** (#3), and later a Stripe **pay URL** (fast-follow #4).
**Embedded URLs are a specific carrier-scrutiny trigger.** A number registered as
SMS-only "customer care" that starts sending review/pay links is emitting *undeclared
content* and gets silently filtered or campaign-suspended **regardless of consent**.
This is gated in **Step 0c** below, as a BUILD-NOW prerequisite — not a footnote.

Telnyx's own STOP/HELP keyword auto-handling stays on and profile-scoped (D3); no app
auto-reply below duplicates it or fires on an opted-out contact.

---

## Verdicts at a glance

| # | Feature | Verdict | Why |
|---|---------|---------|-----|
| 0 | **Keep your existing business number** (port-in / text-enable landline) | **BUILD-NOW** | The real adopt-vs-churn decider; every feature is dead from a number customers don't recognize |
| 1 | Missed-call text-back (core) + forward-to-cell (thin follow-on) | **BUILD-NOW** | The #1 buyer gap; our number ignores calls; Telnyx voice is already ours |
| 2 | After-hours / away auto-reply (owner-authored, emergency-aware) | **BUILD-NOW** | 9pm "no hot water" gets silence today; churns to the rival who auto-replies |
| 3 | Review-request link (one-tap Google review, **manual only**) | **BUILD-NOW** | Highest-ROI post-job text; reviews are existential for a local shop |
| 4 | **Text-to-pay (Stripe Connect)** | **FAST-FOLLOW (top)** | High-value & monetizable, but it's a Connect project (KYC, payouts, disputes, 1099-K), not a send-action |
| 5 | Scheduled send / send-later | **FAST-FOLLOW** | Named fast-follow in D11; real value but not a churn driver alone |
| 6 | Template merge-fields (`{first_name}` etc.) | **FAST-FOLLOW** | Removes friction on the most frequent action; a **dependency of #3**, so it rides along in BUILD-NOW Step 0 |
| 7 | @mentions in notes | **FAST-FOLLOW** | **3–10 crew band only** — a solo owner has no one to @mention |
| 8 | Keyword auto-reply | **FAST-FOLLOW** | Useful, but drifts toward marketing-automation bloat for a 1–10 crew |
| 9 | Light reporting (leads / missed / paid / reviews) | **FAST-FOLLOW** | Owner retention lever; reframed around money & lead-loss, not latency |
| 10 | Conversation snooze | **FAST-FOLLOW** | **3–10 crew band only** — a solo owner doesn't triage a queue |
| 11 | Bulk multi-select actions | **SKIP (for now)** | Low volume at 1–10 staff; build only if support tickets ask |
| 12 | Contact merge / dedupe | **SKIP (for now)** | `UNIQUE(company_id, phone)` makes dupes structural-rare; edge-case tool |
| 13 | Appointment-reminder engine | **SKIP (conscious no)** | Needs a scheduler we don't have; the 90% is covered by scheduled send |
| — | Make search more global/prominent | **SKIP (already solved)** | Command-K + FTS + trigram already ship; it's global. Don't re-touch |

---

## BUILD-NOW (the four that move retention: keep-your-number + three send-triggers)

These are what a solo owner keeps paying for. #0 gets his customers' calls and texts
onto our rails at all; #1–#3 map to money won, money collected-later, and reputation.
Each is small and on-stack.

### 0. Keep your existing business number

**What it is (customer language):** "I've had the same number on my truck, my yard
signs, and my Google listing for ten years. I'm not printing new trucks. Put Loonext
on *my* number."

**The job it serves — this is the adopt-vs-churn decider.** An established owner will
**not** hand his customers a new number to get a texting inbox. If MCTB, after-hours,
and review all fire from a number his callers don't recognize, they're worthless — and
a 50-year-old owner reads "here's your new Loonext number" as "lose my customers" and
walks. This is a **bigger adopt driver than any single feature #1–#3**, and it was
effectively missing before. It is Step 0 of the build for a reason: every feature is
dead until his number is on our rails.

**Lowest-upkeep build — two Telnyx-native paths, no new vendor:**
- **(a) Port-in:** port the company's existing business line to Telnyx so Loonext owns
  SMS **and** voice on the number they already advertise.
- **(b) Text-enable-my-landline:** for owners who won't port (or whose voice must stay
  on their current carrier), host **SMS on the existing landline/number** and leave
  voice where it is. This is the path for the owner who says "don't touch my phone."
- **Bridge honestly in the product copy:** state the port timeline (~1–4 weeks) and
  offer **forward during port** so no call is lost mid-cutover. Don't hide the timeline;
  the owner has heard "instant" and been burned.

**Compliance:** Number provisioning/porting is standard Telnyx; **this is where the
10DLC campaign (Step 0c) gets registered for the ported number.** A text-enabled
landline still needs its 10DLC brand/campaign.

**Verdict: BUILD-NOW (Step 0).** Nothing else adopts without it.

---

### 1. Missed-call text-back — core; forward-to-cell is a thin follow-on

**What it is (customer language):** "When a customer calls the number on my truck and
I'm on a roof, they get an instant text back — 'Sorry we missed you — what's the issue
and what's your address? We'll text you a window.' — and it lands in the same inbox,
and my whole crew's phones light up so nobody misses the lead."

**The job it serves:** Callers to the advertised number rarely leave voicemail — they
dial the next plumber (call-to-close drops from ~60–75% at 5 minutes to ~20% at 30).
Today a call to our number is a dead end; we catch texts only. This is the single
biggest hole and D11 names missed-call text-back "the headline differentiator for
v1.x." Every serious rival (Podium, Weave, Quo) leads with it.

**Scope it so the text drives to a decision, not a new dead-end** (this is the
difference between "demos well" and "retains"):
1. **The canned reply asks ONE booking-forward question** — "What's the issue and
   what's your address? We'll text you a window." — **not** a limp "text us what you
   need." One message (compliance), but a message that moves toward booking.
2. **The miss generates a loud, distinct alert to the whole crew's devices** (push +
   the device that missed the call), not a quiet `conversation_event`. The owner's real
   fear is a lead sitting *unseen*. A silent log recreates the exact failure MCTB exists
   to fix.
3. **MCTB routes into the SAME thread** as any prior texts from that contact, so the
   crew has the history in one place.

**Split the build honestly — core vs telephony follow-on:**

**(a) MCTB core = the true BUILD-NOW.** "Missed" is **not** a passive webhook. There is
no `call.hangup` variant that by itself means "rang but nobody answered" — `call.hangup`
fires on *every* call, and `hangup_cause`/`hangup_source` alone cannot tell a declined
call from a completed one. You **compute** the miss by actively running the call:
- On `call.initiated`, **dial/transfer** the leg with an explicit `timeout_secs`.
- The **miss trigger** = that leg ends unanswered (dial timeout / no bridge / voicemail)
  **OR** the caller hangs up first (`originator_cancel` before bridge).
- **Add AMD (answering-machine detection).** Without it, "forwarded to cell → went to
  carrier voicemail" reads as *answered* and MCTB is skipped — the exact case the
  feature exists for. Telnyx AMD runs on the outbound/forwarded leg (~97% accuracy).
- On a confirmed miss → send the canned SMS **through the Step-0b guard** into the
  thread, fire the crew alert, log the event.

**(b) Forward-to-cell = a thin follow-on *within* #1, called out as the part that needs
care.** It is the trickiest telephony in the whole roadmap and must not silently expand
before the text-back value is live:
- **Two-leg billing:** a forwarded call bills the inbound leg **and** the outbound leg
  to the owner's mobile, both metered full duration — a 6-minute call is ~12 leg-minutes.
  **Cap forward ring time via `timeout_secs`** to bound spend.
- No-answer timeout tuning so MCTB fires at the right moment; caller-ID and
  voicemail-vs-forward race behavior handled.
- **Ship (a) first even inside Step 2/3;** (b) is the optional completion of #1. We are
  **not** building IVR/PBX — that's bloat for a 1–10 shop.

**Cost & upkeep — do not undercount (the old "one webhook, trivial" line was wrong):**
- Voice is a **new always-on ingestion path**: voice webhooks for every inbound call,
  each must be `200 OK`'d.
- Provisioning is bigger than "extend the SMS-only filter": DIDs must be
  **voice-capable**; a **Call Control application/connection must be created and
  associated with every company number** — at onboarding *and* for every future number.
- Cost = small per-minute **plus a per-number monthly voice/DID charge** (previously
  omitted) + the two-leg forward billing above.

**Compliance:** Caller initiated → the auto-text is a reply (Gate 1). Skip if the number
is on the opt-out mirror (any-reasonable-method). No new content URL in the MCTB body,
so Gate 2 is satisfied by the base care campaign.

**Verdict: BUILD-NOW.** Highest value; core is small; forward-to-cell is fenced as a
follow-on so telephony plumbing can't swallow the sprint.

---

### 2. After-hours / away auto-reply (owner-authored, emergency-aware)

**What it is:** "When someone texts us at 9pm or on Sunday, they instantly hear —
in *my* words — 'Got your message. For emergencies call/text NOW and we'll get right on
it — otherwise we'll reply first thing at 8am,' instead of silence."

**The job it serves:** A solo trade can't watch the inbox after 6pm. Today the answer
is "it waits safely in the inbox" — honest, but the customer hears nothing and texts a
rival who auto-replies. Table-stakes.

**Do NOT hard-code "we're closed."** For plumbing/HVAC the 9pm "no hot water" or "no
heat in January" **is the emergency-premium job** — the highest-margin call the owner
gets. An away message that says "we're closed till 8am" hands his best after-hours lead
to the competitor who "does emergencies," and a skeptical owner will simply never turn
the feature on. **Ship the away string as owner-authored and emergency-aware by
default**, fully editable. This is the difference between the owner enabling it and never
touching it — and it's a copy/config change, not new engineering.

**Lowest-upkeep build — and note it is a DIFFERENT clock than quiet-hours:**
- **Business-hours is its own company setting, distinct from per-contact quiet-hours.**
  Quiet-hours = the recipient-protection clock (`destinationLocalHour`, per contact).
  Business-hours = the *shop's* open-hours clock. Gating an away-reply on the *contact's*
  destination-local hour is the wrong clock and will misfire. (The old doc wrongly said
  this "reuses quiet-hours machinery" — it does not; it's a new company-level window.)
- Add a company **business-hours window** + one **owner-authored away-message** field.
- In the inbound webhook: outside business hours + first inbound + guard passes → send
  one auto-reply. Throttle keyed on inbound events (see Step 0b), not wall-clock.

**Compliance:** Inbound-triggered reply → reply-exempt (Gate 1). Respect the opt-out
mirror. Do not fire on STOP/HELP/START keyword inbounds (they still hit the webhook).
No new content URL → Gate 2 satisfied by the base care campaign.

**Verdict: BUILD-NOW.** Cheap, proves the inbound-trigger + auto-send-guard path,
stops after-hours churn — *if* the copy is the owner's, not ours.

---

### 3. Review-request link (one-tap Google review — **manual only, by design**)

> **SUPERSEDED — the Reviews feature was removed entirely (see DECISIONS D32).** The
> one-tap ask went first (issue #2); the owner then cut the whole surface ("remove the
> Reviews section completely, we don't need that"). The Settings page, nav entry,
> `companies.google_review_link` column, and the `{review_link}` merge token are all gone.
> The rationale below is kept as history of why it was built.

**What it is:** "One tap on a finished job texts the customer our Google review link —
'Thanks for choosing us! A quick review means a lot: {link}.'"

**The job it serves:** Google star count drives local lead flow; SMS review requests beat
email ~3:1 and routinely *double* review volume. Highest-ROI post-job text and a top
reason trades buy Podium/Weave/Birdeye. Today we ship it only as a saved reply a human
must remember to paste a link into.

> **Non-goal (deliberate, do not "upgrade" this):** Review asks are **ALWAYS a manual,
> one-tap, human action — NEVER an automated sequence.** Hard-capped at **one ask per
> job**, and **auto-suppressed once the customer replies or clicks.** This is an
> explicit anti-churn / anti-spam decision, not a missing capability. Trades themselves
> report a multi-text review sequence earns a 1-star review "out of spite," and canned
> automated asks produce canned reviews Google discounts. An owner burned by Podium's
> aggressive sequences assumes "review automation" = spam. No future sprint turns this
> into a drip campaign, and keyword-auto-reply (#8) must never be pointed at review asks.

**Lowest-upkeep build — nearly free on our stack:**
- Store the company's **Google review deep-link once** in settings (Place ID →
  `search.google.com/local/writereview?placeid=…`, or the `g.page/r` short link). No
  vendor, no review-aggregation dashboard (that's the Podium bloat we skip).
- One-tap **"Ask for a review"** action → sends a saved message with `{review_link}`
  merged in. Reuses templates + send + merge-fields (Step 0a).

**Compliance — this is the one BUILD-NOW send that is often *cold*, so it clears both
gates carefully:**
- **Gate 1 (consent):** A review ask on a *finished* job is frequently outside the active
  window and is treated as promotional — so it is **not** categorically reply-exempt. Add
  the **thread-recency branch** to the Step-0b guard: if last inbound is within the reply
  window → send as reply; if the thread is **cold** → route through the
  consent-attestation + **quiet-hours** path. **Quiet hours apply to review sends
  regardless.** Honor the opt-out mirror (any reasonable method).
- **Gate 2 (10DLC content):** the review URL is *new emitted content*. It must be covered
  by the company's 10DLC campaign — see Step 0c (register the review deep-link domain;
  add a review-ask sample message).

**Verdict: BUILD-NOW.** Small surface, existential value. *(We do NOT build review
monitoring/aggregation — copy already says we don't do review management; keep it that
way.)*

---

## FAST-FOLLOW (real value, but not this sprint)

### 4. Text-to-pay (Stripe **Connect**) — **FAST-FOLLOW (top of the list)**
The only "get paid" path, currently zero coverage, and genuinely monetizable — but it is
**its own project, not a Step-2 send-action.** The disqualifying detail: our existing
Stripe wiring collects *Loonext's own* subscription revenue into *Loonext's own* bank
account. Routing a customer's $180 into the *plumber's* bank account is **Stripe Connect
(Express connected accounts)**, which competitors (Podium, Weave) run for exactly this
reason. A plain Payment Link would deposit the customer's money into *Loonext* — wrong,
and a money-transmission/liability problem.

**Real shape (scope it honestly):**
- **Per-company Stripe Connect Express onboarding + KYC**, gating the "Request payment"
  action until the owner completes Stripe onboarding (thousands of shops, each a KYC flow).
- **Payouts** to the merchant; **refunds/disputes routed to the merchant**; **1099-K tax
  reporting.** These are *ongoing* support surfaces (onboarding tickets, payout questions,
  dispute handling), not one-time build.
- Delete any "no new vendor / uniquely cheap because Stripe is already wired" framing — it
  is false for on-behalf-of-merchant money.

**Preserve these two owner-facing truths from the trades lens when it ships:**
- **Require a free-text memo/reference field** (job address or invoice #) mapped to the
  Stripe payment description, so a charge is identifiable at month-end reconciliation
  instead of a bare, memo-less line.
- **Position it as "collect a deposit / get paid on the spot," NOT replace-your-invoicing**,
  and state in the copy that **it does not sync to QuickBooks** (point owners at Stripe's
  own QuickBooks connector as their reconciliation path — Loonext does not build AR). Set
  that expectation up front or the owner takes one payment, hits month-end, and turns it off.

**Why fast-follow, not skip:** high value, directly monetizable, strong reason-to-switch —
it belongs on the near-term roadmap, just scoped and staffed as the standalone Connect
project it is.

### 5. Scheduled send / send-later — **FAST-FOLLOW**
Draft the "on my way" or morning-of confirmation the night before; send a quote follow-up
at a decent hour. Named an explicit out-of-scope fast-follow in D11. **Build:** a
`scheduled_messages` row drained by the existing Workers-cron sweep (house style), or
Telnyx's native `send_at`. **Compliance:** single-recipient only, NOT broadcast (D4
excludes bulk). A scheduled *new* outbound re-runs consent + quiet-hours **and re-checks
the opt-out mirror at send time** (state may have changed between schedule and fire).

### 6. Template merge-fields (`{first_name}`, `{business_name}`, `{review_link}` *(removed — see DECISIONS D32)*) — **FAST-FOLLOW (pulled into BUILD-NOW Step 0)**
Today `templates` store only `{name, body}` with no substitution, so every "Hi {first
name}" is hand-edited on the most frequent action. **Build:** simple token substitution
over data already loaded (contact + company). It's a **dependency of #3** (the review
link is a merge token), so it ships in BUILD-NOW **Step 0a** even though standalone it's a
fast-follow.

### 7. @mentions in notes — **FAST-FOLLOW — 3–10 crew band ONLY**
"@Sam, can you take this quote?" inside a thread, with a notification. **This is for the
3–10 crew band only; a solo/duo owner IS the inbox and has no one to @mention — do not
prioritize it for the skeptical solo-owner persona.** D24 says "@mention if/when mentions
ship." **Build:** parse mentions on note write, reuse the existing email/web-push/bell +
realtime broadcast — no new pipeline. **Compliance:** internal-only (`direction='note'`),
never leaves the tenant.

### 8. Keyword auto-reply — **FAST-FOLLOW**
Customer texts HOURS / QUOTE / BOOK and instantly gets the answer. **Build:** a small
`keyword_rules` table matched in the inbound webhook. **Hard rail (compliance):** a rule
may fire **at most one reply per matching inbound** and can **never initiate or fan-out**,
and must route through the Step-0b guard. Less universally missed than MCTB/away-reply for
a tiny shop, and most at risk of drifting into marketing-automation bloat. Never point it
at the review ask (see #3 non-goal). Ship after away-reply proves the inbound-trigger path.

### 9. Light reporting — **FAST-FOLLOW (reframed around money & lead-loss)**
One calm card built around **what the owner loses sleep over, not response-time
percentiles**: **new leads this week**, **calls/texts we missed and did NOT reply to** (the
leak he actually fears), **jobs where we asked for / got paid**, **reviews asked**. **Keep
median-first-response-time out of the headline (or drop it)** — a latency percentile reads
as "built for a call-center manager grading my crew," which repels this ICP. **Build:**
aggregate queries over existing `conversations` / `conversation_events` / reads — no new
store (per the "derive over new heavy tables" precedent). 3–4 numbers, not an analytics
suite.

### 10. Conversation snooze — **FAST-FOLLOW — 3–10 crew band ONLY**
"Remind me about this lead Thursday 8am" without closing it. **This is for the 3–10 crew
band only; a solo/duo owner doesn't triage a queue and won't touch it — do not prioritize
it for the solo-owner persona.** **Build:** a `snoozed_until` column the already-running
hourly cron flips back to open. Quo doesn't even ship it — polish, not a conversion driver.

---

## SKIP (conscious cuts, with reasons)

### 11. Bulk multi-select actions — **SKIP for now**
Multi-select close/tag/assign is quality-of-life, but the 1–10-staff ICP has low thread
volume so payoff is modest. Compliance-safe (hygiene, not bulk-SEND, which D4 forbids).
**Build only if support tickets ask.** Cheap additive route taking an id array — trivial
later; no reason to spend a slot now.

### 12. Contact merge / dedupe — **SKIP for now**
Contacts are `UNIQUE(company_id, phone_e164)` (D7), so duplication is largely
structural-prevented; the mobile-vs-landline case is a rare edge. **Build if CSV/vCard
import (D20) actually generates merge complaints** — until then it's speculative.

### 13. Appointment-reminder *engine* — **SKIP (conscious no)**
Flagged so it's a decision, not an oversight. A full reminder engine (auto reminders +
smart yes/no confirmation reading) needs a scheduling/calendar system we don't have and
shouldn't build — the ICP runs off Jobber / Housecall Pro / Google Calendar, not a Loonext
calendar. **The 90% is already covered by Scheduled Send (#5):** let them schedule a manual
"confirming your 2pm tomorrow." Building the engine breaks the low-upkeep rule and turns us
into an appointment product. Do not build.

### Search — already global; do not re-touch
**No.** Loonext already ships **command-K global search with FTS + trigram** across the
inbox (verified in current-audit). It is already the prominent, global entry point. No gap
here — making it "more global" is motion without value. Leave it.

---

## BUILD-NOW build plan (dependency-ordered)

The BUILD-NOW features share a small set of new primitives: **number-on-our-rails**, an
**inbound-trigger auto-send path** (with a hardened guard), and **merge-field
substitution**. Order the work so each step unlocks the next — and note the re-order from
the prior plan: **after-hours proves the trigger path first, then the headline MCTB, then
review.** MCTB is no longer buried behind review/pay: text-to-pay is a separate fast-follow
project, so there is no "two parallel send-actions" reason to defer the #1 differentiator to
last. MCTB's *only* real dependency is the Step-0b guard.

**Step 0 — Keep your existing number (#0) + shared foundations (do first)**
- **0-number. Number-on-our-rails:** port-in **or** text-enable the company's existing line
  (both Telnyx-native). Nothing else adopts until the owner's advertised number is ours.
  State the ~1–4 week port timeline + forward-during-port bridge in the product copy.
- **0a. Merge-field substitution** in the composer/send path (`{first_name}`,
  `{business_name}`, `{review_link}` *(removed — see DECISIONS D32)*). Small; unblocks #3's
  body. *(Fast-follow #6, pulled forward.)*
- **0b. Auto-send guard** — one helper every auto-message routes through. It sends only if:
  - the contact is **not on the opt-out mirror** (mirror captures **any-reasonable-method**
    opt-outs — informal "stop texting me," email, call — not only the Telnyx STOP keyword);
  - the inbound is **not** itself an automated/system message, and the number did **not**
    just receive our auto-reply (**loop guard** against bot-to-bot spam);
  - the inbound body is **not** a STOP/HELP/START keyword (those still hit the webhook);
  - the **throttle is keyed on inbound events**, not wall-clock, so a burst yields one reply;
  - **thread-recency branch:** if the send carries new content (review link) **and** the
    last inbound is older than the reply window (24–72h, product picks), route through the
    consent-attestation + quiet-hours path instead of reply-exempt. Quiet hours always apply
    to review sends.
- **0c. 10DLC content/campaign prerequisite (gates #3, and later fast-follow #4):** confirm
  the company's 10DLC use-case is **mixed** (or its declared use-case + sample messages
  cover post-sale review solicitation, and later transactional pay links). **Register the
  review deep-link domain** (and later the Stripe pay-link domain) as URLs that will appear;
  **add a review-ask sample message** (and later a pay-link sample); **put the brand name in
  the body.** A care-only campaign that starts emitting review/pay URLs gets carrier-filtered
  regardless of consent — so this is a **BUILD-NOW prerequisite, not a footnote.**

**Step 1 — After-hours / away auto-reply (#2)**
- Add a **company business-hours window** (its own clock, distinct from per-contact
  quiet-hours) + one **owner-authored, emergency-aware away-message** field (do NOT
  hard-code "we're closed").
- Branch in the inbound webhook: outside business hours + first inbound + Step-0b guard
  passes → send one reply.
- **Why first:** lowest risk, no new content URL, no voice. Proves the inbound-trigger +
  auto-send-guard path end to end before anything is bolted on.

**Step 2 — Missed-call text-back (#1 core) — the headline differentiator, ship it here**
- Extend provisioning: **voice-capable DIDs**; create + **associate a Call Control
  app/connection per company number** (across the whole base, and for every future number);
  stand up the **voice-webhook ingestion path** (new always-on upkeep, `200 OK` each).
- **Compute the miss** (not a passive `call.hangup`): on `call.initiated`, dial/transfer
  with `timeout_secs`; miss = leg ends unanswered **or** `originator_cancel` before bridge;
  add **AMD** so carrier-voicemail isn't misread as answered.
- On a confirmed miss → Step-0b guard → send the **booking-forward** canned SMS into the
  **same thread**; fire a **loud crew-wide alert** (push + the device that missed); log the
  event.
- **Why here, not last:** it's the #1 buyer gap and its only dependency is the Step-1 guard.
  No reason to gate it behind review. Keep its voice-provisioning work isolated.

**Step 2b — Forward-to-cell (thin follow-on within #1, optional completion)**
- Owner **forward-to-cell** setting via Telnyx call forward, with **`timeout_secs`-capped
  ring** to bound the **two-leg** billing (inbound + outbound-to-mobile, both metered).
- No-answer timeout tuned so MCTB still fires on carrier-voicemail (AMD). **Ship 2 before 2b**
  so text-back value is live before telephony plumbing. **No IVR/PBX.**

**Step 3 — Review-request link (#3)** — **REMOVED, see DECISIONS D32.** Shipped, then cut
entirely (Settings page, `companies.google_review_link` column, and `{review_link}` token all
gone). Kept here as the historical build plan:
- Store `google_review_link` in settings; add the **manual one-tap "Ask for a review"**
  action → send saved message with `{review_link}`.
- Enforce the **non-goal**: one ask per job, auto-suppress on reply/click, never automated.
- Runs through Step-0b's **thread-recency + quiet-hours** branch (cold-thread review = new
  outbound) and requires **Step 0c** registration to be live.
- **Why last of the three:** it's the only one that emits a new content URL (needs 0c) and
  is often a cold-thread send (needs the recency branch) — so it's correctly sequenced after
  the guard and campaign work are proven.

---

## 12-line summary (BUILD-NOW set + top reason each)

1. BUILD-NOW set = **3 send-features + 1 foundation**: **Keep-your-number (#0)**,
   Missed-call text-back, After-hours auto-reply, Review link. **Text-to-pay moved to
   top FAST-FOLLOW** — it's a Stripe **Connect** project (KYC, payouts, disputes, 1099-K),
   not a send-action; "reuse existing Stripe" fails the on-behalf-of-merchant test.
2. **Keep your existing number (#0)** — the real adopt-vs-churn decider: port-in or
   text-enable the owner's advertised line (both Telnyx-native). Every feature is dead from
   a number his customers don't recognize.
3. Missed-call text-back — the #1 buyer gap. "Missed" is **computed** (dial + `timeout_secs`
   + AMD), not a passive `call.hangup`; the reply asks a **booking-forward question** and
   fires a **loud crew alert** into the same thread. Voice adds a new channel + per-number
   provisioning + two-leg forward billing — planned, not a one-liner.
4. After-hours auto-reply — a 9pm "no hot water" is the **emergency-premium job**; the away
   message is **owner-authored and emergency-aware** (never hard-coded "we're closed"), on
   its own **business-hours clock** (distinct from per-contact quiet-hours).
5. Review link — highest-ROI post-job text; **manual one-tap ONLY, one per job, never a
   sequence** (anti-spam non-goal); near-free (store one link, reuse send + templates).
6. **Two compliance gates, not one:** Gate 1 CONSENT (reply-exempt inside the active window;
   opt-out via **any reasonable method**, not just STOP) and Gate 2 **10DLC CONTENT** (the
   number must be *registered* to emit review/pay URLs — Step 0c).
7. Cold-thread review sends are **not** categorically reply-exempt: the Step-0b guard has a
   **thread-recency branch** routing cold sends through consent + quiet-hours; quiet hours
   always apply to review sends.
8. Lowest-upkeep honored — Telnyx voice/porting on the owner's own number, Workers-cron /
   inbound + voice webhooks, Supabase — no new vendor for BUILD-NOW. (Text-to-pay's Connect
   onboarding is the one real added upkeep, which is why it's a separate fast-follow.)
9. Build order: **(0)** keep-your-number + merge-fields + hardened auto-send guard + 10DLC
   registration → **(1)** after-hours reply (proves the trigger path) → **(2)** missed-call
   text-back (the headline, only needs the guard) → **(2b)** forward-to-cell → **(3)** review
   link.
10. Fast-follows (next, not now): **text-to-pay (Connect)** first, then scheduled send,
    merge-fields as standalone, @mentions **(3–10 crew only)**, keyword auto-reply, light
    reporting **(money & lead-loss framed, not latency)**, snooze **(3–10 crew only)**.
11. Skips with reason: bulk actions (low volume), contact merge (dupes structurally rare),
    appointment-reminder engine (scheduler we shouldn't build; scheduled send covers 90%).
12. Search needs nothing — command-K + FTS + trigram already ship as a global, prominent
    surface; leave it alone.
