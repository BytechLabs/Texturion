-- The inbox snippet says WHAT the attachment is, not just that there is one.
--
-- Founder report (live device): a customer sent a voice message; the inbox row
-- read "Photo". The row only ever received `has_attachments` (a boolean), so
-- every client had to guess a noun — iOS guessed "Photo" for everything, web
-- said the equally uninformative "Attachment". A crew scanning the inbox could
-- not tell a picture from a voicemail-style audio clip from a PDF, or an
-- attachment from a plain text.
--
-- Fix the class, not the string: the snippet now carries the attachment's KIND
-- and COUNT, so every client (web, iOS, Android) labels from the same server
-- truth instead of inventing one. Kinds mirror packages/shared/src/mms.ts
-- (mmsMediaKind) exactly, so the label a client picks in the list matches the
-- chip it renders in the thread.

-- ---------------------------------------------------------------------------
-- mms_media_kind — the SQL twin of mmsMediaKind (packages/shared/src/mms.ts).
-- Coarse kind for icons and labels. Unknown or absent → 'file'.
-- ---------------------------------------------------------------------------
create or replace function public.mms_media_kind(p_content_type text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when t like 'image/%'                        then 'image'
    when t like 'audio/%'                        then 'audio'
    when t like 'video/%'                        then 'video'
    when t in ('text/vcard', 'text/x-vcard')     then 'contact'
    when t = 'text/calendar'                     then 'calendar'
    when t = 'application/pdf'                   then 'document'
    when t like 'text/%'                         then 'text'
    else 'file'
  end
  -- Canonicalize the way the shared helper does: strip any ";charset=..."
  -- parameter, trim, lowercase.
  from (select lower(btrim(split_part(coalesce(p_content_type, ''), ';', 1))) as t) s
$$;

comment on function public.mms_media_kind(text) is
  'Coarse media kind for a content type (image/audio/video/contact/calendar/document/text/file). SQL twin of mmsMediaKind in packages/shared/src/mms.ts.';

revoke execute on function public.mms_media_kind(text)
  from public, anon, authenticated;
grant execute on function public.mms_media_kind(text) to service_role;

-- ---------------------------------------------------------------------------
-- api_list_conversations — last_message gains `attachment_kind` and
-- `attachment_count`. Signature unchanged (create or replace, no drop), and
-- `has_attachments` stays exactly as it was so a client that has not shipped
-- the new fields yet is untouched.
--
-- attachment_kind is the shared kind when every attachment on the message is
-- the same kind, and 'file' for a mixed set — so a client can honestly say
-- "Photo", "2 photos", "Voice message", or "3 files" without a second query.
-- Body otherwise identical to 20260709001100.
-- ---------------------------------------------------------------------------
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
             'has_attachments', lm.attachment_count > 0,
             'attachment_count', lm.attachment_count,
             'attachment_kind', lm.attachment_kind)
         end)
  from public.conversations c
  join public.contacts ct on ct.id = c.contact_id
  left join lateral (
    select m.id, m.direction, m.body, m.created_at,
           att.attachment_count, att.attachment_kind
    from public.messages m
    left join lateral (
      select count(*)::int as attachment_count,
             case
               when count(*) = 0 then null
               when count(distinct public.mms_media_kind(a.content_type)) = 1
                 then min(public.mms_media_kind(a.content_type))
               else 'file'
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
