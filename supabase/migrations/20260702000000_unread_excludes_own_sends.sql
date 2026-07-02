-- DESIGN G4 — unread must mean "something you haven't seen from someone
-- else", never your own activity. The previous definition computed
--
--   unread := c.last_message_at > conversation_reads.last_read_at
--
-- which flagged a conversation unread for the very user whose outbound reply
-- (or note) bumped last_message_at: open → reply → back produced a phantom
-- petrol dot + title-count bump for the sender on every list refetch,
-- degrading the core unread signal.
--
-- New semantics (this migration, same function signature):
--
--   unread := EXISTS a messages row newer than the caller's last_read_at
--             that the caller did not author
--             (sent_by_user_id IS NULL — inbound — or another member's id)
--
-- Your own sends and notes never mark the thread unread for you (on any
-- device); inbound messages and teammates' replies/notes still do. The
-- `p_unread` filter branch uses the identical predicate so the "Unread"
-- filter chip and the row dot can never disagree. The EXISTS probe rides
-- messages_conv_created_idx (conversation_id, created_at).
--
-- Same posture as 20260701050000: SECURITY DEFINER, empty search_path,
-- EXECUTE revoked from end-user roles, granted to service_role only.

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
    and (p_cursor_ts is null
         or (c.last_message_at, c.id) < (p_cursor_ts, p_cursor_id))
  order by c.last_message_at desc, c.id desc
  limit greatest(p_limit, 0)
$$;

-- ---------------------------------------------------------------------------
-- Privileges: deny-by-default (SPEC §6). The signature is unchanged, so the
-- existing revoke/grant still applies; re-asserted for self-containment.
-- ---------------------------------------------------------------------------
revoke execute on function public.api_list_conversations(uuid, uuid, int, text, uuid, uuid, boolean, boolean, text, timestamptz, uuid)
  from public, anon, authenticated;

grant execute on function public.api_list_conversations(uuid, uuid, int, text, uuid, uuid, boolean, boolean, text, timestamptz, uuid)
  to service_role;
