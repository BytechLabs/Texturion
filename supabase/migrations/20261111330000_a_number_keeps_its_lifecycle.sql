-- #722, plan item 4: `phone_numbers.status` follows the phone_number machine
-- (packages/shared/src/state-machines/phone-number.ts), whoever writes it.
--
-- Seven writers move a number (the provisioning saga, remediation, hosted-SMS
-- activation, port activation, port-out, billing suspension and the allowance
-- claim) and each already keeps to these edges with a WHERE guard. A wrong
-- write loses a customer's line, so a move off the edges now raises instead of
-- landing. `enforced.test.ts` pins this trigger to the definition.

create or replace function public.phone_numbers_transition_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not (
       (old.status = 'provisioning' and new.status in ('active', 'provision_failed', 'released'))
    or (old.status = 'active' and new.status in ('suspended', 'released', 'ported_out'))
    or (old.status = 'suspended' and new.status in ('active', 'released', 'ported_out'))
    or (old.status = 'provision_failed' and new.status in ('provisioning', 'released'))
  ) then
    raise exception 'number % cannot go from % to %', old.id, old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger phone_numbers_transition_guard
  before update of status on public.phone_numbers
  for each row execute function public.phone_numbers_transition_guard();

revoke execute on function public.phone_numbers_transition_guard() from public, anon, authenticated;
