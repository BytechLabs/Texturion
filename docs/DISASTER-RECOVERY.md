# Disaster recovery (#249)

`docs/deploy/08-operations.md` §6 covered backups in six lines: "confirm PITR is
enabled", and to recover, "use the dashboard to restore to a timestamp". That is
a plan, not a capability — an untested backup is a belief, and the first
exercise of a belief is always during the worst hour of the company's life.

This document exists so nobody reads that sentence at 3am and discovers what it
left out.

---

## 1. The targets (D74)

| | Target | What it means |
|---|---|---|
| **RPO** — how much data we can lose | **Up to 24 hours** (verified 2026-07-29) | PITR is **OFF** on production, so the only restore points are the daily physical backups. The 5-minute figure this row used to carry assumed PITR was on; nobody had checked. See §2 |
| **RTO** — how long until we are serving again | **4 hours** | Not because recovery takes four hours, but because *discovering, deciding, and reconciling* does |

**These numbers are a commitment about the database only.** The reconciliation in
§4 is bounded by what Stripe and Telnyx will tell us, and neither has an SLA to
us. A recovery is "done" when texting works; it is "correct" days later.

---

## 2. What we actually know, and how we know it

**The logical restore path is measured**, not assumed:

```bash
node scripts/ops/backup-drill.mjs
```

**Drill record — 2026-07-29, local Supabase (PostgreSQL 17.6):**

| Phase | Result |
|---|---|
| Source | 66 tables, 154 functions |
| Dump (`pg_dump -F c`) | **0.5s**, 1.2 MB |
| Restore (`pg_restore`) | **1.6s** |
| Verification | ✓ 66 tables, 154 functions, **every per-table row count matched exactly** |
| **Total data time** | **2.1s** |

What that drill genuinely proves: the dump restores, no constraint or extension
bites only on reload, and nothing is silently dropped. Those are the failures
that hide until you need them.

What it does **not** prove, stated plainly rather than left to be assumed:

- **It is not a PITR drill.** Restoring Supabase's point-in-time backup into a
  fresh project is a dashboard action with a cost, and only the founder can do
  it. **This is the one open item on #249** and it stays open until done.
- **It was run against local, not production.** The schema is identical (same
  migrations); the data volume is not. At production's current size the data
  phase is still minutes, not hours — but that will change, and the drill should
  be re-run against a production-sized restore before anyone quotes the RTO.
- **2.1 seconds is not the RTO.** At our size the data is the *fast* part.
  Provisioning a target, moving secrets, repointing DNS and doing §4 dominate.

### PITR status — a fact, with a date

Recorded rather than assigned as a chore. **Re-verify every quarter** and update
this line; if the date below is stale, the correct reading is "unknown", not
"fine".

| Checked | By | Plan | PITR | Retention |
|---|---|---|---|---|
| **2026-07-29** | `scripts/ops/verify-backup-posture.mjs` (Management API) | Supabase Pro, us-east-1 | **OFF** | 8 daily physical backups, oldest 2026-07-22 |

**PITR is not enabled.** The worst case this section told the reader to assume
turned out to be the actual case, which is why assuming it was the right
instruction — and why leaving the row blank was not.

It did not need a dashboard visit after all. `scripts/ops/verify-backup-posture.mjs`
asks the Management API directly, read-only, with the token CI already holds, and
**exits non-zero while PITR is off** so the claim cannot quietly drift back into a
document. Run it before answering any question about RPO.

**What this means in practice.** The only restore points are the daily snapshots,
taken around 05:27 UTC. At the moment of checking, the newest was **18.1 hours
old** — that was the live exposure, not a theoretical maximum. Anything written
since the last snapshot is gone in a total-loss scenario.

**Enabling PITR is a paid Supabase add-on and a founder decision**, and it is the
one change that would make the 5-minute figure real. Until then 24 hours is the
number, and it is what goes in a security questionnaire.

---

## 3. Order of operations

1. **Stop the bleeding before restoring anything.** `docs/ROLLBACK.md` §1 —
   kill switches take effect in ~10 seconds and need no deploy. If the cause is
   a bad release rather than data loss, you are in the wrong document.
2. **Establish the restore point.** The last timestamp you are confident is good.
   Write it down; every step in §4 is relative to it.
3. **Restore Postgres** to that timestamp.
4. **Answer the migration question** (§5) *before* pointing the Worker at it.
5. **Reconcile the four stores that did not roll back** (§4).
6. **Then** re-enable outbound.

---

## 4. Postgres is not all our state

A point-in-time restore of the database alone leaves us inconsistent with four
other systems. **None of them roll back.** For each, the posture is
reconciliation, not restoration.

### R2 — attachments

**Does not roll back.** Restoring the DB to yesterday leaves two kinds of drift:

- **Rows pointing at deleted objects.** An attachment deleted after the restore
  point is gone from R2, and the restored row still references it. Downloads
  fail with a signed URL to nothing.
- **Orphan objects.** Files uploaded after the restore point exist in R2 with no
  row. They are invisible to the product and we pay for them.

**Reconciliation:** the existing `job:sweep-deleted-attachments` handles orphans
on its normal cadence — an object with no row is exactly what it reclaims. The
first kind needs a scan: list attachment rows created after the restore point
and probe each object. Broken ones should be **deleted rows, not silent 404s**;
a customer needs to know a photo is gone, not click a button that fails.

### Durable Objects — live call state

**Undefined behaviour, and the most dangerous item here.** A `CallSessionDO`
carries authoritative machine state *outside* Postgres. A DB restore under live
DOs means the DO believes in a call the database has never heard of.

**Reconciliation:** before restoring, **turn off `kill:calls`**
(`docs/ROLLBACK.md`). That refuses new call tokens while letting in-flight calls
finish on their own. Wait for `job:sweep-stale-calls` to close what remains, or
accept that any call still live at restore time will end badly for that one
caller. DO state is not worth restoring — it is short-lived by design, and the
`calls` rows are the durable record.

### Stripe — subscriptions and invoices

**Does not roll back, and the drift is money.** A restore past a billing event
puts our tables out of sync with the actual charges — in our favour or the
customer's, and *we would not know which*.

**Reconciliation:** `job:subscription-reconcile` already exists for exactly this
shape of drift (missed webhooks) and is the right tool. Run it immediately after
the restore rather than waiting for its daily slot. Then check the webhook
ledger for Stripe events between the restore point and now, and replay them —
`job:sweep-webhooks` does this, but only for events we received and stored.
**Events that arrived during the outage may never have been stored at all**;
Stripe's dashboard is the source of truth for that window, not our ledger.

### Telnyx — numbers

**Does not roll back.** A number ordered after the restore point still belongs to
us and is missing from our tables. A number *released* after the restore point is
gone from the carrier's pool and may already belong to another business — while
our restored table says it is ours.

**Reconciliation:** `job:reconcile-numbers` adopts orphans (a number we own with
no row) on its normal cadence. The reverse — a row claiming a number we no longer
hold — is the dangerous one: the workspace looks healthy and every send fails.
Compare `phone_numbers` against the Telnyx inventory and mark anything missing
`provision_failed`, which routes the customer to remediation instead of silence.

---

## 5. Migration-after-restore

**Restoring to a timestamp before a migration leaves a schema the deployed
Worker does not expect.** `supabase db push` runs *before* `wrangler deploy`, so
the schema is always at or ahead of the code — restoring backwards inverts that
for the first time.

Ask the same question `docs/ROLLBACK.md` §3 asks:

- **The restore point is before an ADDITIVE migration.** The current Worker
  expects a column that no longer exists. **Re-run the migrations** — they are
  written expand-first and are idempotent (`if not exists`, `create or replace`),
  so re-applying is safe.
- **The restore point is before a REMOVING or NARROWING migration.** The current
  Worker expects the *narrower* shape and the restored data may violate it.
  Re-running the migration can fail on data written between the restore point and
  the drop. Fix the data first, then re-apply.

```bash
git log --oneline <restore-point-date>..HEAD -- supabase/migrations/
```

**Do not point the Worker at a restored database before doing this.** A Worker
against an unexpected schema fails in ways that write more bad data.

---

## 6. Independent backups

Everything currently lives inside **one vendor account**. Account-level loss —
compromise, billing failure, provider action — takes the backups with the data.
That is the same concentration argument as #241, applied to storage rather than
carriage.

**Current position:** we accept the concentration risk, and this is the honest
statement of it rather than a claim to have solved it. The mitigation available
today costs nothing to state: `scripts/ops/backup-drill.mjs` produces a portable
`pg_dump` in seconds, and a copy taken to any store outside Supabase — R2 is a
different vendor and is already provisioned — converts "one account" into "two".

**What has not been decided** is where that copy lives, who holds the key, and
its retention. Those are founder decisions with cost and custody implications,
and inventing them here would be exactly the kind of unverified instruction this
document was written to replace.

---

## Related

- `docs/ROLLBACK.md` — kill switches, and the same migration question for a bad deploy
- `docs/OPERATIONS.md` — the support scripts; note that a released number is gone
- `docs/DECISIONS.md` D74 — the RPO/RTO decision and its reasoning
