-- D19 / APP-FEATURES-V2 §2.2–§2.4 — Storage bucket for note & task attachments.
--
-- ONE private, company-scoped bucket `attachments`, deliberately DISTINCT from
-- `mms-media` so its MIME/size limits differ (mms-media is image-only ≤5 MB;
-- this bucket is 25 MB and accepts the realistic tradesperson doc set). Path is
-- `attachments/{company_id}/{owner_type}/{owner_id}/{uuid}-{safe_filename}` with
-- company_id as the leading segment under the bucket, so a single RLS predicate
-- authorizes the whole tenant tree (D19). Uploads are Worker-mediated with the
-- sb_secret_ key (small files streamed; large via createSignedUploadUrl) — the
-- browser never writes Storage directly (D8).
--
-- Limits (D19 / APP-FEATURES-V2 §2.4):
--   file_size_limit = 25 MB (26214400 bytes) — supersedes the earlier 10 MB.
--   allowed_mime_types = images, PDF, Office/OpenDocument, text/plain, text/csv,
--     ZIP. Executables/scripts are rejected at the API before signing (D19); the
--     bucket allow-list is the belt-and-suspenders second gate.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  26214400,                                          -- 25 MB (25 * 1024 * 1024)
  array[
    -- images (a photo of a part)
    'image/jpeg','image/png','image/gif','image/webp','image/heic','image/heif',
    -- PDF (a quote / spec sheet)
    'application/pdf',
    -- Microsoft Office
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    -- OpenDocument
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',
    -- plain text / CSV
    'text/plain','text/csv',
    -- archives
    'application/zip'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- storage.objects RLS posture (SPEC §6 / D8): the bucket is private and there
-- are NO storage.objects policies for end-user roles — deny-by-default RLS means
-- only the service role (BYPASSRLS, the Worker's sb_secret_ key) can read/write
-- objects; the API mints short-lived signed URLs after membership checks. (D19
-- describes an OPTIONAL defense-in-depth authenticated policy pinned to company
-- = path-segment-2; it is NOT added here because, exactly as with mms-media, no
-- authenticated grant/policy on storage.objects exists at all — the stronger
-- posture. If a future migration ever widens authenticated access, that policy
-- becomes the belt-and-suspenders gate.)
--
-- storage.objects is owned by supabase_storage_admin (migrations run as postgres
-- and cannot ALTER it), so the posture is ASSERTED: fail loudly if RLS is ever
-- off, or if an `attachments` end-user object policy has appeared. Mirrors the
-- mms-media assertion in 20260701001000_mms_storage.sql.
do $$
declare
  bad_policies text;
begin
  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity
  ) then
    raise exception 'storage.objects must have row level security enabled';
  end if;

  select string_agg(policyname, ', ') into bad_policies
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and (qual like '%bucket_id = ''attachments''%'
         or with_check like '%bucket_id = ''attachments''%'
         or qual like '%''attachments''%' or with_check like '%''attachments''%');
  if bad_policies is not null then
    raise exception
      'attachments bucket must have no storage.objects end-user policies (service-role only), found: %',
      bad_policies;
  end if;
end $$;
