create function public.update_lead_response_clock_from_call()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  response_at timestamptz := coalesce(new.answered_at, new.started_at);
begin
  if new.conversation_id is null or new.deleted_at is not null then
    return new;
  end if;

  if (new.direction = 'inbound' and new.outcome = 'answered')
     or (new.direction = 'outbound' and new.answered_by_user_id is not null
         and (new.outcome = 'answered' or new.forward_seconds >= 10)) then
    update public.conversations
       set awaiting_reply_since = null, chase_level = 0
     where company_id = new.company_id and id = new.conversation_id
       and awaiting_reply_since <= response_at;
    return new;
  end if;

  if new.direction = 'inbound' and new.outcome in ('missed', 'voicemail') then
    if tg_op = 'UPDATE' and old.conversation_id = new.conversation_id
       and old.outcome in ('missed', 'voicemail') then
      return new;
    end if;

    update public.conversations c
       set awaiting_reply_since = new.started_at, chase_level = 0
     where c.company_id = new.company_id and c.id = new.conversation_id
       and c.status = 'new' and c.deleted_at is null and c.closed_at is null
       and not c.is_spam and c.awaiting_reply_since is null
       and not exists (
         select 1 from public.messages m
          where m.company_id = new.company_id and m.conversation_id = c.id
            and m.direction = 'outbound' and not m.automated and m.deleted_at is null
            and m.created_at >= new.started_at
       )
       and not exists (
         select 1 from public.calls k
          where k.company_id = new.company_id and k.conversation_id = c.id
            and k.id <> new.id and k.deleted_at is null
            and coalesce(k.answered_at, k.started_at) >= new.started_at
            and (
              (k.direction = 'inbound' and k.outcome = 'answered')
              or (k.direction = 'outbound' and k.answered_by_user_id is not null
                  and (k.outcome = 'answered' or k.forward_seconds >= 10))
            )
       );
  end if;

  return new;
end $$;

create trigger calls_lead_response_clock
after insert or update of conversation_id, outcome, answered_at, answered_by_user_id, forward_seconds
on public.calls
for each row execute function public.update_lead_response_clock_from_call();

revoke execute on function public.update_lead_response_clock_from_call()
  from public, anon, authenticated;
