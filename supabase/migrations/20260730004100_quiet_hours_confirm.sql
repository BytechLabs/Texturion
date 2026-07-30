-- #225 ask 5 — the quiet-hours confirmation, as a setting an admin owns.
--
-- WHAT THIS GOVERNS, AND WHAT IT DELIBERATELY DOES NOT.
--
-- Today exactly one send path asks about quiet hours: a person starting a NEW
-- conversation into a destination whose local clock is inside 8pm–8am gets a
-- 409 `quiet_hours_confirmation_required` and may confirm and send. #225 is
-- explicit that a human must be WARNED and never BLOCKED, and that is what the
-- 409 is. Every other send is reply-exempt (D4): it fires into a thread the
-- customer just started, seconds after they started it, and
-- `quiet-hours-surface.test.ts` enumerates and justifies each one.
--
-- So this column governs ONE thing: whether that confirmation step appears. It
-- is not a licence to text at 3am, and the name says so rather than leaving it
-- to a comment. `quiet_hours_enabled` — the name #225 suggests — would be read
-- by the next author as "quiet hours are off for this company, so my new
-- automated sender may fire whenever", and #237 (appointment reminders) and
-- #313 (post-job ratings) are both queued and are both sends we ORIGINATE on
-- our own clock. That is the first real exposure this product will have, and a
-- badly named boolean is how it would arrive already switched off.
--
-- `quiet_hours_confirm_test.ts` asserts exactly one production file reads this
-- column, so an automated path cannot inherit it by accident. It is the same
-- one-resolver shape as D49/D79: the guard is a test that enumerates who may
-- read a thing, not a comment asking nicely.
--
-- WHY IT EXISTS AT ALL. A 24-hour emergency trade — the burst-pipe plumber, the
-- furnace-out HVAC crew — starts new conversations at 2am as a matter of
-- routine, lawfully, because the customer's house is flooding. For them the
-- confirmation is friction on every single job at the worst possible moment,
-- and repeated friction that is always dismissed trains people to dismiss it,
-- which is worse than not showing it.
--
-- DEFAULT TRUE. Every existing company keeps the confirmation, nobody's
-- behaviour changes on deploy, and turning it off is a deliberate act by an
-- admin who was shown what they are accepting.

alter table public.companies
  add column if not exists quiet_hours_confirm_enabled boolean not null default true;

comment on column public.companies.quiet_hours_confirm_enabled is
  'When true (the default), a person starting a NEW conversation into a destination inside its 8pm-8am local quiet window must confirm (409 quiet_hours_confirmation_required) before the send proceeds (#225 ask 5, SPEC S5, D4). Governs ONLY that confirmation step for human-initiated sends. It is NOT an automated-send permission: reply-exempt paths never read it, and an originating automated sender (#237, #313) must hold-and-release regardless of this column. quiet_hours_confirm_test.ts enforces that by enumerating every file allowed to read it. Off is for 24-hour emergency trades, where the confirmation fires on every job at 2am and being dismissed every time is what makes it worthless.';
