-- [#506] The billing ledger learns to tell one revenue stream from another.
--
-- `usage_events.quantity` has always meant "segments", and `type` has always
-- been one of two SMS shapes. That was true and sufficient while SMS was the
-- only thing metered here. It stopped being sufficient the moment voice
-- shipped — voice needed its own Stripe meter precisely because this table
-- could not carry it — and it will fail the same way for whatever comes next.
--
-- THE REASON THIS COULD NOT WAIT. Every other channel-shaped assumption in
-- docs/RCS-READINESS.md costs the same fixed today or in two years. This one
-- does not: a row written without a channel can never be reclassified, because
-- the fact of what it was is simply absent. The backfill below works only
-- because `type` still carries that fact for every historic row — and that
-- mapping exists today and will not exist for rows written after a third
-- channel starts landing in 'sms_outbound'.
--
-- TEXT + CHECK, NOT AN ENUM, deliberately. `ALTER TYPE ... ADD VALUE` cannot
-- be used by a statement in the same transaction that adds it, so an enum
-- would force every future channel to ship as two ordered migrations and would
-- make a mistake in that ordering a failed deploy. The repo already uses
-- text + CHECK for exactly this reason on `webhook_events.provider`.

alter table public.usage_events
  add column if not exists channel text;

alter table public.usage_events
  add column if not exists unit text;

-- The backfill, which is only possible while `type` still means what it means.
update public.usage_events
   set channel = case type
                   when 'sms_outbound' then 'sms'
                   when 'mms_outbound' then 'mms'
                   else 'adjustment'
                 end,
       unit = case type
                when 'adjustment' then 'adjustment'
                else 'segment'
              end
 where channel is null or unit is null;

alter table public.usage_events
  alter column channel set default 'sms',
  alter column unit set default 'segment';

-- destructive-ok: the NOT NULL is safe because the UPDATE above has already
-- filled every existing row, and it can fill them because `type` still carries
-- the fact. The ordering is the whole safety argument: backfill, then default,
-- then NOT NULL. Reordering these three statements would fail on the first
-- production row. supabase/tests/usage_events_channel.test.sql UE-1 asserts no
-- row is left unclassified.
alter table public.usage_events
  alter column channel set not null,
  alter column unit set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'usage_events_channel_ck'
  ) then
    alter table public.usage_events
      add constraint usage_events_channel_ck
      check (channel in ('sms', 'mms', 'voice', 'rcs', 'adjustment'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'usage_events_unit_ck'
  ) then
    alter table public.usage_events
      add constraint usage_events_unit_ck
      check (unit in ('segment', 'message', 'minute', 'adjustment'));
  end if;
end $$;

comment on column public.usage_events.channel is
  '#506: which revenue stream this row belongs to. Text + CHECK rather than an '
  'enum so a new channel is one migration, not two ordered ones. Historic rows '
  'were backfilled from `type`, which is the only place that fact survived.';

comment on column public.usage_events.unit is
  '#506: what `quantity` counts. A segment and a message are not the same '
  'thing, and a ledger that records the number without the unit cannot be '
  'read back once a channel bills per message rather than per segment.';

-- Reporting reads the ledger by company and period already; adding the channel
-- to that index keeps a per-stream sum from degrading into a scan the day
-- somebody asks what a second stream earned.
create index if not exists usage_events_channel_idx
  on public.usage_events (company_id, channel, created_at);
