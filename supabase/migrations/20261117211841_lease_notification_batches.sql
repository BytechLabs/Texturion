alter table public.pending_notifications
  drop constraint pending_notifications_delivery_kind_check,
  add constraint pending_notifications_delivery_kind_check check (delivery_kind in ('batch', 'summary', 'quiet')),
  add column lease_id uuid,
  add column leased_until timestamptz;

create function public.schedule_quiet_notification() returns trigger
language plpgsql
set search_path = ''
as $function$
declare quiet_end timestamptz;
begin
  select public.notification_quiet_window_end(
           new.created_at at time zone zone.name, p.quiet_from, p.quiet_to
         ) at time zone zone.name
    into quiet_end
    from public.notification_prefs p
    join public.companies c on c.id = p.company_id
    join pg_catalog.pg_timezone_names zone on zone.name = coalesce(p.quiet_timezone, c.timezone)
   where p.company_id = new.company_id and p.user_id = new.user_id;

  new.deliver_at := greatest(new.created_at, quiet_end);
  return new;
end;
$function$;

revoke all on function public.schedule_quiet_notification() from public, anon, authenticated;

create trigger schedule_quiet_notification
  before insert on public.pending_notifications
  for each row when (new.delivery_kind = 'quiet')
  execute function public.schedule_quiet_notification();

create function public.api_lease_notification_batches(
  p_now timestamptz,
  p_lease_id uuid,
  p_limit integer default 20
) returns table (company_id uuid, user_id uuid, counts jsonb, conversations bigint, notifications bigint)
language sql
security definer
set search_path = ''
as $function$
  with due as (
    select pending.company_id, pending.user_id, min(pending.deliver_at) as first_due_at
      from public.pending_notifications pending
     where pending.delivery_kind <> 'summary' and pending.deliver_at <= p_now
       and (pending.leased_until is null or pending.leased_until <= p_now)
     group by pending.company_id, pending.user_id
  ), members as (
    select member.company_id, member.user_id
      from due
      join public.company_members member using (company_id, user_id)
      join public.companies company on company.id = member.company_id
      left join public.notification_prefs prefs using (company_id, user_id)
      left join pg_catalog.pg_timezone_names zone on zone.name = coalesce(prefs.quiet_timezone, company.timezone)
     where member.deactivated_at is null and company.deleted_at is null
       and coalesce(prefs.push_enabled, true)
       and public.notification_quiet_window_end(p_now at time zone zone.name, prefs.quiet_from, prefs.quiet_to) is null
       and not exists (
         select 1 from public.pending_notifications leased
          where leased.company_id = due.company_id and leased.user_id = due.user_id
            and leased.leased_until > p_now
       )
     order by due.first_due_at, due.company_id, due.user_id
     limit p_limit
     for update of member skip locked
  ), leased as (
    update public.pending_notifications pending
       set lease_id = p_lease_id, leased_until = p_now + interval '3 minutes'
      from members
     where pending.company_id = members.company_id and pending.user_id = members.user_id
       and (pending.delivery_kind = 'batch' or (pending.delivery_kind = 'quiet' and pending.deliver_at <= p_now))
       and (pending.leased_until is null or pending.leased_until <= p_now)
    returning pending.company_id, pending.user_id, pending.category, pending.conversation_id
  ), visible as (
    select leased.*
      from leased
      left join public.conversations conversation
        on conversation.id = leased.conversation_id and conversation.company_id = leased.company_id
     where leased.conversation_id is null
        or public.member_number_level(leased.user_id, conversation.phone_number_id) <> 'none'
  ), category_counts as (
    select visible.company_id, visible.user_id, visible.category, count(*) as count
      from visible
     group by visible.company_id, visible.user_id, visible.category
  ), totals as (
    select visible.company_id, visible.user_id,
           count(distinct visible.conversation_id) filter (where visible.category in ('messages_mine', 'messages_all')) as conversations,
           count(*) as notifications
      from visible
     group by visible.company_id, visible.user_id
  ), recipients as (
    select distinct leased.company_id, leased.user_id from leased
  )
  select recipients.company_id, recipients.user_id,
         coalesce(jsonb_object_agg(category_counts.category, category_counts.count)
           filter (where category_counts.category is not null), '{}'::jsonb),
         coalesce(totals.conversations, 0), coalesce(totals.notifications, 0)
    from recipients
    left join totals using (company_id, user_id)
    left join category_counts using (company_id, user_id)
   group by recipients.company_id, recipients.user_id, totals.conversations, totals.notifications
$function$;

revoke all on function public.api_lease_notification_batches(timestamptz, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.api_lease_notification_batches(timestamptz, uuid, integer) to service_role;

create function public.api_consume_notification_batch(p_company_id uuid, p_user_id uuid, p_lease_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $function$
  with consumed as (
    delete from public.pending_notifications
     where company_id = p_company_id and user_id = p_user_id and lease_id = p_lease_id
       and leased_until > now()
    returning 1
  )
  select exists (select 1 from consumed)
$function$;

revoke all on function public.api_consume_notification_batch(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_consume_notification_batch(uuid, uuid, uuid) to service_role;

create or replace function public.api_claim_due_notifications(
  p_now timestamptz default now(),
  p_limit integer default 20
) returns setof public.pending_notifications
language sql
security definer
set search_path = ''
as $function$
  delete from public.pending_notifications
   where delivery_kind = 'batch' and lease_id is null
     and (company_id, user_id) in (
       select company_id, user_id
         from public.pending_notifications
        where delivery_kind = 'batch' and lease_id is null and deliver_at <= p_now
        group by company_id, user_id
        order by min(deliver_at), company_id, user_id
        limit p_limit
     )
  returning *
$function$;
