-- Loonext schema assertion suite (SPEC §6).
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/tests/schema.test.sql
-- (root script: pnpm run db:test — docker exec against the local supabase db)
-- The whole suite runs in one transaction and ROLLS BACK: it never pollutes
-- the local database.

\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- T1. Structure: every expected table exists, RLS enabled on every public
--     table. (port_requests added by 20260702030000_number_porting.sql — D16;
--     call_records by 20260704140000_voice_metering.sql — #12.)
-- ===========================================================================
do $$
declare
  expected text[] := array[
    'profiles','companies','company_members','invites','phone_numbers',
    'messaging_registrations','contacts','conversations','conversation_reads',
    'messages','message_attachments','conversation_events','tags',
    'conversation_tags','opt_outs','usage_events','webhook_events','templates',
    'push_subscriptions','notification_prefs','usage_alerts','grace_notices',
    'port_requests','call_records','company_modules'];
  missing text;
  no_rls  text;
begin
  select string_agg(t, ', ') into missing
  from unnest(expected) t
  where not exists (select 1 from pg_tables p where p.schemaname = 'public' and p.tablename = t);
  if missing is not null then
    raise exception 'T1 FAILED: missing tables: %', missing;
  end if;

  select string_agg(tablename, ', ') into no_rls
  from pg_tables where schemaname = 'public' and not rowsecurity;
  if no_rls is not null then
    raise exception 'T1 FAILED: RLS not enabled on: %', no_rls;
  end if;
  raise notice 'T1 PASSED: every expected table present, RLS enabled on every public table';
end $$;

-- ===========================================================================
-- T2. All 16 enums exist (13 base + port_status/port_messaging_status/
--     number_source from 20260702030000_number_porting.sql — D16).
-- ===========================================================================
do $$
declare
  expected text[] := array[
    'member_role','subscription_status','plan_id','number_status',
    'registration_kind','registration_status','conversation_status',
    'message_direction','message_status','opt_out_source','consent_source_t',
    'usage_event_type','conversation_event_type',
    'port_status','port_messaging_status','number_source'];
  missing text;
begin
  select string_agg(e, ', ') into missing
  from unnest(expected) e
  where not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype = 'e' and t.typname = e);
  if missing is not null then
    raise exception 'T2 FAILED: missing enums: %', missing;
  end if;
  raise notice 'T2 PASSED: all 16 enums exist';
end $$;

-- ===========================================================================
-- T3. Deny-by-default: anon / authenticated hold NO privilege on any public
--     table (SPEC §6 RLS posture — no grants to end-user roles).
-- ===========================================================================
do $$
declare
  bad text;
begin
  -- OID-based check: passing c.oid (not a name built from tablename) keeps the
  -- privilege call tied to the actual public-schema table even if the planner
  -- evaluates it before the schema filter (name-based variants error on
  -- same-named tables in other schemas, e.g. auth.instances).
  select string_agg(c.relname, ', ') into bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and (
      has_table_privilege('anon', c.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_table_privilege('authenticated', c.oid,
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'));
  if bad is not null then
    raise exception 'T3 FAILED: anon/authenticated have privileges on: %', bad;
  end if;
  raise notice 'T3 PASSED: anon/authenticated have no table grants in public';
end $$;

-- ===========================================================================
-- T4. Expected indexes exist (uniques, partial uniques, performance, GIN).
-- ===========================================================================
do $$
declare
  expected text[] := array[
    'invites_pending_uq','phone_numbers_provkey_uq','phone_numbers_e164_uq',
    'contacts_name_trgm','contacts_phone_trgm','conversations_open_uq',
    'conversations_inbox_idx','conversations_assigned_idx',
    'messages_telnyx_id_uq','messages_idem_uq','messages_conv_created_idx',
    'messages_body_tsv_idx','conversation_events_conv_idx','tags_name_uq',
    'usage_events_message_uq','usage_events_period_idx',
    'webhook_events_unprocessed_idx','templates_name_uq'];
  missing text;
begin
  select string_agg(i, ', ') into missing
  from unnest(expected) i
  where not exists (
    select 1 from pg_indexes p where p.schemaname = 'public' and p.indexname = i);
  if missing is not null then
    raise exception 'T4 FAILED: missing indexes: %', missing;
  end if;
  raise notice 'T4 PASSED: all 18 declared indexes exist';
end $$;

-- ===========================================================================
-- T5. Expected triggers exist: 17 moddatetime, auth sync, 6 broadcast.
--     Plus the realtime.messages topic-authorization policy.
-- ===========================================================================
do $$
declare
  n int;
begin
  select count(*) into n
  from pg_trigger tg
  join pg_class c on c.oid = tg.tgrelid
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and tg.tgname = 'set_updated_at' and not tg.tgisinternal;
  -- 13 base tables + port_requests (D16, 20260702030000_number_porting.sql)
  -- + tasks (D17/TASKS.md T1.1, 20260702060000)
  -- + notification_reads (D24 read-model, 20260702070000_appv2_for_you_notifications.sql)
  -- + inbound_notification_days (#39 email budget, 20260707150000_inbound_notification_budget.sql).
  -- The generic attachments table (D19) is append-only and deliberately has NO
  -- moddatetime trigger.
  if n <> 17 then
    raise exception 'T5 FAILED: expected 17 set_updated_at triggers, found %', n;
  end if;

  select count(*) into n
  from pg_trigger tg
  join pg_class c on c.oid = tg.tgrelid
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'auth' and c.relname = 'users' and tg.tgname = 'on_auth_user_created';
  if n <> 1 then
    raise exception 'T5 FAILED: on_auth_user_created trigger missing on auth.users';
  end if;

  select count(*) into n
  from pg_trigger tg
  join pg_class c on c.oid = tg.tgrelid
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and not tg.tgisinternal
    and tg.tgname in ('messages_broadcast','conversations_broadcast',
                      'phone_numbers_broadcast','registrations_broadcast',
                      'port_requests_broadcast','tasks_broadcast');
  -- 4 base broadcast triggers + port.updated (D16) + task.changed (D17/T1.3).
  if n <> 6 then
    raise exception 'T5 FAILED: expected 6 broadcast triggers, found %', n;
  end if;

  select count(*) into n
  from pg_policies
  where schemaname = 'realtime' and tablename = 'messages'
    and policyname = 'company_topic_read';
  if n <> 1 then
    raise exception 'T5 FAILED: company_topic_read policy missing on realtime.messages';
  end if;
  raise notice 'T5 PASSED: 17 moddatetime + auth-sync + 6 broadcast triggers, realtime policy present';
end $$;

-- ===========================================================================
-- Fixtures (rolled back at the end).
-- ===========================================================================
insert into auth.users (id, email, raw_user_meta_data)
values ('11111111-1111-4111-8111-111111111111', 'owner@schema.test',
        '{"display_name":"Owner One"}'::jsonb),
       ('22222222-2222-4222-8222-222222222222', 'stranger@schema.test',
        '{"display_name":"Not A Member"}'::jsonb);

-- ===========================================================================
-- T6. Profile-sync trigger: auth.users insert created public.profiles rows.
-- ===========================================================================
do $$
declare
  dn text;
begin
  select display_name into dn from public.profiles
  where user_id = '11111111-1111-4111-8111-111111111111';
  if dn is distinct from 'Owner One' then
    raise exception 'T6 FAILED: profile not synced from auth.users (display_name=%)', dn;
  end if;
  raise notice 'T6 PASSED: profile-sync trigger fires on auth.users insert';
end $$;

insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Schema Test Plumbing',
        '11111111-1111-4111-8111-111111111111', 'US', '415', now());

insert into public.company_members (company_id, user_id, role)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        '11111111-1111-4111-8111-111111111111', 'owner');

insert into public.phone_numbers (id, company_id, status, provisioning_key, country, number_e164)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'active', 'cs_test_schema_1', 'US', '+14155550100');

insert into public.contacts (id, company_id, phone_e164, name)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        '+14155550123', 'Alice Fixture');

-- ===========================================================================
-- T7. Duplicate contact (company_id, phone_e164) rejected.
-- ===========================================================================
do $$
begin
  begin
    insert into public.contacts (company_id, phone_e164)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '+14155550123');
    raise exception 'T7 FAILED: duplicate (company_id, phone_e164) contact accepted';
  exception when unique_violation then
    null;
  end;
  raise notice 'T7 PASSED: duplicate contact (company, phone) rejected';
end $$;

-- ===========================================================================
-- T8. THE THREADING INVARIANT: at most one open conversation per
--     (company, number, contact); a closed one coexists with a new open one.
-- ===========================================================================
insert into public.conversations (id, company_id, contact_id, phone_number_id, status)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'new');

do $$
begin
  -- second OPEN conversation for the same triple must be rejected
  begin
    insert into public.conversations (company_id, contact_id, phone_number_id, status)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'open');
    raise exception 'T8 FAILED: second open conversation for the same (company, number, contact) accepted';
  exception when unique_violation then
    null;
  end;

  -- close the first; a new open conversation is now allowed
  update public.conversations
  set status = 'closed', closed_at = now()
  where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  insert into public.conversations (id, company_id, contact_id, phone_number_id, status)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'open');

  -- and a third open one is rejected again
  begin
    insert into public.conversations (company_id, contact_id, phone_number_id, status)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'open');
    raise exception 'T8 FAILED: third open conversation accepted while one is already open';
  exception when unique_violation then
    null;
  end;
  raise notice 'T8 PASSED: threading invariant (one open conversation per company/number/contact)';
end $$;

-- ===========================================================================
-- T9. conversations_closed_consistency CHECK: status=closed <=> closed_at set.
-- ===========================================================================
do $$
begin
  begin
    insert into public.conversations (company_id, contact_id, phone_number_id, status, closed_at)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'closed', null);
    raise exception 'T9 FAILED: status=closed with closed_at NULL accepted';
  exception when check_violation then
    null;
  end;
  begin
    insert into public.conversations (company_id, contact_id, phone_number_id, status, closed_at)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'open', now());
    raise exception 'T9 FAILED: status=open with closed_at set accepted';
  exception when check_violation then
    null;
  end;
  raise notice 'T9 PASSED: closed/closed_at consistency CHECK enforced';
end $$;

-- ===========================================================================
-- T10. messages: duplicate telnyx_message_id rejected; multiple NULLs allowed;
--      idempotency-key partial unique; note/status and outbound-actor CHECKs.
-- ===========================================================================
insert into public.messages (id, company_id, conversation_id, direction, body, status, telnyx_message_id)
values ('99999999-9999-4999-8999-999999999999', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'inbound',
        'The quick brown fox jumps over the lazy dog', 'received', 'tx-dup-1');

do $$
begin
  -- duplicate telnyx_message_id rejected
  begin
    insert into public.messages (company_id, conversation_id, direction, body, status, telnyx_message_id)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'inbound', 'dup', 'received', 'tx-dup-1');
    raise exception 'T10 FAILED: duplicate telnyx_message_id accepted';
  exception when unique_violation then
    null;
  end;

  -- multiple NULL telnyx_message_id rows allowed (notes / queued outbound)
  insert into public.messages (company_id, conversation_id, direction, body, status)
  values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          'inbound', 'null-id one', 'received'),
         ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          'inbound', 'null-id two', 'received');

  -- send idempotency: duplicate (company_id, idempotency_key) rejected
  insert into public.messages (company_id, conversation_id, direction, body, status,
                               sent_by_user_id, idempotency_key)
  values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          'outbound', 'idem', 'queued', '11111111-1111-4111-8111-111111111111', 'idem-key-1');
  begin
    insert into public.messages (company_id, conversation_id, direction, body, status,
                                 sent_by_user_id, idempotency_key)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'outbound', 'idem dup', 'queued', '11111111-1111-4111-8111-111111111111', 'idem-key-1');
    raise exception 'T10 FAILED: duplicate (company_id, idempotency_key) accepted';
  exception when unique_violation then
    null;
  end;

  -- note with a status violates messages_note_status
  begin
    insert into public.messages (company_id, conversation_id, direction, body, status)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'note', 'a note', 'received');
    raise exception 'T10 FAILED: note with non-null status accepted';
  exception when check_violation then
    null;
  end;

  -- non-note without a status violates messages_note_status
  begin
    insert into public.messages (company_id, conversation_id, direction, body)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'inbound', 'statusless');
    raise exception 'T10 FAILED: inbound message with NULL status accepted';
  exception when check_violation then
    null;
  end;

  -- outbound without sent_by_user_id violates messages_outbound_actor
  begin
    insert into public.messages (company_id, conversation_id, direction, body, status)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'outbound', 'no actor', 'queued');
    raise exception 'T10 FAILED: outbound message without sent_by_user_id accepted';
  exception when check_violation then
    null;
  end;
  raise notice 'T10 PASSED: telnyx id dedupe (NULLs allowed), idempotency key, note/outbound CHECKs';
end $$;

-- ===========================================================================
-- T11. tsvector generated column populates and matches FTS queries.
-- ===========================================================================
do $$
declare
  n int;
begin
  select count(*) into n from public.messages
  where id = '99999999-9999-4999-8999-999999999999'
    and body_tsv @@ websearch_to_tsquery('english', 'fox')
    and body_tsv @@ to_tsquery('english', 'jump');   -- stemming: jumps -> jump
  if n <> 1 then
    raise exception 'T11 FAILED: body_tsv did not populate/match for the fixture message';
  end if;
  raise notice 'T11 PASSED: messages.body_tsv generated column populates (FTS matches)';
end $$;

-- ===========================================================================
-- T12. conversation_tags composite PK rejects duplicate attach.
-- ===========================================================================
insert into public.tags (id, company_id, name)
values ('88888888-8888-4888-8888-888888888888', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Quote sent');

insert into public.conversation_tags (conversation_id, tag_id)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '88888888-8888-4888-8888-888888888888');

do $$
begin
  begin
    insert into public.conversation_tags (conversation_id, tag_id)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '88888888-8888-4888-8888-888888888888');
    raise exception 'T12 FAILED: duplicate conversation_tags (conversation_id, tag_id) accepted';
  exception when unique_violation then
    null;
  end;

  -- tags case-insensitive unique per company
  begin
    insert into public.tags (company_id, name)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'QUOTE SENT');
    raise exception 'T12 FAILED: case-variant duplicate tag name accepted';
  exception when unique_violation then
    null;
  end;
  raise notice 'T12 PASSED: conversation_tags PK + tags lower(name) uniqueness';
end $$;

-- ===========================================================================
-- T13. webhook_events PK dedupe: duplicate (provider, event_id) rejected and
--      ON CONFLICT DO NOTHING inserts zero rows (the §7 ledger pattern).
-- ===========================================================================
insert into public.webhook_events (provider, event_id, event_type, payload)
values ('telnyx', 'evt_schema_1', 'message.received', '{}'::jsonb);

do $$
declare
  n int;
begin
  begin
    insert into public.webhook_events (provider, event_id, event_type, payload)
    values ('telnyx', 'evt_schema_1', 'message.received', '{}'::jsonb);
    raise exception 'T13 FAILED: duplicate (provider, event_id) accepted';
  exception when unique_violation then
    null;
  end;

  insert into public.webhook_events (provider, event_id, event_type, payload)
  values ('telnyx', 'evt_schema_1', 'message.received', '{}'::jsonb)
  on conflict (provider, event_id) do nothing;
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'T13 FAILED: ON CONFLICT DO NOTHING inserted % row(s)', n;
  end if;

  -- same event_id under the other provider is a different key — allowed
  insert into public.webhook_events (provider, event_id, event_type, payload)
  values ('stripe', 'evt_schema_1', 'invoice.paid', '{}'::jsonb);

  begin
    insert into public.webhook_events (provider, event_id, event_type, payload)
    values ('github', 'evt_schema_2', 'push', '{}'::jsonb);
    raise exception 'T13 FAILED: provider outside (stripe, telnyx) accepted';
  exception when check_violation then
    null;
  end;
  raise notice 'T13 PASSED: webhook_events PK dedupe + provider CHECK';
end $$;

-- ===========================================================================
-- T14. moddatetime: updated_at bumps on UPDATE (fixture row planted with an
--      old updated_at; the trigger must move it to the transaction time).
-- ===========================================================================
do $$
declare
  u timestamptz;
begin
  update public.contacts set updated_at = now() - interval '1 hour', name = 'Alice Old'
  where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  -- moddatetime overwrites even an explicit updated_at with now()
  select updated_at into u from public.contacts
  where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  if u <> now() then
    raise exception 'T14 FAILED: updated_at was not maintained by moddatetime (got %)', u;
  end if;
  raise notice 'T14 PASSED: moddatetime maintains updated_at on UPDATE';
end $$;

-- ===========================================================================
-- T15. conversation_events: conversation_id nullable ONLY for contact-level
--      event types (CHECK conversation_events_conv_required).
-- ===========================================================================
do $$
begin
  -- allowed: contact-level opt-out event with no conversation
  insert into public.conversation_events (company_id, conversation_id, type)
  values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', null, 'opted_out');

  -- rejected: conversation-scoped event with no conversation
  begin
    insert into public.conversation_events (company_id, conversation_id, type)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', null, 'status_changed');
    raise exception 'T15 FAILED: status_changed event with NULL conversation_id accepted';
  exception when check_violation then
    null;
  end;
  raise notice 'T15 PASSED: conversation_events nullable conversation_id CHECK';
end $$;

-- ===========================================================================
-- T16. opt_outs + usage_events + phone_numbers partial uniques.
-- ===========================================================================
do $$
begin
  insert into public.opt_outs (company_id, phone_e164, source)
  values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '+14155550123', 'stop_keyword');
  begin
    insert into public.opt_outs (company_id, phone_e164, source)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '+14155550123', 'manual');
    raise exception 'T16 FAILED: duplicate opt_outs (company_id, phone_e164) accepted';
  exception when unique_violation then
    null;
  end;

  -- usage_events: duplicate message_id rejected, multiple NULLs (adjustments) allowed
  insert into public.usage_events (company_id, message_id, type, quantity)
  values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '99999999-9999-4999-8999-999999999999',
          'sms_outbound', 1);
  begin
    insert into public.usage_events (company_id, message_id, type, quantity)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '99999999-9999-4999-8999-999999999999',
            'sms_outbound', 1);
    raise exception 'T16 FAILED: duplicate usage_events.message_id accepted';
  exception when unique_violation then
    null;
  end;
  insert into public.usage_events (company_id, message_id, type, quantity)
  values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', null, 'adjustment', -3),
         ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', null, 'adjustment', 5);

  -- phone_numbers: number_e164 unique only among non-released rows
  insert into public.phone_numbers (company_id, status, provisioning_key, country,
                                    number_e164, released_at)
  values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'released', 'cs_test_schema_2', 'US',
          '+14155550100', now());
  begin
    insert into public.phone_numbers (company_id, status, provisioning_key, country, number_e164)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'active', 'cs_test_schema_3', 'US',
            '+14155550100');
    raise exception 'T16 FAILED: duplicate active number_e164 accepted';
  exception when unique_violation then
    null;
  end;
  raise notice 'T16 PASSED: opt_outs unique, usage_events partial unique, phone_numbers partial unique';
end $$;

-- ===========================================================================
-- T17. invites: pending partial unique — duplicate pending invite rejected,
--      allowed again once the first is revoked.
-- ===========================================================================
do $$
begin
  insert into public.invites (company_id, email, role, invited_by)
  values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'crew@schema.test', 'member',
          '11111111-1111-4111-8111-111111111111');
  begin
    -- citext: case variant is the same email
    insert into public.invites (company_id, email, role, invited_by)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'CREW@SCHEMA.TEST', 'member',
            '11111111-1111-4111-8111-111111111111');
    raise exception 'T17 FAILED: duplicate pending invite accepted';
  exception when unique_violation then
    null;
  end;

  update public.invites set revoked_at = now()
  where company_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' and email = 'crew@schema.test';

  insert into public.invites (company_id, email, role, invited_by)
  values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'crew@schema.test', 'member',
          '11111111-1111-4111-8111-111111111111');

  begin
    insert into public.invites (company_id, email, role, invited_by)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'boss@schema.test', 'owner',
            '11111111-1111-4111-8111-111111111111');
    raise exception 'T17 FAILED: owner-role invite accepted (D8 forbids)';
  exception when check_violation then
    null;
  end;
  raise notice 'T17 PASSED: invites pending partial unique (citext) + owner-role CHECK';
end $$;

-- ===========================================================================
-- T18. Broadcast triggers actually write realtime.messages rows with ID-only
--      payloads into company:{id} (all five §8 events).
-- ===========================================================================
do $$
declare
  n int;
begin
  -- message.created was fired by the T10 fixture insert
  select count(*) into n from realtime.messages
  where topic = 'company:cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    and event = 'message.created' and extension = 'broadcast'
    and payload->>'message_id' = '99999999-9999-4999-8999-999999999999';
  if n < 1 then
    raise exception 'T18 FAILED: message.created broadcast row not found in realtime.messages';
  end if;

  -- message.status fires on status change
  update public.messages set status = 'delivered'
  where id = '99999999-9999-4999-8999-999999999999';
  select count(*) into n from realtime.messages
  where topic = 'company:cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    and event = 'message.status' and payload->>'status' = 'delivered';
  if n < 1 then
    raise exception 'T18 FAILED: message.status broadcast row not found';
  end if;

  -- conversation.updated fires on conversation update (T8 closed conv1)
  select count(*) into n from realtime.messages
  where topic = 'company:cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    and event = 'conversation.updated'
    and payload->>'conversation_id' = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if n < 1 then
    raise exception 'T18 FAILED: conversation.updated broadcast row not found';
  end if;

  -- number.updated fires on phone_numbers update
  update public.phone_numbers set status = 'suspended', suspended_at = now()
  where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  select count(*) into n from realtime.messages
  where topic = 'company:cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    and event = 'number.updated' and payload->>'status' = 'suspended';
  if n < 1 then
    raise exception 'T18 FAILED: number.updated broadcast row not found';
  end if;

  -- registration.updated fires on messaging_registrations insert
  insert into public.messaging_registrations (company_id, kind, status)
  values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'brand', 'draft');
  select count(*) into n from realtime.messages
  where topic = 'company:cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    and event = 'registration.updated' and payload->>'kind' = 'brand';
  if n < 1 then
    raise exception 'T18 FAILED: registration.updated broadcast row not found';
  end if;
  raise notice 'T18 PASSED: all five broadcast events written to realtime.messages (ID-only payloads)';
end $$;

-- ===========================================================================
-- T19. realtime.messages topic authorization: a company member (JWT sub) can
--      read broadcast rows for company:{id}; a non-member cannot.
-- ===========================================================================
do $$
declare
  n int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
  perform set_config('realtime.topic', 'company:cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
  execute 'set local role authenticated';

  select count(*) into n from realtime.messages
  where topic = 'company:cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  if n < 1 then
    execute 'reset role';
    raise exception 'T19 FAILED: company member cannot read its company topic broadcasts';
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
  execute 'set local role authenticated';

  select count(*) into n from realtime.messages
  where topic = 'company:cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  if n <> 0 then
    execute 'reset role';
    raise exception 'T19 FAILED: non-member can read another company''s topic (% rows)', n;
  end if;

  execute 'reset role';
  raise notice 'T19 PASSED: realtime topic authorization admits members, denies non-members';
exception
  when others then
    execute 'reset role';
    raise;
end $$;

-- ===========================================================================
-- T20. mms-media storage bucket exists, private, 5 MB limit.
-- ===========================================================================
do $$
declare
  n int;
begin
  select count(*) into n from storage.buckets
  where id = 'mms-media' and public = false and file_size_limit = 5242880;
  if n <> 1 then
    raise exception 'T20 FAILED: private mms-media bucket (5 MB limit) missing';
  end if;
  raise notice 'T20 PASSED: private mms-media bucket present with 5 MB file limit';
end $$;

rollback;

select 'ALL SCHEMA TESTS PASSED' as result;
