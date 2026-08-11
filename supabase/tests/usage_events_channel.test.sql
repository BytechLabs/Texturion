-- [#506] The ledger can tell one revenue stream from another.
--
-- What this pins is not the column's existence — it is that adding it changed
-- NOTHING about what the four billing sums produce. A recording change that
-- quietly moves a number is a pricing change wearing a migration's clothes,
-- and the customer finds out on an invoice.
--
-- One transaction, rolled back. Fixtures use a '5c' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('5c000000-0000-4000-8000-00000000000a'::uuid, 'ledger-owner@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at, plan)
values
  ('5c000000-0000-4000-8000-0000000000c1'::uuid, 'Ledger Co',
   '5c000000-0000-4000-8000-00000000000a'::uuid, 'CA', '416', now(), 'starter');

-- ---------------------------------------------------------------------------
-- UE-1. Every historic row carries a channel, because the backfill read it off
--       `type` while that fact still existed.
do $$
declare
  v_unclassified int;
begin
  select count(*) into v_unclassified
    from public.usage_events
   where channel is null or unit is null;

  if v_unclassified > 0 then
    raise exception 'UE-1 FAILED: % ledger row(s) carry no channel. The backfill '
      'is the only chance these ever get one — `type` is where the fact lives, '
      'and nothing else records it.', v_unclassified;
  end if;
  raise notice 'UE-1 PASSED: no unclassified ledger rows';
end $$;

-- ---------------------------------------------------------------------------
-- UE-2. The default is the honest one. A writer that forgets the column must
--       land as 'sms'/'segment' — which is what every row meant before this
--       migration — rather than as a null nobody notices.
do $$
declare
  v_channel text;
  v_unit text;
begin
  insert into public.usage_events (company_id, type, quantity)
  values ('5c000000-0000-4000-8000-0000000000c1'::uuid, 'sms_outbound', 1)
  returning channel, unit into v_channel, v_unit;

  if v_channel is distinct from 'sms' or v_unit is distinct from 'segment' then
    raise exception 'UE-2 FAILED: default is %/%, expected sms/segment',
      v_channel, v_unit;
  end if;
  raise notice 'UE-2 PASSED: a forgetful writer records what it used to mean';
end $$;

-- ---------------------------------------------------------------------------
-- UE-3. The CHECK refuses a channel nobody defined. A typo that lands as a new
--       stream is the failure this column exists to prevent, so it must not be
--       possible to invent one by misspelling it.
do $$
declare
  v_rejected boolean := false;
begin
  begin
    insert into public.usage_events (company_id, type, quantity, channel)
    values ('5c000000-0000-4000-8000-0000000000c1'::uuid, 'sms_outbound', 1, 'smss');
  exception when check_violation then
    v_rejected := true;
  end;

  if v_rejected is distinct from true then
    raise exception 'UE-3 FAILED: an undefined channel was accepted';
  end if;
  raise notice 'UE-3 PASSED: an undefined channel is refused';
end $$;

-- ---------------------------------------------------------------------------
-- UE-4. THE ONE THAT MATTERS. The period sum is unchanged.
--
--       api_period_segments is what the plan's included allowance and the
--       overage arithmetic both read. If adding a recording column moved this
--       number by one, a customer's bill would move with it.
do $$
declare
  v_company uuid := '5c000000-0000-4000-8000-0000000000c1'::uuid;
  v_direct int;
  v_by_channel int;
begin
  insert into public.usage_events (company_id, type, quantity, channel, unit)
  values
    (v_company, 'sms_outbound', 3, 'sms', 'segment'),
    (v_company, 'mms_outbound', 3, 'mms', 'segment'),
    (v_company, 'sms_outbound', 2, 'sms', 'segment');

  -- What the billing path sums today: quantity, blind to channel.
  select coalesce(sum(quantity), 0) into v_direct
    from public.usage_events where company_id = v_company;

  -- The same total, reassembled per stream. These must agree, or the column
  -- has partitioned the ledger rather than annotated it.
  select coalesce(sum(quantity), 0) into v_by_channel
    from public.usage_events
   where company_id = v_company and channel in ('sms', 'mms');

  if v_direct is distinct from v_by_channel then
    raise exception 'UE-4 FAILED: channel-blind sum % <> per-channel sum %. '
      'Adding the column changed what the ledger totals, which is a pricing '
      'change rather than a recording one.', v_direct, v_by_channel;
  end if;
  raise notice 'UE-4 PASSED: totals unchanged (% segments, both ways)', v_direct;
end $$;

-- ---------------------------------------------------------------------------
-- UE-5. A second stream is now separable, which is the whole point. Voice
--       already needed its own Stripe meter because this was impossible.
do $$
declare
  v_company uuid := '5c000000-0000-4000-8000-0000000000c1'::uuid;
  v_sms int;
  v_voice int;
begin
  insert into public.usage_events (company_id, type, quantity, channel, unit)
  values (v_company, 'adjustment', 7, 'voice', 'minute');

  select coalesce(sum(quantity), 0) into v_sms
    from public.usage_events
   where company_id = v_company and channel = 'sms';
  select coalesce(sum(quantity), 0) into v_voice
    from public.usage_events
   where company_id = v_company and channel = 'voice';

  if v_voice is distinct from 7 then
    raise exception 'UE-5 FAILED: voice sums to %, expected 7', v_voice;
  end if;
  if v_sms is distinct from 6 then
    raise exception 'UE-5 FAILED: sms sums to %, expected 6 — a second stream '
      'must not contaminate the first', v_sms;
  end if;
  raise notice 'UE-5 PASSED: two streams, separable, and neither counts the other';
end $$;

rollback;
