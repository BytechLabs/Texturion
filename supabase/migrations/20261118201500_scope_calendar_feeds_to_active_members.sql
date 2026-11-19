create or replace function public.api_mint_calendar_feed_token(
  p_company_id uuid,
  p_user_id uuid,
  p_token_hash text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- Serialize minting with workspace closure, offboarding and rotation.
  perform 1 from public.companies c
   where c.id = p_company_id and c.deleted_at is null
   for share;
  if not found then
    return null;
  end if;

  perform 1 from public.company_members m
   where m.company_id = p_company_id and m.user_id = p_user_id
     and m.deactivated_at is null
   for update;
  if not found then
    return null;
  end if;

  perform public.api_revoke_calendar_feed_token(p_company_id, p_user_id);

  insert into public.calendar_feed_tokens (company_id, user_id, token_hash)
  values (p_company_id, p_user_id, p_token_hash)
  returning id into v_id;

  return v_id;
end $$;

drop function public.api_resolve_calendar_feed_token(text);

create function public.api_resolve_calendar_feed_token(p_token_hash text)
returns table (company_id uuid, user_id uuid, role public.member_role, company_name text)
language sql
security definer
set search_path = ''
as $$
  update public.calendar_feed_tokens t
     set last_read_at = now()
    from public.company_members m, public.companies c
   where t.token_hash = p_token_hash and t.revoked_at is null
     and m.company_id = t.company_id and m.user_id = t.user_id
     and m.deactivated_at is null
     and c.id = t.company_id and c.deleted_at is null
  returning t.company_id, t.user_id, m.role, c.name;
$$;

revoke execute on function public.api_resolve_calendar_feed_token(text)
  from public, anon, authenticated;
grant execute on function public.api_resolve_calendar_feed_token(text) to service_role;

create function public.api_calendar_feed_tasks(
  p_company_id uuid,
  p_user_id uuid,
  p_since timestamptz
) returns table (
  id uuid, title text, description text, due_at timestamptz,
  addr_street text, addr_unit text, addr_city text, addr_state text,
  addr_postal_code text, updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.title, t.description, t.due_at, t.addr_street, t.addr_unit,
         t.addr_city, t.addr_state, t.addr_postal_code, t.updated_at
    from public.task_assignees a
    join public.tasks t on t.company_id = a.company_id and t.id = a.task_id
    join public.companies c on c.id = t.company_id
   where a.company_id = p_company_id and a.user_id = p_user_id
     and c.deleted_at is null and t.deleted_at is null and t.due_at >= p_since
     and public.calendar_task_access_allowed(p_user_id, p_company_id, t.conversation_id)
   order by t.due_at, t.id
   limit 1000;
$$;

revoke execute on function public.api_calendar_feed_tasks(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_calendar_feed_tasks(uuid, uuid, timestamptz)
  to service_role;

create function public.calendar_feed_member_removed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.api_revoke_calendar_feed_token(old.company_id, old.user_id);
  return null;
end $$;

revoke execute on function public.calendar_feed_member_removed() from public, anon, authenticated;

create trigger calendar_feed_member_deactivated
after update of deactivated_at on public.company_members
for each row when (old.deactivated_at is null and new.deactivated_at is not null)
execute function public.calendar_feed_member_removed();

create trigger calendar_feed_member_deleted
after delete on public.company_members
for each row execute function public.calendar_feed_member_removed();

create function public.calendar_feed_workspace_closed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.calendar_feed_tokens t
     set revoked_at = now()
   where t.company_id = new.id and t.revoked_at is null;
  return null;
end $$;

revoke execute on function public.calendar_feed_workspace_closed() from public, anon, authenticated;

create trigger calendar_feed_workspace_closed
after update of deleted_at on public.companies
for each row when (old.deleted_at is null and new.deleted_at is not null)
execute function public.calendar_feed_workspace_closed();

update public.calendar_feed_tokens t
   set revoked_at = now()
 where t.revoked_at is null
   and not exists (
     select 1 from public.company_members m
       join public.companies c on c.id = m.company_id
      where m.company_id = t.company_id and m.user_id = t.user_id
        and m.deactivated_at is null and c.deleted_at is null
        and not exists (
          select 1 from public.audit_log a
           where a.company_id = t.company_id and a.occurred_at >= t.created_at
             and (a.action = 'workspace.closed' or (
               a.action = 'member.deactivated' and a.target_type = 'member'
               and a.target_id = m.id::text and a.before->>'active' = 'true'
             ))
        )
   );
