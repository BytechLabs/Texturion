-- The workspace purge erases the audit log with the rest of the workspace.
--
-- purge_workspace_step lists audit_log in its table roster, but the audit log
-- refuses every delete unless loonext.audit_retention is on
-- (audit_log_is_append_only, #231), and the purge never turned it on. The
-- first closed workspace with an audit row (every closure writes
-- workspace.closed) would have stopped its erasure there for good. No
-- workspace has been closed on production yet, so nothing is stuck.
--
-- The flag is transaction-local, and only this definer function and the
-- retention prune set it.
do $mig$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'purge_workspace_step';
  v_new := replace(v_def,
    $$  foreach v_table in array v_tables loop$$,
    $$  -- The roster includes audit_log, which only accepts deletes under this flag.
  perform set_config('loonext.audit_retention', 'on', true);
  foreach v_table in array v_tables loop$$);
  if v_new = v_def then
    raise exception 'purge_workspace_step: the delete-loop anchor was not found';
  end if;
  execute v_new;
end $mig$;

revoke execute on function public.purge_workspace_step(uuid, int)
  from public, anon, authenticated;
grant execute on function public.purge_workspace_step(uuid, int) to service_role;
