# Who owns a workspace, and how that changes

**Status: CURRENT DIRECTION (#323).** Describes how the product works today. Where it disagrees with `docs/DECISIONS.md`, that file wins.

The owner role controls billing, the spending cap, phone numbers, and US
texting. It is the one role that cannot be demoted by anybody else, which is
what stops an admin locking out the person who pays.

That property is worth keeping. What #332 added is the missing other half: a
way for it to move **deliberately**, so a founder who retires, sells, dies, or
loses access to their email does not leave a business nobody can run.

This page is the policy. The code is
`supabase/migrations/20260729000200_ownership_transfer.sql` and
`apps/api/src/routes/ownership.ts`; the rules below are the ones a person has
to follow, including the one that is not automated on purpose.

---

## The invariant

Ownership lives in two places — `companies.owner_user_id` and the
`company_members` row with `role = 'owner'` — and they must always agree.

* `company_members_one_owner_uq` makes a second owner row impossible.
* `api_ownership_integrity()` returns every workspace where the two disagree.
  Empty is the only acceptable answer, and the SQL suite asserts it after every
  operation.
* Nothing writes `owner_user_id` except `apply_ownership()`. If you find
  yourself about to write it from anywhere else, that is the bug.

A workspace can never have zero owners and can never have two.

---

## Path 1 — transfer (the owner is here and able to act)

The owner offers, the recipient accepts. Two-sided, because a business is not
something a person can be handed without agreeing to hold it, and because a
silent reassignment would be indistinguishable from a takeover to everyone
else in the workspace.

1. Owner → **Settings → Team → Ownership → Hand the workspace over**, picks an
   active member.
2. Everybody on the crew is emailed. **Nothing has moved.**
3. The recipient accepts within **7 days**, or the offer expires.
4. On acceptance the swap is atomic: the outgoing owner becomes an **admin**
   (they still work here, they just no longer hold the powers that come with
   paying), the recipient becomes owner, and the backup nomination is cleared
   so the new owner names their own.
5. Everybody is emailed again, and the whole thing is on the audit log.

Either side can call it off at any point before acceptance: the owner cancels,
the recipient declines.

**Covers:** sale, retirement, planned succession, restructuring, a co-founder
handover, and the ordinary case of an owner who simply wants somebody else to
hold it.

---

## Path 2 — the named backup claims (the owner cannot act)

This is the one that matters, and it is deliberately not a recovery flow.

The owner nominates a **backup owner** in advance, while authenticated. That
person — and nobody else, ever — can later start a claim.

1. Backup → **Settings → Team → Ownership → Ask to take over**.
2. The owner is emailed immediately, and so is every member. The subject line
   starts with **"Action needed"**.
3. **Seven days pass.** For the whole of that week the owner can cancel it with
   one click, instantly, from any device.
4. If nobody cancels, the backup completes the claim and the same atomic swap
   runs.

**Why this is not a bypass.** The only person who can take the workspace is one
the owner chose. The owner keeps an instant veto for a full week. Every member
is told at the start rather than at the end, so the people who know whether the
owner is merely on holiday are the ones holding the alarm. An admin who was not
named can do nothing, and an admin who is not party to a claim cannot cancel
one either — otherwise an admin could keep a dead owner's workspace frozen
forever.

**Why seven days.** Too short and an owner on a two-week holiday loses their
business to a disgruntled backup. Too long and a grieving family waits a month
to answer their own customers. Seven days is about one full cycle of nobody
answering the business phone, which is roughly as long as a real business can
stand.

**Prompt for it.** A workspace with more than one member and no backup named is
one bad week away from Path 3. The Team screen asks for one on all three
clients; that prompt is far cheaper than any recovery procedure, and every
workspace that answers it converts the hard problem into the easy one.

---

## Path 3 — no backup, and the owner cannot act

**Not automated, and not self-serve.** This is the case the issue's own
devil's-advocate section is about: every account-recovery mechanism is an
attack surface, and this one guards the role that controls spending and phone
numbers. A weak procedure is worse than none, because it converts "call the
founder" — slow, manual, and actually quite secure — into something an
attacker can attempt at scale.

So this stays human-in-the-loop. It is executed by the founder, and only after
**two independent signals** from the list below. One signal is never enough:
each of them individually is something a determined attacker could obtain, and
the pairing is the whole security of the procedure.

### Accepted signals

| Signal | How it is verified | Why it is hard to fake |
|---|---|---|
| **Control of the payment method** | The claimant states the card brand, last four digits, and billing postcode on file, AND completes a Stripe micro-charge refunded immediately, initiated by us | Requires access to the statement of the account that pays |
| **Control of the ported number** | We text a code to the workspace's own business number and they read it back on a recorded call | Requires physical control of the line the business runs on |
| **Control of the business domain** | A DNS TXT record we specify, on the domain in the workspace's registered business email | Requires control of the company's own domain |
| **Documentary proof of succession** | Death certificate, grant of probate, or a bill of sale naming the claimant, matched against the registered business name and address on the 10DLC record | Legally attested, and matched against something we already hold |

### The procedure

1. **Log the request** before doing anything. Which workspace, who is asking,
   what they claim, and how they can be reached.
2. **Contact the current owner on every channel we hold** — their account
   email, and the workspace's own business number. Wait **14 days**. If they
   respond, the request ends here and becomes a Path 1 transfer or nothing.
3. **Collect two signals** from the table. Record what was verified and how.
4. **Tell the whole crew** that a change of ownership has been requested and
   verified, and wait a further **7 days** for an objection.
5. **Execute** with `apply_ownership()`, never a hand-written `UPDATE`, and
   write an audit row with the founder as actor.
6. **Tell everybody it happened.**

Total: at least three weeks, deliberately. Anybody who needs it faster than
that has a Path 2 nomination available to them in advance, and this document
says so at the point of prompting.

### What is never accepted

* An email from an address that merely looks official.
* A claim from somebody who is not already a member of the workspace, unless
  Signal 4 (documentary succession) is one of the two.
* Urgency as a substitute for a signal. Every social-engineering attempt on a
  procedure like this is urgent.

---

## What is audited

Every step, on the workspace's own history (#231), because the first question
after a handover that turns out to be wrong is "when was the backup named, and
by whom":

| Action | When |
|---|---|
| `ownership.backup_named` | A backup is named or cleared |
| `ownership.offered` | The owner offers it to a member |
| `ownership.claim_started` | The named backup starts a claim |
| `ownership.transferred` | The swap lands, by either path |
| `ownership.canceled` | Vetoed by the owner, or declined by the recipient |

---

## Related

* `docs/DECISIONS.md` D67 — the reasoning, in one place.
* `#276` offboarding: a member being removed. The owner row is still the one
  membership `offboard_member` refuses to touch, and now there is somewhere
  to send them first.
* `#346` account deletion: still refuses an owner, and now the refusal names a
  route that exists.
* `#236` signed-in devices: the other half of "the owner is unreachable" — you
  can at least see whether their phone has opened the app this month.
