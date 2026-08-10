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

- **Any live signal that a customer paid.** Worth being exact, because the
  first draft of this document was wrong about it: the webhook writes a
  `payment_paid` row to `conversation_events`, and **that table has no broadcast
  trigger** — the realtime triggers fire on `messages`, `conversations`,
  `phone_numbers` and registrations only. So a crew sees the payment when the
  thread next fetches, not the moment it lands.
  That meets the acceptance criterion ("a paid request records the payment
  against the conversation") and is short of what the moment deserves. Making it
  live means either a new broadcast event kind or a new push kind, both of which
  are vocabularies all three clients share (`scripts/check-push-kinds.mjs`), so
  it is its own change rather than a detail of this one.
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
