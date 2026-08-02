-- #508 — the inbox can show the threads nobody has answered yet.
--
-- The response-time card names the leak ("5 leads nobody answered") and on web
-- linked to `/inbox?status=new`, which is a different set. Nothing moves a
-- conversation off `new` when the crew replies — only a human re-filing it or
-- an inbound `waiting -> open` flip does — so that filter means "nobody tidied
-- this up", and a crew that answers everything and never touches the status
-- dropdown sees every thread there.
--
-- `awaiting_reply_since` is the honest one, and it already exists: the #388
-- lead clock, set by `messages_start_lead_clock` on the first inbound of a new
-- or reopened thread and cleared by `messages_stop_lead_clock` on a human
-- outbound. It is lead-scoped, which matches the card exactly —
-- `api_response_time_stats` counts leads with `response_seconds is null`, so
-- the two are one concept seen from either end: historical and live.
--
-- Reusing the column rather than deriving a second predicate is what satisfies
-- #508's third criterion by construction: three clients cannot disagree about
-- what "unanswered" counts when none of them defines it.
--
-- Adding a parameter changes the signature, so the 14-arg overload is dropped
-- and the 15-arg version recreated — otherwise PostgREST sees two candidates
-- for a call that omits `p_awaiting`. Same drop-and-recreate as `p_snoozed`,
-- `p_pinned` and `p_hidden_number_ids` before it.

drop function if exists public.api_list_conversations(
  uuid, uuid, int, text, uuid, uuid, boolean, boolean, text, timestamptz, uuid,
  text, uuid[], text);

CREATE OR REPLACE FUNCTION public.api_list_conversations(p_company_id uuid, p_user_id uuid, p_limit integer, p_status text DEFAULT NULL::text, p_assigned_user_id uuid DEFAULT NULL::uuid, p_tag_id uuid DEFAULT NULL::uuid, p_is_spam boolean DEFAULT false, p_unread boolean DEFAULT false, p_q text DEFAULT NULL::text, p_cursor_ts timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_pinned text DEFAULT NULL::text, p_hidden_number_ids uuid[] DEFAULT NULL::uuid[], p_snoozed text DEFAULT 'exclude'::text, p_awaiting text DEFAULT NULL::text)
 RETURNS SETOF jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    -- #508: threads still waiting on a first reply. `awaiting_reply_since` is
    -- the #388 lead clock, trigger-maintained on every message: set on the
    -- first inbound of a new or reopened thread, cleared by a human outbound.
    -- Reading it here rather than deriving a second "needs a reply" predicate
    -- is what makes the three clients agree by construction — and it is the
    -- LIVE twin of the number the response-time card reports, which counts
    -- leads with no response. `status='new'` was neither: nothing moves a
    -- conversation off it when the crew replies, so it means "nobody re-filed
    -- this" rather than "nobody answered this".
    and (p_awaiting is null
         or p_awaiting not in ('only', 'exclude')
         or (p_awaiting = 'only'    and c.awaiting_reply_since is not null)
         or (p_awaiting = 'exclude' and c.awaiting_reply_since is null))
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
$function$;

comment on function public.api_list_conversations is
  '#508: p_awaiting filters on the #388 lead clock (awaiting_reply_since) rather than on status, because status is a housekeeping state a reply does not change. It is the live twin of the response-time card''s unanswered count, so the card and the destination it links to describe the same set.';

revoke all on function public.api_list_conversations(
  uuid, uuid, int, text, uuid, uuid, boolean, boolean, text, timestamptz, uuid,
  text, uuid[], text, text) from public, anon, authenticated;
grant execute on function public.api_list_conversations(
  uuid, uuid, int, text, uuid, uuid, boolean, boolean, text, timestamptz, uuid,
  text, uuid[], text, text) to service_role;
