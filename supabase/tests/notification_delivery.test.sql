-- [#297] Notification batching — assertion suite for
-- supabase/migrations/20260803180000_notification_delivery.sql.
--
-- The rule worth guarding is ND-2: the claim is BY MEMBER, not by row. A
-- per-row claim still "works" — every notification eventually goes out — while
-- producing four pushes that each say "1 new message", which is the volume
-- problem this feature exists to solve, wearing the feature's name. Nothing
-- errors, nobody files a bug, and the member turns notifications off anyway.
--
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/notification_delivery.test.sql
--
-- One transaction, rolled back. Fixtures use a '7b' id prefix so the file runs
-- standalone OR after the other suites in one psql session.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('7b000000-0000-4000-8000-00000000000a'::uuid, 'batch-a@test.local'),
  ('7b000000-0000-4000-8000-00000000000b'::uuid, 'batch-b@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('7b000000-0000-4000-8000-0000000000c1'::uuid, 'Batch Plumbing',
   '7b000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

insert into public.company_members (company_id, user_id, role) values
  ('7b000000-0000-4000-8000-0000000000c1'::uuid,
   '7b000000-0000-4000-8000-00000000000a'::uuid, 'owner'),
  ('7b000000-0000-4000-8000-0000000000c1'::uuid,
   '7b000000-0000-4000-8000-00000000000b'::uuid, 'member');

insert into public.phone_numbers
  (id, company_id, provisioning_key, country, number_e164, status)
values ('7b000000-0000-4000-8000-0000000000f1'::uuid,
        '7b000000-0000-4000-8000-0000000000c1'::uuid,
        'batch-1', 'US', '+12125557401', 'active');

-- TWO contacts, because the schema allows one open conversation per
-- (company, number, contact) — and because the digest's whole point is
-- "across 3 conversations", which needs more than one customer.
insert into public.contacts (id, company_id, phone_e164, name)
values ('7b000000-0000-4000-8000-0000000000d1'::uuid,
        '7b000000-0000-4000-8000-0000000000c1'::uuid,
        '+12125559701', 'Busy Tuesday'),
       ('7b000000-0000-4000-8000-0000000000d2'::uuid,
        '7b000000-0000-4000-8000-0000000000c1'::uuid,
        '+12125559702', 'Also Texting');

insert into public.conversations
  (id, company_id, contact_id, phone_number_id, status, last_message_at)
values ('7b000000-0000-4000-8000-0000000000e1'::uuid,
        '7b000000-0000-4000-8000-0000000000c1'::uuid,
        '7b000000-0000-4000-8000-0000000000d1'::uuid,
        '7b000000-0000-4000-8000-0000000000f1'::uuid, 'open', now()),
       ('7b000000-0000-4000-8000-0000000000e2'::uuid,
        '7b000000-0000-4000-8000-0000000000c1'::uuid,
        '7b000000-0000-4000-8000-0000000000d2'::uuid,
        '7b000000-0000-4000-8000-0000000000f1'::uuid, 'open', now());

-- ---------------------------------------------------------------------------
-- ND-1: nothing due claims nothing.
--
-- This runs every minute forever, and on almost every tick the answer is
-- nothing. A claim that returned rows early would flush a batch before its
-- window closed, which is the setting not working.
-- ---------------------------------------------------------------------------
insert into public.pending_notifications
  (company_id, user_id, category, conversation_id, deliver_at)
values
  ('7b000000-0000-4000-8000-0000000000c1'::uuid,
   '7b000000-0000-4000-8000-00000000000a'::uuid,
   'messages_all', '7b000000-0000-4000-8000-0000000000e1'::uuid,
   now() + interval '10 minutes');

do $$
declare claimed int;
begin
  select count(*) into claimed
    from public.api_claim_due_notifications(now(), 20);
  if claimed is distinct from 0 then
    raise exception 'ND-1: claimed % row(s) before the window closed', claimed;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- ND-2: a due batch is claimed WHOLE, per member.
--
-- THE ONE THAT MATTERS. A per-row claim sends four notifications that each say
-- "1 new message" — the volume problem with extra steps. Nothing errors and
-- nobody reports it; the member simply turns notifications off, which is the
-- outcome this feature was built to prevent.
-- ---------------------------------------------------------------------------
insert into public.pending_notifications
  (company_id, user_id, category, conversation_id, deliver_at)
values
  ('7b000000-0000-4000-8000-0000000000c1'::uuid,
   '7b000000-0000-4000-8000-00000000000a'::uuid,
   'messages_all', '7b000000-0000-4000-8000-0000000000e1'::uuid,
   now() - interval '1 minute'),
  ('7b000000-0000-4000-8000-0000000000c1'::uuid,
   '7b000000-0000-4000-8000-00000000000a'::uuid,
   'messages_all', '7b000000-0000-4000-8000-0000000000e1'::uuid,
   now() - interval '1 minute'),
  ('7b000000-0000-4000-8000-0000000000c1'::uuid,
   '7b000000-0000-4000-8000-00000000000a'::uuid,
   'messages_all', '7b000000-0000-4000-8000-0000000000e2'::uuid,
   now() - interval '1 minute');

do $$
declare claimed int; conversations int;
begin
  create temporary table claimed_batch on commit drop as
    select * from public.api_claim_due_notifications(now(), 20);

  select count(*), count(distinct conversation_id)
    into claimed, conversations
    from claimed_batch;

  -- All FOUR: the three just queued plus the one from ND-1, which is now due
  -- for the same member and belongs in the same digest.
  if claimed is distinct from 4 then
    raise exception 'ND-2: expected the member''s whole batch, claimed %', claimed;
  end if;
  if conversations is distinct from 2 then
    raise exception 'ND-2: expected 2 conversations in the batch, got %', conversations;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- ND-3: claiming REMOVES them, so a second sweep cannot send the batch twice.
-- ---------------------------------------------------------------------------
do $$
declare left_over int;
begin
  select count(*) into left_over from public.pending_notifications;
  if left_over is distinct from 0 then
    raise exception 'ND-3: % row(s) survived the claim', left_over;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- ND-4: one member's due batch does not drag another member's early.
--
-- Two members with different windows are two different promises about two
-- different phones. A claim that grouped by company would flush somebody's
-- 30-minute batch because a colleague's 5-minute one came due.
-- ---------------------------------------------------------------------------
insert into public.pending_notifications
  (company_id, user_id, category, conversation_id, deliver_at)
values
  ('7b000000-0000-4000-8000-0000000000c1'::uuid,
   '7b000000-0000-4000-8000-00000000000a'::uuid,
   'messages_all', '7b000000-0000-4000-8000-0000000000e1'::uuid,
   now() - interval '1 minute'),
  ('7b000000-0000-4000-8000-0000000000c1'::uuid,
   '7b000000-0000-4000-8000-00000000000b'::uuid,
   'messages_all', '7b000000-0000-4000-8000-0000000000e1'::uuid,
   now() + interval '25 minutes');

do $$
declare rows_for_b int;
begin
  perform public.api_claim_due_notifications(now(), 20);

  select count(*) into rows_for_b
    from public.pending_notifications
   where user_id = '7b000000-0000-4000-8000-00000000000b'::uuid;
  if rows_for_b is distinct from 1 then
    raise exception
      'ND-4: the other member''s batch was flushed early (% left)', rows_for_b;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- ND-5: the batch window is bounded.
--
-- A window of a day is not batching, it is a summary with the wrong name — and
-- a window of zero is immediate delivery pretending to be something else.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.notification_prefs
      (user_id, company_id, batch_window_minutes)
    values ('7b000000-0000-4000-8000-00000000000a'::uuid,
            '7b000000-0000-4000-8000-0000000000c1'::uuid,
            1440);
    raise exception 'ND-5: a 24-hour "batch" window was accepted';
  exception
    when check_violation then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- ND-6: an absent delivery preference is an EMPTY OBJECT, not null.
--
-- Every existing member has one of these after this migration, and the code
-- reading it treats a missing category as "immediate". A null column would
-- make every reader handle two shapes for the same fact.
-- ---------------------------------------------------------------------------
do $$
declare shape jsonb;
begin
  insert into public.notification_prefs (user_id, company_id)
  values ('7b000000-0000-4000-8000-00000000000b'::uuid,
          '7b000000-0000-4000-8000-0000000000c1'::uuid);

  select delivery into shape
    from public.notification_prefs
   where user_id = '7b000000-0000-4000-8000-00000000000b'::uuid;

  if shape is distinct from '{}'::jsonb then
    raise exception 'ND-6: a fresh prefs row has delivery = %', shape;
  end if;
end $$;

rollback;
