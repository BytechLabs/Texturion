-- #293 — the list learns about deferral.
--
-- A snoozed thread is hidden from the DEFAULT view and findable on request,
-- with its return time shown. "Something that vanishes with no way to see what
-- you deferred is worse than the problem."
--
-- `p_snoozed` borrows `p_pinned`'s vocabulary, with one deliberate difference:
-- its default is 'exclude', not "no filter". Every other parameter here means
-- "null = do not filter", and this one cannot — the whole point is that the
-- ordinary inbox stops showing deferred threads without every caller having to
-- remember to ask. Callers that genuinely want everything say so.
--
-- Adding a parameter changes the signature, so the 13-arg overload is dropped
-- and the 14-arg version recreated — otherwise PostgREST sees two candidates
-- for a call that omits `p_snoozed`. Same drop-and-recreate as the `p_pinned`
-- and `p_hidden_number_ids` migrations before it.

drop function if exists public.api_list_conversations(
  uuid, uuid, int, text, uuid, uuid, boolean, boolean, text, timestamptz, uuid,
  text, uuid[]);

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
  p_pinned           text        default null,
  p_hidden_number_ids uuid[]     default null,
  p_snoozed          text        default 'exclude'
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
         -- #293: when THIS member has deferred it, when it comes back and why.
         -- Carried on every row rather than only in the snoozed view, so a
         -- thread that returns mid-session can be labelled without a second
         -- read, and so the snoozed list needs no join of its own.
         'snoozed_until', sz.until,
         'snooze_note', sz.note,
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
             'has_attachments', lm.attachment_count > 0,
             'attachment_count', lm.attachment_count,
             'attachment_kind', lm.attachment_kind)
         end)
  from public.conversations c
  join public.contacts ct on ct.id = c.contact_id
  -- The deferral is THIS member's. A colleague's snooze must not appear on
  -- their row, and must not hide the thread from them.
  left join public.conversation_snoozes sz
    on sz.conversation_id = c.id
   and sz.user_id = p_user_id
   and sz.until > now()
  left join lateral (
    select m.id, m.direction, m.body, m.created_at,
           att.attachment_count, att.attachment_kind
    from public.messages m
    left join lateral (
      select count(*)::int as attachment_count,
             case
               when count(*) filter (where a.content_type like 'image/%') > 0
                 then 'image'
               when count(*) filter (where a.content_type like 'audio/%') > 0
                 then 'audio'
               when count(*) filter (where a.content_type like 'video/%') > 0
                 then 'video'
               when count(*) > 0 then 'file'
               else null
             end as attachment_kind
        from public.message_attachments a
       where a.message_id = m.id
    ) att on true
    where m.conversation_id = c.id
    order by m.created_at desc, m.id desc
    limit 1
  ) lm on true
  where c.company_id = p_company_id
    and c.is_spam = coalesce(p_is_spam, false)
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
    -- #293 deferral: 'exclude' (the DEFAULT) hides what this member deferred,
    -- 'only' is the "what did I defer" view, 'all' opts out entirely. An
    -- unrecognised value falls through to showing everything rather than
    -- hiding a thread on a typo — the failure that costs a customer is the one
    -- where a thread disappears.
    and (p_snoozed is null
         or p_snoozed not in ('exclude', 'only')
         or (p_snoozed = 'exclude' and sz.conversation_id is null)
         or (p_snoozed = 'only'    and sz.conversation_id is not null))
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
  uuid, uuid, int, text, uuid, uuid, boolean, boolean, text, timestamptz, uuid,
  text, uuid[], text) from public, anon, authenticated;
grant execute on function public.api_list_conversations(
  uuid, uuid, int, text, uuid, uuid, boolean, boolean, text, timestamptz, uuid,
  text, uuid[], text) to service_role;
