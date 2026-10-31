-- D142: what agent_diag could still do with a login once the 2026-10-30
-- migration took every table from it.

-- ---------------------------------------------------------------------------
-- (a) No temporary objects. TEMP reaches every role through PUBLIC, and a
-- session that turns read-only off can then use disk on production's server
-- and create pg_temp objects, which is how a search path is turned against a
-- function that trusts it. No grant excludes one role, so TEMP comes off
-- PUBLIC and goes back by name to every role that held it. A role created
-- after this migration starts without TEMP and gets it only by a grant of
-- its own; that includes a role the platform adds to production later, which
-- would be refused a temporary table, loudly, rather than silently.
-- ---------------------------------------------------------------------------
do $$
declare
  v_db      text := pg_catalog.current_database();
  v_role    text;
  v_granted int := 0;
begin
  for v_role in
    select r.rolname
      from pg_catalog.pg_roles r
     where r.rolname <> 'agent_diag'
       and r.rolname !~ '^pg_'
       and not r.rolsuper
       and pg_catalog.has_database_privilege(r.oid, v_db, 'TEMP')
     order by r.rolname
  loop
    execute format('grant temporary on database %I to %I', v_db, v_role);
    v_granted := v_granted + 1;
  end loop;

  execute format('revoke temporary on database %I from public', v_db);

  -- A revoke that matched no grant only warns, so the outcome is checked.
  if pg_catalog.has_database_privilege('agent_diag', v_db, 'TEMP') then
    raise exception 'agent_diag still holds TEMP on database % after the revoke from PUBLIC', v_db;
  end if;
  raise notice 'TEMP on % is now granted by name to % role(s), and not to agent_diag or PUBLIC',
    v_db, v_granted;
end $$;

-- ---------------------------------------------------------------------------
-- (b) No transaction past 60 seconds. The statement (15 s) and idle (30 s)
-- timeouts still let a run of short statements hold one snapshot open, which
-- holds back vacuum under the views. Like those, this is a default a session
-- can SET away. A reaper it cannot override needs a scheduler, and pg_cron is
-- installed neither here nor in production (read 2026-10-31); enabling it
-- would grant PUBLIC its schema and cron.schedule.
-- ---------------------------------------------------------------------------
alter role agent_diag set transaction_timeout = '60s';

-- ---------------------------------------------------------------------------
-- (c) pg_net, where installed (the local image, not production), opens its
-- functions and its request queue to PUBLIC, which would let agent_diag send
-- HTTP from the database server. Only the owner can revoke that. On Supabase
-- the owner is supabase_admin, so there this is a notice.
-- scripts/ops/set-agent-diag-password.mjs refuses to give agent_diag a
-- password where it can reach pg_net, and call-trace.mjs refuses to trace from
-- a session that can. Neither stops a session that runs neither, so enabling
-- pg_net on production first needs agent_diag's password withdrawn
-- (set-agent-diag-password.mjs --withdraw) or PUBLIC revoked by its owner.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn       regprocedure;
  v_owned    boolean;
  v_callers  text[];
  v_role     text;
  v_revoked  int := 0;
  v_skipped  int := 0;
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_net') then
    raise notice 'pg_net is not installed; nothing to revoke';
    return;
  end if;

  -- The roles Supabase grants pg_net's request functions to by name keep
  -- every function, so the database-webhook trigger's owner still works.
  select coalesce(array_agg(distinct grantee.rolname order by grantee.rolname), '{}')
    into v_callers
    from pg_catalog.pg_proc p
    join pg_catalog.pg_depend d
      on d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
    join pg_catalog.pg_extension e on e.oid = d.refobjid and e.extname = 'pg_net'
    cross join lateral pg_catalog.aclexplode(p.proacl) acl
    join pg_catalog.pg_roles grantee on grantee.oid = acl.grantee
   where acl.privilege_type = 'EXECUTE'
     and grantee.rolname <> 'agent_diag'
     and not grantee.rolsuper;

  for v_fn, v_owned in
    select p.oid::regprocedure, pg_catalog.pg_has_role(current_user, p.proowner, 'USAGE')
      from pg_catalog.pg_proc p
      join pg_catalog.pg_depend d
        on d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      join pg_catalog.pg_extension e on e.oid = d.refobjid and e.extname = 'pg_net'
     where pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE')
     order by 1
  loop
    if not v_owned then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    foreach v_role in array v_callers loop
      execute format('grant execute on function %s to %I', v_fn, v_role);
    end loop;
    execute format('revoke execute on function %s from public', v_fn);
    v_revoked := v_revoked + 1;
  end loop;

  if v_skipped > 0 then
    raise notice 'pg_net: % function(s) stay open to PUBLIC because % does not own them; '
      'agent_diag must not be given a password in this database (set-agent-diag-password refuses)',
      v_skipped, current_user;
  end if;
  raise notice 'pg_net: % function(s) taken off PUBLIC, kept for %', v_revoked, v_callers;
end $$;
