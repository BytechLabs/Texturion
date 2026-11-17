create function public.api_unread_conversation_count(
  p_company_id uuid,
  p_user_id uuid,
  p_hidden_number_ids uuid[] default null
) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)
    from public.conversations c
    join public.conversation_unread_basis b on b.conversation_id = c.id and b.company_id = c.company_id
    left join public.conversation_reads r on r.conversation_id = c.id and r.user_id = p_user_id
   where c.company_id = p_company_id
     and not c.is_spam
     and c.deleted_at is null
     and (p_hidden_number_ids is null or c.phone_number_id is null
       or not (c.phone_number_id = any(p_hidden_number_ids)))
     and (case when b.latest_by is distinct from p_user_id then b.latest_at else b.other_at end)
           > coalesce(r.last_read_at, '-infinity'::timestamptz)
$$;

revoke all on function public.api_unread_conversation_count(uuid, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_unread_conversation_count(uuid, uuid, uuid[]) to service_role;

create function public.api_unread_push_badges(
  p_company_id uuid,
  p_user_ids uuid[],
  p_inbox_roles text[]
) returns table (user_id uuid, unread_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, public.api_unread_conversation_count(p_company_id, m.user_id, array(
    select l.phone_number_id from public.member_number_levels(m.user_id, p_company_id) l
     where l.level = 'none'
  ))
    from public.company_members m
   where m.company_id = p_company_id and m.deactivated_at is null
     and m.user_id = any(p_user_ids) and m.role::text = any(p_inbox_roles)
$$;

revoke all on function public.api_unread_push_badges(uuid, uuid[], text[])
  from public, anon, authenticated;
grant execute on function public.api_unread_push_badges(uuid, uuid[], text[]) to service_role;
