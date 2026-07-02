-- DESIGN G4 + G8 — two read-path additions for the inbox and usage screens:
--
--   api_list_conversations  now embeds `last_message` (id, direction, body,
--                            created_at, has_attachments) so the G4 row
--                            anatomy — "last message snippet one line" — is
--                            satisfied on a cold load of GET /v1/conversations
--                            (previously the snippet existed only after the
--                            thread cache was seeded client-side).
--   api_usage_history        month-bucketed outbound-segment totals from
--                            usage_events for the G8 "6-month history bars"
--                            on /settings/usage. `p_anchor` defaults to now()
--                            and exists so the SQL suite can pin time.
--
-- Same posture as 20260701010000: SECURITY DEFINER, empty search_path,
-- EXECUTE revoked from end-user roles, granted to service_role only.

-- ---------------------------------------------------------------------------
-- GET /v1/conversations (SPEC §7, DESIGN G4): keyset page on
-- (last_message_at, id) DESC. Each row: the conversation (minus the internal
-- last_notified_at debounce stamp) + embedded contact summary + tags +
-- per-caller `unread` flag + `last_message` snippet source (newest messages
-- row — notes included, they ARE messages rows). Body is truncated to 160
-- chars server-side: the row renders one line, never a full MMS-long text.
-- ---------------------------------------------------------------------------
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
  p_cursor_id        uuid        default null
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
         'unread', c.last_message_at > coalesce(
           (select r.last_read_at
              from public.conversation_reads r
             where r.conversation_id = c.id and r.user_id = p_user_id),
           '-infinity'::timestamptz),
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
    and (not coalesce(p_unread, false) or c.last_message_at > coalesce(
          (select r.last_read_at
             from public.conversation_reads r
            where r.conversation_id = c.id and r.user_id = p_user_id),
          '-infinity'::timestamptz))
    and (p_q is null
         or ct.name ilike ('%' || p_q || '%')
         or ct.phone_e164 ilike ('%' || p_q || '%'))
    and (p_cursor_ts is null
         or (c.last_message_at, c.id) < (p_cursor_ts, p_cursor_id))
  order by c.last_message_at desc, c.id desc
  limit greatest(p_limit, 0)
$$;

-- ---------------------------------------------------------------------------
-- GET /v1/usage (DESIGN G8): calendar-month outbound-segment totals for the
-- last p_months months (oldest first, current month last), zero-filled so the
-- bars always render a full set. usage_events is the app-side source of truth
-- (SPEC §9 — never Stripe). SUM in SQL for the same row-cap reason as
-- api_period_segments.
-- ---------------------------------------------------------------------------
create or replace function public.api_usage_history(
  p_company_id uuid,
  p_months     int,
  p_anchor     timestamptz default now()
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'month', to_char(b.month_start, 'YYYY-MM'),
             'segments', coalesce(u.total, 0))
           order by b.month_start), '[]'::jsonb)
  from (
    select date_trunc('month', p_anchor) - make_interval(months => g.n)
             as month_start
    from generate_series(greatest(p_months, 1) - 1, 0, -1) as g(n)
  ) b
  left join lateral (
    select sum(e.quantity)::bigint as total
    from public.usage_events e
    where e.company_id = p_company_id
      and e.created_at >= b.month_start
      and e.created_at < b.month_start + interval '1 month'
  ) u on true
$$;

-- ---------------------------------------------------------------------------
-- Privileges: deny-by-default (SPEC §6) — strip PUBLIC, grant service_role.
-- api_list_conversations keeps its signature, so its existing revoke/grant
-- from 20260701010000 still applies; re-asserted here for self-containment.
-- ---------------------------------------------------------------------------
revoke execute on function public.api_list_conversations(uuid, uuid, int, text, uuid, uuid, boolean, boolean, text, timestamptz, uuid)
  from public, anon, authenticated;
revoke execute on function public.api_usage_history(uuid, int, timestamptz)
  from public, anon, authenticated;

grant execute on function public.api_list_conversations(uuid, uuid, int, text, uuid, uuid, boolean, boolean, text, timestamptz, uuid)
  to service_role;
grant execute on function public.api_usage_history(uuid, int, timestamptz)
  to service_role;
