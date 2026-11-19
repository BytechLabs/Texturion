\set ON_ERROR_STOP on

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;

select plan(2);

create temporary table viewer_report_rpc (name text primary key);
insert into viewer_report_rpc values
  ('api_response_time_stats'), ('api_response_time_baseline'), ('api_contact_timeline'),
  ('api_pipeline_report'), ('api_lead_source_report');

select is(
  array(
    select r.name from viewer_report_rpc r
    where not exists (
      select 1 from pg_proc p where p.proname = r.name and p.pronamespace = 'public'::regnamespace
    ) order by r.name
  ),
  array[]::text[],
  'Every viewer report exists'
);

select is(
  array(
    select p.oid::regprocedure::text from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (p.proname in (select name from viewer_report_rpc) or (
        p.proname like 'api\_%report%' escape '\'
        -- Internal aggregate reports do not accept a workspace viewer.
        and p.proname not in ('api_ai_value_report', 'api_high_priority_push_report')
      ))
      and (not coalesce('p_hidden_number_ids' = any(p.proargnames), false)
           or lower(pg_get_functiondef(p.oid)) not like '%deleted_at is null%')
    order by 1
  ),
  array[]::text[],
  'Viewer report functions filter trashed rows and accept the viewer''s hidden lines'
);

select * from finish(true);

rollback;
