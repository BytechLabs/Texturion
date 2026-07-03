# JobText — Customer-Lens Gap Analysis (trades daily reality)

Researched 2026-07-03. Lens: what a plumber / HVAC / landscaper / cleaner / salon owner
actually needs day-to-day from a business texting tool that JobText does not provide today.
Grounded in the trade (reviews/forums/trade sources + competitor behavior), constrained to
JobText's lowest-upkeep rule (reuse Supabase / Telnyx / Stripe / Workers-cron; no new vendors).

## What JobText already ships (so we don't re-list it as a gap)
Shared SMS inbox, assignment/ownership, internal notes, conversation tags pre-seeded as a
pipeline (Quote sent / Scheduled / Won / Lost), saved replies ("/" templates), MMS both
directions (photo triage), message-done + promote-to-Task (list/board/calendar/**map**),
CSV/vCard contact import + export, port-in (keep your number), email + web-push notifications,
/for-you crew queue, search. The five trade jobs are *acknowledged* in copy — but the
"confirm booking / review ask / quote follow-up / job done" texts ship only as **manual
saved-reply templates a human must remember to send**, and two jobs (never-miss-a-call,
get-paid) are not served at all.

## The jobs-to-be-done vs. what's missing

### 1. Never miss a lead — CALLS, not just texts  [LOAD-BEARING]
The ICP's number is on trucks/yard signs/Google; customers **call** it. 62% of calls to local
service businesses go unanswered at peak; ~41% of weekend calls go unanswered; callers rarely
leave voicemail — they dial the next plumber. JobText today only catches texts to that number;
a call to the same Telnyx number is a dead end. This is the single biggest hole and JobText's
own D11 already names **missed-call text-back** "the headline differentiator for v1.x" — it is
deferred, not absent by design. Feasible on-stack: Telnyx numbers can do voice ($0.002/min,
native voicemail beta + call-forwarding + transcription), so an unanswered inbound call fires
an auto-SMS ("Sorry we missed you — text us what you need and we'll get right back") that lands
in the same shared thread. Turns a lost call into a live text conversation. Nothing new to buy.

### 2. Respond fast even after hours  [LOAD-BEARING for retention]
A 9pm "no hot water" must get *an instant acknowledgement*, then a human in the morning. Today
JobText's answer is "it waits safely in the inbox" — honest, but the customer hears silence and
may text a competitor who auto-replies. Every FSM/texting rival has an **after-hours / instant
auto-reply** (business-hours-aware). Feasible with a Workers-cron/business-hours check +
one auto-send on first inbound outside hours; reuses `companies.timezone` (D15) and quiet-hours
machinery (D4). Pair it with the missed-call text-back (same acknowledgement path).

### 3. Get the address & details up front  [NICE-TO-HAVE, cheap]
"Send me a photo of the shutoff" is already MMS-native (a real strength). The remaining friction:
the address/details arrive as free text scattered in the thread and never become structured data
— yet the Map task view (D25) needs an address on the contact to plot a job. A tiny **structured
intake / capture** (pin an address or job detail from a message onto the contact in one tap, or a
first-contact auto-ask "What's the address and the problem?") closes the loop between the thread
and the Map view the product already built. Low effort, high day-to-day payoff.

### 4. Schedule the job  [PARTIAL — don't overbuild]
Full calendar/booking is Jobber/Housecall Pro/ServiceTitan territory and would break the
low-upkeep rule — do NOT build a scheduler. But 78% of under-45 customers prefer to book without
calling, and the trade confirms slots by text constantly. The right-sized gaps: (a) a **booking-
confirmation that's a feature, not a manual template** — set day/time once, it renders a clean
confirmation and (optionally) a reminder; (b) **appointment reminders + "on my way" as
first-class actions**, since reminders cut no-shows ~35% and every rival automates them while
JobText leaves them as canned text. The Task `due_at` + calendar view already exists — a reminder
is a cron over `due_at`, not a new system.

### 5. Get PAID  [LOAD-BEARING — currently zero coverage]
This is the biggest *category* gap: JobText has Stripe wired for its own billing but gives the
tradesperson **no way to collect money from their customer over text**. "Text-to-pay" is now
table-stakes in the trade (25–30% of some tools' invoices get paid over text; it beats email 3:1).
Feasible on-stack with **Stripe Payment Links / Connect** (already the payment vendor): owner sets
an amount → JobText mints a payment link → sends it in-thread → webhook marks paid. Deposits before
a truck rolls, balance on completion. No new vendor, and it's the feature most likely to make a
$29/mo tool feel like it prints money.

### 6. Get a REVIEW  [LOAD-BEARING for a small shop's survival]
Reviews are existential for local trades, and SMS review requests beat email 3:1 and routinely
*double* Google review volume. JobText ships this only as saved-reply #6 ("a Google review goes a
long way: {link}") — a human must paste a link and remember to send it. The gap is **automation +
the link itself**: store the company's Google review deep-link once (free — Place ID →
`search.google.com/local/writereview?placeid=…`, or the `g.page/r` short link; no vendor), then
offer a one-tap "Ask for a review" that fires when a job/message is marked **done** (JobText
already has message-done + Task-done as the trigger). Best practice is to send ~90–120 min after
completion — a short cron delay, not a new pipeline.

### 7. Coordinate the crew  [MOSTLY COVERED — small edges]
Assignment, internal notes, /for-you queue, tasks, and the Map view already serve this well; it's
JobText's strongest area. Remaining small edges: **@mentions** in notes (flagged as "if/when it
ships" in D24 — the crew wants to tag a specific tech, not just assign the whole thread) and a
light **on-call / who-gets-after-hours-pings** rule so evening notifications hit one person, not
everyone (copy already promises "only the on-call tech gets buzzed" but there's no on-call setting
behind it — a promise the product doesn't yet keep).

## Load-bearing vs. nice-to-have (retention call)
- **Load-bearing (churn if absent):** missed-call text-back (#1), after-hours auto-reply (#2),
  text-to-pay (#5), review-request automation (#6). These are the four every serious rival has and
  that map directly to money won/collected/reputation — the reasons a solo owner keeps paying.
- **Nice-to-have (delight, low cost):** structured address/detail capture (#3), booking-confirm +
  reminder + on-my-way as features (#4), @mentions + on-call rule (#7 edges).
- **Do NOT build (scope/upkeep discipline):** a full scheduler/calendar-booking system, mass-text
  blasts (D4/D11 exclude for compliance), voice as a phone system. Missed-call text-back needs only
  voice *reception*, not a full IVR.

## Why these are the right calls
JobText's marketing is honest that it "doesn't do voice calls, mass text blasts, or review
management" (COPY §H8) — but three of those four honest-omissions (missed-call catch, review asks,
and by extension text-to-pay) are exactly the trade's money jobs, and all three are buildable on the
**existing** Telnyx/Stripe/Workers stack with no new vendor. The pattern of the real gap: JobText
nailed the *shared-inbox* job and turned the trade's daily texts into *templates a human sends*; the
retention unlock is turning the four money-jobs (catch the call, reply instantly, get paid, get the
review) from manual templates into **automated, on-stack features**.

## Sources
- Missed-call cost/behavior: marqeable.com/blog/missed-call-text-back-home-services,
  marvixdigital.com/blog/hidden-cost-missed-calls-plumbing, salescaptain, signpost.com
- Text-to-pay / review SMS in trades: textrequest.com/product/payments, textellent.com,
  mcc.codes/blog/google-reviews-home-services, applausehq.com, housecallpro benchmark (via search)
- Reminders/on-my-way/no-shows: help.housecallpro.com SMS job reminders, getjobber.com help
- Booking preference stats: getdriive, hicira.com, ServiceTitan/Housecall Pro research (via search)
- Telnyx voice/voicemail feasibility: telnyx.com/pricing/voice-api, telnyx.com voicemail beta
- Stripe Payment Links: docs.stripe.com/payment-links, docs.stripe.com/api/payment-link/create
- Google review deep-link: brightlocal Place ID generator, embedsocial.com/blog/google-review-link
