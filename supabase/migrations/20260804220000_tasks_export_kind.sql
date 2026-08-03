-- #304 — the last kind: the work itself.
--
-- Scheduled work is a reporting axis too, and it is the one that looks like
-- internal admin and is not. Every task hangs off a conversation (D17: a task
-- promotes a real message), so a row names a customer, quotes what they asked
-- for, and says who was sent. That is customer data wearing a project-
-- management hat, and the export inherits the history export's rules rather
-- than the usage export's: `contacts.bulk` to ask for it, and #106 number
-- access resolved at build time.
--
-- Both gates again, because the check constraint is not the only one:
-- request_data_export raises on a kind it does not know.

alter table public.data_exports
  drop constraint if exists data_exports_kind_check;

alter table public.data_exports
  add constraint data_exports_kind_check
  check (kind in ('workspace', 'conversation_history', 'usage_summary', 'tasks'));

create or replace function public.request_data_export(
  p_company_id uuid,
  p_user_id    uuid,
  p_ttl        interval default interval '7 days',
  -- Defaulted, so the #227 call site is unchanged and still means the dump.
  p_kind       text default 'workspace',
  p_filters    jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing uuid;
  v_id uuid;
begin
  if p_kind not in ('workspace', 'conversation_history', 'usage_summary',
                    'tasks') then
    raise exception 'request_data_export: unknown kind %', p_kind;
  end if;

  -- Serialize per company AND KIND, so two clicks cannot both see "nothing in
  -- flight" while an urgent scoped export still gets past a running dump.
  perform pg_advisory_xact_lock(
    hashtext('data_export:' || p_company_id::text || ':' || p_kind)
  );

  select id into v_existing
    from public.data_exports
   where company_id = p_company_id
     and kind = p_kind
     and status in ('pending', 'running')
   order by requested_at
   limit 1;
  if v_existing is not null then
    return jsonb_build_object('outcome', 'in_flight', 'export_id', v_existing);
  end if;

  insert into public.data_exports
    (company_id, requested_by, expires_at, kind, filters)
  values
    (p_company_id, p_user_id, now() + p_ttl, p_kind, coalesce(p_filters, '{}'::jsonb))
  returning id into v_id;

  return jsonb_build_object('outcome', 'queued', 'export_id', v_id);
end $$;
