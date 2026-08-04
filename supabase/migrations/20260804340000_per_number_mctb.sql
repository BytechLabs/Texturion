-- #307 — a missed call on the sales line should not text back the service
-- line's message, and a tracked number on a yard sign may want no text at all.
--
-- The other identity columns landed in 20260804320000. These two complete the
-- issue's Scope list: missed-call textback was the last behaviour still
-- resolved from the company row alone.
--
-- Null means INHERIT, exactly as it does for the greeting and the away reply.
-- Not false, and not '': a false here would silence the textback on every
-- existing number the moment this migration ran, which is precisely the
-- "migration must be a no-op" line in #307. Nobody's number changes behaviour
-- until somebody sets one.

alter table public.phone_numbers
  add column if not exists mctb_enabled boolean,
  add column if not exists mctb_message text;

comment on column public.phone_numbers.mctb_enabled is
  'Per-number missed-call textback toggle (#307). NULL = inherit companies.mctb_enabled.';
comment on column public.phone_numbers.mctb_message is
  'Per-number missed-call textback text (#307). NULL = inherit companies.mctb_message.';

-- The company message has a length ceiling; the per-number one gets the same.
-- Without it a number could hold a message the workspace form would reject,
-- and the difference would only surface as a carrier-side truncation on a
-- caller who has just been missed.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'phone_numbers_mctb_message_len'
  ) then
    alter table public.phone_numbers
      add constraint phone_numbers_mctb_message_len
      check (mctb_message is null or char_length(mctb_message) <= 1000);
  end if;
end $$;
