# Pre-answered security questionnaire (#285)

**Status: CURRENT DIRECTION (#323).** A working answer sheet, not a
representation. Every answer below cites where the fact lives, so the source is
what a buyer is really being told and this file is only a faster route to it.
Where this disagrees with the cited source, the source wins and this file is the
bug.

---

## How to use this

A SIG-Lite or CAIQ arrives as a spreadsheet with a few hundred rows, most of
which do not apply to a product this size. This covers the domains that always
appear, in the order they usually appear, so the founder is editing rather than
starting.

Three rules, and they matter more than the answers:

1. **Never widen an answer to make it sound better.** The buyer who catches one
   overclaim discounts everything else on the sheet, and the questions that
   would catch it are the ones a compliance function is good at.
2. **A dated fact needs its date carried with it.** Backup posture in
   particular is observed, not configured, and an undated number implies a
   guarantee that does not exist.
3. **"We do not have that" is a complete answer.** §"What we do not have" below
   exists so those rows can be answered quickly and consistently rather than
   negotiated one at a time.

---

## 1. Company, scope and certifications

| Question | Answer | Source |
|---|---|---|
| Do you hold SOC 2, ISO 27001 or equivalent? | No. None held, none in progress. **This is now stated on `/security` under "Certifications: we hold none"** — send the buyer there rather than only answering here, so the answer they get privately is the one anybody can read. | `docs/ACCEPTED-RISKS.md` R4, D119 |
| Will you sign a DPA? | Not today. There is no `/legal/dpa` and no source document for one. | `docs/ACCEPTED-RISKS.md` R4 |
| What is in scope? | The Loonext product: web app, iOS and Android apps, and the API that serves them. | `docs/DATA-INVENTORY.md` |

R4 records this as an accepted risk rather than an oversight, with the reasoning
and the conditions that would change it. If a questionnaire is being answered at
all, one of R4's own triggers has fired: **say so and revisit R4**, because
"a real security questionnaire arrives, one not a hypothetical" is the first
trigger listed there.

## 2. Data handling and location

| Question | Answer | Source |
|---|---|---|
| Where is customer data stored? | The United States. | `/security` (`apps/web/src/app/(marketing)/security/page.tsx`) |
| Do you offer data residency guarantees? | No. Storage is US, and that is a statement of where it is rather than a contractual commitment. AI inference in particular cannot be confined to a country. | `docs/ACCEPTED-RISKS.md` R4, `docs/VENDOR-QUESTIONS.md` R4 |
| Is data encrypted in transit and at rest? | Yes, both. | `/security` |
| Is message content used in analytics or error reporting? | No. Message content is excluded from analytics and from error logs. | `/security` |
| What personal data is collected? | Enumerated per field, per platform, with the reason. | `docs/DATA-INVENTORY.md` §"Data collected" |
| Is the device address book uploaded? | No. Reading it on-device is not collecting it, and the distinction is documented rather than assumed. | `docs/DATA-INVENTORY.md` §"Reading the device address book is not collecting contacts" |

## 3. Tenant isolation and access control

| Question | Answer | Source |
|---|---|---|
| How is one customer's data separated from another's? | Every query is scoped to one business by id, and the API authorizes every request itself — that is where the isolation lives. Row-level security is deny-by-default underneath it, which stops anything reaching the database outside the API but does not second-guess the API's own queries. Realtime channels are gated the same way. | `/security`, SPEC §10 |
| How are inbound integrations authenticated? | Cryptographically, per event: Ed25519 signatures on carrier webhooks, HMAC on payment webhooks. Anything failing verification is rejected. | `/security` |
| How are credentials managed? | Encrypted secrets, never in the repository. The payment key is restricted to billing scope; the database key is independently revocable. The browser receives only public configuration. | `/security` |
| Is access within a customer's own workspace controlled? | Yes, by capability rather than by rank, including per-number access control. | `docs/DECISIONS.md` (capability roles), `apps/api/src/routes/*` |

## 4. Availability, backup and disaster recovery

**Carry the dates.** These are observed facts with a method, not configured
guarantees.

| Question | Answer | Source |
|---|---|---|
| What is your RPO? | **Up to 24 hours.** Point-in-time recovery is OFF; recovery is from daily physical snapshots. | `docs/ACCEPTED-RISKS.md` R6, `docs/DISASTER-RECOVERY.md` §"PITR status" |
| Evidence for that? | Checked **2026-08-14** by `scripts/ops/verify-backup-posture.mjs` against the Supabase Management API: Pro plan, us-east-1, PITR off, 6 daily physical snapshots present, newest 1.1h old. Re-observe before sending — the snapshot count has read 8, 7 and 6 across three checks, and the "newest" age says where in the daily cycle the script ran rather than anything about the RPO. | `docs/DISASTER-RECOVERY.md` §"PITR status" |
| Is that re-checked? | Weekly, by CI (`.github/workflows/backup-posture.yml`). It alarms if backups have STOPPED, not because PITR is off, which is a recorded decision rather than news. | `docs/DISASTER-RECOVERY.md` |
| Is there a documented recovery procedure? | Yes, including the state that is not in Postgres: storage buckets, Durable Objects, Stripe, and Telnyx numbers, registrations and in-flight ports. | `docs/DISASTER-RECOVERY.md` §§3-4 |
| Has recovery been rehearsed? | There is a drill script (`scripts/ops/backup-drill.mjs`). Quote the date of the last run, not the existence of the script. | `docs/DISASTER-RECOVERY.md` |

**Do not quote the D74 target instead of the observed number.** The target and
the reality differ, R6 exists because of that gap, and a target quoted as an RPO
is the overclaim most likely to be checked.

## 5. Incident response and disclosure

| Question | Answer | Source |
|---|---|---|
| Will you notify us of a breach, and when? | Yes, with the timeline stated publicly, along with what we do not hold. | `/security` (added for #285) |
| Is there a route to report a vulnerability? | `security@loonext.com`, routed per the deploy documentation. | `docs/deploy/10-email-inbox.md` |

## 6. Deletion, export and portability

| Question | Answer | Source |
|---|---|---|
| Can a customer delete their data? | Yes, with a 30-day grace period before it becomes irreversible. | `packages/shared/src/deletion-promises.ts` (`DELETION_GRACE_DAYS`) |
| Is deletion complete? | Not in every store, and the exceptions are enumerated rather than implied. | `packages/shared/src/deletion-promises.ts` (`DELETION_GAPS`) |
| Can a customer export their data? | Contacts export exists; broader export is a known gap (#304). | `docs/DELETION.md`, issue #304 |

## 7. Subprocessors and AI

| Question | Answer | Source |
|---|---|---|
| Who are your subprocessors? | Published as a ledger, kept current. | `/legal/subprocessors` |
| Is customer data used for AI, and by whom? | Disclosed on both store forms and in the inventory. The disclosure states the routing rather than implying containment. | `docs/DATA-INVENTORY.md` §"AI, which is a data-sharing disclosure on both forms" |
| Is customer data used to train models? | Answer from the subprocessor ledger and the AI disclosure, not from memory. | `/legal/subprocessors`, `docs/DATA-INVENTORY.md` |

## 8. Abuse and platform integrity

| Question | Answer | Source |
|---|---|---|
| How is outbound messaging abuse prevented? | Destination restrictions (US and Canada), per-business rate limits, a customer-controlled spending cap, and opt-out enforced at send time. | `/security` |
| Is there an acceptable use policy, and is it enforced? | Yes, accepted at company creation, with a published graduated enforcement ladder and behavioural monitoring that alerts a person and never acts automatically. | `/legal/aup` §8, `docs/AUP-ENFORCEMENT.md` |
| Do you inspect message content to detect abuse? | No. Monitoring is behavioural: counts and ratios only. | `/legal/aup` §8, `apps/api/src/messaging/aup-watch.ts` |

---

## What we do not have

Answer these consistently. Each is a recorded decision with reasoning, not a gap
nobody noticed, and the reasoning is usually a better answer than the absence.

- **SOC 2 / ISO 27001** — none, none in progress (R4).
- **A DPA** — no document exists (R4).
- **A data-residency commitment** — storage is US; AI inference cannot be
  confined to a country (R4).
- **Point-in-time recovery** — off; real RPO up to 24 hours (R6).
- **A rehearsed-on-a-schedule recovery drill** — the script exists; quote the
  last run date rather than implying a cadence.

Not answered here, because nothing in the repository evidences them. Do not
improvise these: **penetration testing, external vulnerability scanning,
employee background screening, security awareness training, a formal SDLC
policy, and cyber insurance.** If a buyer needs them, that is R4's second
trigger doing its job.
