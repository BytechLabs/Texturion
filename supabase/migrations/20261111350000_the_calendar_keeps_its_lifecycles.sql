-- #722, plan item 2: the calendar family follows its machines in the database
-- (packages/shared/src/state-machines/calendar-*.ts). Every writer is SQL and
-- already keeps to these edges; this makes the rule the tables' own, so a new
-- function cannot move a revoked connection back or reopen a completed outbox
-- row. The machines are ours, so a move off the edges raises.
-- `enforced.test.ts` pins every trigger to its definition.

create or replace function public.calendar_connections_transition_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not (
       (old.status = 'active' and new.status in ('reauth_required', 'disconnected', 'revoked'))
    or (old.status = 'reauth_required' and new.status in ('active', 'disconnected', 'revoked'))
    or (old.status = 'disconnected' and new.status in ('revoked'))
  ) then
    raise exception 'calendar connection % cannot go from % to %', old.id, old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger calendar_connections_transition_guard
  before update of status on public.calendar_connections
  for each row execute function public.calendar_connections_transition_guard();

revoke execute on function public.calendar_connections_transition_guard() from public, anon, authenticated;

create or replace function public.task_calendar_links_transition_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.link_state is distinct from old.link_state and not (
       (old.link_state = 'active' and new.link_state in ('conflict', 'event_removed', 'refused', 'unlinked'))
    or (old.link_state = 'conflict' and new.link_state in ('active', 'unlinked'))
    or (old.link_state = 'event_removed' and new.link_state in ('active', 'refused', 'unlinked'))
    or (old.link_state = 'refused' and new.link_state in ('active', 'event_removed', 'unlinked'))
    or (old.link_state = 'unlinked' and new.link_state in ('active'))
  ) then
    raise exception 'calendar link % cannot go from % to %', old.id, old.link_state, new.link_state
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger task_calendar_links_transition_guard
  before update of link_state on public.task_calendar_links
  for each row execute function public.task_calendar_links_transition_guard();

revoke execute on function public.task_calendar_links_transition_guard() from public, anon, authenticated;

create or replace function public.calendar_outbox_transition_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state is distinct from old.state and not (
       (old.state = 'queued' and new.state in ('leased', 'completed', 'cancelled'))
    or (old.state = 'leased' and new.state in ('queued', 'completed', 'cancelled'))
  ) then
    raise exception 'calendar outbox row % cannot go from % to %', old.id, old.state, new.state
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger calendar_outbox_transition_guard
  before update of state on public.calendar_outbox
  for each row execute function public.calendar_outbox_transition_guard();

revoke execute on function public.calendar_outbox_transition_guard() from public, anon, authenticated;

create or replace function public.calendar_reminder_replans_transition_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state is distinct from old.state and not (
       (old.state = 'queued' and new.state in ('leased', 'completed', 'cancelled'))
    or (old.state = 'leased' and new.state in ('queued', 'completed', 'cancelled'))
  ) then
    raise exception 'reminder replan % cannot go from % to %', old.id, old.state, new.state
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger calendar_reminder_replans_transition_guard
  before update of state on public.calendar_reminder_replans
  for each row execute function public.calendar_reminder_replans_transition_guard();

revoke execute on function public.calendar_reminder_replans_transition_guard() from public, anon, authenticated;

create or replace function public.webhook_subscriptions_transition_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and not (
       (old.status = 'active' and new.status in ('error', 'revoking', 'revoked'))
    or (old.status = 'renewing' and new.status in ('active', 'error', 'revoking', 'revoked'))
    or (old.status = 'error' and new.status in ('active', 'revoking', 'revoked'))
    or (old.status = 'expired' and new.status in ('revoking', 'revoked'))
    or (old.status = 'revoking' and new.status in ('revoked'))
  ) then
    raise exception 'calendar push subscription % cannot go from % to %', old.id, old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger webhook_subscriptions_transition_guard
  before update of status on public.webhook_subscriptions
  for each row execute function public.webhook_subscriptions_transition_guard();

revoke execute on function public.webhook_subscriptions_transition_guard() from public, anon, authenticated;
