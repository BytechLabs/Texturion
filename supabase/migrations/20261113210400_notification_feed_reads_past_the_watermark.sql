-- The bell badge reads only what is past the member's watermark.
--
-- api_notifications_unread_count counted notification_feed and THEN dropped
-- everything at or before notification_reads.last_seen_at. notification_feed is
-- security definer with its own search_path, so the planner never inlines it:
-- the filter could not reach the arms, and every badge refresh built the
-- member's whole notification history to count the few rows after "mark all
-- read".
--
-- notification_feed gains p_since and each of its five arms applies
-- `created_at > p_since` itself, so the 2026111321* indexes can start at the
-- watermark. p_since defaults to -infinity, which keeps every row: the list
-- (api_notifications) and every existing 2- and 3-argument call read exactly
-- what they read before. The old 3-argument function is dropped rather than
-- kept beside the new one, because with both present those calls would be
-- ambiguous.
--
-- The badge reads the watermark first and passes it in. The answer is the
-- same: a row was counted when created_at > last_seen_at and it was not read
-- one by one, and that is still the rule. D24 holds; the feed is still derived.

drop function public.notification_feed(uuid, uuid, uuid[]);

create function public.notification_feed(
  p_company_id        uuid,
  p_user_id           uuid,
  p_hidden_number_ids uuid[] default null,
  p_since             timestamptz default '-infinity'
) returns table (
  id              uuid,
  type            text,
  created_at      timestamptz,
  conversation_id uuid,
  message_id      uuid,
  task_id         uuid,
  contact_id      uuid
)
language sql
stable
security definer
set search_path = ''
as $$
    select m.id,
           'inbound_message'::text as type,
           m.created_at,
           m.conversation_id,
           m.id     as message_id,
           null::uuid as task_id,
           c.contact_id
    from public.messages m
    join public.conversations c on c.id = m.conversation_id and c.deleted_at is null
    where m.company_id = p_company_id
      and m.direction = 'inbound'
      and m.deleted_at is null
      and m.created_at > p_since
      and c.assigned_user_id = p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    select e.id, 'assigned', e.created_at, e.conversation_id,
           null::uuid, null::uuid, c.contact_id
    from public.conversation_events e
    join public.conversations c on c.id = e.conversation_id and c.deleted_at is null
    where e.company_id = p_company_id
      and e.type = 'assigned'
      and e.payload->>'to' = p_user_id::text
      and e.created_at > p_since
      and coalesce(e.actor_user_id, '00000000-0000-0000-0000-000000000000') <> p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    select e.id, 'task_assigned', e.created_at, e.conversation_id,
           null::uuid, (e.payload->>'task_id')::uuid, c.contact_id
    from public.conversation_events e
    join public.conversations c on c.id = e.conversation_id and c.deleted_at is null
    where e.company_id = p_company_id
      and e.type = 'task_assigned'
      and e.payload->>'to_user_id' = p_user_id::text
      and e.created_at > p_since
      and coalesce(e.actor_user_id, '00000000-0000-0000-0000-000000000000') <> p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    -- #129: an INBOUND missed call, assignee-else-everyone, like the push.
    select e.id, 'missed_call', e.created_at, e.conversation_id,
           null::uuid, null::uuid, c.contact_id
    from public.conversation_events e
    join public.conversations c on c.id = e.conversation_id and c.deleted_at is null
    where e.company_id = p_company_id
      and e.type = 'call_completed'
      and e.payload->>'outcome' = 'missed'
      and e.created_at > p_since
      and coalesce(e.payload->>'direction', 'inbound') = 'inbound'
      and (c.assigned_user_id is null or c.assigned_user_id = p_user_id)
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    -- Named on an internal note. The feed row id is the NOTE's message id, so
    -- notification_read_items (keyed on that id) needs no change. A note body
    -- quotes customer text, so this arm carries the same hidden-number filter
    -- as every other conversation arm, and an author who mentions themselves
    -- is never told about it.
    select m.id, 'mention', m.created_at, m.conversation_id,
           m.id, null::uuid, c.contact_id
    from public.message_mentions mn
    join public.messages m      on m.id = mn.message_id and m.deleted_at is null
    join public.conversations c on c.id = m.conversation_id and c.deleted_at is null
    where mn.company_id = p_company_id
      and mn.user_id = p_user_id
      and m.direction = 'note'
      and m.created_at > p_since
      and m.sent_by_user_id is distinct from p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
$$;

comment on function public.notification_feed(uuid, uuid, uuid[], timestamptz) is
  '#359: THE definition of what counts as a notification. api_notifications '
  'and api_notifications_unread_count both select from it, so the list and '
  'the badge cannot disagree and the #106 deny-list is applied once. '
  'p_since keeps only rows created after it; the badge passes the watermark.';

revoke all on function public.notification_feed(uuid, uuid, uuid[], timestamptz)
  from public, anon, authenticated;
grant execute on function public.notification_feed(uuid, uuid, uuid[], timestamptz)
  to service_role;

-- plpgsql: the watermark is read first and handed to the feed as a value its arms range on.
create or replace function public.api_notifications_unread_count(
  p_company_id        uuid,
  p_user_id           uuid,
  p_hidden_number_ids uuid[] default null
) returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_seen timestamptz;
begin
  select nr.last_seen_at into v_seen
    from public.notification_reads nr
   where nr.user_id = p_user_id and nr.company_id = p_company_id;

  return (
    select count(*)::bigint
      from public.notification_feed(p_company_id, p_user_id, p_hidden_number_ids,
                                    coalesce(v_seen, '-infinity'::timestamptz)) f
     where not exists (
       select 1 from public.notification_read_items ri
        where ri.user_id = p_user_id
          and ri.company_id = p_company_id
          and ri.notification_id = f.id));
end;
$fn$;

revoke all on function public.api_notifications_unread_count(uuid, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_notifications_unread_count(uuid, uuid, uuid[])
  to service_role;

-- From 20260730003100_one_notification_definition.sql: neither entry point may
-- carry an arm of its own, so the list and the badge cannot drift.
do $$
declare
  v_list  text := pg_get_functiondef(
    'public.api_notifications(uuid, uuid, integer, timestamptz, uuid, uuid[])'::regprocedure);
  v_count text := pg_get_functiondef(
    'public.api_notifications_unread_count(uuid, uuid, uuid[])'::regprocedure);
begin
  if v_list not like '%notification_feed(%' then
    raise exception 'api_notifications must read the shared notification_feed';
  end if;
  if v_count not like '%notification_feed(%' then
    raise exception 'api_notifications_unread_count must read the shared notification_feed';
  end if;
  -- The arms live in notification_feed and nowhere else.
  if v_list like '%conversation_events%' or v_count like '%conversation_events%' then
    raise exception
      'a notification arm has been added outside notification_feed, so the list '
      'and the badge will drift, which is what #188 and #201 were';
  end if;
  if v_count like '%public.messages%' then
    raise exception
      'the badge is reading messages directly again; it must be a count over '
      'notification_feed, not a parallel implementation';
  end if;
  -- One notification_feed, so a 3-argument call cannot be ambiguous.
  if (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname = 'notification_feed') <> 1 then
    raise exception 'expected exactly one public.notification_feed';
  end if;
end $$;
