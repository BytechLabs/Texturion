# FEATURE-GAPS — compliance + platform-eng review

Reviewer lens: compliance + platform engineer. Scope: verify, for every
outbound-message feature in `FEATURE-GAPS.md`, that opt-out enforcement +
10DLC/consent still hold and it does not create a spam/keyword-campaign problem;
and for call-forward / missed-call text-back, verify the Telnyx voice reality and
whether it is truly low-upkeep. Date: 2026-07-03.

Verdict on the doc's product calls: **the BUILD-NOW/FAST-FOLLOW/SKIP ranking is
sound.** Two things are wrong and load-bearing: (A) the compliance backbone
over-reads the "reply is exempt" rule — it is true for *consent* but does **not**
exempt content from 10DLC campaign-registration rules, and it is topic/time-scoped
in ways review-requests and pay-links strain; (B) the missed-call-text-back voice
mechanic as written **will not fire** and is **not** the low-upkeep "one webhook"
the doc claims. Fixes below are exact.

---

## A. Compliance — the backbone is half-right (fix required)

### A1. The "reply-exempt" rule exempts CONSENT, not 10DLC campaign content. (blocking)

The doc's backbone (lines 18-34, and every per-feature "reply-exempt (D4)" note)
treats "the customer texted/called us first" as a blanket pass. It is a real,
correct rule — but **only for consent**. CTIA conversational-messaging: if the
consumer initiates and the business responds with *relevant* information, no
opt-in is expected. That is a **TCPA/consent** carve-out.

It does **nothing** for the *other* gate every one of these messages passes
through: the message content must match the **registered 10DLC campaign**. Sample
messages, use-case, and description are vetted; carriers filter traffic that
diverges from what was registered. A number registered for "customer care /
conversational" that starts emitting **payment links, review-request links, and
promotional copy** is sending content the campaign did not declare — that is how
you get silent carrier filtering and eventual campaign suspension, independent of
whether consent was fine.

**Why this matters here:** the four BUILD-NOW features deliberately widen what the
number sends — a Stripe URL (#4), a Google review URL (#3), an after-hours
auto-reply (#2), a canned missed-call text (#1). Embedded URLs are specifically a
carrier-scrutiny trigger. The doc never mentions the campaign registration at all.

**Fix (exact):** Add a subsection to the compliance backbone and to the Step-0
foundations:
- Before shipping #3/#4, confirm the company's 10DLC campaign use-case is
  **mixed** (or that its declared use-case + sample messages cover transactional
  payment links and post-sale review solicitation). If numbers were registered
  SMS-only "customer care," the sample-message set must be updated to include a
  pay-link sample and a review-ask sample, or a mixed use-case re-registered.
- Register the **Stripe pay-link domain and the review deep-link domain** as the
  actual URLs that will appear, and use a consistent branded/company sender
  identity in the body (brand name in the message) — this is the CTIA
  content/URL-handling tightening from the Oct-2025 update.
- Make this a **BUILD-NOW prerequisite**, not a footnote. It is cheap (a
  registration/settings check) but it is the difference between "compliant" and
  "delivered."

### A2. Review-request and pay-link are the topic-shift edge, not clean replies. (fix wording + guard)

The doc calls review-link and pay-link "reply-exempt" because they're "inside an
open conversation with a served customer" (lines 141, 168, 302). The conversational
exemption is **topic- and recency-scoped**: it covers responding to the consumer
with information *relevant to what they asked*. A **review request** is widely
treated as promotional/solicitation, and a **pay-link days after the job** is a new
topic the consumer did not raise. Sent minutes after "can you fix my sink," inside
the live thread, both are defensible. Sent as a one-tap action **weeks later**, or
as the *first* message after a long-dormant thread, they are a new outbound and the
"reply" framing is thin.

This is not academic: the doc's own #3/#4 UX is "one tap on a *finished* job" —
i.e. explicitly after the work, potentially well after the last inbound.

**Fix (exact):**
- Reword #3/#4 and backbone line 30-32 to stop calling these categorically
  reply-exempt. State the real rule: **safe as a reply when sent within the active
  conversation window; treat as new outbound (consent + quiet-hours gates) when the
  thread has gone cold.**
- In the Step-0b auto-send/send guard, add a **thread-recency check**: if the last
  inbound from this contact is older than the reply window (propose 24-72h;
  product to pick), route the review/pay send through the **same
  consent-attestation + quiet-hours path** the doc already applies to
  scheduled-send and @mentions — not the reply-exempt path. This is one branch,
  reusing machinery that already exists.
- Keep quiet-hours on review/pay sends regardless — a pay link at 9pm is a bad look
  even when technically a reply.

### A3. Away auto-reply and MCTB: one-per-contact throttle is necessary but not sufficient. (tighten)

Correctly reply-triggered (#2 line 116, #1 line 88). The throttle ("once per
contact per few hours," lines 112, 116) is right and is the anti-spam control.
Three gaps to close in Step-0b so this doesn't become a keyword-campaign problem:
- **Loop guard:** the guard must not auto-reply to our own or another automated
  system's messages. Suppress when the inbound is itself an auto-response
  (e.g., a carrier/system short-code, or a number that just received our
  auto-reply) to avoid two bots texting each other. Key the throttle on
  *inbound events*, not wall-clock, so a burst of inbounds yields one reply.
- **STOP/HELP:** the doc says don't fire on STOP/HELP (lines 116, 88) — correct,
  Telnyx handles those profile-scoped. Ensure the guard checks the **opt-out
  mirror** *and* skips when the inbound body is itself a STOP/HELP/START keyword,
  because those inbounds still hit the webhook before/around Telnyx's handling.
- **Business-hours source of truth:** #2 relies on `destinationLocalHour` /
  `companies.timezone`. Away-reply must gate on the **company's** business hours
  (a company setting), not the destination-local hour used for quiet-hours on the
  *contact*. The doc conflates these at line 107-111 — they are different clocks
  (recipient's quiet-hours vs. the shop's open-hours). Make the away-window its own
  company setting.

### A4. Keyword auto-reply (#8) — the one genuine spam-campaign risk; guard it. (agree, add rail)

The doc already flags this as most-at-risk of marketing-automation drift (lines
200-205) and correctly ranks it FAST-FOLLOW. Add one hard rail so it can't become a
broadcast vector: keyword rules may only fire **in response to a matching inbound,
one reply per inbound**, and must never be usable to initiate or fan-out. Same
Step-0b guard (opt-out mirror, throttle, STOP/HELP). If that rail is in the table
schema/handler from day one, #8 stays conversational and never touches campaign
scope beyond the declared samples.

### A5. Scheduled send (#5) — the doc gets this right; one addition.

Lines 180-184 correctly: single-recipient only, not broadcast, and consent +
quiet-hours **re-checked at send time**. Add: also re-check the **opt-out mirror at
send time** (contact may have texted STOP between schedule and fire), and **10DLC
content** still applies — a scheduled promo is still promo. Minor; the core call is
correct.

---

## B. Telnyx voice reality — MCTB as written won't fire, and it isn't "one webhook"

### B1. An unanswered inbound call does NOT give you a clean "missed" signal. (blocking — the mechanic is wrong)

The plan (lines 82-88, 283-288): "point a `call.hangup` (no-answer) webhook at the
Worker … on an unanswered inbound call … fire one canned SMS." **There is no
`call.hangup` variant that by itself means 'rang but nobody answered.'** In Telnyx
Call Control, an inbound call to your app fires `call.initiated`; your app decides
what to do. If you never issue an `answer`/`bridge`/`transfer`, the call just
sits/ends and `call.hangup` fires with a cause (e.g. `originator_cancel` when the
caller gives up, `normal_clearing`, etc.) — but `call.hangup` fires on **every**
call, answered or not. `hangup_cause`/`hangup_source` alone do not cleanly
distinguish "the human declined to pick up" from a normal completed call.

To know a call was **missed** you must actively run the call: `answer` (or, more
usefully, `transfer`/`dial` to the owner) and then inspect the **outcome of that
leg** — was the dialed leg answered before the timeout, or did it time out /
go to voicemail. "Missed" is a state **you compute from a bridge/dial result**, not
a webhook you passively receive.

**Fix (exact):** Rewrite the #1 build (lines 82-88 and Step 3, 283-288) to:
1. On `call.initiated`, issue a **`transfer`/`dial` to the owner's cell** with an
   explicit **`timeout_secs`** (the forward).
2. Watch the resulting leg: if it ends **unanswered** (dial timeout / no bridge /
   voicemail via AMD), that is the "missed" trigger → route the canned SMS through
   the Step-0b guard.
3. If the caller hangs up first (`originator_cancel` before bridge), also treat as
   missed → same SMS.
Detecting voicemail-vs-human on the forwarded leg realistically needs **AMD**
(answering-machine detection) — otherwise "forwarded to cell, owner didn't pick up,
went to *carrier* voicemail" reads as *answered* and you skip the text, which is
exactly the case the feature exists for. Note AMD in the plan.

### B2. Provisioning gap is bigger than "extend SMS-only." (fix scope)

Lines 88-90, 284-286 say numbers are SMS-only (`filter[features]=sms`) and we
"attach a voice profile." Accurate direction, but the honest checklist is:
- The DID must be **voice-capable** at purchase/porting (a number provisioned
  SMS-only may need re-provisioning or a voice-capable equivalent — not always a
  toggle).
- Create a **Call Control application** (connection) with a webhook URL, and
  **associate every company number** with it. This is per-number config that has to
  happen at onboarding for the whole base, plus for every future number — a real
  provisioning-pipeline change, not a one-line filter edit.
- You now consume **voice webhooks for every inbound call on every number**,
  answered or not, and must `200 OK` each — a new always-on ingestion path with its
  own reliability surface. That is the true upkeep, and the doc undercounts it.

### B3. The cost line is wrong-shaped. (fix the number)

Line 90 / line 88: "~$0.002/min … trivial." Two corrections:
- **Forwarding double-bills.** Forward-to-cell = inbound leg **+** outbound leg to
  the owner's mobile, both metered, for the full ring/talk duration — not one
  one-minute charge. A forwarded 6-minute call is ~12 leg-minutes.
- **Per-number recurring voice cost is omitted.** Enabling voice on the DID base
  carries the number/voice-channel monthly, times every company number — a fixed
  monthly line item, not a per-call rounding error. Still cheap, but it is a
  **recurring per-tenant cost** the "trivial" framing hides. Re-state as: "small
  per-minute + a per-number monthly; forwarded calls bill two legs — model it, then
  cap forward ring time (`timeout_secs`) to bound spend."

### B4. Is MCTB truly low-upkeep? Mostly yes — after the honest scope. (verdict)

With B1-B3 corrected, MCTB is still the right BUILD-NOW and still on-stack (no new
vendor). But it is the **only** feature on the list that adds a new channel, a new
provisioning step across the whole number base, an always-on voice-webhook ingestion
path, AMD, and two-leg billing. The doc's "largest, do last" instinct (line 282) is
right; its "just one webhook / cost trivial" framing is not. Keep the verdict,
correct the scope so it isn't underestimated in planning.

---

## C. Mis-scoping flags (smaller)

- **#3/#4 depend on A1 (campaign scope), not just #6 (merge-fields).** The doc lists
  merge-fields as the only dependency (lines 138, 190-191, 262). The real gating
  dependency for shipping pay/review links is the **10DLC content/URL check** (A1).
  Add it to Step 0 as **0c**.
- **After-hours reply "reuses quiet-hours machinery" (line 118, 299) is imprecise.**
  Quiet-hours = recipient-protection clock; business-hours = shop-open clock. They
  are related but distinct settings (see A3). Don't imply one is the other.
- **Search / bulk / merge / appointment-engine SKIPs are correct** — no compliance
  or platform surface; nothing to add. Snooze (#10) and reporting (#9) touch no
  outbound path; fine.
- **@mentions (#7) correctly `direction='note'`, never leaves tenant (line 198)** —
  no outbound gate needed. Correct.

---

## D. What to change in FEATURE-GAPS.md (punch list)

1. Backbone (lines 18-34): split the claim into **consent** (reply-exempt: true)
   vs **10DLC content/campaign** (NOT exempt: must match registered use-case +
   samples + URLs). Add A1 as a stated prerequisite.
2. #3 and #4 (lines 141, 168) + line 302: stop calling review/pay categorically
   reply-exempt; add the active-window rule + cold-thread fallback to the gated
   path (A2).
3. Step-0b guard (lines 263-266): add thread-recency branch (A2), loop/auto-reply
   suppression, STOP/HELP-body skip, opt-out-mirror-at-send (A3, A5).
4. Add **Step 0c**: 10DLC campaign/use-case + URL registration check, gating #3/#4.
5. #1 build + Step 3 (lines 82-90, 283-288): replace "`call.hangup` no-answer
   webhook" with **transfer/dial + leg-timeout + AMD** as the miss detector (B1);
   expand provisioning scope (B2); fix cost shape and cap ring time (B3).
6. Away-reply (#2, lines 107-118): make business-hours its own company setting,
   distinct from quiet-hours (A3).

None of this changes the four BUILD-NOW picks or the ordering. It corrects the two
places where the doc would ship something that either gets **filtered by carriers**
(A1/A2) or **never fires** (B1).

---

## Sources

- CTIA conversational-messaging / consent exemption & Oct-2025 tightening:
  [CTIA SMS guidelines (Telnyx)](https://telnyx.com/resources/ctia-sms-guidelines),
  [Holland & Knight — CTIA messaging principles (2026)](https://www.hklaw.com/en/insights/publications/2026/05/beyond-tcpa-compliance-why-ctia-messaging-principles),
  [Infobip — US messaging content requirements](https://www.infobip.com/docs/essentials/usa-and-canada-compliance/usa-messaging-content-requirements)
- 10DLC campaign content/use-case alignment, text-to-pay/mixed use-case, URL scrutiny:
  [Twilio — A2P 10DLC campaign approval requirements](https://help.twilio.com/articles/11847054539547-A2P-10DLC-Campaign-Approval-Requirements),
  [Bandwidth — 10DLC campaign use cases](https://www.bandwidth.com/support/en/articles/12823087-10dlc-campaign-use-cases),
  [HighLevel — A2P 10DLC approval best practices](https://help.gohighlevel.com/support/solutions/articles/48001229784-a2p-10dlc-campaign-approval-best-practices)
- TCPA consent for transactional vs promotional SMS (2026):
  [ActiveProspect — TCPA text messages 2026](https://activeprospect.com/blog/tcpa-text-messages/),
  [Infobip — 2026 TCPA compliance for SMS](https://www.infobip.com/blog/tcpa-compliance-sms)
- Telnyx voice / call-control mechanics, hangup causes, no-answer detection:
  [Telnyx — Voice API webhooks](https://developers.telnyx.com/docs/voice/programmable-voice/voice-api-webhooks),
  [Telnyx — Configuring Call Control/TeXML applications](https://support.telnyx.com/en/articles/4374050-configuring-call-control-texml-applications-voice-api),
  [Telnyx — SIP response codes / hangup causes](https://support.telnyx.com/en/articles/4409457-telnyx-sip-response-codes),
  [Telnyx — AMD demo (call control)](https://github.com/team-telnyx/demo-amd)
