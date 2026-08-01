# Incident communication (#242)

**Status: CURRENT DIRECTION (#323).** Describes how the product works today. Where it disagrees with `docs/DECISIONS.md`, that file wins.

Detection is solved. Server-side Sentry is the source of truth for errors, the
`liveness_heartbeats` ledger catches the failures that are *absences* rather than
throws (#387), and the kill switches in `docs/ROLLBACK.md` stop the bleeding in
about ten seconds without a deploy.

**Telling the customer is the part that had no plan.** This is that plan. It is
deliberately short: a runbook nobody can follow at 7am while texting is down is
the same as no runbook.

---

## 1. Who declares

**The founder. There is nobody else, and pretending otherwise is how a runbook
becomes fiction.** No committee, no severity matrix, no escalation tree.

Declare when **either** is true:

- a customer-visible function is broken for **more than one workspace** — texting,
  the inbox, calls, or sign-in; or
- **you do not yet know** whether it is one workspace or all of them.

That second clause is the one that matters. The instinct during an incident is to
finish diagnosing before saying anything, and the diagnosis is exactly what takes
the longest. **Say something while you still do not know.**

## 2. Where it is posted, in priority order

1. **The `/status` live line.** One plain sentence in Cloudflare KV. **No repo, no
   CI, no deploy, no API worker** — you edit it in the Cloudflare dashboard from
   your phone and the page picks it up within a minute. This is the channel that
   works when the thing that is broken is our own pipeline.

   Dashboard: **Workers & Pages → KV → STATUS_FEED → key `incident`**. Type the
   sentence. That is the entire procedure. From a terminal, if you have one:

   ```bash
   pnpm --filter @loonext/web exec wrangler kv key put --binding STATUS_FEED incident "Texts are not sending right now. Incoming texts still arrive." --remote
   ```

   **Clear it the same way when it is over** (`--remote` delete, or empty the
   value in the dashboard). An empty or absent value renders nothing at all.

   **Then open `/status` once.** That page load is what mails the subscriber
   list (#477) — there is no cron, because the OpenNext worker entry is
   generated and has nowhere to hang one. The load also sends the "resolved"
   email when you clear the line, so do it both times. If you forget, the next
   visitor triggers it; opening the page yourself just means it does not wait
   for one.

2. **The status email list.** Anyone can subscribe from `/status`, including
   people who are not customers, and they are mailed once when the live line
   appears and once when it clears. Transitions only: re-wording the same
   incident does not re-mail anybody. Capped at two fan-outs a day and 1000
   status emails a month, and it stops rather than overspending, so during a
   long flapping incident assume the second wording did not go out.

3. **Direct email to affected owners.** Still the channel that matters most,
   because it does not depend on anybody remembering to check a page. Recipients:
   the owner addresses of affected workspaces (`billingRecipients` gives you the
   shape). If the blast radius is unclear, all owners.

4. **The written report in `INCIDENTS`** (`apps/web/src/app/(marketing)/status/page.tsx`)
   — the considered record, added afterward through a normal deploy, with a date
   and a full write-up. This one does need CI and a deploy, and that is fine: you
   are writing it when the incident is over.

**Why the live line and the written report are separate mechanisms.** The split
follows the failure boundary rather than the data shape. The urgent half has to
work while our deploy pipeline is the thing that is down, so it is one plain-text
value with no schema to get wrong at 7am. The considered half wants dates,
structure and review, so it goes through the repo like any other content. Trying
to serve both from one mechanism means either a JSON payload you have to hand-edit
during an outage, or a written record nobody can post when it matters.

**The value is plain text on purpose, not JSON.** One missing brace in a JSON
payload makes it unparseable, and the only safe thing the page can then do is show
nothing — which is the silence this whole document exists to prevent, with a syntax
error as its cause. There is no syntax. Type a sentence.

## 2a. The confirmed date

**Key `confirmed` in the same namespace, `YYYY-MM-DD`.** It means *a person
actually checked texting, the inbox and notifications on this date* — nothing
else. While it is within a week the page says so; past that, and whenever it is
absent or unparseable, the page says nobody has checked recently rather than
showing a date that answers a different question.

**Only set it when you have actually looked.** It is deliberately left EMPTY at
the time of writing, because nobody had, and a status page asserting a check that
never happened is the failure mode #242 was filed about.

## 3. The first message, within 15 minutes

Fifteen minutes from *declaring*, not from root cause. Four sentences, in this
order, and do not wait to improve them:

1. **What is not working**, in the customer's words. "Texts are not sending" —
   never "the dispatch worker is erroring".
2. **What still works.** Almost always something does, and it is the most useful
   sentence in the message: "Incoming texts are still arriving and nothing is
   lost."
3. **What we are doing**, present tense. "We have paused outbound sending while we
   fix it."
4. **When you will hear next.** A time, not a condition. "I will write again
   within the hour, whether or not it is fixed."

**Never** include: an ETA for the fix, a cause you are not sure of, or the word
"minor". The customer decides how minor it is.

A worked example, for the case that has actually happened (a carrier incident):

> Texts are not sending right now. Incoming texts are still arriving normally and
> nothing you have sent is lost — anything queued will go out when this clears.
> Our carrier is having an outage; we have paused outbound sending so nothing
> fails silently or bills you twice. I will write again within the hour, whether
> or not it is resolved.

## 4. The follow-up, and the close

**Follow up on the interval you promised, even with nothing new.** "Still working
on it, no change yet, next update in an hour" is a real message. Silence after a
promised time is worse than the original outage, because it is the moment the
customer stops believing anything we say.

**Close it explicitly.** An incident that stops being mentioned is not resolved,
it is abandoned. The closing message says: what broke, how long it lasted, what
was and was not affected, and what stops it happening again. If nothing stops it
happening again, say that instead of inventing something.

**Never bill for an incident you caused.** If a customer paid for segments that
did not arrive, refund them without being asked and say so in the closing
message — `docs/DECISIONS.md` D34 and the money-back posture make that the
cheaper choice anyway.

## 5. Publishing while everything is broken: settled

#242's first acceptance item — publish an incident while the API, CI and the
deploy pipeline are all broken — is **met**, by the KV live line in §2. The
options considered, and why KV won:

| Option | Independent of our deploy? | Cost | The catch |
|---|---|---|---|
| **External provider** (Statuspage, Instatus, Better Stack) | Yes, fully | ~$0–30/mo | A subscription and another vendor; the honest default for this problem, and what the category expects |
| **Cloudflare KV**, edited from the dashboard | Yes for CI and the API; **no** for Cloudflare itself | Included | Needs a namespace and binding; a Cloudflare outage takes the page and the product together, so the boundary is narrower than it looks |
| **A designated GitHub issue**, fetched at request time | Yes for CI, the API, and our deploy | Free | Adds a runtime dependency on GitHub's API and its rate limits; postable from a phone, which is a real advantage at 7am |

**Chosen: Cloudflare KV**, and the earlier recommendation of an external provider
was wrong on the decisive point. The argument for a provider was that it is
independent of *every* system likely to be down, and KV's listed catch was that a
Cloudflare outage takes the page and the product together.

That catch is not a real cost. **The status page is served by Cloudflare.** If
Cloudflare is down, nobody can load the page regardless of where its content came
from — so a KV dependency adds no failure domain that the page did not already
have. A Postgres-backed feed, by contrast, would ADD one: Supabase can be the
thing that is broken, or the thing a bad migration broke, and then the incident
feed goes down with the incident it exists to report.

So KV buys the whole acceptance criterion for zero new vendors, zero
subscriptions, and zero recurring cost, on infrastructure already in the critical
path.

**Subscribe-by-email: the provider recommendation above was withdrawn on
2026-07-31** (#477, D105). It rested on one claim — that a provider brings
subscribe-by-email along with it, so it is cheaper than building — and the claim
is true while the conclusion is not, because the build turned out to be a list in
the KV namespace we already have plus two plain-text emails. Buying would have
meant a recurring bill and a fourth vendor holding our customers' addresses, to
avoid roughly three hundred lines.

What matters more than the cost is *where it runs*. The API worker already has
Resend, rate limiting, suppressions and a database, so subscribing there would
have been a fraction of the code — and the notifier would then share a failure
domain with the product. A bad migration, a Supabase outage or a broken API
deploy would take the announcement down with the thing it was announcing, which
is the same mistake a Postgres-backed feed would have made. So the list lives in
KV beside the live line and the mail goes out from the worker that serves the
page.

**One setup step, and it is not done automatically.** The web worker needs its
own `RESEND_API_KEY` and `RESEND_FROM` secrets — separate from the API worker's,
because the point is that it does not depend on the API worker for anything:

```bash
pnpm --filter @loonext/web exec wrangler secret put RESEND_API_KEY
```

Until both are set the subscribe form does not render at all and the fan-out is a
no-op. That is deliberate and it is the same rule as everywhere else on this
page: nothing renders that isn't backed by something real, and a form that
accepts an address it can never mail is the same lie as a green dot with no probe
behind it.

**A KV read per request would be a cost center** on a page that gets linked around
during an incident, so the page caches at the edge for 60 seconds
(`revalidate = 60`). An incident line can therefore be up to a minute stale, which
is far inside the fifteen-minute commitment in §3, and a link storm cannot turn the
status page into a bill.

## 6. What must never be added to `/status`

The page renders **no** operational indicators — no green dots, no gauges, no
"all systems operational" — until each is backed by a real probe
(DESIGN-DIRECTION v4 §6, owner amendment 11, binding; QA gate 6). A fake green
dot is worse than an empty page, because it is an active claim rather than a
missing one. `status-page.test.tsx` fails if one appears.

Related: `docs/ROLLBACK.md` (stop the bleeding first), `docs/DISASTER-RECOVERY.md`
(when the data is the problem), `docs/DECISIONS.md` D74 (RPO/RTO, and the
correction that PITR is off).
