-- #304 — the bookkeeper's kind.
--
-- A third export joins the two that already share this queue, this bucket,
-- this reaper and this failure path. The per-kind advisory lock from
-- 20260804160000 means it does not wait behind a full workspace dump, and a
-- full dump does not wait behind it.
--
-- WHAT THIS EXPORT IS, AND IS NOT. It reports what we METERED in a window —
-- segments, minutes, and how much of that has been handed to Stripe. It prices
-- nothing, and the reason is in the schema rather than in anybody's judgement:
-- `companies.plan` records the plan in force NOW and there is no plan history
-- anywhere in this database. Pricing a period that has already closed would
-- mean applying today's plan to a month the workspace may have been on a
-- different one, and a bookkeeper who ties out to that number makes decisions
-- on it. Counts are what the invoice cannot already tell them; money is what
-- it already does.

alter table public.data_exports
  drop constraint if exists data_exports_kind_check;

alter table public.data_exports
  add constraint data_exports_kind_check
  check (kind in ('workspace', 'conversation_history', 'usage_summary'));

comment on column public.data_exports.kind is
  'What was asked for. ''workspace'' is the #227 privacy dump (everything). '
  '''conversation_history'' is one customer''s correspondence for an insurer '
  'or a lawyer. ''usage_summary'' is what a bookkeeper needs beside the Stripe '
  'invoice: metered counts for a window, and how much of it Stripe has been '
  'told about. The kind alone does not answer "what did somebody take" — '
  '`filters` carries that (#276).';

-- The constraint is not the only gate: request_data_export validates the kind
-- itself and raises on anything it does not know. Widening one without the
-- other produces a table that accepts the row and an RPC that refuses to write
-- it — which is the honest failure, but only because somebody wrote a test.
-- Re-created verbatim from 20260804160000 with the list widened.

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
  if p_kind not in ('workspace', 'conversation_history', 'usage_summary') then
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
