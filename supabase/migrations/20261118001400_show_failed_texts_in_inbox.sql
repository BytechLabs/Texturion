alter table public.conversations add column last_outbound_failed_at timestamptz;

with last_send as (
  select distinct on (m.conversation_id)
    m.conversation_id, m.company_id, m.status, m.updated_at
  from public.messages m
  where m.direction = 'outbound'
    and m.deleted_at is null
    and (m.status = 'failed' or m.telnyx_message_id is not null)
  order by m.conversation_id, m.created_at desc, m.id desc
)
update public.conversations c
   set last_outbound_failed_at = last_send.updated_at
  from last_send
 where c.id = last_send.conversation_id
   and c.company_id = last_send.company_id
   and c.deleted_at is null
   and last_send.status = 'failed';

create function public.update_outbound_failure_marker() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'failed' and old.status is distinct from new.status then
    update public.conversations set last_outbound_failed_at = now()
     where id = new.conversation_id and company_id = new.company_id;
  elsif old.telnyx_message_id is null and new.telnyx_message_id is not null
    and new.status <> 'failed' then
    update public.conversations set last_outbound_failed_at = null
     where id = new.conversation_id and company_id = new.company_id
       and last_outbound_failed_at is not null;
  end if;
  return null;
end $$;

revoke execute on function public.update_outbound_failure_marker()
  from public, anon, authenticated;

create trigger update_outbound_failure_marker
after update of status, telnyx_message_id on public.messages
for each row when (new.direction = 'outbound' and new.deleted_at is null)
execute function public.update_outbound_failure_marker();
