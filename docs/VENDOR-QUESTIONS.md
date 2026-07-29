# Open questions somebody has to ask (#373)

Facts we could not settle from documentation or from the codebase, and that
somebody has to **ask** rather than infer. Mostly vendor questions; one is for
counsel (#393 ask 4 asks that they travel together, and splitting them into two
documents is how #373 happened in the first place).

`PORTING.md` §12 invented this discipline for one feature — *"Open items
flagged 'verify in build' (do not guess at build time)"* — and it is the right
instinct: it separates what is **pinned** from what is **assumed**, and says
plainly not to guess. This generalises it to the whole vendor surface, because
the most consequential open question was not in the document that lists open
questions.

**Each entry names what it BLOCKS.** That is the point. An unanswered question
that blocks nothing can wait forever at no cost; one that blocks a safety fix
or a market cannot, and the difference should be visible at a glance rather
than reconstructed from four documents.

**No review cadence** (following #326's argument for triggers over calendars).
These resolve when somebody asks the vendor or tests against the live API —
never on a schedule. Several could go in one support message.

---

## OPEN

### V1 — Canadian A2P registration · Telnyx · blocks #379, holds #369

**The question, verbatim** (drafted in `DECISIONS.md` D2, ready to send):

> *"For a Canadian long code on our account sending A2P traffic to Canadian
> subscribers, is any registration or persona verification required, or
> performed by Telnyx on our behalf? If not, are there volume thresholds at
> which Rogers, Bell or TELUS begin filtering unregistered traffic?"*

**Why it matters.** `getSendGates.caAllowed` is a hardcoded `true`. D2's Canada
half is the claim our entire Canada-first positioning rests on, and it is
**unverified** — deliberately left `true` rather than changed on a guess,
because inventing a Canadian gate nobody has confirmed exists would block our
headline market on a hunch.

**What we do know**, verified against the live Telnyx account 2026-07-28: our
one Canadian number was bought *after* the 2025-03-26 cutoff, carries
`messaging_campaign_id: None`, and is classified by Telnyx itself as
`traffic_type: A2P`. So we are sending traffic Telnyx calls A2P, from a
post-cutoff number, with no campaign attached.

**What an answer unblocks.** *"Not required"* closes #379 and releases #369's
acquisition spend. *"Required"* makes it a wizard step on all three clients,
using the machinery US 10DLC already has.

**The signal in the meantime:** `messaging/delivery-by-country.ts` — if
carriers are filtering us today, the delivery-rate split is the only evidence
we would ever get.

**Travels with L1** (#393 ask 4). Both ask what a first Canadian message must
contain — V1 for it to *arrive*, L1 for it to be *lawful*. Different
recipients, same afternoon.

---

### V2 — what Telnyx emits on a campaign SUSPENSION · Telnyx · blocks nothing today

**The question.** When a 10DLC campaign that was `MNO_ACCEPTED` is later
suspended or revoked by the carrier, what does the API report? A distinct
`campaignStatus`? A lifecycle change? A `10dlc.*` webhook? Nothing?

**Why it matters.** #423 built the `suspended` state and the poller that would
notice one. It recognises the signals we already know
(`MNO_REJECTED`, `MNO_SUSPENDED`, `TCR_FAILED`, `TELNYX_FAILED`,
`MNO_PROVISIONING_FAILED`, lifecycle `EXPIRED`, any `failureReasons`) and is a
deliberate **no-op** otherwise — an unrecognised payload is far likelier to be
our parsing gap than a carrier decision, and acting on it would stop a paying
customer's texting because we failed to understand a response.

**What an answer unblocks.** Confidence that the list above is complete. Today
the machinery is right and its trigger list is a best guess.

---

### V3 — porting response schemas · Telnyx · blocks nothing (the build worked around them)

Carried over from `PORTING.md` §12, which remains the detailed source:

- **§3.1** the per-number portability-check response fields (`portable`,
  `not_portable_reason`, `phone_number_type`, `messaging_capable`,
  `fast_portable`, `carrier_name`). The **path** is pinned; only the fields are open.
- **§3.8** the exact cancel action path on `porting_orders` (submit is pinned).
- **§3.6** whether `GET /v2/porting_orders/{id}` carries `messaging_port_status`
  (pollable) or the messaging track is webhook-only.
- **§2.2** the exact `phone_number_type` token returned for wireless numbers.
  The wireless requirement itself is **resolved and implemented**; only the
  token string is unconfirmed.

**Why they block nothing:** porting works, so the build evidently handled each.
They are here so that a future change touching these fields knows they were
never confirmed.

---

### V4 — LOW_VOLUME throughput limits · Telnyx/carriers · blocks #351's ceiling copy

Carrier-set, undocumented by us, and they move. D59 chose LOW_VOLUME
deliberately; what the tier's actual per-second and daily ceilings are is the
open half.

### V5 — toll-free verification timelines · Telnyx · blocks #329

The SPEC ruling was made against figures measured at launch. Whether they still
hold decides whether toll-free is a real second door past the 10DLC wait.

### V6 — is there a number-reputation lookup we can call BEFORE handing a number over? · Telnyx · blocks #235 ask 2

**The question.**

> *"Before we assign a number from your inventory to a customer, is there any
> API that reports that number's reputation or labelling status — a prior
> spam/scam flag with First Orion, Hiya or TNS, or any Telnyx-side signal that
> it was recycled from a high-complaint sender? If not, is reputation data
> available on request for numbers already on our account?"*

**Why it matters.** A recycled number arrives pre-poisoned and we cannot see it.
#235 asks us to screen a number before it becomes somebody's business line, and
we could not build that half honestly: nothing in the Telnyx API we use exposes
reputation, and inventing a screening step against an endpoint nobody has
confirmed exists would be worse than not having one.

**What we built instead**, so the risk is covered rather than deferred: the
assessment carries an absolute 70% delivery floor for a number with **no**
baseline. A pre-poisoned number is caught within days of handout rather than
never — detection instead of prevention, which is the honest trade when
prevention is unavailable.

**What an answer unblocks.** *"Yes, here is the endpoint"* turns #235 ask 2 into
a real pre-handout gate, and a number we cannot vouch for stops becoming
somebody's phone line. *"No"* closes the ask permanently, and the floor stays
the answer.

---

## NOT A VENDOR — for counsel

Same discipline, different recipient. Kept here rather than in a second
document because splitting them is how #373 happened in the first place.

### L1 — does a first outbound SMS need sender identification under CASL s.6(2)? · counsel · blocks #393 asks 3-4

**The question, kept narrow on purpose** — this is a yes/no, not a compliance
review:

> *"Does a first outbound SMS from a Canadian business to a customer who
> verbally asked to be texted require sender identification in the message body
> under CASL s.6(2)?"*

**Why it matters.** D4's enforced footer — `— {Business name}. Reply STOP to
opt out`, labelled in D4 itself as *"CASL identification + CTIA"* — was removed
by owner direction in 2026-07, and the recorded trade-off weighed **carrier**
risk only. CASL's requirements are cumulative: s.6(1) consent, s.6(2)
identification, s.6(3) unsubscribe. Our consent attestation answers s.6(1)
well; s.6(2) had one answer and it was the footer. Liability attaches to the
**sending business** — our customer — not only to us.

**The exposure is one message type:** the first outbound to a new contact.
Replies inside an inbound conversation were never decorated and are not at
issue.

**What an answer unblocks.** *No* → D4 stands as amended and this closes.
*Yes* → the middle path, a default-on setting the owner can switch off, so the
product ships compliant and turning it off is a deliberate act.
`contacts.first_identification_sent_at` was deliberately left in place for
exactly this. **Nothing is built until the answer exists** — #393 is explicit.

---

## RESOLVED — kept so they are not re-asked

A register that only lists open questions gets re-litigated. These are closed,
with the answer, so nobody spends an afternoon rediscovering them.

### R1 — what `POST /v2/calls` returns for a repeated `command_id` · ANSWERED

**#373 called this "the serious one"** — the DO's `telnyx-dial` effect carried
no `command_id`, so a journal replay could create a **duplicate billable ring
leg** that rang to the 45s timeout and could not be adopted, because the
pending key is frozen in the journal. The literal fix was assessed as unsafe:
`runtime.ts` maps every 4xx to `known-dead`, which on the placer path
terminalises the session and hangs up a live customer.

**The answer, verified against the live Telnyx API before shipping:** a
repeated `command_id` returns **HTTP 202 with the SAME `call_control_id`**. No
second leg is created, and the `4xx → known-dead` mapping is never reached by a
replay.

**Shipped.** `commandId` is threaded from the dial effect's frozen
`pendingKey` (`calls/session-do.ts:546`, `:590` → `calls/runtime.ts:344`), so
at-least-once effect execution is now safe on the one command that bills.

### R2 — Telnyx error 10038 on Canadian number reservations · ANSWERED

An account-level restriction, not a code defect. Resolved by an account
upgrade. Recorded because it is the precedent for the shape V1 is in: a vendor
answer gating a market, discoverable only by asking.

---

## Adding an entry

Only when the answer must come from the **vendor** or from the **live API**, and
we chose not to guess. If the codebase can answer it, it is not a vendor
question — it is a task.

Give it: the question (verbatim, if it is going in a support ticket), why it
matters, **what it blocks**, and what an answer would unblock. Move it to
RESOLVED with the answer rather than deleting it.
