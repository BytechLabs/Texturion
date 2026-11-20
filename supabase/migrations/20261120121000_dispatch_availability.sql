alter table public.company_members
  add column dispatch_shifts jsonb not null default '{}'
    check (jsonb_typeof(dispatch_shifts) = 'object');

create function public.dispatch_worker_availability(p_company uuid, p_worker uuid, p_day date)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'start', ((p_day + (shift ->> 'start')::time) at time zone co.timezone),
    'end', ((p_day + (shift ->> 'end')::time) at time zone co.timezone),
    'breaks', coalesce((select jsonb_agg(jsonb_build_object(
      'start', ((p_day + (item ->> 'start')::time) at time zone co.timezone),
      'end', ((p_day + (item ->> 'end')::time) at time zone co.timezone)
    ) order by item ->> 'start') from jsonb_array_elements(shift -> 'breaks') item), '[]'::jsonb)
  )
  from public.company_members cm join public.companies co on co.id = cm.company_id
  cross join lateral (select cm.dispatch_shifts -> extract(isodow from p_day)::text as shift) rule
  where cm.company_id = p_company and cm.user_id = p_worker and shift is not null
$$;

create function public.api_dispatch_set_shift(
  p_company_id uuid, p_actor_id uuid, p_worker_id uuid, p_weekday integer, p_shift jsonb, p_revision integer
)
returns text language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.company_members cm where cm.company_id = p_company_id
    and cm.user_id = p_actor_id and cm.deactivated_at is null and cm.role in ('owner', 'admin'))
  then return 'not_found'; end if;
  if p_weekday not between 1 and 7 then return 'hours'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text, 876));
  if (select dispatch_revision from public.companies where id = p_company_id) is distinct from p_revision
  then return 'stale'; end if;

  update public.company_members cm set dispatch_shifts = case when p_shift is null then cm.dispatch_shifts - p_weekday::text
    else jsonb_set(cm.dispatch_shifts, array[p_weekday::text], p_shift) end
  where cm.company_id = p_company_id and cm.user_id = p_worker_id and cm.deactivated_at is null;
  if not found then return 'not_found'; end if;
  update public.companies set dispatch_revision = dispatch_revision + 1 where id = p_company_id;
  return 'ok';
end;
$$;

create function public.dispatch_fits_worker_shift(p_company uuid, p_worker uuid, p_start timestamptz, p_end timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select coalesce((p_start >= (hours ->> 'start')::timestamptz and p_end <= (hours ->> 'end')::timestamptz
    and not exists (select 1 from jsonb_array_elements(hours -> 'breaks') pause
      where p_start < (pause ->> 'end')::timestamptz and p_end > (pause ->> 'start')::timestamptz)), false)
  from public.companies co
  cross join lateral (select public.dispatch_worker_availability(
    p_company, p_worker, (p_start at time zone co.timezone)::date) as hours) availability
  where co.id = p_company and hours is not null
$$;

revoke all on function public.api_dispatch_set_shift(uuid, uuid, uuid, integer, jsonb, integer),
  public.dispatch_worker_availability(uuid, uuid, date),
  public.dispatch_fits_worker_shift(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.api_dispatch_set_shift(uuid, uuid, uuid, integer, jsonb, integer),
  public.dispatch_worker_availability(uuid, uuid, date),
  public.dispatch_fits_worker_shift(uuid, uuid, timestamptz, timestamptz) to service_role;

do $$
declare
  definition text;
  needle text;
begin
  definition := pg_get_functiondef('public.api_dispatch_read(uuid,uuid,date,integer,uuid)'::regprocedure);
  needle := $old$'id', cm.user_id, 'name', p.display_name$old$;
  if strpos(definition, needle) = 0 then raise exception 'Dispatch member projection changed'; end if;
  execute replace(definition, needle, $new$'id', cm.user_id, 'name', p.display_name, 'shifts', cm.dispatch_shifts,
        'availability', coalesce((select jsonb_object_agg(d.day, a.hours) from days d
          cross join lateral (select public.dispatch_worker_availability(w.id, cm.user_id, d.day) as hours) a
          where a.hours is not null), '{}'::jsonb)$new$);

  definition := pg_get_functiondef('public.api_dispatch_publish(uuid,uuid,integer,jsonb,jsonb)'::regprocedure);
  needle := $old$then return 'duration'; end if;$old$;
  if strpos(definition, needle) = 0 then raise exception 'Dispatch duration check changed'; end if;
  execute replace(definition, needle, $new$then return 'duration'; end if;
    if public.dispatch_fits_worker_shift(p_company_id, v_change.assignee_id, v_change.starts_at, v_change.ends_at) is false
    then return 'hours'; end if;$new$);
end;
$$;
