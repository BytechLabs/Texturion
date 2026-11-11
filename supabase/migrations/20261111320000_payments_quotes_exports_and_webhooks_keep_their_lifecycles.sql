-- #722, plan item 7: four internal machines the database now enforces.
--
-- Each status may only move along its shared definition
-- (packages/shared/src/state-machines/{payment-request,quote,data-export,
-- webhook-delivery}.ts), whoever writes it. Every writer today already keeps
-- to these edges with a WHERE guard (`.eq("status", ...)`, the claim RPCs);
-- this makes the rule the table's own, so a new writer cannot move a paid
-- request back to requested or a delivered webhook back to pending.
-- `enforced.test.ts` fails when a trigger and its definition differ.
--
-- These machines are ours, not a provider's, so an illegal move raises.

create or replace function public.payment_requests_transition_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not (
       (old.status = 'requested' and new.status in ('paid', 'cancelled', 'expired'))
    or (old.status = 'cancelled' and new.status in ('paid'))
    or (old.status = 'expired' and new.status in ('paid'))
  ) then
    raise exception 'payment request % cannot go from % to %', old.id, old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger payment_requests_transition_guard
  before update of status on public.payment_requests
  for each row execute function public.payment_requests_transition_guard();

create or replace function public.quotes_transition_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status in ('sent'))
    or (old.status = 'sent' and new.status in ('viewed', 'accepted', 'declined', 'expired'))
    or (old.status = 'viewed' and new.status in ('accepted', 'declined', 'expired'))
  ) then
    raise exception 'quote % cannot go from % to %', old.id, old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger quotes_transition_guard
  before update of status on public.quotes
  for each row execute function public.quotes_transition_guard();

create or replace function public.data_exports_transition_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not (
       (old.status = 'pending' and new.status in ('running', 'failed'))
    or (old.status = 'running' and new.status in ('ready', 'failed'))
  ) then
    raise exception 'data export % cannot go from % to %', old.id, old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger data_exports_transition_guard
  before update of status on public.data_exports
  for each row execute function public.data_exports_transition_guard();

create or replace function public.webhook_deliveries_transition_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not (
       (old.status = 'pending' and new.status in ('delivering'))
    or (old.status = 'delivering' and new.status in ('pending', 'succeeded', 'failed'))
  ) then
    raise exception 'webhook delivery % cannot go from % to %', old.id, old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger webhook_deliveries_transition_guard
  before update of status on public.webhook_deliveries
  for each row execute function public.webhook_deliveries_transition_guard();

revoke execute on function public.payment_requests_transition_guard() from public, anon, authenticated;
revoke execute on function public.quotes_transition_guard() from public, anon, authenticated;
revoke execute on function public.data_exports_transition_guard() from public, anon, authenticated;
revoke execute on function public.webhook_deliveries_transition_guard() from public, anon, authenticated;
