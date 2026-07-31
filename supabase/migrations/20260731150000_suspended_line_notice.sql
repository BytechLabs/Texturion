-- #490 — a caller on a suspended line hears ringing until their carrier gives
-- up, and the business is never told they called.
--
-- Two facts about an inbound call that nothing recorded, and they are different
-- questions:
--
--   `unattended`     — this call reached a line that could not take it (the
--                      number is suspended, or the subscription is not active).
--                      It is the number the OWNER needs: every one of these is
--                      a job they lost while we had the chance to tell them it
--                      was happening. That is #277's win-back argument with
--                      evidence attached, and it is worth recording whatever
--                      the caller ends up hearing.
--
--   `notice_spoken`  — we ANSWERED and said something before hanging up, rather
--                      than ringing out. This is the one that costs money, on a
--                      workspace that by definition is not paying, so it is
--                      also the one the daily cap counts. Reading the cap off
--                      this column means the cap needs no counter table of its
--                      own and can never drift from what actually happened.
--
-- WHY THE CALLER HEARS ANYTHING AT ALL. The caller is our customer's customer,
-- trying to give a tradesperson money. Ringing out for the thirty to sixty
-- seconds their carrier allows teaches them the business is unreliable; six
-- honest seconds teaches them to try again or another way. The copy never says
-- WHY — a caller must not learn their plumber's billing status.
--
-- This does NOT reverse CALLS-V3 §16 item 3. That rejected a 45-second server
-- hangup as a behaviour change smuggled in as hygiene, on the grounds that it
-- bought no honesty because there was nothing to say. There is now something to
-- say. The no-immortal-ringing guarantee still belongs to the janitor alarm.

alter table public.calls
  add column if not exists unattended boolean not null default false,
  add column if not exists notice_spoken boolean not null default false;

comment on column public.calls.unattended is
  '#490: this inbound call reached a suspended number or an inactive '
  'subscription, so nobody could be rung. The count an owner is shown when '
  'deciding whether to reinstate.';

comment on column public.calls.notice_spoken is
  '#490: we answered and spoke the unavailable notice rather than ringing out. '
  'The billable half, and what the per-company daily cap counts.';

-- The two reads this supports, and nothing else:
--   * "how many calls reached my suspended line, and when" (owner-facing),
--   * "how many notices has this company spent today" (the cap, on the inbound
--     hot path — a caller is listening to silence for every millisecond of it).
--
-- Partial, because `unattended` is false for essentially every row: a full
-- index here would be almost entirely dead weight on the busiest table.
create index if not exists calls_unattended_idx
  on public.calls (company_id, started_at desc)
  where unattended;
