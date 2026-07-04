-- ===========================================================================
-- D30 storage accounting — the exact per-company stored-bytes sums behind
--   (a) the POST /v1/attachments budget gate (Starter 5 GB / Pro 25 GB over
--       LIVE generic attachments), and
--   (b) the GET /v1/usage `storage` arm (generic attachments + MMS media, so
--       an owner sees storage the way they see segments).
--
-- One function, api_storage_usage(p_company_id) → jsonb
--   { attachments_bytes, mms_bytes }
--   - attachments_bytes: sum(size_bytes) of LIVE rows in public.attachments
--     (deleted_at IS NULL — soft-deleted rows are already queued for the D19
--     sweep and no longer count against the budget);
--   - mms_bytes: sum(size_bytes) of public.message_attachments (display-only:
--     inbound MMS is customer content and is NEVER blocked on a budget — D30
--     bounds it per message instead).
--
-- Exact sums live in SQL (same reason as api_period_segments): a plain
-- PostgREST read would truncate at the row cap. Same security posture as
-- every api_* function: SECURITY DEFINER, empty search_path, EXECUTE revoked
-- from end-user roles — only service_role (the Worker's sb_secret_ key).
-- ===========================================================================

-- message_attachments has no company_id index (the gallery joins via
-- message_id); the D30 per-company sum needs one so the usage read never
-- seq-scans a table that grows with every tenant's media.
create index if not exists message_attachments_company_id_idx
  on public.message_attachments (company_id);

create or replace function public.api_storage_usage(
  p_company_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'attachments_bytes', coalesce((
      select sum(a.size_bytes)
      from public.attachments a
      where a.company_id = p_company_id
        and a.deleted_at is null
    ), 0)::bigint,
    'mms_bytes', coalesce((
      select sum(m.size_bytes)
      from public.message_attachments m
      where m.company_id = p_company_id
    ), 0)::bigint
  )
$$;

revoke execute on function public.api_storage_usage(uuid)
  from public, anon, authenticated;
grant execute on function public.api_storage_usage(uuid)
  to service_role;
