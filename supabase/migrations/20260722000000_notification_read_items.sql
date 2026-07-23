-- #188: "mark all read" leaves the unread dot; tapping a notification never
-- marks it read. Two disagreements in the D24 read-model, fixed together:
--
-- (1) CLOCK SPLIT. api_mark_notifications_read stamped the watermark with the
--     WORKER's clock (new Date().toISOString() in
--     apps/api/src/routes/notifications.ts) while every feed item's created_at
--     is stamped by Postgres now() at insert. Cloudflare Workers freeze Date
--     between I/O and the two clocks are never the same clock, so the
--     watermark could land BEFORE the newest item's created_at — the strict
--     `created_at > last_seen_at` unread test then keeps the badge nonzero
--     after "Read all". Fix: p_now becomes optional; the RPC stamps
--     coalesce(p_now, now()) — the DB clock, the same clock that stamps
--     created_at. One clock, one source of truth. (The explicit-p_now form
--     stays for the legacy { before } watermark advance.)
--
-- (2) NO PER-ITEM READ. The only single-item path was the { before } watermark
--     advance, which marks the tapped item AND EVERYTHING OLDER read — tapping
--     the newest notification silently swallowed every older unread, and any
--     client that re-serialized the timestamp (millisecond truncation) landed
--     the watermark microseconds short and marked NOTHING read. Fix: a true
--     per-item exception set, notification_read_items, layered on the
--     watermark. The unread predicate everywhere becomes
--
--         created_at > last_seen_at
--         AND id NOT IN (caller's notification_read_items)
--
--     applied identically by BOTH read-model twins (api_notifications and
--     api_notifications_unread_count), so the feed dots and the badge can
--     never disagree. api_mark_notification_read inserts into the set
--     (idempotent via ON CONFLICT DO NOTHING); every watermark advance prunes
--     rows the watermark now covers, and the insert path caps the set per
--     (user, company) — cost-protection: the exception set is bounded no
--     matter what a client does.
--
-- SPEC §7/§10 conventions throughout: SECURITY DEFINER, empty search_path,
-- EXECUTE revoked from anon/authenticated, service_role only, explicit
-- p_company_id + p_user_id (tenant + user isolation). Deny-by-default RLS on
-- the new table (enabled, no policies; service_role DML via the D8 ALTER
-- DEFAULT PRIVILEGES in 20260701030000_service_role_grants.sql).

-- ===========================================================================
-- 0. notification_read_items — per-(user, company) read exceptions AHEAD of
--    the watermark. notification_id is the derived feed row's id (a messages
--    or conversation_events uuid); item_created_at is that row's created_at,
--    kept so watermark advances can prune rows they cover. Rows only ever
--    SUBTRACT from the caller's own unread set, so an invented id is
--    harmless — it costs one capped row and nothing else.
-- ===========================================================================
create table public.notification_read_items (
  user_id         uuid not null references auth.users(id)       on delete cascade,
  company_id      uuid not null references public.companies(id) on delete cascade,
  notification_id uuid not null,
  item_created_at timestamptz not null,
  read_at         timestamptz not null default now(),
  primary key (user_id, company_id, notification_id)
);

alter table public.notification_read_items enable row level security;

-- ===========================================================================
-- 1. api_notifications — same derived union as 20260711 (inbound_message /
--    assigned / task_assigned / missed_call, #106-filtered); ONLY the unread
--    expression changes: watermark AND the per-item exception set.
-- ===========================================================================
drop function if exists public.api_notifications(uuid, uuid, int, timestamptz, uuid, uuid[]);

create function public.api_notifications(
  p_company_id        uuid,
  p_user_id           uuid,
  p_limit             int,
  p_before_ts         timestamptz default null,
  p_before_id         uuid        default null,
  p_hidden_number_ids uuid[]      default null
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
$$;
revoke execute on function public.api_notifications(uuid, uuid, int, timestamptz, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_notifications(uuid, uuid, int, timestamptz, uuid, uuid[])
  to service_role;

-- ===========================================================================
-- 2. api_notifications_unread_count — the badge twin. The union arms now also
--    carry the row id so the SAME unread predicate as the feed (watermark +
--    exception set) applies; the twins change in lockstep, as always.
-- ===========================================================================
drop function if exists public.api_notifications_unread_count(uuid, uuid, uuid[]);

create function public.api_notifications_unread_count(
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
  ) f, seen s
  where f.created_at > s.last_seen_at
    and not exists (
      select 1 from public.notification_read_items ri
       where ri.user_id = p_user_id
         and ri.company_id = p_company_id
         and ri.notification_id = f.id)
$$;
revoke execute on function public.api_notifications_unread_count(uuid, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_notifications_unread_count(uuid, uuid, uuid[])
  to service_role;

-- ===========================================================================
-- 3. api_mark_notifications_read — the watermark advance (mark-all + the
--    legacy { before } path). Same signature; p_now gains DEFAULT NULL and a
--    null stamps now() — the DB clock, the clock that stamps created_at, so
--    mark-all-read can never land behind a fresh item (#188 fix 1). Every
--    advance prunes exception rows the watermark now covers, keeping the set
--    minimal. greatest() keeps the watermark monotonic, as before.
-- ===========================================================================
create or replace function public.api_mark_notifications_read(
  p_company_id uuid,
  p_user_id    uuid,
  p_now        timestamptz default null
) returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen timestamptz;
begin
  insert into public.notification_reads (user_id, company_id, last_seen_at)
  values (p_user_id, p_company_id, coalesce(p_now, now()))
  on conflict (user_id, company_id) do update
    set last_seen_at = greatest(public.notification_reads.last_seen_at, excluded.last_seen_at)
  returning last_seen_at into v_seen;

  -- Rows at/behind the watermark are read twice over — drop them.
  delete from public.notification_read_items ri
   where ri.user_id = p_user_id
     and ri.company_id = p_company_id
     and ri.item_created_at <= v_seen;

  return v_seen;
end $$;

-- ===========================================================================
-- 4. api_mark_notification_read — mark ONE notification read (#188 fix 2).
--    Inserts into the exception set; idempotent (ON CONFLICT DO NOTHING) and
--    a no-op when the watermark already covers the item. Returns whether THIS
--    call flipped it (false = it was already read). The newest-500 cap per
--    (user, company) bounds the set against any client behavior
--    (cost-protection: cap-and-drop, same shape as the #30 push-subscription
--    cap); rows the cap drops were readable only until the next mark-all
--    prune anyway, and the watermark path remains the durable truth.
-- ===========================================================================
create function public.api_mark_notification_read(
  p_company_id      uuid,
  p_user_id         uuid,
  p_notification_id uuid,
  p_created_at      timestamptz
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seen     timestamptz;
  v_inserted boolean := false;
  v_cutoff   timestamptz;
begin
  select nr.last_seen_at into v_seen
    from public.notification_reads nr
   where nr.user_id = p_user_id and nr.company_id = p_company_id;

  if v_seen is null or p_created_at > v_seen then
    insert into public.notification_read_items
      (user_id, company_id, notification_id, item_created_at)
    values (p_user_id, p_company_id, p_notification_id, p_created_at)
    on conflict (user_id, company_id, notification_id) do nothing;
    v_inserted := found;
  end if;

  -- cap-and-drop: keep only the caller's newest 500 exception rows. The
  -- 500th-newest read_at is the cutoff; anything older goes in one bounded
  -- statement (self-healing for any backlog, like the #30 eviction).
  select ri.read_at into v_cutoff
    from public.notification_read_items ri
   where ri.user_id = p_user_id and ri.company_id = p_company_id
   order by ri.read_at desc
   offset 499 limit 1;
  if found then
    delete from public.notification_read_items ri
     where ri.user_id = p_user_id
       and ri.company_id = p_company_id
       and ri.read_at < v_cutoff;
  end if;

  return v_inserted;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges: deny-by-default (SPEC §6). service_role (the Worker) only.
-- ---------------------------------------------------------------------------
revoke execute on function public.api_mark_notifications_read(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_mark_notifications_read(uuid, uuid, timestamptz)
  to service_role;
revoke execute on function public.api_mark_notification_read(uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_mark_notification_read(uuid, uuid, uuid, timestamptz)
  to service_role;
