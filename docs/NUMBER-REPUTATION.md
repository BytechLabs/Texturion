# A number has been flagged (#235)

**Status: CURRENT DIRECTION (#323).** Describes how the product works today. Where it disagrees with `docs/DECISIONS.md`, that file wins.

We sell a phone number as the product. When a carrier or an analytics vendor
(First Orion, Hiya, TNS) labels one, the customer's business stops working —
and the labelling is invisible from our side unless we go looking.

**Recovery takes days of registry paperwork.** So the moment to start is the
alert, not the churn call.

---

## How we find out

`job:number-health` runs daily and assesses every active number against **its
own** trailing baseline, never a fleet average — a plumber texting 200 regulars
has a different natural delivery rate than a roofer cold-quoting, and one shared
threshold would flag one of them forever and never flag the other.

Three signals, any of which is enough:

| Signal | What it looks like | Why it matters |
|---|---|---|
| **Delivery fell off its own baseline** | 15+ points below the previous 28 days | The ordinary case |
| **Absolute floor with no baseline** | Under 70% and no history | A **recycled** number arrives pre-poisoned — we do not know what the last holder did with it |
| **Replies collapsed while delivery looks fine** | Zero inbound against an established reply rate | The tell for **silent filtering**: accepted, billed, dropped. No delivery-rate check catches this |

Two states above healthy, with **different audiences**:

- **`watch`** — real signal, thin sample. **Internal only. The customer is never
  told.** It exists so we are looking before we are sure.
- **`degraded`** — enough volume and a large enough fall that ordinary variance
  does not explain it. **This is the only state a customer sees.**

The split is the whole design. At our size a number sends a few dozen texts a
week; three failures is an ordinary Tuesday. Telling somebody their business
line is flagged over that would cost us the account — and the one time it was
real, nobody would believe it.

Only **transitions** are emailed. A known-bad number does not mail us every
morning until somebody mutes the mailbox. Recoveries are emailed too: a recovery
is the only evidence that a remediation actually worked.

---

## What the customer sees

A degraded number shows a banner on the numbers screen, on all three clients,
naming the state, how long, and the remediation path. Never a silent
degradation — the house style is honest failure, applied to a number instead of
a send.

A `watch` number shows **nothing**. `api_number_health` flattens it to
`healthy` server-side, so a client cannot leak it by accident.

---

## Remediation, in order

### 1. Confirm it is not us

Before touching a registry, rule out the cheap explanations:

```bash
node scripts/ops/version-distribution.mjs   # is this one build, or everybody?
```

- Is `kill:outbound-send` off, or the workspace overridden? (`docs/ROLLBACK.md`)
- Is the campaign still approved? A rejected re-review looks exactly like
  filtering.
- Is the destination country the pattern? Check the `delivery-by-country` alert
  — if it is Canada, `docs/DECISIONS.md` D2 is the open question (#379).

### 2. Free caller-registry submissions

The analytics vendors run free correction paths for a mislabelled business
number. Submit under the customer's real business identity, not ours:

- **First Orion** — free number-reputation lookup and correction request
- **Hiya** — business number registration and dispute
- **TNS** — number-reputation correction

These are the vendors carriers consult for "Scam Likely" style labelling.
Registration is also **preventative**: a registered business number is far less
likely to be labelled in the first place.

### 3. Fix what caused it

A label is usually earned. Check before disputing, or it comes straight back:

- Sending volume that spiked without a matching reply rate
- Identical message bodies at volume (template blasts read as campaigns)
- Sending to numbers that never reply — a stale or bought list
- Missing opt-out language (`opt-out-language.ts` exists for this)

### 4. Last resort: replace the number

Only after the above, and only with the customer's agreement — a business
number is on their van and their invoices.

- Order the replacement first, and run both in parallel.
- Forward the old number for a transition period.
- The old number stays ours until the customer confirms the change has
  propagated to their listings.

**Never release the old number the same day.** Closing a workspace releases the
number at Telnyx immediately and it may already belong to somebody else
(`docs/OPERATIONS.md`) — the same irreversibility applies here.

---

## Protecting the pool

One abusive workspace degrades everyone's throughput on a shared campaign, and
Telnyx holds us — not the tenant — responsible.

- Per-company outbound rate limiting is SPEC §10 layer 3, enforced at the single
  dispatch choke point.
- `kill:outbound-send` with a `--company` override contains one tenant without
  touching anybody else (`docs/ROLLBACK.md`).
- The daily assessment is what makes a slowly-souring tenant visible before the
  carrier notices.

## Related

- `docs/ROLLBACK.md` — kill switches, including the per-workspace override
- `docs/DECISIONS.md` D2 — the open Canada question (#379)
- `docs/OPERATIONS.md` — support scripts, and why a released number is gone
