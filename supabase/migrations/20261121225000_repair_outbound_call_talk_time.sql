-- A carrier hangup can supply talk time after a synthetic completion was threaded.
create function public.sync_outbound_call_talk_time() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.conversation_events e
     set payload = jsonb_set(e.payload, '{forward_seconds}', to_jsonb(new.forward_seconds), false)
   where e.company_id = new.company_id
     and e.conversation_id = new.conversation_id
     and e.type = 'call_completed'
     and e.payload->>'call_session_id' = new.call_session_id
     and e.payload ? 'forward_seconds';
  return null;
end $$;

revoke execute on function public.sync_outbound_call_talk_time() from public, anon, authenticated, service_role;

create trigger calls_sync_outbound_talk_time
after update of forward_seconds on public.calls
for each row when (
  new.direction = 'outbound' and new.outcome = 'answered' and new.conversation_id is not null
  and old.forward_seconds is distinct from new.forward_seconds
)
execute function public.sync_outbound_call_talk_time();

with durations as (
  select company_id, call_session_id, sum(billable_seconds)::integer as seconds
    from public.call_records
   where leg = 'out_customer' and call_session_id is not null
   group by company_id, call_session_id
)
update public.calls c
   set forward_seconds = d.seconds
  from durations d
 where c.company_id = d.company_id
   and c.call_session_id = d.call_session_id
   and c.direction = 'outbound'
   and c.outcome = 'answered'
   and c.ended_at is not null
   and c.forward_seconds is distinct from d.seconds;
