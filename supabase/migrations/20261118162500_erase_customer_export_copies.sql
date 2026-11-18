alter table public.data_exports add column erasure_revoked_at timestamptz;

create function public.revoke_customer_export_copies(p_company uuid)
returns void
language sql security definer set search_path = ''
as $$
  update public.data_exports
    set status = case when status = 'running' then 'failed' else status end,
        error = 'A customer erasure removed this copy. Request a new export.',
        erasure_revoked_at = now(),
        lease_token = null,
        expires_at = greatest(now(), lease_expires_at)
  where company_id = p_company
    and kind in ('workspace', 'conversation_history', 'tasks')
    and status in ('running', 'ready', 'failed')
    and storage_prefix is not null and reaped_at is null and erasure_revoked_at is null;
$$;

create function public.revoke_exports_on_customer_erasure()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.revoke_customer_export_copies(new.company_id);
  return new;
end;
$$;

create trigger revoke_exports_on_customer_erasure
  after update of erasure_started_at on public.contacts
  for each row when (new.erasure_started_at is not null and new.erasure_started_at is distinct from old.erasure_started_at)
  execute function public.revoke_exports_on_customer_erasure();

create or replace function public.claim_data_exports(p_limit integer)
returns setof public.data_exports
language sql security definer set search_path = ''
as $$
  with due as (
    select e.id from public.data_exports e
    where e.status in ('pending', 'running')
      and (e.lease_expires_at is null or e.lease_expires_at <= now())
      and (e.kind = 'usage_summary' or not exists (
        select 1 from public.contacts c where c.company_id = e.company_id
          and c.erasure_started_at is not null and c.erasure_completed_at is null
      ))
    order by e.requested_at, e.id
    limit least(greatest(p_limit, 1), 3)
    for update skip locked
  )
  update public.data_exports as export
    set status = 'running',
        started_at = coalesce(export.started_at, now()),
        storage_prefix = coalesce(export.storage_prefix, export.company_id::text || '/' || export.id::text),
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + interval '20 minutes'
    from due where export.id = due.id
    returning export.*;
$$;

create function public.api_customer_erasure_exports(p_company uuid, p_contact uuid, p_limit integer)
returns table (id uuid, storage_prefix text, removable boolean)
language plpgsql security definer set search_path = ''
as $$
begin
  if public.is_on_legal_hold(p_company) or not exists (
    select 1 from public.contacts c join public.companies co on co.id = c.company_id
    where c.company_id = p_company and c.id = p_contact and co.deleted_at is null
      and c.erasure_started_at is not null and c.erasure_completed_at is null
  ) then
    return;
  end if;

  perform public.revoke_customer_export_copies(p_company);
  return query
    select e.id, e.storage_prefix, e.expires_at <= now()
    from public.data_exports e
    where e.company_id = p_company and e.erasure_revoked_at is not null and e.reaped_at is null
    order by e.expires_at, e.id limit least(greatest(p_limit, 1), 5);
end;
$$;

create function public.require_customer_export_erasure()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (
    select 1 from public.data_exports e
    where e.company_id = new.company_id and e.reaped_at is null
      and e.kind in ('workspace', 'conversation_history', 'tasks') and e.storage_prefix is not null
  ) then
    raise exception 'Cannot finish erasure until archived exports are removed';
  end if;
  return new;
end;
$$;

create trigger require_customer_export_erasure
  before update of erasure_completed_at on public.contacts
  for each row when (old.erasure_completed_at is null and new.erasure_completed_at is not null)
  execute function public.require_customer_export_erasure();

revoke execute on function public.revoke_customer_export_copies(uuid),
  public.revoke_exports_on_customer_erasure(), public.require_customer_export_erasure(),
  public.api_customer_erasure_exports(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.api_customer_erasure_exports(uuid, uuid, integer) to service_role;
