-- Apply both filters before choosing the keyset page so counts and rows agree.
drop function public.api_list_conversations(uuid, uuid, integer, text, uuid, uuid, boolean, boolean, text, timestamptz, uuid, text, uuid[], text, text);

create or replace function public.api_list_conversations(
  p_company_id uuid,
  p_user_id uuid,
  p_limit integer,
  p_status text default null,
  p_assigned_user_id uuid default null,
  p_tag_id uuid default null,
  p_is_spam boolean default false,
  p_unread boolean default false,
  p_q text default null,
  p_cursor_ts timestamptz default null,
  p_cursor_id uuid default null,
  p_pinned text default null,
  p_hidden_number_ids uuid[] default null,
  p_snoozed text default 'exclude',
  p_awaiting text default null,
  p_unassigned boolean default false,
  p_phone_number_id uuid default null
)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $fn$

  -- Choose the page before joining its contacts, tags, and latest messages.
  with page as (
    select c.id, c.last_message_at, c.pinned_at
    from public.conversations c
    left join public.conversation_snoozes sz
      on sz.conversation_id = c.id
     and sz.user_id = p_user_id
     and sz.until > now()
    where c.company_id = p_company_id
      and c.deleted_at is null
      and c.is_spam = coalesce(p_is_spam, false)
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
      and (p_status is null or c.status = p_status::public.conversation_status)
      and (p_assigned_user_id is null or c.assigned_user_id = p_assigned_user_id)
      and (not coalesce(p_unassigned, false) or c.assigned_user_id is null)
      and (p_phone_number_id is null or c.phone_number_id = p_phone_number_id)
      and (p_tag_id is null or exists (
            select 1 from public.conversation_tags cx
             where cx.conversation_id = c.id and cx.tag_id = p_tag_id))
      and (not coalesce(p_unread, false) or coalesce((
             select case when b.latest_by is distinct from p_user_id
                         then b.latest_at else b.other_at end
                    > coalesce(r.last_read_at, '-infinity'::timestamptz)
               from public.conversation_unread_basis b
               left join public.conversation_reads r
                 on r.conversation_id = b.conversation_id and r.user_id = p_user_id
              where b.conversation_id = c.id), false))
      -- Keep contact search separate so the page can use its ordering index.
      and (p_q is null
           or c.contact_id in (
                select ct.id
                  from public.contacts ct
                 where ct.name ilike ('%' || p_q || '%')
                    or ct.phone_e164 ilike ('%' || p_q || '%')))
      and (p_pinned is null
           or (p_pinned = 'only'    and c.pinned_at is not null)
           or (p_pinned = 'exclude' and c.pinned_at is null))
      and (p_awaiting is null
           or p_awaiting not in ('only', 'exclude')
           or (p_awaiting = 'only'    and c.awaiting_reply_since is not null)
           or (p_awaiting = 'exclude' and c.awaiting_reply_since is null))
      and (p_snoozed is null
           or p_snoozed not in ('exclude', 'only')
           or (p_snoozed = 'exclude' and sz.conversation_id is null)
           or (p_snoozed = 'only'    and sz.conversation_id is not null))
      and (p_cursor_ts is null
           or (c.last_message_at, c.id) < (p_cursor_ts, p_cursor_id))
    order by (case when p_pinned = 'only' then c.pinned_at end) desc nulls last,
             c.last_message_at desc, c.id desc
    limit greatest(p_limit, 0)
  )
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
         'snoozed_until', sz.until,
         'snooze_note', sz.note,
         'unread', coalesce((
             select case when b.latest_by is distinct from p_user_id
                         then b.latest_at else b.other_at end
                    > coalesce(r.last_read_at, '-infinity'::timestamptz)
               from public.conversation_unread_basis b
               left join public.conversation_reads r
                 on r.conversation_id = b.conversation_id and r.user_id = p_user_id
              where b.conversation_id = c.id), false),
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
  from page
  join public.conversations c on c.id = page.id
  join public.contacts ct on ct.id = c.contact_id
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
      and m.deleted_at is null
    order by m.created_at desc, m.id desc
    limit 1
  ) lm on true
  order by (case when p_pinned = 'only' then c.pinned_at end) desc nulls last,
           c.last_message_at desc, c.id desc
$fn$;

revoke execute on function public.api_list_conversations(uuid, uuid, integer, text, uuid, uuid, boolean, boolean, text, timestamptz, uuid, text, uuid[], text, text, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.api_list_conversations(uuid, uuid, integer, text, uuid, uuid, boolean, boolean, text, timestamptz, uuid, text, uuid[], text, text, boolean, uuid)
  to service_role;
