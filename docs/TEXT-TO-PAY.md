# Text-to-pay (#224 / D133)

**Status: IMPLEMENTED (#224).** The record of a decision that has shipped, and
the standing answer to "what happens when a customer disputes one". D133 in
`docs/DECISIONS.md` is the decision itself; the CODE is the authority on
behaviour. The refund and dispute sections are BINDING — they are what the
product promises a business, and changing either is a decision, not an edit.

A tradesperson asks their customer for money in the thread the job was arranged
in. The customer gets an ordinary text with a link, taps it, and pays by card.
The money goes to the business's own bank account.

This document exists because #224 refused to be built until three questions were
answered by an owner rather than assumed by an implementation, and because the
last of its acceptance criteria is *"refunds and disputes have a defined,
documented path before launch, not after."* This is that path.

---

## The three decisions

### 1. Do we take on Connect at all? — **Yes**

`docs/customer-gap-analysis.md` researched the trade's five money jobs. Four are
served. Getting paid was the one with zero coverage, and it is the one that
makes a $29/month tool feel like it pays for itself.

### 2. Standard, Express or Custom? — **Express, with DIRECT charges**

This is the load-bearing half, and the second word matters more than the first.

A **direct charge** is created *on the connected account* — the request carries
`stripeAccount: acct_…` and nothing else. The consequences are the whole answer
to the liability question:

| | Who it lands on |
|---|---|
| Merchant of record | the tradesperson |
| Name on the customer's card statement | the tradesperson's |
| A chargeback | the tradesperson's Stripe balance |
| A refund | the tradesperson's Stripe balance |
| A negative balance after a dispute | the tradesperson's account |
| Tax reporting on the payment | the tradesperson's |

A **destination charge** would have moved every row in that table onto us. We
would have become the platform of record for money movement between two other
parties, with the disputes, the reserves and the tax surface that follows. That
is the exposure #224 was filed to ask about, and this is the answer: we are not
in the path of their money at any point.

**Express** rather than Standard because Stripe owns the onboarding, the KYC,
and — the part that matters after launch — the dashboard where the business
issues a refund and answers a dispute. A one-truck plumber gets a real payments
back office and we do not have to build, staff, or keep one compliant.

### 3. Platform fee? — **Zero**

No `application_fee_amount` anywhere in the codebase, and
`apps/api/src/routes/payments.test.ts` asserts its absence on every payment link
we create. The value stays in the subscription.

Three reasons, in order of weight:

1. **The customer-facing amount is exactly what the business typed.** A fee
   would either come out of their money (a deduction they did not agree to at
   the keyboard) or be added on top (a surcharge their customer sees).
2. **It keeps us out of collecting fees on somebody else's transaction**, which
   is a different regulatory conversation from the one we have chosen to have.
3. **The pitch is simpler and true:** *"the money goes to your bank account, we
   take nothing on top."* That sentence appears verbatim in
   `payoutReadinessCopy` and is checked by a test.

Stripe's own card fee is the only deduction, and it is Stripe's to state.

---

## What the customer sees

```
Northline Plumbing: $250 for Deposit for Tuesday.
Pay securely here:
https://app.loonext.com/pay/‹token›
```

Composed by `paymentRequestSms` in `packages/shared/src/payments-copy.ts`, which
is also what the composer previews on all three clients — so the preview is the
message, not an approximation of it.

The shape is fixed, and each line earns its position:

- **The business name is first.** A payment link from an unnamed sender is a
  phishing text and the customer is right to think so.
- **The amount is second.** Nobody should have to open a link to find out what
  they are being asked for.
- **The link is last and alone on its line**, so every phone linkifies all of it.
- **No "click here", no urgency, no shortened domain.** All three are what a
  carrier's spam filter and a homeowner's instinct are both looking for.

### The page

`/pay/‹token›` is ours, not Stripe's, and that is deliberate. A raw
`buy.stripe.com` link in the text would work, and would be one tap shorter. What
it could not do is say **"this has been paid"** — so a customer who taps the
text twice would meet a card form for money they have already sent.

The page carries three facts (who is asking, how much, what for) and one button.
It carries none of our branding: it appears under the business's name, because
that is who the customer has a relationship with. It carries none of the
*customer's* details either — they already know their own address, and this is a
URL that lives in SMS logs and browser history.

The card form is Stripe's, on Stripe's domain. We do not embed it, wrap it, or
reimplement it.

---

## The link, and how it dies

The customer-facing URL is a D75 `public_links` token (`purpose: 'payment'`):
256 bits, stored only as a SHA-256 hash, expiry mandatory, revocable
individually, one failure page for every failure.

| Event | What happens to the link |
|---|---|
| Paid | revoked immediately, by the webhook, and Stripe's own `completed_sessions` limit of 1 stops a second session |
| Cancelled by the crew | revoked, and the Stripe payment link is deactivated |
| 14 days pass | the token stops resolving on its own; the hourly `job:expire-payment-requests` moves the row to `expired` so the thread stops saying "Waiting" |
| The send failed after the link was minted | revoked and deactivated on the way out — a live payment link for a text that never arrived is the worst artefact this feature could leave |

**Fourteen days**, and the reason is not arbitrary: it is longer than any deposit
conversation and shorter than the point where a homeowner has forgotten what the
money was for. Paying a bill you no longer recognise is how a legitimate charge
becomes a chargeback — which, per the table at the top, lands on the business.

---

## Refunds

**The business issues refunds in their own Stripe Express dashboard.** Settings →
Getting paid → *Open Stripe* mints a single-use login link
(`accounts.createLoginLink`) straight into it.

This is a deliberate boundary, not a gap:

- Refunds, **partial** refunds, receipts, dispute evidence and payout history all
  live in a back office Stripe already runs, keeps compliant, and updates.
- A thin copy of it in our settings screen would mean owning the correctness of
  money movement we specifically chose not to be in the path of.
- The capability is `billing.manage`, not `workspace.own` — issuing a refund is
  bookkeeping, and the bookkeeper role (#315) exists precisely so the person who
  does the books does not need the owner's login for it.

**The thread still finds out.** `charge.refunded` on the connected account writes
a `payment_refunded` event onto the conversation and stamps `refunded_at` on the
request. A refund discussed in a Stripe dashboard and invisible where the job
lives is how two people end up telling a customer different things about the same
money.

A refunded request stays `status = 'paid'`. Money did change hands; collapsing
that into the status would destroy the fact the crew most needs.

## Disputes

**The chargeback is the business's**, in both directions: Stripe emails them, the
evidence is submitted from their dashboard, and the funds and the dispute fee
come out of their balance. We are not a party to it.

**The thread still finds out.** `charge.dispute.created` writes a
`payment_disputed` event and stamps `disputed_at`. In the thread strip a dispute
outranks a refund, because a chargeback is the thing somebody has to act on and a
refund is not.

**What we do not do:** we do not submit evidence, contest, or advise. We have no
standing and no facts — the business does.

---

## The moment it lands (#607)

**The three post-payment events are live.** A `payment_paid`, `payment_refunded`
or `payment_disputed` row landing in `conversation_events` publishes a broadcast,
and the strip above the composer moves without anybody refreshing. Until #607 it
did not: this document's "what this deliberately does not have" list led with
*"any live signal that a customer paid"*, which was true when it was written and
described somebody standing in a driveway pulling to refresh to find out whether
they could start work.

| | |
|---|---|
| Event | `payment.updated` |
| Topic | `company:{company_id}:number:{phone_number_id}` — the thread's line, never the workspace |
| Payload | `{ conversation_id, payment_request_id, type }` |

`type` is the `conversation_event_type` label VERBATIM — `payment_paid`,
`payment_refunded`, `payment_disputed`. A trimmed `paid`/`refunded` would be a
third vocabulary beside the SQL enum and the API union that
`scripts/check-conversation-events.mjs` already holds equal in both directions,
and a list written three times is the one that drifts.

**ID-only, and enforced rather than trusted.** `payment_request_id` reaches the
wire only when the row's jsonb holds a scalar that the uuid parser accepts;
anything else — an object, an array, a Stripe id — is sent as null. That is the
trigger's rule and not the writer's, because `conversation_events.payload` is an
untyped `jsonb` column written from many places, and `->>` on an OBJECT
serialises the object. No amount, currency, description or customer name is ever
broadcast; clients refetch through the API so authorization stays in one place.
`supabase/tests/payment_requests.test.sql` PR-13 asserts it with a payload
carrying a sentence a customer typed.

**Why the number's topic and not the workspace's.** A payment names a thread and
a thread belongs to a line. Publishing to `company:{company_id}` would tell a
member who was denied that line that money had just arrived on it — the exposure
#484 closed, reopened for the one event where the amount is the news.

**`payment_requested` and `payment_cancelled` deliberately stay quiet.** The
request IS an outbound text, so `message.created` already fires for it; a
cancellation is somebody in this app doing it on purpose. PR-10 derives the
payment family from the enum itself and asserts which members are loud in BOTH
directions, so a sixth type cannot land quietly on either side of that line.

**And the phone in a pocket hears too.** `notifications/payment.ts` sends one
push per payment event to everybody whose number access covers the thread —
exactly the set the broadcast above reaches, so the two cannot disagree about
who is allowed to know. It carries `kind: "payment"`, which Android routes to a
`payments` channel and iOS to the matching category, both held equal by
`scripts/check-push-kinds.mjs`. ONE kind for all three outcomes: the
discriminator decides where a push lands, and a refund on a channel the deposit
is not would be a switch somebody could silence without knowing they had.

It is `operational` rather than a volume-control category of its own, for two
reasons. A payment is about the business's money rather than its inbox, which is
the stated line for `operational`; and the batch digest a quieter category would
degrade to renders every held row as "N new messages", so a batched payment
would have been reported to the crew as a text nobody sent. Quiet hours still
apply — a deposit at 1am is on the timeline in the morning — and the priority is
normal, because HIGH is a rationed resource (#452) and somebody waiting on a
deposit is holding their phone.

The words are the timeline's words ("paid", "went back to", "pulled back"), and
the collapse key carries the outcome so a refund cannot erase the payment it
followed. What the money was for is a member's own words and is withheld under
#430; who it was from is not.

The SQL is `supabase/migrations/20260813110000_the_deposit_lands_before_anyone_refreshes.sql`,
amended by `supabase/migrations/20260813130000_the_payment_broadcast_enforces_its_own_contract.sql`.

---

## Who can do what

| Action | Capability | Why |
|---|---|---|
| Connect the Stripe account | `workspace.own` | it binds a legal entity and a bank account to the workspace. `capabilities.ts`: anything that spends money, ends the workspace or moves the number is owner-only |
| See the Getting-paid screen, open the Stripe dashboard | `billing.manage` | the bookkeeper's refund path |
| Ask a customer for money | `conversations.send` | it is an outbound message. The tech standing in the driveway is the person who needs the deposit, and a feature only the owner can use is one that gets replaced by a personal e-transfer |
| Cancel a request | `conversations.send` | same act, undone |

---

## The gates a payment request passes

In this order, and the order is the design — **every refusal that can be decided
without Stripe is decided before anything exists at Stripe.**

1. `conversations.send`, plus per-number `text` level (#106)
2. The conversation's number is provisioned and active
3. `runPreSendGates` — the outbound kill switch, AUP enforcement, subscription
   active, seasonal pause, destination US/CA, 10DLC registration, **opt-out**
4. `charges_enabled` on the connected account, re-read from Stripe
5. Amount within `PAYMENT_MIN_CENTS`…`PAYMENT_MAX_CENTS`
6. `gate_outbound_send` — rate limit, spend cap, atomic with the message insert
7. Dispatch to the carrier

A contact who sent STOP cannot be asked for money, by exactly the same mechanism
that stops them receiving anything else: there is no second send path here, only
the ordinary one carrying a different body.

Steps 6 and 7 are the two that can fail *after* the Stripe link exists. Both
clean up after themselves — the link is deactivated and the token revoked.

**The ceiling is $25,000** because a typo on a phone keypad is a real event and
"$450" becoming "$45000" is one missed decimal. It sits well above any
residential trade job and below the point where a mistyped figure is plausible.
**The floor is $1** because Stripe refuses a charge under 50 cents, and a request
that mints a link the customer cannot pay is worse than a refusal at the
keyboard.

---

## What this deliberately does not have

- **A push notification when a customer pays.** The *in-app* signal is live —
  see "The moment it lands" above, which is what #607 built and what this bullet
  used to deny. A phone with the app closed still learns about it on the next
  open. Push kinds are a shared vocabulary (`scripts/check-push-kinds.mjs`) and
  adding one is its own decision.
- **Invoices.** A payment request is a bill for an amount, not a line-item
  document. Quotes are #287 and they are a different object with a different
  lifecycle.
- **Recurring or saved payment methods.** Both put us in a relationship with the
  customer's card that a one-off link does not.
- **Our own refund UI.** See above — it is a boundary, and it is stated in the
  settings copy so nobody has to guess.

---

## Operating it

| | |
|---|---|
| Env | `STRIPE_CONNECT_WEBHOOK_SECRET` — Stripe registers *events on your account* and *events on connected accounts* as separate endpoints with separate secrets, even pointed at the same URL. Both are verified at `/webhooks/stripe`; a signature matching neither is still rejected and counted |
| Connect events handled | `account.updated`, `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, `charge.dispute.created` |
| Cron | `job:expire-payment-requests`, hourly. Its silence means the thread's wording is stale, never that money is at risk — the token has already stopped resolving |
| Erasure | `payment_requests` and `stripe_connect_accounts` are both in `purge_workspace_step`, and `supabase/tests/purge_coverage.test.sql` derives that requirement rather than trusting it. The Stripe ACCOUNT is not deleted: it is the business's own legal entity with payout history they are required to keep |
| Parity | `packages/shared/vectors/payments.json` pins the state machine and the amount bounds across all three clients |
