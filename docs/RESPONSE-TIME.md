# Response time, defined (#239)

**Status: CURRENT DIRECTION (#323).** Describes how the product works today. Where it disagrees with `docs/DECISIONS.md`, that file wins.

We sell the idea that the business which answers first gets the job. This is the
number that says whether we deliver it, and it is meant to be a number a
contractor repeats to other contractors. So it has to survive being checked
against their gut.

That is the whole reason this document exists. The issue put it exactly right:
getting the definition wrong "produces a vanity metric the customer stops
trusting the first time it disagrees with their gut". The definition below is
what `api_response_time_stats` computes, what `GET /v1/reports/response-time`
returns, and what all three clients display. If any of the four ever disagree,
this file is the one that is right and the other three are the bug.

## What is measured

**One measurement per conversation: the first inbound message, and the first
human reply after it.**

That is the sentence. Everything below is a consequence of it.

## What starts the clock

The **first message in the thread**, and only when that message is **inbound**.

A thread we opened is us reaching out — there is nobody waiting, and there is
nothing to be fast about. Counting it would penalise a workspace for doing
outreach. This matches the shipped #388 lead clock, which also only ever starts
on inbound.

## What stops it

The first **outbound message written by a person**: `direction = 'outbound'` and
`automated = false`.

**An auto-reply is not an answer.** "We'll get back to you" is the state this
product exists to get out of, not a resolution of it. A workspace whose away
message fires in ten seconds and whose crew replies the next morning answers in
a morning, not in ten seconds.

There is a specific trap here, and it is worth naming because it is invisible:
`sent_by_user_id` is **NOT NULL on automated sends too** — auto-replies are
attributed to the owner, because the outbound-actor CHECK requires an actor. Any
implementation that tests the actor instead of the `automated` flag silently
reads every away reply as the owner answering. The #388 lead clock hit this
first; the metric inherits the correct test from it.

## What is excluded, and why

| Excluded | Why |
| --- | --- |
| **Notes** | An internal note is not a reply to the customer. A note written *before* the customer's first text also does not disqualify the thread — it is not the thread's first message for this purpose. |
| **Spam threads** | Nobody owes a spammer a fast answer, and counting them would make the number worse for doing the right thing. |
| **Threads we opened** | See "what starts the clock". |
| **Reopened threads** | See below. |

## A reopened thread is not measured again

Someone who texts again three weeks later is a returning customer, not a new
lead. Blending the two makes the headline drift for reasons the crew cannot act
on.

**This is a deliberate difference from the #388 escalation ladder**, which *does*
chase a reopened thread. The two answer different questions:

- The **ladder** asks "who is waiting right now" — and it should absolutely chase
  a returning customer who is being ignored.
- This **metric** asks "how fast do we answer a new customer" — which is the
  claim we sell.

The difference is documented rather than reconciled, because reconciling them
would make one of the two wrong.

## Leads nobody answered are counted

A thread with no human reply contributes to `unanswered`, and to nothing else. It
does not enter the median.

This matters more than it looks. If silence were excluded, **a workspace could
improve its median by ignoring more leads** — the exact behaviour the metric
exists to expose. So the unanswered count sits next to the median everywhere the
median appears, and no client shows one without the other.

### And the count is a door (#508)

Naming a leak without offering a way to act on it is where the panel stopped for
a while: web linked the row to `/inbox?status=new` and both phones rendered the
same sentence inert.

`status` was the wrong set. Nothing moves a conversation off `new` when the crew
replies — only a human re-filing it, or an inbound flipping `waiting`→`open` —
so that filter meant "nobody tidied this up". A crew that answered every lead and
never touched the status dropdown saw all of them under it; a tidy crew saw none.

The destination is `?awaiting=only`, which filters on `awaiting_reply_since`: the
#388 lead clock, set on the first inbound of a new or reopened thread and cleared
by a human outbound. It is the LIVE twin of this count — the card reads leads
with no response historically, the filter reads the ones still waiting now. All
three clients send the same parameter and none defines a predicate of its own,
which is what stops them disagreeing about a word the crew says out loud.

## Snoozing a thread does not change the number

#293 lets a member defer a conversation until a chosen time, and asks that
"snoozed periods do not count against response-time metrics". Read against what
is actually measured here, that is **already true**, and making it explicitly
true would have made the metric lie.

There is one window per thread: first inbound to first human reply. A deferral
can only overlap it in one case — a lead somebody deferred **without ever
answering it**. That is precisely the case the section above exists to keep
counted. Subtracting deferred time would hand a workspace the lever the metric
is supposed to remove: defer the slow ones, watch the median improve.

The case #293 describes — *"I'll get you a price once I've spoken to my
supplier"* — is a thread the crew has **already replied to**. Its measurement
closed at that reply, and no later deferral can move it.

Where deferral does apply is the **focus queue**, which asks a different
question: not "how fast did we answer" but "what needs me today". A thread you
deferred leaves your queue and its count, per member, and stays on everyone
else's. `supabase/tests/conversation_snooze.test.sql` SN-11 and SN-12 pin both
halves — SN-12 asserts the response-time numbers are identical with and without
an active deferral, so if somebody later adds the subtraction, it fails and says
why.

## Business hours

Each lead is classified by **when the customer wrote**, never by when we replied.
A midnight text answered at 9am is an after-hours lead that took nine hours;
keying the split on our own reply time would file it as an in-hours win.

The classification uses `isAfterHours` in `packages/shared`, which is the one
implementation of the weekday loop, the timezone placement and the #402 date
exceptions. It is not reimplemented in SQL — the
`20260730002500_business_hours_exceptions.sql` migration states the rule for the
whole codebase: "the shape is enforced there, not here, so the four surfaces
share one rule."

That is why the RPC returns per-lead rows as well as aggregates: the Worker needs
each lead's opening instant to ask the shared evaluator.

## The arc

The before/after is the product story, so the baseline is the workspace's **first
fourteen days**. Two weeks rather than one because a three-person crew can take
very few leads in seven days, and an arc drawn from two of them is noise
presented as progress.

The baseline is withheld, with a reason, in two cases:

- `too_new` — the first fortnight still overlaps the window being reported, so
  comparing them compares the workspace to itself.
- `no_answered_leads` — nothing was answered in the first fortnight. That is not
  a baseline of zero; it is no baseline. "You have improved from 0 seconds" is
  the arc as fiction.

## Per-member numbers are the owner's choice

`companies.response_stats_per_member` defaults to **FALSE**, and while it is off
the API returns `by_member: null` and no member id appears in the payload at all.

Per-member numbers are motivating in some crews and toxic in others, so naming
individuals is a decision the owner makes rather than one we make for them. Once
the owner has made it, the whole crew sees it: a leaderboard nobody may look at
is not a leaderboard, and the opt-in is the control.

`null` rather than `[]` is deliberate — "the owner has not opted in" and "nobody
has answered anything" are different facts, and the clients say different things
about them.

## Exactness, and the one cap

Every aggregate — `leads`, `answered`, `unanswered`, `median_seconds`,
`p90_seconds`, `by_member`, `by_number` — is computed over **every** qualifying
lead in the window. None of them is ever a number about a sample.

The per-lead row list is capped (5,000, newest first) because it crosses the wire
for the business-hours split. When it truncates, the response says so
(`split_truncated`, `split_row_limit`), because a cap that reports nothing reads
as "we looked at everything". At the volumes a small crew produces this never
trips.

## Where it is enforced

| Layer | File |
| --- | --- |
| Definition + percentiles | `supabase/migrations/20260730020000_response_time_stats.sql` |
| Assertions on the definition | `supabase/tests/response_time.test.sql` |
| Hours split, arc, per-member gate | `apps/api/src/routes/reports.ts` |
| Assertions on those | `apps/api/src/routes/reports.test.ts` |
| Business-hours evaluation (shared) | `packages/shared/src/business-hours.ts` |

The SQL suite deliberately spends most of its length on the cases where a naive
implementation reports something **better than the truth**: an auto-reply counted
as an answer, a note counted as an answer, an unanswered lead dropped so the
median improves, a thread we opened counted as a lead we were slow to. Those are
the failures that destroy trust, and they all fail in the same flattering
direction.
