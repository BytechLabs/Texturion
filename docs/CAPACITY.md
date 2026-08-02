# Capacity: what breaks first, and at what volume

> **Status: partial, and the partiality is the point.** #251 asks for "a
> documented capacity plan naming the first thing that breaks and at what
> volume." One of its five unknowns is now measured. The other four are not,
> and this document says so rather than estimating them, because a capacity
> number that reads as measured and was guessed is worse than an admitted gap —
> it is the number somebody quotes to a 50-tech prospect.

Re-run the measured half with:

```bash
node scripts/ops/query-load.mjs
```

---

## 1. The hot list queries — MEASURED

The one axis #251 says unit tests cannot reach: *"their behaviour on a
workspace with 50,000 conversations and 200,000 messages is unmeasured, and
index behaviour on realistic data volumes is not something unit tests can tell
us."*

Index behaviour at volume is a property of Postgres and the schema, not of the
network, so a local database running the same migrations answers it exactly.
Measured on a developer laptop (Docker Postgres 15, warm cache, best of three).

| Workspace size | `api_for_you` | inbox page 1 | `status=open` | search |
|---|---|---|---|---|
| 5,000 conversations / 20,000 messages | 30 ms | 54 ms | 30 ms | 36 ms |
| 50,000 conversations / 200,000 messages | >200 ms | >200 ms | >200 ms | **282 ms** |

**The finding: every hot query crosses 200 ms somewhere between a 5,000- and a
50,000-conversation workspace.** At the smaller size the whole set is
comfortable. At the larger one all four are above the line a person notices,
and search is the worst at 282 ms.

**What that means in customers.** A conversation is one contact-relationship
(D7 threads by contact, reopening within 30 days rather than starting a new
row), so 50,000 conversations is a business with tens of thousands of distinct
customers. No current customer is near it. The honest statement to a
prospect is therefore: *the list surfaces are fast for a normal trade business
and have not been tuned for one with tens of thousands of customers, and we know
where that starts to show.*

**Not yet done, and deliberately filed rather than fixed here** (#251: "with the
resulting index work filed separately rather than fixed here"): the
`EXPLAIN (ANALYZE, BUFFERS)` pass on each of the four. Run
`node scripts/ops/query-load.mjs --keep` and explain against the fixture.

### Caveat on the measurement

Seeding 50,000 conversations and 200,000 messages takes upwards of ten minutes
on a laptop, which is why the table above has a complete row at the smaller size
and a partial one at the larger. The 282 ms search figure and the
"all four over 200 ms" verdict come from a completed full-volume run; the three
individual sub-figures at that size were not captured before the seeding budget
ran out. They are left blank rather than interpolated.

---

## 2. What is NOT measured, and why not

These four are properties of a **deployed system under concurrency**. Nothing
local can speak to them honestly, and each needs a non-production environment
plus a driver that generates real concurrent load.

| Unknown | Why local cannot answer it | What it would take |
|---|---|---|
| **Durable Object saturation** | A DO is single-threaded per instance and serializes every event for one call. The failure mode is latency on call setup, which only appears when real webhooks arrive concurrently. | A deployed Worker, N synthetic concurrent calls per workspace, measuring time-to-answer. |
| **Supabase pooler ceiling** | Workers scale to arbitrary concurrency; Postgres does not. The question is where the pooler refuses and whether the API errors honestly or hangs — a property of the managed pooler, not of a local Postgres. | Load against a non-prod Supabase project with the same pooler configuration. |
| **Realtime fan-out** | Broadcast delivery to many subscribers is a Supabase Realtime property. Realtime has already died silently twice (#215, and the mobile parked-reconnect bug), so this is the axis with a track record. | N subscribed clients per workspace against a deployed project, measuring delivery and drop rate. |
| **Webhook burst** | Telnyx delivers on its schedule; a carrier retry storm after a partial outage is the spike, and it arrives exactly when we are least able to absorb it. | Replay a captured burst against a deployed Worker at real concurrency. |

**The honest-degradation requirement is also unverified.** #251 asks that every
ceiling produce a truthful failure rather than a hang. That cannot be claimed
for a ceiling nobody has reached.

---

## 3. Where the declared ceilings already are

Not measurements — these are limits the code sets deliberately, collected here
because a capacity conversation should start from what we already decided.

| Limit | Value | Where |
|---|---|---|
| Concurrent presented calls per device | 2 | `SoftphoneCore` / provider |
| Push targets per user | bounded, oldest evicted | `MAX_PUSH_SUBSCRIPTIONS_PER_USER` (#30) |
| Egress per workspace per period | 200 GB | `EGRESS_ALLOWANCE_BYTES` |
| Retention sweep per run | 500 rows/batch, 20 batches/workspace, 5 workspaces | `retention-enforce.ts` |
| Workspace purge per run | 500 rows/step, 200 steps, 5 workspaces | `purge.ts` |
| AI features per workspace per month | hard per-feature caps | `AI_UNIT_COST_CENTS` consumers |

These bound our own background work. None of them bounds a customer's
interactive experience, which is what section 1 measures.

---

## 4. Cost per unit of load

Partially answered elsewhere rather than here. `node scripts/ops/storage-report.mjs`
(#240) reports stored bytes, egress and derived monthly cost per workspace from
real data, which is the storage half. Message, voice and AI unit costs live in
`billing/costs.ts` and are already summed per tenant by the overage warning.

What is missing is compute: the Worker and DO cost of serving a busy workspace,
which needs the same deployed environment as section 2.
