\set ON_ERROR_STOP on

begin;

do $$
declare
  report_name text;
begin
  foreach report_name in array array[
    'api_response_time_stats', 'api_pipeline_report', 'api_lead_source_report', 'api_contact_timeline'
  ] loop
    if (
      select count(*) = 0 or bool_or(
        not coalesce('p_hidden_number_ids' = any(p.proargnames), false)
        or lower(pg_catalog.pg_get_functiondef(p.oid)) not like '%deleted_at is null%'
      )
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = report_name
    ) then
      raise exception '% must filter trashed rows and accept the viewer''s hidden lines', report_name;
    end if;
  end loop;
end $$;

rollback;
