-- [#240 item 4] Storage and egress as standing figures — assertion suite for
-- supabase/migrations/20260802130000_storage_fleet_report.sql.
--
-- The point of this report is the workspace the TRIPWIRE cannot see: the one at
-- 8 GB growing 2 GB a week, which crosses every alert tier in turn and is
-- invisible until it does. So the assertions are about ranking and about the
-- growth window, not about whether a total adds up.
--
-- One transaction, rolled back. Fixtures use a 'cf' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('cf000000-0000-4000-8000-00000000000a'::uuid, 'fleet-owner@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('cf000000-0000-4000-8000-0000000000c1'::uuid, 'Heavy Co',
   'cf000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now()),
  ('cf000000-0000-4000-8000-0000000000c2'::uuid, 'Light Co',
   'cf000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now()),
  ('cf000000-0000-4000-8000-0000000000c3'::uuid, 'Empty Co',
   'cf000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

-- Heavy: 4 GiB stored, half of it added inside the window.
insert into public.attachments
  (company_id, owner_type, owner_id, storage_path, file_name, content_type,
   size_bytes, created_at)
values
  ('cf000000-0000-4000-8000-0000000000c1'::uuid, 'note',
   'cf000000-0000-4000-8000-0000000000d1'::uuid, 'p/old.jpg', 'old.jpg',
   'image/jpeg', 2147483648, now() - interval '200 days'),
  ('cf000000-0000-4000-8000-0000000000c1'::uuid, 'note',
   'cf000000-0000-4000-8000-0000000000d2'::uuid, 'p/new.jpg', 'new.jpg',
   'image/jpeg', 2147483648, now() - interval '3 days'),
  -- Light: 1 GiB, all of it old.
  ('cf000000-0000-4000-8000-0000000000c2'::uuid, 'note',
   'cf000000-0000-4000-8000-0000000000d3'::uuid, 'p/l.jpg', 'l.jpg',
   'image/jpeg', 1073741824, now() - interval '200 days'),
  -- Deleted bytes are not stored bytes: counting them would inflate the cost
  -- of a workspace that has already cleaned up, and misrank the report.
  ('cf000000-0000-4000-8000-0000000000c2'::uuid, 'note',
   'cf000000-0000-4000-8000-0000000000d4'::uuid, 'p/gone.jpg', 'gone.jpg',
   'image/jpeg', 10737418240, now() - interval '10 days');

update public.attachments
   set deleted_at = now()
 where storage_path = 'p/gone.jpg';

-- Light egresses heavily: 20 GiB in the window. At $0.09/GB against
-- $0.021/GB/mo stored, serving costs far more than keeping — which is the
-- whole reason the report carries both.
insert into public.egress_events (company_id, bucket, object_key, bytes, created_at)
values
  ('cf000000-0000-4000-8000-0000000000c2'::uuid, 'attachments', 'p/l.jpg',
   21474836480, now() - interval '5 days'),
  -- Outside the window: must not count toward this month's spend.
  ('cf000000-0000-4000-8000-0000000000c1'::uuid, 'attachments', 'p/old.jpg',
   107374182400, now() - interval '200 days');

do $$
declare
  v_first uuid;
  v_heavy record;
  v_light record;
begin
  -- A workspace with nothing has nothing to say, and a report nobody can scan
  -- is one nobody reads.
  if exists (
    select 1 from public.api_storage_fleet(30, 200)
     where company_id = 'cf000000-0000-4000-8000-0000000000c3'::uuid
  ) then
    raise exception 'an empty workspace must not appear in the report';
  end if;

  select * into v_heavy from public.api_storage_fleet(30, 200)
   where company_id = 'cf000000-0000-4000-8000-0000000000c1'::uuid;
  select * into v_light from public.api_storage_fleet(30, 200)
   where company_id = 'cf000000-0000-4000-8000-0000000000c2'::uuid;

  if v_heavy.stored_bytes <> 4294967296 then
    raise exception 'heavy stored bytes wrong: %', v_heavy.stored_bytes;
  end if;
  -- THE GROWTH WINDOW. Half the bytes are 200 days old; only the recent half
  -- is "added", which is the figure the tripwire cannot produce at all.
  if v_heavy.added_bytes <> 2147483648 then
    raise exception 'heavy added bytes wrong: %', v_heavy.added_bytes;
  end if;

  -- Soft-deleted bytes are excluded, so Light is 1 GiB and not 11.
  if v_light.stored_bytes <> 1073741824 then
    raise exception 'deleted bytes must not count as stored: %', v_light.stored_bytes;
  end if;

  -- Egress outside the window is not this month's spend.
  if v_heavy.egress_bytes <> 0 then
    raise exception 'stale egress must not count: %', v_heavy.egress_bytes;
  end if;

  -- RANKED BY COST, NOT BY SIZE — the report's whole reason for existing.
  -- Light stores a quarter of what Heavy does and costs more, because serving
  -- is ~4x the price of keeping. A size-ordered report would bury it.
  select company_id into v_first from public.api_storage_fleet(30, 200) limit 1;
  if v_first <> 'cf000000-0000-4000-8000-0000000000c2'::uuid then
    raise exception
      'the report must rank by cost, not stored size (first was %)', v_first;
  end if;
  if v_light.monthly_cost_cents <= v_heavy.monthly_cost_cents then
    raise exception 'egress-heavy workspace must cost more than the bigger one';
  end if;

  raise notice 'storage fleet report: all assertions passed';
end $$;

rollback;
