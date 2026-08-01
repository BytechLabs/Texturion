# Rollback (#283)

**Status: CURRENT DIRECTION (#323).** Describes how the product works today. Where it disagrees with `docs/DECISIONS.md`, that file wins.

Something is broken in production. This is the order to work in, and the one
question that decides everything.

**Read this first:** the fastest fix is almost never a deploy. A deploy takes
CI plus a Worker rollout, and if the deploy path is what broke — or CI is red —
there is no fast path at all. That is the failure this whole mechanism exists
to route around.

---

## 1. Contain it (seconds, no deploy)

Kill switches take effect within the Worker's **10-second flag cache**. Every
one of them is reversible by the same command with `--on`.

```bash
node scripts/ops/set-flag.mjs --list
```

| Switch | Turning it OFF means | What still works |
|---|---|---|
| `kill:ai` | No AI enrichment anywhere — one gate, `runAiFeature` | Threads, tasks, voicemail; they just stop being enriched |
| `kill:calls` | No new calls placed or accepted (the WebRTC token is refused) | **Calls already in progress are never dropped.** Texting is untouched |
| `kill:realtime` | Clients stop subscribing and fall back to polling | The inbox — slower, never wrong |
| `kill:outbound-send` | **All outbound SMS stops**, at the one dispatch choke point | Everything inbound. Nothing queued is lost |

```bash
node scripts/ops/set-flag.mjs --key kill:calls --off --note "telnyx 5xx storm" --apply
```

`kill:outbound-send` is the most serious switch we have — it silences the
product's core promise. It exists for a carrier incident or a runaway loop
billing us per message, where the alternative is watching the bill climb until
a deploy lands.

**One workspace only** (a runaway tenant, or a bug only they trigger):

```bash
node scripts/ops/set-flag.mjs --key kill:ai --company <uuid> --off --note "why" --apply
node scripts/ops/set-flag.mjs --key kill:ai --company <uuid> --clear --apply   # undo
```

A per-workspace override beats the global switch in **both** directions, which
is also how a fix ships to the founder's workspace first.

**If the flag store itself is unreachable**, every flag falls back to the
default in `apps/api/src/flags/registry.ts` — kill switches default ON, so the
product keeps working. You cannot contain an incident with flags in that state;
go to §2.

---

## 2. Roll back the code

```bash
gh run list --branch main --limit 5           # find the last green deploy
git revert <bad-sha> && git push origin main  # forward-only; never force-push main
```

A revert is a new commit through the same CI. If CI is red for an unrelated
reason, fix that first or the rollback cannot ship — which is precisely why §1
comes before §2.

---

## 3. The migration question

**This is the one that catches people.** `supabase db push` runs **before**
`wrangler deploy`. So by the time a bad Worker is live, its migration already
is too — and reverting the Worker does not revert the schema.

Ask one question:

> **Did the migration remove or narrow anything?**

### It only ADDED (a column, a table, a function, a permissive default)

**Roll the code back and leave the schema alone.** An added column that nobody
reads is inert. This is why every migration here is written expand-first: the
schema stays compatible with the previous Worker, so the Worker can go back on
its own.

### It REMOVED or NARROWED something (dropped a column, tightened a CHECK, made a column NOT NULL, changed a function's signature)

**You cannot roll back. You must roll forward.**

The old Worker will not run against the new schema, and undoing the migration
loses whatever has been written since it landed. Write a new migration that
restores what the previous Worker needs, and deploy that.

The mitigation is to never be here: **expand and contract as two deploys.**
Add the new shape, ship the code that writes both, let it settle, then remove
the old shape in a later migration. The contract half is the only genuinely
irreversible thing we do, and it should never ride the same deploy as the
feature that needs it.

### Which situation am I in?

```bash
git diff <last-good-sha>..HEAD -- supabase/migrations/
```

Look for `drop`, `not null`, `check`, and any `create or replace function`
whose **argument list changed** — that last one is a trap: it creates an
*overload* rather than replacing, and a defaulted new parameter makes every
shorter call ambiguous. (#339 hit exactly this; `app_version.test.sql` now pins
the function count.)

---

## 4. Ship the fix to a subset first

Once there is a fix, it does not have to go to everyone at once.

```bash
node scripts/ops/set-flag.mjs --key rollout:x --internal --apply       # internal cohort
node scripts/ops/set-flag.mjs --key rollout:x --percent 10 --apply     # then 10%
node scripts/ops/set-flag.mjs --key rollout:x --percent 100 --apply    # then everyone
```

Buckets are **stable**: a workspace's position for a given flag never moves, so
a feature cannot appear and disappear under somebody mid-task, and two
different 10% rollouts do not land on the same tenth of the customer base.

---

## 5. Afterwards

- Note what happened on the flag row (`--note`). It is the first thing the next
  person reads.
- **Turn the switch back on.** A kill switch left off is an outage nobody is
  paging about.
- If a rollout flag is now permanent, delete it and its branches. `removeBy` in
  `registry.ts` fails CI once the date passes, on purpose: permanent flags are
  how a codebase becomes untestable.

## Related

- `docs/OPERATIONS.md` — the support scripts, and D71's update floor
- `docs/DECISIONS.md` D72 — why flags are declared in code and valued in the database
