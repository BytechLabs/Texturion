-- #722, plan item 5: the 10DLC registration and the hosted-SMS order follow
-- their machines in the database, not only in code
-- (packages/shared/src/state-machines/{registration,text-enablement}.ts).
--
-- The carrier owns both. A late or replayed carrier event that would move a
-- row off its edges is not an error to throw back at a webhook: the row keeps
-- the status it has, the way `applyTransitionPatch` and `mapHostedStatus`
-- already treat it in code. `enforced.test.ts` pins both triggers.
--
-- Decided here: a rejected registration is resubmitted after a fix
-- (rejected -> submitted, the path the phones' fix form already takes), and a
-- suspended one is reactivated the same way after a paid resubscribe.
-- Releasing a number cancels its hosted order even once completed.

create or replace function public.messaging_registrations_status_forward_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status in ('submitted'))
    or (old.status = 'submitted' and new.status in ('pending', 'approved', 'rejected'))
    or (old.status = 'pending' and new.status in ('approved', 'rejected'))
    or (old.status = 'approved' and new.status in ('suspended'))
    or (old.status = 'rejected' and new.status in ('submitted'))
    or (old.status = 'suspended' and new.status in ('approved', 'rejected', 'submitted'))
  ) then
    new.status := old.status;
  end if;
  return new;
end $$;

create trigger messaging_registrations_status_forward_only
  before update of status on public.messaging_registrations
  for each row execute function public.messaging_registrations_status_forward_only();

create or replace function public.text_enablement_orders_status_forward_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not (
       (old.status = 'pending' and new.status in ('in-progress', 'action-required', 'completed', 'failed', 'cancelled'))
    or (old.status = 'action-required' and new.status in ('pending', 'in-progress', 'completed', 'failed', 'cancelled'))
    or (old.status = 'in-progress' and new.status in ('action-required', 'completed', 'failed', 'cancelled'))
    or (old.status = 'completed' and new.status in ('cancelled'))
    or (old.status = 'failed' and new.status in ('pending', 'cancelled'))
  ) then
    new.status := old.status;
  end if;
  return new;
end $$;

create trigger text_enablement_orders_status_forward_only
  before update of status on public.text_enablement_orders
  for each row execute function public.text_enablement_orders_status_forward_only();

revoke execute on function public.messaging_registrations_status_forward_only() from public, anon, authenticated;
revoke execute on function public.text_enablement_orders_status_forward_only() from public, anon, authenticated;
