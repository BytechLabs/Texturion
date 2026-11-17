create or replace function public.api_due_lead_chases(
  p_now timestamptz,
  p_widen_minutes integer,
  p_limit integer default 200
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  with due as (
    select c.id, c.awaiting_reply_since,
           jsonb_build_object(
             'conversation_id',  c.id,
             'company_id',       c.company_id,
             'assigned_user_id', c.assigned_user_id,
             'phone_number_id',  c.phone_number_id,
             'contact_name',     ct.name,
             'contact_phone',    ct.phone_e164,
             'awaiting_since',   c.awaiting_reply_since,
             'from_level',       c.chase_level,
             'to_level',         2,
             'timezone',         co.timezone,
             'business_hours',   co.business_hours
           ) as chase
      from public.conversations c
      join public.companies co on co.id = c.company_id
      join public.contacts ct on ct.id = c.contact_id
     where c.awaiting_reply_since is not null
       and c.closed_at is null
       and c.is_spam = false
       and co.deleted_at is null
       and c.chase_level = 0
       and co.lead_chase_crew_enabled
       and c.assigned_user_id is not null
       and c.awaiting_reply_since <= p_now - make_interval(mins => p_widen_minutes)
     order by c.awaiting_reply_since, c.id
     limit coalesce(p_limit, 200)
  )
  select coalesce(jsonb_agg(chase order by awaiting_reply_since, id), '[]'::jsonb)
    from due
$function$;
