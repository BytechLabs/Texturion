# AUP enforcement runbook (#303)

**Status: CURRENT DIRECTION (#323).** Describes how enforcement works today,
including the parts that are policy rather than code — the "Not yet built"
section at the end is the boundary. The published policy at `/legal/aup` §8 is
the customer-facing commitment; where this file disagrees with it, §8 wins and
this file is the bug.

The published policy is `/legal/aup` §8. This is the operational side of it:
what to do when the watch job raises a workspace, and what each step of the
ladder means in the system.

**Read the policy first if the two ever disagree.** §8 is a public commitment to
customers; this file is a working note. A change here that contradicts §8 is a
bug in this file.

---

## What raises a case

`apps/api/src/messaging/aup-watch.ts` runs on a schedule, reads
`api_aup_signals`, and emails ops when a workspace trips its conjunction. It
**never acts**, by design: a roofer after a storm is statistically
indistinguishable from a mass marketer, and the cost of suspending the roofer on
the busiest day of their year is far greater than the cost of a carrier
conversation about the marketer.

The signals, and the thresholds as built:

| Signal | Threshold | What it means |
|---|---|---|
| Velocity | `VELOCITY_MULTIPLE = 5` times the workspace's own median day | Above its OWN baseline, not an absolute number, because a small crew's normal is a small number |
| Floor | `MIN_SENDS_TO_JUDGE = 100` | Below this nothing is judged; a quiet workspace tripling from 3 to 9 is noise |
| Fan-out | `FRESH_RATIO = 0.8` to previously-uncontacted numbers | Reaching strangers at scale is the shape mass marketing makes |
| Opt-outs | `OPT_OUT_ALARM = 10` | The recipients' own verdict, and one of two signals needing no interpretation |
| Opt-out RATE | `OPT_OUT_RATIO_ALARM = 0.03` above 50 sends | Catches the small workspace an absolute count is blindest to — the shape a bought list makes |
| Rejection RATE | `BLOCK_RATIO_ALARM = 0.02` above 50 sends | The same reading for the carrier's verdict |
| Carrier blocks | `SPAM_BLOCK_ALARM = 5` | The network's verdict. Lower than the opt-out bar because carrier filtering applies to the SENDING POOL, so these are already spending every other customer's deliverability |

Velocity and fan-out are a **conjunction**, not independent triggers. Volume
alone is a busy day; reaching new numbers alone is a new workspace doing exactly
what it should. Together they describe mass marketing and little else.

**Nothing here reads a message body.** `api_aup_signals` returns counts and
ratios only. Keep it that way: content inspection to protect our own sending
reputation would betray the privacy posture the rest of the product holds, and
§8 now promises publicly that we do not do it.

---

## Working a case

**1. Look before you believe it.** The alert names shapes, not verdicts. Check
the workspace's history, plan, and how long they have been a customer. A storm,
a seasonal campaign to an existing customer list, or a genuinely growing
business all look like this.

**2. Ask.** Step one of the ladder, and where most cases end. Contact the owner,
describe what was seen, and ask what is happening. A legitimate business answers
this easily and is usually glad to be asked.

**3. Decide a step, and record it.** Every action is auditable (#231). The
evidence is the signal set plus whatever the owner told you.

---

## The ladder, operationally

| Step | What it does | When |
|---|---|---|
| Ask | An email. Nothing changes in the system. | First response to any raised case |
| Rate-limit | Slows outbound. Existing conversations keep working. | Sending continues in a pattern that cannot be reconciled with the policy |
| Suspend sending | Outbound stops. Inbox, history and number stay theirs; inbound still arrives. | The pattern is clear and the owner cannot or will not explain it |
| Terminate | Ends the workspace. Usage already incurred is not refunded. | Deliberate, repeated after contact, or unlawful |

Skip straight to suspend or terminate when a carrier or regulator requires it, a
court order arrives, or the conduct is unambiguously illegal or actively harming
recipients. §8 promises we still say what happened and why, so still send that
email.

**A suspension is reversible and §8 says so.** If the explanation lands after the
fact, lift it. Getting this wrong in the cautious direction is recoverable;
getting it wrong in the other direction costs a customer their business.

---

## Not yet built

Honest state, so nobody assumes a lever exists:

- **Rate-limit and suspend now have a switch.** `companies.aup_enforcement`
  (`'none' | 'rate_limited' | 'suspended'`) is read by `getSendGates` and acted
  on in `runPreSendGates` — the single choke point every send path funnels
  through, the same place the opt-out gate lives. Suspended refuses with
  `sending_suspended`; rate-limited caps outbound at
  `RATE_LIMITED_SENDS_PER_HOUR` (20), which leaves an ordinary crew's day
  intact and makes a fan-out of thousands take weeks.

  Setting the state is still a human writing SQL. There is no ops UI, and the
  column's own constraint refuses a non-`none` state without a timestamp and a
  note of at least ten characters — §8 promises we say what happened and why,
  and a row nobody can reconstruct three weeks later cannot honour that.

- **Do NOT reuse the billing suspension.** `phone_numbers.status = "suspended"`
  is the non-payment path (`telnyx/provisioning.ts`), and the Stripe webhook
  clears it on payment (`webhooks/stripe.ts`). Wiring AUP enforcement through it
  would mean paying an invoice silently lifts an abuse suspension. Enforcement
  has its own state, and `aup-enforcement.test.ts` AE-5 fails if any file
  outside the enforcement path writes it — AE-10 fails if a billing, webhook or
  provisioning path is merely *added to the allowlist*, before any such write
  exists.
- **Applying the ladder IS recorded**, by a trigger on the column rather than
  by route code. That is deliberate: this file says enforcement is applied by a
  human in psql, and a route can only record what passes through it. Every
  writer is covered — psql, a future ops route, a migration, a mistake.
  `aup.rate_limited`, `aup.suspended`, `aup.lifted`, with both states and the
  note in `before`/`after` and a null actor, because it is a platform decision
  and not one taken by anybody inside the workspace.

  Re-asserting the SAME step writes nothing. A second complaint about a
  workspace already suspended is not a second suspension, and an audit column
  that cries wolf is one people stop reading.
- **Signup screening exists, and it FLAGS rather than declines.**
  `screenBusinessName` (packages/shared) matches the workspace name against the
  categories §4 prohibits and emails ops before the number is provisioned. It
  never blocks the signup: a name is weak evidence — "Colt Plumbing" is a
  plumber — and refusing on a keyword would turn away a real customer at the
  moment they are deciding whether to trust us, with nobody to argue to.

  The term list's SPECIFICITY is the feature. A single common word in it fires
  on real contractors, whoever reads the alerts learns to dismiss them, and the
  one real dispensary lands in a queue nobody trusts. PC-8 fails the build if a
  term is a word an ordinary trade name contains.
- **Complaint intake exists and has its own budget.** `POST /contact` takes a
  `kind`, and `abuse` is counted against a separate daily cap. That is not
  cosmetic: the cap counted every submission globally, so twenty sales
  enquiries exhausted the day and the abuse report arriving at four in the
  afternoon was silently dropped — the cost protection suppressing the reports
  that protect the sending pool. Published in `/legal/aup` §9.

- **Complaint ratios** are implemented, as a second reading of the two
  verdict signals rather than new data. A count answers the wrong question for
  half our customers: ten opt-outs against ten thousand sends is a good week,
  ten against forty is a workspace texting people who never asked. Above
  `RATIO_MIN_SENDS = 50`, an opt-out rate of 3% or a carrier-rejection rate of
  2% is reported — but only when the COUNT alarm has not already said it, so
  one workspace never produces the same fact twice in different arithmetic.

  The floor is the whole trick. Without it, one opt-out from three sends is
  33% and every quiet workspace trips on its first unsubscribe. Carrier-
  violation codes now are: `api_aup_signals.spam_blocks_24h` counts outbound
  FAILED with the codes `carrier-failure.ts` classifies as `spam_blocked`
  (40003, 40015, 40322). `40300` is excluded on purpose — it is an opt-out and
  already has its own signal, and counting it twice would report one STOP as
  two problems.
