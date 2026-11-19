alter table public.quotes
  add column decided_by_name text check (char_length(btrim(decided_by_name)) between 1 and 120),
  add column decline_reason text check (char_length(btrim(decline_reason)) between 1 and 500),
  add column decision_version integer not null default 1;

do $migration$
declare
  definition text := pg_get_functiondef('public.api_finish_customer_erasure(uuid,uuid)'::regprocedure);
  updated text;
begin
  updated := replace(
    definition,
    'update public.quotes set description = ''Removed'', status = case',
    'update public.quotes set description = ''Removed'', decided_by_name = null, decline_reason = null, status = case'
  );
  if updated = definition then
    raise exception 'Missing quotes update in api_finish_customer_erasure';
  end if;
  execute updated;
end $migration$;
