-- #722 phase 2: the remaining status machines keep their lifecycles in the
-- database, each trigger holding the edges defined in
-- packages/shared/src/state-machines/ (enforced.test.ts reads them back).
--
-- Internal machines (number health, geocode, call legs) refuse a move outside
-- their edges, as payment requests and quotes do. Provider machines (port,
-- port messaging, billing disputes, the subscription) KEEP the old status
-- instead, as registrations do: Stripe and Telnyx events can arrive out of
-- order, and refusing one would fail the webhook and retry it forever.
--
-- Checked on production first (2026-11-11): every row is in a defined state,
-- and the writers were read for moves the definitions missed. A consult leg
-- that was answered and then drops is marked failed, so call_leg now has
-- answered -> failed. A new subscription (a resubscribe after an expired
-- checkout or a cancellation) starts its own lifecycle, so only moves within
-- one subscription id are held to the machine.
--
-- Not here, by decision: conversation (every move is real, so a trigger would
-- refuse nothing), consent (an evidence ledger; the opt-out gate enforces that
-- only the customer lifts a STOP) and call (next, against the reducer).

create or replace function public.number_health_transition_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state is distinct from old.state and not (
       (old.state = 'healthy' and new.state in ('degraded'))
    or (old.state = 'degraded' and new.state in ('healthy'))
  ) then
    raise exception 'number health for % cannot go from % to %', old.phone_number_id, old.state, new.state
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function public.contacts_geocode_transition_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.geocode_status is distinct from old.geocode_status and not (
       (old.geocode_status = 'pending' and new.geocode_status in ('ok', 'failed', 'no_address'))
    or (old.geocode_status = 'ok' and new.geocode_status in ('pending', 'no_address'))
    or (old.geocode_status = 'failed' and new.geocode_status in ('pending', 'no_address'))
    or (old.geocode_status = 'no_address' and new.geocode_status in ('pending'))
  ) then
    raise exception 'contact geocode % cannot go from % to %', old.id, old.geocode_status, new.geocode_status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function public.tasks_geocode_transition_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.geocode_status is distinct from old.geocode_status and not (
       (old.geocode_status = 'pending' and new.geocode_status in ('ok', 'failed', 'no_address'))
    or (old.geocode_status = 'ok' and new.geocode_status in ('pending', 'no_address'))
    or (old.geocode_status = 'failed' and new.geocode_status in ('pending', 'no_address'))
    or (old.geocode_status = 'no_address' and new.geocode_status in ('pending'))
  ) then
    raise exception 'task geocode % cannot go from % to %', old.id, old.geocode_status, new.geocode_status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function public.call_member_legs_transition_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state is distinct from old.state and not (
       (old.state = 'ringing' and new.state in ('answered', 'failed'))
    or (old.state = 'answered' and new.state in ('failed'))
  ) then
    raise exception 'call leg % cannot go from % to %', old.call_control_id, old.state, new.state
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function public.billing_disputes_status_forward_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not (
       (old.status = 'warning_needs_response' and new.status in ('warning_under_review', 'warning_closed', 'needs_response'))
    or (old.status = 'warning_under_review' and new.status in ('warning_closed', 'needs_response'))
    or (old.status = 'needs_response' and new.status in ('under_review', 'won', 'lost'))
    or (old.status = 'under_review' and new.status in ('won', 'lost'))
  ) then
    new.status := old.status;
  end if;
  return new;
end $$;

create or replace function public.port_requests_status_forward_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status in ('in-process', 'submitted', 'exception', 'cancel-pending', 'cancelled'))
    or (old.status = 'in-process' and new.status in ('submitted', 'exception', 'foc-date-confirmed', 'activation-in-progress', 'ported', 'cancel-pending', 'cancelled'))
    or (old.status = 'submitted' and new.status in ('exception', 'foc-date-confirmed', 'activation-in-progress', 'ported', 'cancel-pending', 'cancelled'))
    or (old.status = 'exception' and new.status in ('submitted', 'in-process', 'foc-date-confirmed', 'activation-in-progress', 'ported', 'cancel-pending', 'cancelled'))
    or (old.status = 'foc-date-confirmed' and new.status in ('activation-in-progress', 'ported', 'exception', 'cancel-pending', 'cancelled'))
    or (old.status = 'activation-in-progress' and new.status in ('ported', 'exception', 'cancel-pending', 'cancelled'))
    or (old.status = 'cancel-pending' and new.status in ('cancelled'))
  ) then
    new.status := old.status;
  end if;
  return new;
end $$;

create or replace function public.phone_numbers_porting_status_forward_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.porting_status is distinct from old.porting_status
     and old.porting_status is not null and not (
       (old.porting_status = 'draft' and new.porting_status in ('in-process', 'submitted', 'exception', 'cancel-pending', 'cancelled'))
    or (old.porting_status = 'in-process' and new.porting_status in ('submitted', 'exception', 'foc-date-confirmed', 'activation-in-progress', 'ported', 'cancel-pending', 'cancelled'))
    or (old.porting_status = 'submitted' and new.porting_status in ('exception', 'foc-date-confirmed', 'activation-in-progress', 'ported', 'cancel-pending', 'cancelled'))
    or (old.porting_status = 'exception' and new.porting_status in ('submitted', 'in-process', 'foc-date-confirmed', 'activation-in-progress', 'ported', 'cancel-pending', 'cancelled'))
    or (old.porting_status = 'foc-date-confirmed' and new.porting_status in ('activation-in-progress', 'ported', 'exception', 'cancel-pending', 'cancelled'))
    or (old.porting_status = 'activation-in-progress' and new.porting_status in ('ported', 'exception', 'cancel-pending', 'cancelled'))
    or (old.porting_status = 'cancel-pending' and new.porting_status in ('cancelled'))
  ) then
    new.porting_status := old.porting_status;
  end if;
  return new;
end $$;

create or replace function public.port_requests_messaging_forward_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.messaging_port_status is distinct from old.messaging_port_status and not (
       (old.messaging_port_status = 'not_applicable' and new.messaging_port_status in ('pending', 'activating', 'ported', 'exception'))
    or (old.messaging_port_status = 'pending' and new.messaging_port_status in ('activating', 'ported', 'exception'))
    or (old.messaging_port_status = 'activating' and new.messaging_port_status in ('ported', 'exception'))
    or (old.messaging_port_status = 'exception' and new.messaging_port_status in ('activating', 'ported'))
  ) then
    new.messaging_port_status := old.messaging_port_status;
  end if;
  return new;
end $$;

create or replace function public.companies_subscription_status_forward_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.subscription_status is distinct from old.subscription_status
     -- A new subscription starts its own lifecycle (a resubscribe after an
     -- expired checkout or a cancellation): only moves within one are checked.
     and new.stripe_subscription_id is not distinct from old.stripe_subscription_id and not (
       (old.subscription_status = 'incomplete' and new.subscription_status in ('active', 'incomplete_expired', 'canceled'))
    or (old.subscription_status = 'active' and new.subscription_status in ('past_due', 'unpaid', 'canceled'))
    or (old.subscription_status = 'past_due' and new.subscription_status in ('active', 'unpaid', 'canceled'))
    or (old.subscription_status = 'unpaid' and new.subscription_status in ('active', 'canceled'))
    or (old.subscription_status = 'canceled' and new.subscription_status in ('incomplete', 'active'))
  ) then
    new.subscription_status := old.subscription_status;
  end if;
  return new;
end $$;

create trigger number_health_transition_guard
  before update of state on public.number_health
  for each row execute function public.number_health_transition_guard();

-- Every update, not just one naming the column: an address edit moves the
-- status through tasks_geocode_status_sync, which fires first by name.
create trigger contacts_geocode_transition_guard
  before update on public.contacts
  for each row execute function public.contacts_geocode_transition_guard();

create trigger tasks_geocode_transition_guard
  before update on public.tasks
  for each row execute function public.tasks_geocode_transition_guard();

create trigger call_member_legs_transition_guard
  before update of state on public.call_member_legs
  for each row execute function public.call_member_legs_transition_guard();

create trigger billing_disputes_status_forward_only
  before update of status on public.billing_disputes
  for each row execute function public.billing_disputes_status_forward_only();

create trigger port_requests_status_forward_only
  before update of status on public.port_requests
  for each row execute function public.port_requests_status_forward_only();

create trigger port_requests_messaging_forward_only
  before update of messaging_port_status on public.port_requests
  for each row execute function public.port_requests_messaging_forward_only();

create trigger phone_numbers_porting_status_forward_only
  before update of porting_status on public.phone_numbers
  for each row execute function public.phone_numbers_porting_status_forward_only();

create trigger companies_subscription_status_forward_only
  before update of subscription_status on public.companies
  for each row execute function public.companies_subscription_status_forward_only();

revoke execute on function public.number_health_transition_guard() from public, anon, authenticated;
revoke execute on function public.contacts_geocode_transition_guard() from public, anon, authenticated;
revoke execute on function public.tasks_geocode_transition_guard() from public, anon, authenticated;
revoke execute on function public.call_member_legs_transition_guard() from public, anon, authenticated;
revoke execute on function public.billing_disputes_status_forward_only() from public, anon, authenticated;
revoke execute on function public.port_requests_status_forward_only() from public, anon, authenticated;
revoke execute on function public.port_requests_messaging_forward_only() from public, anon, authenticated;
revoke execute on function public.phone_numbers_porting_status_forward_only() from public, anon, authenticated;
revoke execute on function public.companies_subscription_status_forward_only() from public, anon, authenticated;
