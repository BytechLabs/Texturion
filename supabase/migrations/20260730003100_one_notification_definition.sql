-- #359 - the bell list and the bell badge were the same rules, written twice.
--
-- D24 chose to DERIVE the notification feed rather than add a table, which was
-- right: no write on every notifiable event, and deletion stays consistent for
-- free. It was then implemented twice - `api_notifications` for the list and
-- `api_notifications_unread_count` for the badge - each redefined across three
-- migrations, each carrying its own copy of the five arms AND its own copy of
-- the #106 deny filter.
--
-- Every change to what counts as a notification had to land identically in
-- both, or the badge disagrees with the list: a "3" over a bell showing two
-- items, or no dot with unread items behind it. That is exactly what #188 and
-- #201 were, both reported by the founder from live use, and both painful to
-- diagnose precisely because the count and the list were separate things.
--
-- The only thing holding them together was test discipline. That worked, and
-- it is the weakest available guarantee: it holds as long as whoever adds the
-- sixth arm remembers there are two functions and finds the test.
--
-- ---------------------------------------------------------------------------
-- ONE DEFINITION, TWO ENTRY POINTS.
--
-- `notification_feed` IS the definition, lifted verbatim from the list's own
-- `feed` CTE so this migration cannot change what anybody sees. Both entry
-- points now select from it, which also applies the #106 deny-list exactly
-- once - a filter expressed twice is a divergence waiting to become a
-- disclosure rather than a cosmetic bug.
--
-- The two entry points STAY. The API needs a cheap count without
-- materialising rows, and a `language sql` STABLE function like this is
-- inlined by the planner, so the count pays for the columns it actually reads
-- rather than for the whole row.

create or replace function public.notification_feed(
  p_company_id        uuid,
  p_user_id           uuid,
  p_hidden_number_ids uuid[] default null
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
    join public.conversations c on c.id = m.conversation_id
    where m.company_id = p_company_id
      and m.direction = 'inbound'
      and c.assigned_user_id = p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    select e.id, 'assigned', e.created_at, e.conversation_id,
           null::uuid, null::uuid, c.contact_id
    from public.conversation_events e
    join public.conversations c on c.id = e.conversation_id
    where e.company_id = p_company_id
      and e.type = 'assigned'
      and e.payload->>'to' = p_user_id::text
      and coalesce(e.actor_user_id, '00000000-0000-0000-0000-000000000000') <> p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    select e.id, 'task_assigned', e.created_at, e.conversation_id,
           null::uuid, (e.payload->>'task_id')::uuid, c.contact_id
    from public.conversation_events e
    join public.conversations c on c.id = e.conversation_id
    where e.company_id = p_company_id
      and e.type = 'task_assigned'
      and e.payload->>'to_user_id' = p_user_id::text
      and coalesce(e.actor_user_id, '00000000-0000-0000-0000-000000000000') <> p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    -- #129: an INBOUND missed call — assignee-else-everyone, like the push.
    select e.id, 'missed_call', e.created_at, e.conversation_id,
           null::uuid, null::uuid, c.contact_id
    from public.conversation_events e
    join public.conversations c on c.id = e.conversation_id
    where e.company_id = p_company_id
      and e.type = 'call_completed'
      and e.payload->>'outcome' = 'missed'
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
    join public.messages m      on m.id = mn.message_id
    join public.conversations c on c.id = m.conversation_id
    where mn.company_id = p_company_id
      and mn.user_id = p_user_id
      and m.direction = 'note'
      and m.sent_by_user_id is distinct from p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
$$;

comment on function public.notification_feed(uuid, uuid, uuid[]) is
  '#359: THE definition of what counts as a notification. api_notifications '
  'and api_notifications_unread_count both select from it, so the list and '
  'the badge cannot disagree and the #106 deny-list is applied once.';

-- The list: the same tail it always had, over the shared definition.
create or replace function public.api_notifications(
  p_company_id        uuid,
  p_user_id           uuid,
  p_limit             integer,
  p_before_ts         timestamptz default null,
  p_before_id         uuid default null,
  p_hidden_number_ids uuid[] default null
) returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with seen as (
    select coalesce(
             (select nr.last_seen_at from public.notification_reads nr
               where nr.user_id = p_user_id and nr.company_id = p_company_id),
             '-infinity'::timestamptz) as last_seen_at
  )
  select jsonb_build_object(
           'id', f.id,
           'type', f.type,
           'conversation_id', f.conversation_id,
           'message_id', f.message_id,
           'task_id', f.task_id,
           'contact', jsonb_build_object('id', ct.id, 'name', ct.name,
                                         'phone_e164', ct.phone_e164),
           'created_at', f.created_at,
           -- #188: unread = past the watermark AND not individually read.
           'unread', (f.created_at > s.last_seen_at
                      and not exists (
                        select 1 from public.notification_read_items ri
                         where ri.user_id = p_user_id
                           and ri.company_id = p_company_id
                           and ri.notification_id = f.id)))
  from public.notification_feed(p_company_id, p_user_id, p_hidden_number_ids) f
  cross join seen s
  left join public.contacts ct on ct.id = f.contact_id
  where (p_before_ts is null or (f.created_at, f.id) < (p_before_ts, p_before_id))
  order by f.created_at desc, f.id desc
  limit greatest(p_limit, 0)
$$;

-- The badge: a COUNT over that same definition, with the same unread rule the
-- list computes per row. Before this it was a parallel implementation.
create or replace function public.api_notifications_unread_count(
  p_company_id        uuid,
  p_user_id           uuid,
  p_hidden_number_ids uuid[] default null
) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  with seen as (
    select coalesce(
             (select nr.last_seen_at from public.notification_reads nr
               where nr.user_id = p_user_id and nr.company_id = p_company_id),
             '-infinity'::timestamptz) as last_seen_at
  )
  select count(*)::bigint
    from public.notification_feed(p_company_id, p_user_id, p_hidden_number_ids) f
    cross join seen s
   where f.created_at > s.last_seen_at
     and not exists (
       select 1 from public.notification_read_items ri
        where ri.user_id = p_user_id
          and ri.company_id = p_company_id
          and ri.notification_id = f.id)
$$;

revoke all on function public.notification_feed(uuid, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.notification_feed(uuid, uuid, uuid[]) to service_role;
revoke all on function public.api_notifications(uuid, uuid, integer, timestamptz, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_notifications(uuid, uuid, integer, timestamptz, uuid, uuid[]) to service_role;
revoke all on function public.api_notifications_unread_count(uuid, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_notifications_unread_count(uuid, uuid, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- THE SIXTH ARM CANNOT BE ADDED TO ONLY ONE PLACE.
--
-- Test discipline held this together before, and it held. What it could not do
-- is stop somebody adding an arm to the list and forgetting the badge — the
-- test only catches that if they find and extend it.
--
-- Now neither entry point contains an arm at all: both select from
-- notification_feed, so a sixth arm has exactly one place to go. This assertion
-- is what makes that permanent — it fails the moment either function starts
-- reading `messages` or `conversation_events` directly again, which is the
-- shape of the regression it exists to prevent.
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
      'a notification arm has been added outside notification_feed — the list '
      'and the badge will drift, which is what #188 and #201 were';
  end if;
  if v_count like '%public.messages%' then
    raise exception
      'the badge is reading messages directly again — it must be a count over '
      'notification_feed, not a parallel implementation';
  end if;
end $$;
