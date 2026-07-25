-- @mentions on internal notes.
--
-- A crew coordinates by assigning a whole thread, which is too coarse when the
-- point is "Sam, you did this install last spring, does this look familiar?".
-- Mentioning a teammate on a note tells that one person.
--
-- The note BODY is untouched: the route still writes the literal typed string
-- ("@Sam Rivera") to messages.body, so Android and iOS, which know nothing
-- about mentions, render the note exactly as it was typed. Mentions are
-- additive metadata in a per-message child table, the same shape
-- message_attachments uses: company_id denormalized for the tenant filter every
-- Worker query carries, plus conversation_id so the bell read-model can apply
-- the number-access filter with one join.

create table public.message_mentions (
  message_id      uuid not null references public.messages(id)      on delete cascade,
  user_id         uuid not null references auth.users(id)           on delete cascade,
  company_id      uuid not null references public.companies(id)     on delete restrict,
  conversation_id uuid not null references public.conversations(id) on delete restrict,
  created_at      timestamptz not null default now(),
  -- Mentioning the same person twice on one note is one mention, not two
  -- notifications.
  primary key (message_id, user_id)
);

-- The bell arm's driving lookup: this member's mentions, newest first.
create index message_mentions_user_idx
  on public.message_mentions (company_id, user_id, created_at desc);

alter table public.message_mentions enable row level security;

-- Deny by default: no policies, and the API reaches it as service_role.
revoke all on public.message_mentions from public, anon, authenticated;
grant select, insert, update, delete on public.message_mentions to service_role;

comment on table public.message_mentions is
  'Teammates named on an internal note. Additive metadata: the note body still '
  'carries the literal "@Name" text, so clients that know nothing about '
  'mentions render the note unchanged.';

-- ===========================================================================
-- Bell read-model: a fifth arm on BOTH twins.
--
-- api_notifications and api_notifications_unread_count must never disagree, or
-- the badge counts something the list cannot show. They are recreated together
-- here, and the ONLY difference from their live definitions is the mention arm
-- appended to each feed.
--
-- CREATE OR REPLACE (not drop + create) keeps the existing privileges, which
-- are execute for service_role alone; the revoke/grant below re-states them so
-- the intent survives a future edit that does drop the function.
-- ===========================================================================

create or replace function public.api_notifications(
  p_company_id uuid,
  p_user_id uuid,
  p_limit integer,
  p_before_ts timestamptz default null,
  p_before_id uuid default null,
  p_hidden_number_ids uuid[] default null
)
returns setof jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  with seen as (
    select coalesce(
             (select nr.last_seen_at from public.notification_reads nr
               where nr.user_id = p_user_id and nr.company_id = p_company_id),
             '-infinity'::timestamptz) as last_seen_at
  ),
  feed as (
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
  from feed f
  cross join seen s
  left join public.contacts ct on ct.id = f.contact_id
  where (p_before_ts is null or (f.created_at, f.id) < (p_before_ts, p_before_id))
  order by f.created_at desc, f.id desc
  limit greatest(p_limit, 0)
$function$;

revoke all on function public.api_notifications(uuid, uuid, integer, timestamptz, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_notifications(uuid, uuid, integer, timestamptz, uuid, uuid[])
  to service_role;

create or replace function public.api_notifications_unread_count(
  p_company_id uuid,
  p_user_id uuid,
  p_hidden_number_ids uuid[] default null
)
returns bigint
language sql
stable
security definer
set search_path to ''
as $function$
  with seen as (
    select coalesce(
             (select nr.last_seen_at from public.notification_reads nr
               where nr.user_id = p_user_id and nr.company_id = p_company_id),
             '-infinity'::timestamptz) as last_seen_at
  )
  select count(*)::bigint from (
    select m.id, m.created_at
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.company_id = p_company_id and m.direction = 'inbound'
      and c.assigned_user_id = p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    select e.id, e.created_at
    from public.conversation_events e
    join public.conversations c on c.id = e.conversation_id
    where e.company_id = p_company_id and e.type = 'assigned'
      and e.payload->>'to' = p_user_id::text
      and coalesce(e.actor_user_id, '00000000-0000-0000-0000-000000000000') <> p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    select e.id, e.created_at
    from public.conversation_events e
    join public.conversations c on c.id = e.conversation_id
    where e.company_id = p_company_id and e.type = 'task_assigned'
      and e.payload->>'to_user_id' = p_user_id::text
      and coalesce(e.actor_user_id, '00000000-0000-0000-0000-000000000000') <> p_user_id
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
    union all
    select e.id, e.created_at
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
    -- The mention arm, identical in its predicates to the list's.
    select m.id, m.created_at
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
  ) f, seen s
  where f.created_at > s.last_seen_at
    and not exists (
      select 1 from public.notification_read_items ri
       where ri.user_id = p_user_id
         and ri.company_id = p_company_id
         and ri.notification_id = f.id)
$function$;

revoke all on function public.api_notifications_unread_count(uuid, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_notifications_unread_count(uuid, uuid, uuid[])
  to service_role;
