# Environments — where things get tested

Short version: there is **one deployed environment (production)**, and that is a
deliberate trade, not an oversight. What protects it is a real local stack, a CI
pipeline that stands up an actual database, a guard on the only irreversible
step, and a rollback measured in seconds.

## What exists today

**Local — a full stack, and this is the place to click around.**
`supabase start` runs a real Postgres with every migration applied, and the app
runs against it. `scripts/dev-seed.mjs` + `scripts/dev-shot.mjs` give a
signed-in session and screenshots, so a change can be *used*, not just compiled.
This is the "somewhere to test before release" — it is simply local rather than
a shared URL.

**The gate — a real database, not a mock.**
`checks.yml` stands up Supabase, applies all migrations **from zero**
(`db reset`), runs the SQL suite, the unit suites, and the launch-pass e2e
golden paths, builds both Workers, and compiles both phone apps. Every pull
request runs it, and `main.yml` calls the same file on every push to `main` —
one gate, not two that can drift.

**Production — merge-to-ship (D50).**
A green gate on `main` deploys nothing. Production changes when the release PR
merges, and `main.yml` orders it: gate → release → ship. `ship.yml` pushes the
migrations, deploys both Workers, purges the cache, and builds the two phone
release artifacts. One version exists at a time; the deployed commit is stamped
into the Worker and reported to Sentry as the release. `docs/RELEASING.md` is
the whole procedure.

The gate runs on every commit exactly as before — what moved is only *when* a
green gate turns into a deploy. A release that waits for the next merge is a
batch, so the migration guard below matters more than it did, not less.

## The gap that actually matters

CI's database is **empty**. That means a migration can be perfectly valid, pass
every test, and still destroy production data — `drop column`, `set not null` on
a column with existing NULLs, a narrowing type change. And unlike a Worker, a
migration **cannot be rolled back**.

That asymmetry — not the absence of a staging URL — is the real risk, so it gets
an explicit guard: `scripts/check-migrations.mjs` (run in CI) fails the build on
a destructive statement unless the migration says why it is safe:

```sql
-- destructive-ok: <why this is safe>
```

It deliberately does not flag `drop function`/`view`/`trigger` — dropping and
recreating a routine to change its signature is the normal idiom here, changes no
rows, and flagging it would train everyone to add the acknowledgement reflexively.
A guard people ignore is not a guard.

## Rolling back

```bash
pnpm --filter @loonext/api exec wrangler rollback
```

Seconds, no rebuild. This is *why* shipping a batch is safe for the Workers, and
why the migration guard above carries the weight for the part that isn't — a
release now carries several commits' worth of migrations at once, and none of
them roll back.

## Why there is no staging environment (yet)

A staging environment for this product is not just a second Worker — the core of
the product is telephony. A staging stack that cannot send a text or take a call
cannot exercise the thing most likely to break, so a faithful one needs its own
Supabase project **and its own Telnyx numbers and credentials**. Numbers bill
monthly whether or not anyone calls them, which is a standing cost center on a
product where the whole cost posture is cap-and-drop.

So the trade today is: local is faithful and free, CI is thorough, prod rolls
back fast, and the irreversible step is guarded. That is a reasonable posture for
one engineer.

**When to revisit:** the moment there is a second person shipping, or a customer
whose outage is expensive. At that point the honest sequence is

1. a second Supabase project (free tier is enough for staging data),
2. `wrangler deploy --env staging` with its own routes,
3. a Telnyx sub-account with **one** test number,

and `main` deploying to staging first, with production promoted from the same
artifact. That last part matters more than the environment itself: promoting the
*same build* is what makes staging meaningful rather than theatre.

## Cheaper middle step, if you want one sooner

`wrangler versions upload` publishes a Worker version with its own preview URL
that takes **no production traffic**. Useful for eyeballing a UI or API change
against real data before promoting it with `wrangler versions deploy`.

Note the sharp edge: a preview version uses the **production bindings**, so it
reads and writes the real database and the real Telnyx account. It is safe for
verifying a read-mostly change and genuinely dangerous for anything that sends,
dials, or bills.
