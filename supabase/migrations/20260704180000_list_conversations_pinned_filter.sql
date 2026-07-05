-- #13 part 1 — server-side pinned-first ordering. Today pinned threads float to
-- the top CLIENT-side (sortPinnedFirst), so a pinned-but-quiet conversation that
-- has fallen off the loaded pages only reaches the top once its page loads. This
-- adds a `p_pinned` filter so the inbox fetches the (few) pinned threads in ONE
-- call and the main keyset list excludes them — leaving the main list's
-- (last_message_at, id) cursor completely untouched:
--
--   p_pinned = 'only'    → only pinned threads, ordered pinned_at DESC (no cursor)
--   p_pinned = 'exclude' → only un-pinned threads, the normal keyset list
--   p_pinned = null      → every thread, keyset (unchanged legacy behaviour)
--
-- Adding a parameter changes the signature, so the 11-arg overload is dropped
-- and the 12-arg version recreated (otherwise PostgREST sees two candidates for
-- a no-p_pinned call). Body is otherwise identical to 20260702000000
-- (unread-excludes-own-sends): SECURITY DEFINER, empty search_path, service-role
-- only.

drop function if exists public.api_list_conversations(
  uuid, uuid, int, text, uuid, uuid, boolean, boolean, text, timestamptz, uuid);

create or replace function public.api_list_conversations(
  p_company_id       uuid,
  p_user_id          uuid,
  p_limit            int,
  p_status           text        default null,
  p_assigned_user_id uuid        default null,
  p_tag_id           uuid        default null,
  p_is_spam          boolean     default false,
  p_unread           boolean     default false,
  p_q                text        default null,
  p_cursor_ts        timestamptz default null,
  p_cursor_id        uuid        default null,
  p_pinned           text        default null
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

revoke execute on function public.api_list_conversations(uuid, uuid, int, text, uuid, uuid, boolean, boolean, text, timestamptz, uuid, text)
  from public, anon, authenticated;

grant execute on function public.api_list_conversations(uuid, uuid, int, text, uuid, uuid, boolean, boolean, text, timestamptz, uuid, text)
  to service_role;
