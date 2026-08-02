# Accepted risks, and what would make us look again

**Status: CURRENT DIRECTION (#326), seeded 2026-08-02.** The register lives
here; the decisions themselves stay in `docs/DECISIONS.md`. This adds one thing
to each: **the condition under which it stops being the right answer.**

## Why this exists

This product records its trade-offs, which is unusually good practice. What
none of them carried was a trigger for revisiting, and the failure mode is
quiet: a decision that was right when made becomes wrong through changed
circumstances, and because it is written down it *reads* as still-considered.
**Documentation makes a stale decision look deliberate**, which is worse than
an undocumented one — an undocumented one at least invites the question.

Table shape is D85's, verbatim, because it already worked.

## The rules this register is held to

- **Triggers, not dates.** "When a deal requires it" is enforceable and
  self-evidently relevant. "Review in six months" is a calendar entry nobody
  honours.
- **Name the scoreboard, or admit there isn't one.** An accepted risk with no
  observability is a bet nobody is scoring, and an entry that implies we are
  watching when we are not is worse than no entry.
- **Short.** A register of forty is a document nobody reads. If a risk does not
  warrant a trigger, it does not belong here.
- **Pruned, not grown.** An entry whose risk has been closed is deleted, not
  archived. Two were deleted before this file was first committed (below).
- **Judged by whether it ever fires.** #326's own devil's advocate is right: if
  nothing here is ever triggered and nothing revisited, this is theatre and
  should be deleted rather than maintained.

## Already resolved, and therefore not in the register

#326 named these as accepted risks. Both had been closed by the time the
register was written, which is the argument for the register rather than an
exception to it:

- **"No MFA (#314)"** — MFA shipped, including enforced personal enrolment
  (`supabase/migrations/20260729000300_mfa.sql`,
  `20260731120000_mfa_enforce_personal_enrolment.sql`). Not a risk; a feature.
- **"Nothing measures deliverability (#235)"** — number reputation shipped
  (`supabase/migrations/20260730000300_number_reputation.sql`), and
  `apps/api/src/messaging/delivery-by-country.ts` carries a per-country
  delivery rate with an alert floor. This one matters twice: it was the
  evidence for #326's central claim that D4's risk is unwatchable, and it is
  no longer true. **D4 now has a scoreboard**, which is why its entry below
  names a threshold instead of an apology.

---

## R1 — first messages carry no identification or opt-out footer (D4)

| | |
|---|---|
| **Exposure** | A first outbound to a new contact is not guaranteed to identify the business or state how to opt out. Weakens 10DLC standing and invites carrier filtering. |
| **Bound** | Outbound only, and only the automatic footer. Consent capture, the opt-out keyword handler and the STOP gate are all untouched — a customer who replies STOP is still blocked, permanently, by machinery no send path can bypass. |
| **Why accepted** | Owner direction, 2026-07. The footer cost characters on every first message, and an em dash in it pushed a one-segment message to three. |
| **Trigger to revisit** | **Whichever comes first:** (a) `delivery-by-country.ts` reports a CA- or US-destination rate below `DELIVERY_ALERT_FLOOR` (0.85) for a sustained window; (b) any number reaches a `number_health` flagged state (#235); (c) counsel answers L1 in `VENDOR-QUESTIONS.md` on CASL s.6(2) sender identification; (d) a carrier rejection catalogued in `rejection-guidance.ts` cites missing identification. |
| **Not a trigger** | A single failed message, or one customer complaint. The risk is a *rate* and the scoreboard measures a rate; reacting to a single event would mean reversing an owner ruling on noise. |

**What firing this trigger buys.** The named mitigation is verified toll-free
for Canadian A2P (D113, #329) — already reachable on our Telnyx account, and
deliberately not built until this rate says it is needed. R1 and D113 share one
trigger on purpose, so neither can be revisited without the other.

## R2 — one carrier, no fallback (D76, #241)

| | |
|---|---|
| **Exposure** | Telnyx is the only path for SMS, MMS, voice and numbers. A prolonged outage or an account action stops the product, not a feature of it. |
| **Bound** | The seam is cut: the provider client is behind one module and the recovery time is named in D76 rather than assumed. This is a concentration risk, not an entanglement one. |
| **Why accepted** | A second carrier costs a second registration, a second number pool, and a porting story, for a failure that has not occurred. The recovery path is a port-out, and D76 states its duration honestly rather than pretending it is fast. |
| **Trigger to revisit** | **Whichever comes first:** (a) an account-standing event — a suspension, a compliance action, an unexplained rejection class; (b) a second carrier becomes cheaper than the weeks-long port-out recovery D76 prices; (c) Telnyx declines a market we have decided to sell into (they already do not list Canadian RCS carriers — D111). |
| **Not a trigger** | A single outage. One incident is what the recovery time in D76 is *for*; a second carrier bought after one bad night is a decision made by adrenaline. |

## R3 — the phone layer assumes +1 (#305)

| | |
|---|---|
| **Exposure** | Every market beyond the US and Canada is a rewrite rather than a rollout: NANP inference, the country CHECK constraints, the 10DLC state machine, and NANP-priced fair use all assume a ten-digit North American number. |
| **Bound** | Entirely internal. No customer is promised a market we cannot serve, and the ceiling is a fact about our own reach rather than a defect anybody experiences. |
| **Why accepted** | The ICP is Canadian and US trades. Building for a market with no customer in it is the most expensive kind of speculation. |
| **Trigger to revisit** | **Whichever comes first:** (a) a deal that requires a non-+1 number; (b) an existing customer expanding into one; (c) anybody quoting a timeline for international support to a prospect — the answer must be this entry rather than an improvisation. |
| **Not a trigger** | Curiosity about market size. #305 asks for the ceiling to be *inventoried and costed*, which is worth doing on its own; doing the work is a different decision from writing down what it would cost. |

## R4 — no SOC 2, no residency commitment (#285)

| | |
|---|---|
| **Exposure** | A buyer with a compliance function cannot complete procurement. There is no SOC 2 report, no DPA at `/legal/dpa`, and no data-residency guarantee — Workers AI inference cannot be confined to a country at all (`VENDOR-QUESTIONS.md` R4). |
| **Bound** | Honest today: `/legal/subprocessors` and `/legal/privacy` both state the routing rather than implying containment, and the AI disclosure was corrected specifically so the page does not overclaim. |
| **Why accepted** | The ICP is a three-person crew, not a procurement department. A SOC 2 is a five-figure annual cost against a buyer we do not currently sell to. |
| **Trigger to revisit** | **Whichever comes first:** (a) a real security questionnaire arrives — one, not a hypothetical; (b) a deal is lost with compliance cited as the reason; (c) we choose to sell to a segment that has a compliance function, which is a positioning decision and would make this a cost of entry. |
| **Not a trigger** | A competitor publishing a badge. Heymarket has SOC 2 Type 2 and we say so plainly on `/compare/heymarket`; conceding where they win is the posture, not a reason to buy an audit. |

## R5 — storage is free, with alerting instead of caps (D34)

| | |
|---|---|
| **Exposure** | A workspace can store an unbounded amount, and the cost lands on the founder. The tiers (25/50/100/200/400 GB) alert; they do not stop anything. |
| **Bound** | The abuse arm exists and fires; what is absent is a hard ceiling. Attachment ingest is capped per item and per message, so the growth is many-small rather than one-enormous. |
| **Why accepted** | A founder ruling: dropping a customer's photos to save storage money is the wrong trade for a product whose users send pictures of broken furnaces. Cheaper to pay than to lose the job. |
| **Trigger to revisit** | **Whichever comes first:** (a) any single workspace crosses the 400 GB tier — the top of the ladder means the ladder stopped describing reality; (b) storage becomes the largest line on the infrastructure bill; (c) #240's derivative-serving work lands, which changes the arithmetic enough that this entry should be re-read rather than assumed. |
| **Not a trigger** | Total storage growing. Growth is the product working. The question is concentration in one tenant, which is what (a) measures. |

## R6 — real RPO is up to 24 hours (D74)

| | |
|---|---|
| **Exposure** | Point-in-time recovery is not enabled on the production database, so the recoverable window is the last daily backup — up to 24 hours of messages, not the five minutes PITR would give. |
| **Bound** | RTO is unaffected. This is data loss on a restore, not availability, and it applies to a disaster scenario rather than ordinary operation. |
| **Why accepted** | PITR is a paid tier on a database that currently holds one production workspace's traffic. The cost is real and the exposure scales with customers rather than with time. |
| **Trigger to revisit** | **Whichever comes first:** (a) any paying customer beyond the founder's own workspace — at that point the 24 hours belongs to somebody who did not choose it; (b) a DPA or questionnaire asks for an RPO, since the honest answer is this entry; (c) a near-miss that would have needed a restore. |
| **Not a trigger** | Time passing. **Run `node scripts/ops/verify-backup-posture.mjs` before quoting an RPO anywhere** — D74's stated five minutes was corrected to this once already, and the script exists so the number is read rather than remembered. |

## R7 — RCS is deferred, and the ledger cannot tell channels apart (D111)

| | |
|---|---|
| **Exposure** | `usage_events` has no channel dimension, so a second revenue stream cannot be separated from SMS after the fact. **No backfill can reclassify rows that were never tagged.** |
| **Bound** | Not RCS-specific and not hypothetical — voice already needed its own Stripe meter for exactly this reason. The 35 other RCS-shaped sites in `docs/RCS-READINESS.md` cost the same whenever they are fixed; this one does not. |
| **Why accepted** | Recorded rather than accepted, honestly. #230's acceptance required the spike to change no production behaviour, and a schema change is production. |
| **Trigger to revisit** | **Already fired.** Tracked as #506. This entry exists so that if #506 is closed without being done, the reason is written next to the risk rather than lost in an issue thread. |
| **Not a trigger** | RCS shipping. That is D111's question and it has its own gate; this is about the ledger being able to record whatever comes next, which is true regardless of whether RCS ever does. |
