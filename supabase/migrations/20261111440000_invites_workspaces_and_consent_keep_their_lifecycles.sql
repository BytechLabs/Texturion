-- #722: invites, workspaces and the consent ledger keep their lifecycles in
-- the database.
--
-- An invite's state is invite_state(accepted_at, revoked_at, expires_at) and a
-- workspace's is workspace_state(paused_at, deleted_at, purged_at), each one SQL
-- definition (20261111360000). Nothing stopped a write from walking an accepted
-- or revoked invite back to pending, or marking a workspace purged that was
-- never closed. These triggers refuse those moves with check_violation, the
-- same way the internal machines do.
--
-- Task and conversation visibility need none: every move between their states
-- is legal (a restored spam conversation comes back as spam), so there is
-- nothing to refuse.
--
-- The accept and revoke routes (apps/api/src/routes/team.ts) only ever move a
-- pending or expired invite, and the purge (purge_workspace_step) only purges a
-- closed workspace, so no current writer is refused.

create or replace function public.invites_transition_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_from text := public.invite_state(old.accepted_at, old.revoked_at, old.expires_at, now());
  v_to   text := public.invite_state(new.accepted_at, new.revoked_at, new.expires_at, now());
begin
  if v_from is distinct from v_to and not (
       (v_from = 'pending' and v_to in ('accepted', 'revoked', 'expired'))
    or (v_from = 'expired' and v_to in ('pending', 'revoked'))
  ) then
    raise exception 'invite % cannot go from % to %', old.id, v_from, v_to
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function public.companies_workspace_transition_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_from text := public.workspace_state(old.paused_at, old.deleted_at, old.purged_at);
  v_to   text := public.workspace_state(new.paused_at, new.deleted_at, new.purged_at);
begin
  if v_from is distinct from v_to and not (
       (v_from = 'active' and v_to in ('paused', 'closed'))
    or (v_from = 'paused' and v_to in ('active', 'closed'))
    or (v_from = 'closed' and v_to in ('active', 'paused', 'purged'))
  ) then
    raise exception 'workspace % cannot go from % to %', old.id, v_from, v_to
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger invites_transition_guard
  before update of accepted_at, revoked_at, expires_at on public.invites
  for each row execute function public.invites_transition_guard();

create trigger companies_workspace_transition_guard
  before update of paused_at, deleted_at, purged_at on public.companies
  for each row execute function public.companies_workspace_transition_guard();

revoke execute on function public.invites_transition_guard() from public, anon, authenticated;
revoke execute on function public.companies_workspace_transition_guard() from public, anon, authenticated;

-- Consent is a ledger: each row is the state a number entered, and the latest
-- wins. Implied consent (they texted first) never follows express consent or a
-- STOP, because only the customer lifts a STOP and a vouched yes outranks an
-- inbound text. The row is skipped rather than refused, so the write that
-- carried it (a contact save) still succeeds.
create or replace function public.contact_consent_events_no_downgrade()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state = 'implied' and exists (
    select 1 from public.contact_consent_events e
     where e.company_id = new.company_id
       and e.phone_e164 = new.phone_e164
       and e.state in ('express', 'revoked')
  ) then
    return null;
  end if;
  return new;
end $$;

create trigger contact_consent_events_no_downgrade
  before insert on public.contact_consent_events
  for each row execute function public.contact_consent_events_no_downgrade();

revoke execute on function public.contact_consent_events_no_downgrade() from public, anon, authenticated;
