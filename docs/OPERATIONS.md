# How a support request becomes a change in production

**Status: CURRENT DIRECTION (#323).** Describes how the product works today. Where it disagrees with `docs/DECISIONS.md`, that file wins.

There is no admin console, and there is deliberately not going to be one soon:
it is a large build for a solo founder and most of it would go unused. What
there is instead is a short set of reviewed scripts, and two rules that apply
to every one of them.

**The rules matter more than the scripts.** The risk here does not scale with
customer count — it scales with the number of times somebody runs a manual
statement, and the worst outcome is available on the very first one.

1. **Dry run by default.** Nothing writes to product data without `--apply`.
   Every script that writes prints the rows it would touch first. This is what
   catches an unqualified `WHERE`, which is the single failure mode that turns one
   customer's support request into a multi-tenant incident.

   The exceptions are named in the table below rather than left for somebody to
   discover: the three disaster-recovery scripts have no `--apply` because none of
   them writes product data at all — two are read-only, and `backup-drill.mjs`
   only ever creates and drops its own scratch database. A blanket rule with a
   silent exception is worse than a rule with a stated one.
2. **An audit row, always.** `audit_log` is hardened so that no route and no
   stolen key can rewrite history — but that protects against the *application*.
   A founder typing `update companies set …` bypassed it entirely, because the
   log records what the app did. These scripts write the row the app would
   have written: null actor (the schema's system-actor slot) and a
   `platform-ops/<script>` agent, so a support edit is distinguishable from a
   cron six months later.

If you find yourself about to type SQL into psql against production, that is
the signal to add a script here instead — even a bad one, because a bad script
still dry-runs and still leaves a record.

---

## Running one

Credentials come from the environment, never from a flag. A secret in an
argument is a secret in your shell history.

```bash
export SUPABASE_URL=https://<project>.supabase.co
export SUPABASE_SECRET_KEY=sb_secret_...
node scripts/ops/<script>.mjs --company <uuid>          # shows what it would do
node scripts/ops/<script>.mjs --company <uuid> --apply  # does it
```

Every script prints the target host and the mode before anything else. **Read
that line.** Running a fix against the wrong project is the one mistake nobody
recovers from, and the host being on screen next to the word APPLY is the only
reliable defence.

---

## What exists

| Script | For | Notes |
|---|---|---|
| `reopen-workspace.mjs` | A workspace closed by mistake, inside the 30-day window | Restores the data. **Cannot restore the number** — see below |
| `clear-spam-flag.mjs` | A real customer marked as spam (#342) | The company id is a filter, not a check, so it cannot reach across tenants |
| `restore-member.mjs` | An offboarding that should not have happened (#383) | Comes back as `member`, never silently as `admin` |
| `reset-registration.mjs` | A rejected 10DLC brand or campaign (#352) | Re-opens the wizard; **submits nothing to Telnyx** |
| `set-release-policy.mjs` | Recommending — or requiring — an app update (#339) | Prints the blast radius before the write. A floor is governed by **D71** |
| `version-distribution.mjs` | "Does everyone have the fix?" (#339) | Read-only; no `--apply`. Names the cohort reporting no version at all |
| `set-flag.mjs` | Containing an incident without a deploy (#283) | Kill switches take ~10s. See **`docs/ROLLBACK.md`** |
| `backup-drill.mjs` | Proving the data comes back, and timing it (#249) | Dump → restore → verify against a scratch DB. **Exception to rule 1: no `--apply` and no dry run** — it drops and recreates its own `restore_drill` database every time. It never touches product data, which is why the exception is safe. See **`docs/DISASTER-RECOVERY.md`** |
| `verify-backup-posture.mjs` | Answering any question about RPO, including a security questionnaire (#249) | Read-only, no `--apply`; asks the Supabase Management API for PITR status and the backup window. **Exits non-zero while PITR is off**, so it can gate an answer rather than merely inform one. `--monitor` inverts that: it fails only if backups have stopped, which is what the weekly `backup-posture.yml` job needs |
| `prod-dump-scale.mjs` | "How big is production, and how long does getting the data out take?" (#249) | Read-only against production, and **writes nothing to disk** — the dump is streamed to a byte counter and discarded, because a full production dump at rest is customer message bodies with no retention policy |
| `legal-hold.mjs` | A workspace is in a dispute or under investigation (#284) | Suspends every retention deletion for it. Changes nothing else — a hold that degraded the product would punish somebody for being in a dispute |
| `erase-contact.mjs` | A non-customer asks us to delete their contact-form data (#340) | They have no account, so no self-serve path reaches it. Prints what we hold **before** removing it, and returns a count |
| `retention-report.mjs` | Is week-4 retention above D12's 85% floor? (#327) | Read-only. **Withholds the verdict** on a thin cohort rather than showing a rate nobody should act on |
| `rcs-session-model.mjs` | Would RCS Conversational's per-session billing beat per-segment SMS? (#450) | Read-only. Folds real traffic into rolling 24h sessions and prints break-even across plausible multipliers. **Withholds the verdict** below 200 sessions |

### The one promise that needs saying out loud

Closing a workspace **releases its phone number at Telnyx immediately**, on
purpose: holding a number costs us money for a workspace that has asked to
leave. Once released it is in the carrier's pool and may already belong to
another business.

So `reopen-workspace.mjs` restores everything except the thing customers ask
about first. It prints that in red-flag terms rather than quietly reopening,
because the customer needs to hear it from us in the same breath as "you're
back" — not when a job text bounces. The product copy on the closure screen
says the same thing before they confirm.

### The floor is the one script that can hurt everybody at once

`set-release-policy.mjs --recommended` is safe and dismissible. `--minimum` is
not: below it, the app stops, and the person holding it is running their
business phone line off it. D71 governs when that is allowed; the script
enforces the mechanical half —

- a floor **requires `--message`**, because somebody losing access is owed the
  reason on the same screen;
- a floor **may not be newer than the currently recommended version**, so it can
  never point at a build that has had no time to reach anyone;
- the **blast radius prints first**, on the dry run as well as the apply,
  counting sessions that report *no version* as blocked — because they are, and
  early on they are most of them.

Rollback is `--clear --apply`: live within the endpoint's five-minute cache, no
deploy involved. That is the whole reason the floor lives in the database rather
than in a build — a floor baked into a client can only be lowered by shipping a
client, and the moment you need to lower it is the moment shipping is the thing
that is broken.

---

## What is still by hand

Named here rather than left to be rediscovered:

- **A stuck port-in.** Telnyx dashboard plus state fixes. The port saga has its
  own resume path (`pollPortRequests`); reach for that first.
- **"My texts stopped arriving."** Investigation, not a fix — start with the
  `webhook_liveness` probe (#308) and the per-country delivery split (#379).
- **Anything touching money.** Refunds and proration go through Stripe's own
  dashboard, which has its own audit trail and does not need ours.

---

## Where personal data lives

`docs/PERSONAL-DATA-INVENTORY.md` classifies **every** table, including the ones
holding nothing personal — because "not in the document" must always mean
somebody forgot, never that it was deliberately left out. A new table with no
line there fails CI.

The two answers worth knowing without looking them up: **SSN/SIN last-4** lives
in exactly two tables, and **raw IP addresses** in exactly two. Everything else
that looks like an address is derived geography, on purpose.

## Related

- `docs/ACCOUNT-RECOVERY.md` — the MFA lockout procedure, which is the same
  shape: a documented human path, deliberately not self-serve.
- `docs/OWNERSHIP.md` — the unreachable-owner procedure.
- `docs/DECISIONS.md` D70 — the reasoning.
