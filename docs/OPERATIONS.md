# How a support request becomes a change in production

There is no admin console, and there is deliberately not going to be one soon:
it is a large build for a solo founder and most of it would go unused. What
there is instead is a short set of reviewed scripts, and two rules that apply
to every one of them.

**The rules matter more than the scripts.** The risk here does not scale with
customer count — it scales with the number of times somebody runs a manual
statement, and the worst outcome is available on the very first one.

1. **Dry run by default.** Nothing writes without `--apply`. Every script
   prints the rows it would touch first. This is what catches an unqualified
   `WHERE`, which is the single failure mode that turns one customer's support
   request into a multi-tenant incident.
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

## Related

- `docs/ACCOUNT-RECOVERY.md` — the MFA lockout procedure, which is the same
  shape: a documented human path, deliberately not self-serve.
- `docs/OWNERSHIP.md` — the unreachable-owner procedure.
- `docs/DECISIONS.md` D70 — the reasoning.
