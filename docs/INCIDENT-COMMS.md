# Incident communication (#242)

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

1. **Direct email to affected owners.** This is the channel that matters and the
   one that does not depend on anybody remembering to check a page. Recipients:
   the owner addresses of affected workspaces (`billingRecipients` gives you the
   shape). If the blast radius is unclear, all owners.
2. **`/status`** (`apps/web/src/app/(marketing)/status/page.tsx`) — add to
   `INCIDENTS`, bump `LAST_POSTED`, deploy.

**Know the catch on step 2 before you rely on it.** Posting to `/status` requires
editing the repo, passing CI, and deploying the marketing app. So it cannot be
used for an outage whose cause is CI, the deploy pipeline, Cloudflare, or a bad
migration — the page shares a failure domain with the product. **In those cases
email is the only channel, and that is fine: use it and skip the page.**

Moving publishing off the deploy path is the open half of #242. It needs somewhere
independently writable, and the options have real trade-offs — see §5.

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

## 5. The open half: publishing while everything is broken

#242's first acceptance item — publish an incident while the API, CI and the
deploy pipeline are all broken — is **not met** and needs an infrastructure
decision. The three candidates, with the trade-off each carries:

| Option | Independent of our deploy? | Cost | The catch |
|---|---|---|---|
| **External provider** (Statuspage, Instatus, Better Stack) | Yes, fully | ~$0–30/mo | A subscription and another vendor; the honest default for this problem, and what the category expects |
| **Cloudflare KV**, edited from the dashboard | Yes for CI and the API; **no** for Cloudflare itself | Included | Needs a namespace and binding; a Cloudflare outage takes the page and the product together, so the boundary is narrower than it looks |
| **A designated GitHub issue**, fetched at request time | Yes for CI, the API, and our deploy | Free | Adds a runtime dependency on GitHub's API and its rate limits; postable from a phone, which is a real advantage at 7am |

**Recommendation: an external provider**, and subscribe-by-email with it. It is
the only option that is independent of *every* system likely to be down, the
per-month cost is trivial against one lost customer, and it solves #242's
"Subscribe" scope item in the same purchase rather than as a separate build.

**Until that decision is made, §2's ordering is the mitigation**: email first,
page second, and never rely on the page for a deploy-path outage.

## 6. What must never be added to `/status`

The page renders **no** operational indicators — no green dots, no gauges, no
"all systems operational" — until each is backed by a real probe
(DESIGN-DIRECTION v4 §6, owner amendment 11, binding; QA gate 6). A fake green
dot is worse than an empty page, because it is an active claim rather than a
missing one. `status-page.test.tsx` fails if one appears.

Related: `docs/ROLLBACK.md` (stop the bleeding first), `docs/DISASTER-RECOVERY.md`
(when the data is the problem), `docs/DECISIONS.md` D74 (RPO/RTO, and the
correction that PITR is off).
