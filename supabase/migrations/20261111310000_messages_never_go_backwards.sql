-- #722, the `message` machine (packages/shared/src/state-machines/message.ts).
--
-- Telnyx's `message.sent` and `message.finalized` arrive out of order and get
-- replayed, and the finalize handler wrote the final status with no from-state
-- check, so a late event could move a delivered text back to sent. The status
-- now only moves along the machine's edges. Because the carrier owns this
-- machine, a move off the edges is not an error to throw back at a webhook: the
-- text simply keeps the status it has. The API fires its outcome effects only
-- when its own update moved the row (apps/api/src/messaging/status.ts).
--
-- Notes carry no status (NULL) and are untouched.

create or replace function public.messages_status_forward_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and old.status is not null and not (
       (old.status = 'queued' and new.status in ('sent', 'delivered', 'failed'))
    or (old.status = 'sent' and new.status in ('delivered', 'failed'))
    or (old.status = 'failed' and new.status in ('queued'))
  ) then
    new.status := old.status;
  end if;
  return new;
end $$;

create trigger messages_status_forward_only
  before update of status on public.messages
  for each row execute function public.messages_status_forward_only();

revoke execute on function public.messages_status_forward_only()
  from public, anon, authenticated;
