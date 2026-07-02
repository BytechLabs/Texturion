-- SPEC §3, §6 — Storage for MMS media (messaging track).
--
-- The `mms-media` bucket row was created (private, 5 MB limit) in the RLS
-- migration; this migration pins its full configuration: the allowed image
-- MIME types for MMS attachments in both directions (outbound sends are
-- further restricted to jpeg/png/gif ≤1 MB at the API layer, SPEC §7; inbound
-- accepts what carriers commonly deliver for pictures).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mms-media',
  'mms-media',
  false,
  5242880,
  array['image/jpeg','image/png','image/gif','image/webp']
)
on conflict (id) do update
  set public            = excluded.public,
      file_size_limit   = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- storage.objects RLS posture (SPEC §6): the bucket is private and there are
-- NO storage policies for end users — deny-by-default RLS means only the
-- service role (BYPASSRLS, the Worker's sb_secret_ key) can read or write
-- objects. The API mints short-lived signed URLs after membership checks.
-- storage.objects is owned by supabase_storage_admin (migrations run as
-- postgres and cannot ALTER it), so the required posture is ASSERTED: the
-- migration fails loudly if RLS is ever off or an mms-media object policy
-- has appeared for end-user roles.
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
    and (qual like '%mms-media%' or with_check like '%mms-media%');
  if bad_policies is not null then
    raise exception 'mms-media must have no storage.objects policies (service-role only), found: %',
      bad_policies;
  end if;
end $$;
