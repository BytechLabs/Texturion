create function public.api_due_daily_summaries(
  p_now timestamptz,
  p_limit integer default 50
) returns table (user_id uuid, company_id uuid, timezone text, summary_date date)
language sql
stable
security definer
set search_path = ''
as $function$
  select p.user_id, p.company_id, zone.name, clock.local_now::date
    from public.notification_prefs p
    join public.companies c on c.id = p.company_id
    join pg_catalog.pg_timezone_names zone
      on zone.name = coalesce(p.quiet_timezone, c.timezone)
    cross join lateral (select p_now at time zone zone.name as local_now) clock
   where p.summary_at is not null
     and p.push_enabled
     and c.deleted_at is null
     and (p.summary_sent_on is null or p.summary_sent_on < clock.local_now::date)
     and p.summary_at <= clock.local_now::time
   order by (clock.local_now::date + p.summary_at) at time zone zone.name,
            p.company_id, p.user_id
   limit coalesce(p_limit, 50)
$function$;

revoke all on function public.api_due_daily_summaries(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.api_due_daily_summaries(timestamptz, integer)
  to service_role;
