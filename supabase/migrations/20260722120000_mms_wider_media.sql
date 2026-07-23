-- #189: MMS beyond images.
--
-- The mms-media bucket's allowed_mime_types was pinned to the four image
-- types (20260701001000_mms_storage.sql) while carriers genuinely deliver
-- audio, video, vCard, calendar, PDF, and plain text. Widen the bucket to the
-- canonical deliverable set — the SAME list the API enforces at both ingress
-- points (packages/shared/src/mms.ts MMS_OUTBOUND_MEDIA_TYPES; outbound gate
-- in apps/api/src/messaging/media.ts, inbound gate in messaging/inbound.ts).
-- The bucket stays the hard ceiling; the API remains the 4xx-shaped gate.
--
-- Unchanged on purpose:
--   * file_size_limit stays 5 MB (inbound bound; outbound is API-capped at
--     1 MB per item, the practical carrier limit).
--   * private + zero storage.objects policies (service-role only) — asserted
--     by 20260701001000_mms_storage.sql and re-asserted here.
update storage.buckets
set allowed_mime_types = array[
  'image/jpeg','image/png','image/gif','image/webp',
  'audio/mpeg','audio/mp4','audio/amr','audio/wav','audio/ogg','audio/3gpp',
  'video/mp4','video/3gpp','video/quicktime',
  'application/pdf','text/vcard','text/x-vcard','text/calendar','text/plain'
]
where id = 'mms-media';

-- Re-assert the service-role-only posture after touching the bucket row.
do $$
declare
  bad_policies text;
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'mms-media' and public = false and file_size_limit = 5242880
  ) then
    raise exception 'mms-media must stay private with the 5 MB file limit';
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
