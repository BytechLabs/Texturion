-- #303 — every enforcement action is recorded, whoever takes it.
--
-- The acceptance criterion is "every enforcement action is recorded in the
-- audit log". The obvious implementation is an ops route that writes the state
-- and the audit row together — and it would not satisfy this, because
-- docs/AUP-ENFORCEMENT.md is explicit that setting the state today is a human
-- writing SQL. A route can only record what goes through it, and the thing
-- that actually happens goes around it.
--
-- So the record is a TRIGGER on the column itself. Every writer is covered:
-- the psql session, a future ops route, a migration, a mistake. Enforcement
-- decisions are exactly what gets disputed later, and "we have no record of
-- who did that" is the answer that turns a dispute into a problem.
--
-- ── WHY THREE ACTIONS RATHER THAN ONE ─────────────────────────────────────
--
-- `aup.rate_limited`, `aup.suspended`, `aup.lifted`. The audit column is read
-- by a person scanning for what happened to a workspace, and three verbs that
-- say the outcome beat one `aup.changed` whose meaning is inside a JSON blob.
-- The blob still carries both states, for the case where the step went
-- sideways rather than up or down.
--
-- `actor_user_id` is null: this is a platform action, not one taken by anybody
-- inside the workspace, and the audit table already allows that (#404).

create or replace function public.log_aup_enforcement_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  -- Only a real transition. An UPDATE that rewrites the same step — a note
  -- being corrected, say — is not an enforcement action and must not read as
  -- one in a column somebody scans.
  if new.aup_enforcement is not distinct from old.aup_enforcement then
    return new;
  end if;

  v_action := case new.aup_enforcement
    when 'rate_limited' then 'aup.rate_limited'
    when 'suspended'    then 'aup.suspended'
    else 'aup.lifted'
  end;

  insert into public.audit_log
    (company_id, actor_user_id, action, target_type, target_id, before, after)
  values (
    new.id,
    null,
    v_action,
    'company',
    new.id::text,
    jsonb_build_object(
      'aup_enforcement', old.aup_enforcement,
      'note', old.aup_enforcement_note
    ),
    jsonb_build_object(
      'aup_enforcement', new.aup_enforcement,
      'note', new.aup_enforcement_note
    )
  );

  return new;
end $$;

drop trigger if exists companies_aup_enforcement_audit on public.companies;
create trigger companies_aup_enforcement_audit
  after update of aup_enforcement on public.companies
  for each row
  execute function public.log_aup_enforcement_change();

comment on function public.log_aup_enforcement_change() is
  '#303: writes an audit row for every change to companies.aup_enforcement. A '
  'trigger rather than route code because the runbook says enforcement is '
  'applied by a human in psql today — a route records only what passes '
  'through it, and this has to record what happens.';
