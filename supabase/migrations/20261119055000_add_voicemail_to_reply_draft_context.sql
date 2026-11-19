create function public.api_reply_suggestion_window(
  p_company_id uuid,
  p_conversation_id uuid,
  p_limit integer
)
returns table (direction text, body text, created_at timestamptz, source text)
language sql
stable
security definer
set search_path = ''
as $$
  with turns as (
    (
      select m.id, m.direction::text, m.body, m.created_at, null::text as source
      from public.messages m
      where m.company_id = p_company_id and m.conversation_id = p_conversation_id
        and m.deleted_at is null and m.direction in ('inbound', 'outbound')
      order by m.created_at desc, m.id desc
      limit 12
    )
    union all
    (
      select event.id, 'inbound', call.voicemail_transcript, event.created_at, 'voicemail'
      from public.conversation_events event
      join public.calls call on call.call_session_id = event.payload->>'call_session_id'
        and call.company_id = event.company_id and call.conversation_id = event.conversation_id
      where event.company_id = p_company_id and event.conversation_id = p_conversation_id
        and event.type = 'call_completed' and event.payload->>'kind' = 'voicemail'
        and call.deleted_at is null and call.voicemail_deleted_at is null
        and call.voicemail_path is not null and nullif(btrim(call.voicemail_transcript), '') is not null
      order by event.created_at desc, event.id desc
      limit 12
    )
  )
  select turn.direction, turn.body, turn.created_at, turn.source
  from turns turn
  order by turn.created_at desc, turn.id desc
  limit greatest(least(p_limit, 12), 0);
$$;

revoke all on function public.api_reply_suggestion_window(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.api_reply_suggestion_window(uuid, uuid, integer)
  to service_role;
