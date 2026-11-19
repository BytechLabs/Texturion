alter table public.data_exports
  add column lease_token uuid,
  add column lease_expires_at timestamptz,
  add column stored_files jsonb;

create index data_exports_claim_idx on public.data_exports (requested_at, id)
  where status in ('pending', 'running');

create function public.claim_data_exports(p_limit integer)
returns setof public.data_exports
language sql security definer set search_path = ''
as $$
  with due as (
    select id from public.data_exports
    where status in ('pending', 'running')
      and (lease_expires_at is null or lease_expires_at <= now())
    order by requested_at, id
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

revoke execute on function public.claim_data_exports(integer) from public, anon, authenticated;
grant execute on function public.claim_data_exports(integer) to service_role;
