alter table public.pending_notifications
  add column delivery_kind text not null default 'batch'
  check (delivery_kind in ('batch', 'summary'));

update public.notification_prefs
   set summary_at = time '17:00'
 where summary_at is null
   and delivery @? '$.* ? (@ == "summary")';

create function public.notification_quiet_window_end(p_at timestamp, p_from time, p_to time)
returns timestamp
language sql
immutable
set search_path = ''
as $function$
  select case
    when p_from < p_to and p_at::time >= p_from and p_at::time < p_to then p_at::date + p_to
    when p_from > p_to and p_at::time >= p_from then (p_at::date + 1) + p_to
    when p_from > p_to and p_at::time < p_to then p_at::date + p_to
  end
$function$;

revoke all on function public.notification_quiet_window_end(timestamp, time, time)
  from public, anon, authenticated;
grant execute on function public.notification_quiet_window_end(timestamp, time, time)
  to service_role;

create function public.notification_summary_delivery_at(
  p_wanted time,
  p_zone text,
  p_quiet_from time,
  p_quiet_to time,
  p_sent date,
  p_at timestamptz
) returns timestamptz
language sql
stable
set search_path = ''
as $function$
  select greatest(p_at, min(schedule.delivery_at) at time zone p_zone)
    from (select (p_at at time zone p_zone)::date as today) clock
    cross join lateral (values (clock.today - 1), (clock.today), (clock.today + 1)) day(value)
    cross join lateral (
      select coalesce(
        public.notification_quiet_window_end(day.value + p_wanted, p_quiet_from, p_quiet_to),
        day.value + p_wanted
      ) as delivery_at
    ) schedule
   where (p_sent is null or p_sent < day.value)
     and schedule.delivery_at::date >= clock.today
$function$;

revoke all on function public.notification_summary_delivery_at(time, text, time, time, date, timestamptz)
  from public, anon, authenticated;
grant execute on function public.notification_summary_delivery_at(time, text, time, time, date, timestamptz)
  to service_role;

create function public.schedule_held_summary_notification() returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  wanted time;
  quiet_from time;
  quiet_to time;
  sent date;
  zone_name text;
begin
  select p.summary_at, p.quiet_from, p.quiet_to, p.summary_sent_on, zone.name
    into wanted, quiet_from, quiet_to, sent, zone_name
    from public.notification_prefs p
    join public.companies c on c.id = p.company_id
    join pg_catalog.pg_timezone_names zone on zone.name = coalesce(p.quiet_timezone, c.timezone)
   where p.company_id = new.company_id and p.user_id = new.user_id;

  if wanted is null or zone_name is null then
    new.delivery_kind := 'batch';
    return new;
  end if;

  new.deliver_at := public.notification_summary_delivery_at(wanted, zone_name, quiet_from, quiet_to, sent, new.created_at);
  return new;
end;
$function$;

revoke all on function public.schedule_held_summary_notification()
  from public, anon, authenticated;

create trigger schedule_held_summary_notification
  before insert on public.pending_notifications
  for each row when (new.delivery_kind = 'summary')
  execute function public.schedule_held_summary_notification();

create function public.reschedule_held_summary_notifications() returns trigger
language plpgsql
set search_path = ''
as $function$
declare zone_name text;
begin
  select zone.name into zone_name
    from public.companies c
    join pg_catalog.pg_timezone_names zone on zone.name = coalesce(new.quiet_timezone, c.timezone)
   where c.id = new.company_id;

  update public.pending_notifications
     set delivery_kind = case when new.summary_at is null or zone_name is null then 'batch' else 'summary' end,
         deliver_at = public.notification_summary_delivery_at(
           new.summary_at, zone_name, new.quiet_from, new.quiet_to, new.summary_sent_on, statement_timestamp()
         )
   where company_id = new.company_id and user_id = new.user_id and delivery_kind = 'summary';
  return new;
end;
$function$;

revoke all on function public.reschedule_held_summary_notifications()
  from public, anon, authenticated;

create trigger reschedule_held_summary_notifications
  after update of summary_at, quiet_timezone, quiet_from, quiet_to on public.notification_prefs
  for each row
  when (
    old.summary_at is distinct from new.summary_at or old.quiet_timezone is distinct from new.quiet_timezone
    or old.quiet_from is distinct from new.quiet_from or old.quiet_to is distinct from new.quiet_to
  )
  execute function public.reschedule_held_summary_notifications();

create or replace function public.api_claim_due_notifications(
  p_now timestamptz default now(),
  p_limit integer default 20
) returns setof public.pending_notifications
language sql
security definer
set search_path = ''
as $function$
  delete from public.pending_notifications
   where delivery_kind = 'batch'
     and (company_id, user_id) in (
       select company_id, user_id
         from public.pending_notifications
        where delivery_kind = 'batch' and deliver_at <= p_now
        group by company_id, user_id
        order by min(deliver_at), company_id, user_id
        limit p_limit
     )
  returning *
$function$;

create or replace function public.api_due_daily_summaries(
  p_now timestamptz,
  p_limit integer default 50
) returns table (user_id uuid, company_id uuid, timezone text, summary_date date)
language sql
stable
security definer
set search_path = ''
as $function$
  select p.user_id, p.company_id, zone.name, due.summary_date
    from public.notification_prefs p
    join public.companies c on c.id = p.company_id
    join pg_catalog.pg_timezone_names zone on zone.name = coalesce(p.quiet_timezone, c.timezone)
    cross join lateral (select p_now at time zone zone.name as local_now) clock
    cross join lateral (
      select day.summary_date, schedule.delivery_at
        from (values (clock.local_now::date - 1), (clock.local_now::date)) day(summary_date)
        cross join lateral (
          select coalesce(
            public.notification_quiet_window_end(day.summary_date + p.summary_at, p.quiet_from, p.quiet_to),
            day.summary_date + p.summary_at
          ) as delivery_at
        ) schedule
       where (p.summary_sent_on is null or p.summary_sent_on < day.summary_date)
         and schedule.delivery_at::date = clock.local_now::date
         and schedule.delivery_at at time zone zone.name <= p_now
       order by day.summary_date desc
       limit 1
    ) due
   where p.summary_at is not null
     and p.push_enabled
     and c.deleted_at is null
     and public.notification_quiet_window_end(clock.local_now, p.quiet_from, p.quiet_to) is null
   order by due.delivery_at at time zone zone.name, p.company_id, p.user_id
   limit coalesce(p_limit, 50)
$function$;
