-- [#284] Retention ENFORCEMENT — assertion suite for
-- supabase/migrations/20260802040000_retention_enforce.sql.
--
-- The two guards are the whole feature, and both live in SQL precisely so a
-- bug in the Worker cannot route around them:
--
--   1. A workspace under LEGAL HOLD is never eligible.
--   2. A workspace that has not been WARNED about its CURRENT window is never
--      eligible — which is what makes "nobody discovers retention by losing
--      something" a mechanism rather than a promise in a comment.
--
-- The second is the one worth a suite of its own. It is easy to write, easy to
-- delete while refactoring, and its absence is invisible until the day a
-- customer loses three years of texts they were never told about.
--
-- One transaction, rolled back. Fixtures use a 'ce' id prefix, clear of
-- retention_setting's 'cb'.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('ce000000-0000-4000-8000-00000000000a'::uuid, 'enforce-owner@test.local');

-- Three workspaces, identical except for the guard each one exercises.
insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at,
   retention_days)
values
  ('ce000000-0000-4000-8000-0000000000c1'::uuid, 'Warned Co',
   'ce000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(), 90),
  ('ce000000-0000-4000-8000-0000000000c2'::uuid, 'Unwarned Co',
   'ce000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(), 90),
  ('ce000000-0000-4000-8000-0000000000c3'::uuid, 'Held Co',
   'ce000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now(), 90);

insert into public.phone_numbers
  (id, company_id, number_e164, status, provisioning_key, country)
values
  ('ce000000-0000-4000-8000-0000000000b1'::uuid,
   'ce000000-0000-4000-8000-0000000000c1'::uuid, '+14155550101', 'active',
   'ret-enforce-1', 'US'),
  ('ce000000-0000-4000-8000-0000000000b2'::uuid,
   'ce000000-0000-4000-8000-0000000000c2'::uuid, '+14155550102', 'active',
   'ret-enforce-2', 'US'),
  ('ce000000-0000-4000-8000-0000000000b3'::uuid,
   'ce000000-0000-4000-8000-0000000000c3'::uuid, '+14155550103', 'active',
   'ret-enforce-3', 'US');

insert into public.contacts (id, company_id, phone_e164) values
  ('ce000000-0000-4000-8000-0000000000d1'::uuid,
   'ce000000-0000-4000-8000-0000000000c1'::uuid, '+14155559001'),
  ('ce000000-0000-4000-8000-0000000000d2'::uuid,
   'ce000000-0000-4000-8000-0000000000c2'::uuid, '+14155559002'),
  ('ce000000-0000-4000-8000-0000000000d3'::uuid,
   'ce000000-0000-4000-8000-0000000000c3'::uuid, '+14155559003');

insert into public.conversations (id, company_id, contact_id, phone_number_id)
values
  ('ce000000-0000-4000-8000-0000000000e1'::uuid,
   'ce000000-0000-4000-8000-0000000000c1'::uuid,
   'ce000000-0000-4000-8000-0000000000d1'::uuid,
   'ce000000-0000-4000-8000-0000000000b1'::uuid),
  ('ce000000-0000-4000-8000-0000000000e2'::uuid,
   'ce000000-0000-4000-8000-0000000000c2'::uuid,
   'ce000000-0000-4000-8000-0000000000d2'::uuid,
   'ce000000-0000-4000-8000-0000000000b2'::uuid),
  ('ce000000-0000-4000-8000-0000000000e3'::uuid,
   'ce000000-0000-4000-8000-0000000000c3'::uuid,
   'ce000000-0000-4000-8000-0000000000d3'::uuid,
   'ce000000-0000-4000-8000-0000000000b3'::uuid);

-- One message well past the 90-day window, one comfortably inside it, per
-- workspace. The recent one is the control: a job that returned it would be
-- deleting data nobody was warned about and nobody agreed to lose.
-- `status` is required for any non-note direction (messages_note_status).
insert into public.messages
  (id, company_id, conversation_id, direction, status, body, created_at)
values
  ('ce000000-0000-4000-8000-0000000000f1'::uuid,
   'ce000000-0000-4000-8000-0000000000c1'::uuid,
   'ce000000-0000-4000-8000-0000000000e1'::uuid, 'inbound', 'received', 'ancient',
   now() - interval '200 days'),
  ('ce000000-0000-4000-8000-0000000000f2'::uuid,
   'ce000000-0000-4000-8000-0000000000c1'::uuid,
   'ce000000-0000-4000-8000-0000000000e1'::uuid, 'inbound', 'received', 'recent',
   now() - interval '2 days'),
  ('ce000000-0000-4000-8000-0000000000f3'::uuid,
   'ce000000-0000-4000-8000-0000000000c2'::uuid,
   'ce000000-0000-4000-8000-0000000000e2'::uuid, 'inbound', 'received', 'ancient',
   now() - interval '200 days'),
  ('ce000000-0000-4000-8000-0000000000f4'::uuid,
   'ce000000-0000-4000-8000-0000000000c3'::uuid,
   'ce000000-0000-4000-8000-0000000000e3'::uuid, 'inbound', 'received', 'ancient',
   now() - interval '200 days');

-- Only the first and third workspaces were told. The held one is warned on
-- purpose: it proves the hold is doing the work, rather than the absence of a
-- notice quietly carrying the test.
insert into public.retention_notices (company_id, window_days, message_count)
values
  ('ce000000-0000-4000-8000-0000000000c1'::uuid, 90, 1),
  ('ce000000-0000-4000-8000-0000000000c3'::uuid, 90, 1);

update public.companies
   set legal_hold_at = now(), legal_hold_reason = 'warranty dispute'
 where id = 'ce000000-0000-4000-8000-0000000000c3'::uuid;

do $$
declare
  v_ids uuid[];
begin
  -- ---------------------------------------------------------------- eligible
  select array_agg(company_id) into v_ids
    from public.api_retention_overdue_companies(50);

  if not ('ce000000-0000-4000-8000-0000000000c1'::uuid = any(v_ids)) then
    raise exception 'a warned, unheld workspace with overdue messages must be eligible';
  end if;

  -- THE ONE THAT MATTERS. Never told, so never deleted — a broken notice job
  -- must destroy nothing rather than destroy silently.
  if 'ce000000-0000-4000-8000-0000000000c2'::uuid = any(v_ids) then
    raise exception 'an unwarned workspace must never be eligible for deletion';
  end if;

  if 'ce000000-0000-4000-8000-0000000000c3'::uuid = any(v_ids) then
    raise exception 'a workspace under legal hold must never be eligible';
  end if;

  -- ------------------------------------------------------------- the batch
  select array_agg(message_id) into v_ids
    from public.api_retention_overdue_messages(
      'ce000000-0000-4000-8000-0000000000c1'::uuid, 500
    );

  if not ('ce000000-0000-4000-8000-0000000000f1'::uuid = any(v_ids)) then
    raise exception 'the overdue message must be in the batch';
  end if;
  -- The control. Returning this would delete data inside the window.
  if 'ce000000-0000-4000-8000-0000000000f2'::uuid = any(v_ids) then
    raise exception 'a message inside the window must never be in the batch';
  end if;

  -- ------------------------------------------- a hold placed mid-sweep
  -- The company query and the batch query are a whole cron run apart, so the
  -- batch re-checks rather than trusting its caller. Without this, a hold
  -- placed during a run would not take effect until the next day — on a
  -- workspace whose data is being destroyed right now.
  update public.companies
     set legal_hold_at = now()
   where id = 'ce000000-0000-4000-8000-0000000000c1'::uuid;

  select array_agg(message_id) into v_ids
    from public.api_retention_overdue_messages(
      'ce000000-0000-4000-8000-0000000000c1'::uuid, 500
    );
  if v_ids is not null then
    raise exception 'a hold placed mid-sweep must stop the very next batch';
  end if;

  -- ------------------------------------------------- shortening re-warns
  -- A workspace that shortens its window has DIFFERENT data at risk, so its
  -- old notice must not license the new deletion. Lifting the hold isolates
  -- the window change as the only thing under test.
  update public.companies
     set legal_hold_at = null, retention_days = 120
   where id = 'ce000000-0000-4000-8000-0000000000c1'::uuid;

  select array_agg(company_id) into v_ids
    from public.api_retention_overdue_companies(50);
  if 'ce000000-0000-4000-8000-0000000000c1'::uuid = any(v_ids) then
    raise exception
      'a changed window must need its own notice before anything is deleted';
  end if;

  raise notice 'retention enforcement: all assertions passed';
end $$;

rollback;
