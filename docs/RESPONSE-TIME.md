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

The report measures one response per conversation. It starts with the first
qualifying inbound text or call and ends with the first human answer.

## What starts the clock

Take the earlier of the first inbound text and the first missed or voicemail
call. If a member already sent a human outbound message or placed a call in the
conversation, count the conversation as outreach. The report ignores automatic
texts when it determines who started the conversation. A call answered as it
rings can answer an earlier lead. It starts no lead of its own.

## What stops it

The first human outbound text, answered callback, or later live-answered
inbound call stops the clock. A member's outbound call also qualifies if it has
at least ten seconds of talk time. For calls, the report uses the answer time
when available and credits the member recorded on the call.

An automatic reply leaves the clock running. A workspace whose away message
fires in ten seconds and whose crew replies the next morning answers in a
morning.

There is a specific trap here, and it is worth naming because it is invisible:
`sent_by_user_id` is **NOT NULL on automated sends too** — auto-replies are
attributed to the owner, because the outbound-actor CHECK requires an actor. Any
implementation that tests the actor instead of the `automated` flag silently
reads every away reply as the owner answering. The #388 lead clock hit this
first. The report checks the same flag. The #388 escalation clock also starts
on a missed call and clears when a crew member reaches the caller.

The API counts text-first and call-first leads separately. It also counts leads
that received a missed-call text-back and leads that sent an inbound text after
that text-back.

## What is excluded, and why

| Excluded | Why |
| --- | --- |
| **Notes** | An internal note is not a reply to the customer. A note written *before* the customer's first text also does not disqualify the thread — it is not the thread's first message for this purpose. |
| **Spam threads** | Nobody owes a spammer a fast answer, and counting them would make the number worse for doing the right thing. |
| **Deleted activity and hidden lines** | Trashed conversations, calls and texts are excluded, along with conversations on lines the reader cannot see. |
| **Threads we opened** | See "what starts the clock". |
| **Reopened threads** | See below. |

Pipeline, lead-source and satisfaction reports also use the viewer’s line
access. Pipeline and lead-source counts exclude trashed conversations.
Satisfaction also excludes ratings attached to trashed jobs.

Lead-source rankings count each contact’s first qualifying lead. Reports show
returning conversations and crew outreach alongside the ranking. A returning
conversation has an earlier qualifying lead for that contact or new inbound
activity on a conversation opened before the selected window.

The pipeline card links directly to the oldest actionable quotes and manually
tracked opportunities in its window. Satisfaction links to the most recently
answered jobs below the callback threshold and compares equally long windows.
The outstanding-quote queue shows the full count of unexpired sent or viewed
quotes and puts the oldest quotes first.

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

The baseline starts on the first qualifying lead. It closes after at least
14 days and once five leads have been answered, with a 60-day cap. The API
returns `collecting` with the answer count while that window is open,
`too_new` when it overlaps the selected comparison window, and
`no_answered_leads` if it closes without an answer.

The workspace baseline is stored on the company with its definition version.
Trash, restore and spam changes invalidate a baseline that could include the
affected activity. A member with hidden lines gets a baseline computed from
their visible conversations. The owner recap uses the workspace baseline.

Details and the owner recap count distinct callers who had a missed or
voicemail call during the selected window. A caller is reached once the crew
answers by text or phone before the window closes. The Details link opens the
live list of conversations awaiting a reply.

## Per-member numbers are the owner's choice

`companies.response_stats_per_member` defaults to **FALSE**, and while it is off
the API returns `by_member: null` and omits member IDs and names. When enabled,
each row includes the profile's display name. The clients display a localized
“Member” label when a profile has no name.

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
