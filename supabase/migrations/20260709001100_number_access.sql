-- #106 (#80): per-number workspace access control.
--
-- Each phone number can be limited to a role or to specific people, at one of
-- two levels; ABSENCE of rows for a number means the default: everyone on the
-- team can text from it (today's behavior, least surprise).
--
--   principal_kind 'all'  → every active member         (principal IS NULL)
--   principal_kind 'role' → members with that role      (principal = 'admin' | 'member')
--   principal_kind 'user' → one member                  (principal = user_id::text)
--
--   level 'text' → full use (send texts, notes, read)
--   level 'note' → read + internal notes only (no outbound texts)
--
-- A user's effective level for a number = the MOST SPECIFIC matching row
-- (user > role > all); no matching row (when any rows exist) = NO ACCESS (the
-- number and its conversations are hidden). Owners and admins ALWAYS have full
-- access to every number (managed by them; no self-lockout) — enforced in the
-- Worker, not here.
--
-- Service-role only (the Worker enforces; end-user roles never read this).

create table public.number_access (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  phone_number_id uuid not null references public.phone_numbers(id) on delete cascade,
  principal_kind  text not null check (principal_kind in ('all', 'role', 'user')),
  -- 'role' → the role name; 'user' → the member's user id; 'all' → null.
  principal       text,
  level           text not null check (level in ('text', 'note')),
  created_at      timestamptz not null default now(),
  constraint number_access_principal_shape check (
    (principal_kind = 'all' and principal is null)
    or (principal_kind = 'role' and principal in ('admin', 'member'))
    or (principal_kind = 'user' and principal is not null)
  ),
  -- One rule per (number, principal): PostgREST upserts converge per subject.
  unique nulls not distinct (phone_number_id, principal_kind, principal)
);

create index number_access_company_idx
  on public.number_access (company_id, phone_number_id);

alter table public.number_access enable row level security;

-- ---------------------------------------------------------------------------
-- api_list_conversations gains p_hidden_number_ids (null = unrestricted): the
-- Worker resolves the caller's HIDDEN numbers (#106 — a DENY list, so un-ruled
-- / released / NULL numbers are always visible) and passes them, so a
-- restricted member's inbox excludes conversations on numbers hidden from
-- them. Body otherwise identical to 20260704180000 (the p_pinned version, with
-- unread-excludes-own-sends). The signature changes, so drop the 12-arg
-- overload first (PostgREST must never see two candidates).
-- ---------------------------------------------------------------------------
drop function if exists public.api_list_conversations(
  uuid, uuid, int, text, uuid, uuid, boolean, boolean, text, timestamptz, uuid, text);

create or replace function public.api_list_conversations(
  p_company_id         uuid,
  p_user_id            uuid,
  p_limit              int,
  p_status             text        default null,
  p_assigned_user_id   uuid        default null,
  p_tag_id             uuid        default null,
  p_is_spam            boolean     default false,
  p_unread             boolean     default false,
  p_q                  text        default null,
  p_cursor_ts          timestamptz default null,
  p_cursor_id          uuid        default null,
  p_pinned             text        default null,
  p_hidden_number_ids  uuid[]      default null
) returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select (to_jsonb(c.*) - 'last_notified_at')
    || jsonb_build_object(
         'contact', jsonb_build_object(
           'id', ct.id, 'name', ct.name, 'phone_e164', ct.phone_e164),
         'tags', coalesce(
           (select jsonb_agg(
                     jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color)
                     order by t.name)
              from public.conversation_tags cx
              join public.tags t on t.id = cx.tag_id
             where cx.conversation_id = c.id),
           '[]'::jsonb),
         'unread', exists (
           select 1
             from public.messages m
            where m.conversation_id = c.id
              and (m.sent_by_user_id is null or m.sent_by_user_id <> p_user_id)
              and m.created_at > coalesce(
                (select r.last_read_at
                   from public.conversation_reads r
                  where r.conversation_id = c.id and r.user_id = p_user_id),
                '-infinity'::timestamptz)),
         'last_message', case when lm.id is null then null else
           jsonb_build_object(
             'id', lm.id,
             'direction', lm.direction,
             'body', left(lm.body, 160),
             'created_at', lm.created_at,
             'has_attachments', lm.has_attachments)
         end)
  from public.conversations c
  join public.contacts ct on ct.id = c.contact_id
  left join lateral (
    select m.id, m.direction, m.body, m.created_at,
           exists (select 1 from public.message_attachments a
                    where a.message_id = m.id) as has_attachments
    from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc, m.id desc
    limit 1
  ) lm on true
  where c.company_id = p_company_id
    and c.is_spam = coalesce(p_is_spam, false)
    -- #106: restricted members never see conversations on a number hidden from
    -- them (a DENY list — un-ruled / released / NULL-number rows stay visible).
    and (p_hidden_number_ids is null
         or c.phone_number_id is null
         or not (c.phone_number_id = any(p_hidden_number_ids)))
    and (p_status is null or c.status = p_status::public.conversation_status)
    and (p_assigned_user_id is null or c.assigned_user_id = p_assigned_user_id)
    and (p_tag_id is null or exists (
          select 1 from public.conversation_tags cx
           where cx.conversation_id = c.id and cx.tag_id = p_tag_id))
    and (not coalesce(p_unread, false) or exists (
          select 1
            from public.messages m
           where m.conversation_id = c.id
             and (m.sent_by_user_id is null or m.sent_by_user_id <> p_user_id)
             and m.created_at > coalesce(
               (select r.last_read_at
                  from public.conversation_reads r
                 where r.conversation_id = c.id and r.user_id = p_user_id),
               '-infinity'::timestamptz)))
    and (p_q is null
         or ct.name ilike ('%' || p_q || '%')
         or ct.phone_e164 ilike ('%' || p_q || '%'))
    -- #13 pinned filter: 'only' keeps pinned, 'exclude' drops them, null = all.
    and (p_pinned is null
         or (p_pinned = 'only'    and c.pinned_at is not null)
         or (p_pinned = 'exclude' and c.pinned_at is null))
    -- The keyset cursor rides (last_message_at, id) — untouched by pinning, so
    -- the 'exclude' main list paginates exactly as before.
    and (p_cursor_ts is null
         or (c.last_message_at, c.id) < (p_cursor_ts, p_cursor_id))
  -- 'only' sorts most-recently-pinned first; every other mode falls straight
  -- through to the legacy (last_message_at, id) order.
  order by (case when p_pinned = 'only' then c.pinned_at end) desc nulls last,
           c.last_message_at desc, c.id desc
  limit greatest(p_limit, 0)
$$;

revoke execute on function public.api_list_conversations(
  uuid, uuid, int, text, uuid, uuid, boolean, boolean, text, timestamptz, uuid, text, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_list_conversations(
  uuid, uuid, int, text, uuid, uuid, boolean, boolean, text, timestamptz, uuid, text, uuid[])
  to service_role;
