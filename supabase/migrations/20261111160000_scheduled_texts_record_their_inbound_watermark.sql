-- A scheduled text must know which inbound message it was written against.
--
-- `scheduled_messages.inbound_watermark` is compared at fire time to notice that
-- the customer replied after the text was queued. A NULL watermark was read as
-- "the thread had no inbound when this was written", so ANY inbound counted as
-- newer. Only `api_schedule_message` ever set it. The appointment reminders
-- written by `api_sync_task_reminders` and the rating ask inserted by the API
-- left it NULL, so on every thread the customer had ever texted they were held
-- as "customer replied" and re-claimed every minute until they expired.
--
-- The fix is at the table, not at each caller: a BEFORE INSERT trigger fills a
-- missing watermark with the thread's newest inbound, which is what
-- `api_schedule_message` computes. After this, NULL means exactly "no inbound
-- yet", whichever code path inserted the row, including ones written later.

create or replace function public.scheduled_messages_default_watermark()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if new.inbound_watermark is null then
    select max(m.created_at) into new.inbound_watermark
      from public.messages m
     where m.company_id = new.company_id
       and m.conversation_id = new.conversation_id
       and m.direction = 'inbound';
  end if;
  return new;
end;
$$;

revoke execute on function public.scheduled_messages_default_watermark()
  from public, anon, authenticated;

drop trigger if exists scheduled_messages_default_watermark
  on public.scheduled_messages;
create trigger scheduled_messages_default_watermark
  before insert on public.scheduled_messages
  for each row execute function public.scheduled_messages_default_watermark();

-- Rows already queued or held without a watermark: use the newest inbound that
-- existed when the row was created. A reply that truly arrived after the row
-- was written stays newer than the watermark and still holds it. Rows whose
-- thread had no inbound at creation keep NULL, which is now correct.
update public.scheduled_messages s
   set inbound_watermark = w.newest,
       updated_at = now()
  from (
    select s2.id,
           (select max(m.created_at)
              from public.messages m
             where m.company_id = s2.company_id
               and m.conversation_id = s2.conversation_id
               and m.direction = 'inbound'
               and m.created_at <= s2.created_at) as newest
      from public.scheduled_messages s2
     where s2.status in ('pending', 'held')
       and s2.inbound_watermark is null
  ) w
 where s.id = w.id
   and w.newest is not null;

-- A held row that was held only because of the missing watermark is released by
-- the backfill above on its next claim. Clear its stale hold reason when it is
-- no longer true, so the thread does not keep saying the customer replied.
update public.scheduled_messages s
   set held_reason = null,
       held_reason_key = null,
       held_at = null,
       status = 'pending',
       updated_at = now()
 where s.status = 'held'
   and s.held_reason_key = 'domain.scheduledHoldCustomerReplied'
   and s.inbound_watermark is not null
   and not exists (
     select 1 from public.messages m
      where m.company_id = s.company_id
        and m.conversation_id = s.conversation_id
        and m.direction = 'inbound'
        and m.created_at > s.inbound_watermark
   );
