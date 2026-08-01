# Getting back in

**Status: CURRENT DIRECTION (#323).** Describes how the product works today. Where it disagrees with `docs/DECISIONS.md`, that file wins.

Two-factor authentication protects the thing an attacker actually wants: not
data, but the ability to text a homeowner **from the plumber's real number**
asking them to re-send payment somewhere else. The customer cannot detect that,
because the number is genuine.

Which is exactly why the way back in matters as much as the lock. The issue
this came from ([#314]) names the real risk correctly: *a contractor who loses
their phone and cannot get into the app has lost their business phone line, and
will rightly blame us.*

So there are three ways back, in order of how much they cost. Take the first
one that applies.

---

## 1. You still have a recovery code — self-serve, instant

Ten single-use codes are issued at enrolment and shown **once**. They cannot be
retrieved later, by us or by anybody with our database, which is the whole
reason they are worth having.

Using one **removes** two-factor from the account. It does not sign you in and
it does not elevate anything — you then sign in with your password alone and
set the factor up again.

That is deliberate, and it is the security of the whole mechanism. A recovery
code that granted a verified session would turn *a stolen password plus a
stolen printout* into a silent full bypass. Removing the factor is loud
instead: the account holder is emailed the moment it happens, so a code used by
somebody else is a message rather than a silence.

**Ten wrong codes locks the endpoint for an hour**, correct codes included, so
somebody grinding through guesses cannot turn a stolen password into a bypass.
Re-enrolling clears the lock — a person who has just proved control of the
account should not be carrying a punishment for having been attacked.

If codes are running low, issue a fresh set from Settings → Account. Doing so
invalidates every previous code, and the account holder is emailed to say so,
because a printout somebody still trusts is worse than none.

---

## 2. Somebody else in the workspace can act — no support ticket

Most lockouts do not need us at all, and reaching for us first is the mistake:

- **The workspace requires two-factor and you have not set it up.** You are not
  locked out. Every route that reaches enrolment is deliberately exempt from
  the requirement, so Settings → Account is always reachable. Set it up and
  carry on.
- **The grace period is about to end and somebody is on holiday.** The owner
  can turn the requirement off, and back on later with a fresh window. The
  deadline itself never moves once set — that is deliberate, so what an owner
  tells their crew stays true — but the requirement is theirs to lift.
- **The OWNER is the one locked out.** This is the case that used to be fatal
  and is not any more: if they named a backup owner in advance, that person can
  take over the workspace after a seven-day window. See `docs/OWNERSHIP.md`.

---

## 3. No codes, no other route — the human procedure

**Not automated, and not self-serve.** This is the case where a weak process is
worse than none, because it converts "call the founder" — slow, manual, and
actually quite secure — into something an attacker can attempt at scale. The
attacker's story is always the same, and it is a good one: *I lost my phone, I
run this business, my customers are texting and I cannot answer them.* It is
also exactly what a real customer says.

So this is executed by the founder, by hand, and only after **two independent
signals**. One is never enough: each is individually obtainable by somebody
determined, and the pairing is the security.

### Accepted signals

| Signal | How it is verified | Why it is hard to fake |
|---|---|---|
| **Control of the account's email** | A link we send, clicked, plus a reply from the same address in the same thread | The attacker's usual starting point, so it never counts alone |
| **Control of the payment method** | Card brand, last four, billing postcode on file, AND a Stripe micro-charge we initiate and refund | Requires access to the statement of the account that pays |
| **Control of the business number** | We text a code to the workspace's own number and they read it back on a recorded call | Requires physical control of the line the business runs on |
| **A colleague vouches** | An existing owner or admin of the same workspace confirms, from their own signed-in account | Requires an account we can already see is legitimate |

### The procedure

1. **Log the request first.** Who, which workspace, what they claim, how to
   reach them. Before anything else — a request nobody wrote down is a request
   nobody can review afterwards.
2. **Collect two signals.** Record which two, and how each was verified.
3. **Wait 24 hours** and tell the account's email address that a removal has
   been requested. If the real owner of the account did not ask, this is the
   message that saves them, and it only works if it goes out before the change
   rather than after.
4. **Remove the factor** with `api_mfa_set_recovery_codes` + the GoTrue admin
   factor delete, never a hand-written UPDATE. The person then signs in with
   their password and re-enrols.
5. **Tell them it happened**, and tell the workspace owner.

Twenty-four hours minimum, deliberately. Anybody who needs it faster than that
has recovery codes available to them in advance, and the enrolment screen says
so at the moment it matters.

### Never accepted

- **Urgency as a substitute for a signal.** Every social-engineering attempt on
  a procedure like this is urgent. So is every real one; that is why it cannot
  be evidence.
- **An email that merely looks official**, including one from a domain that
  resembles the customer's.
- **A request to change the recovery email as part of the same request.** That
  is the attack, written down.
- **SMS as a second factor**, then or ever. We are a texting company, so it is
  the obvious-looking option — and SMS factors fall to SIM swap while our
  users' phone numbers are the most publicly-known thing about their
  businesses. Recommending it would be indefensible for us specifically.

---

## What the product does on its own

| Event | Who is told | Why |
|---|---|---|
| A new device signs in | The account holder | The cheapest signal there is, and it helps people who never turn MFA on (#236) |
| Recovery codes issued | The account holder | The previous set just stopped working |
| A recovery code is used | The account holder | The one message that catches a code used by somebody else |
| Two-factor removed | The account holder | Their account is back to a password alone |
| An ownership claim starts | Every member | See `docs/OWNERSHIP.md` |

None of these go to the workspace. A sign-in is a fact about a person's
account, they are the only one who knows whether it was them, and telling a
boss where an employee signed in from would be surveillance rather than
security.

---

## Related

- `docs/DECISIONS.md` D69 — the reasoning, in one place.
- `docs/OWNERSHIP.md` — the owner-specific version of "cannot act", and the
  named-backup path that avoids this document entirely.
- `#236` signed-in devices — the response half: what to do once you know.

[#314]: https://github.com/BytechLabs/Texturion/issues/314
