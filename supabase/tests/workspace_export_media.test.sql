begin;

insert into auth.users (id, email)
values ('8f000000-0000-4000-8000-00000000000c', 'export-media@test.local');

insert into public.companies (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('8f000000-0000-4000-8000-0000000000d3', 'Media HVAC',
   '8f000000-0000-4000-8000-00000000000c', 'US', '415', now()),
  ('8f000000-0000-4000-8000-0000000000d4', 'Other HVAC',
   '8f000000-0000-4000-8000-00000000000c', 'US', '415', now());

insert into public.phone_numbers (id, company_id, status, provisioning_key, country, number_e164)
values
  ('8f000000-0000-4000-8000-0000000000e3', '8f000000-0000-4000-8000-0000000000d3',
   'active', 'export-media-line', 'US', '+14155550167'),
  ('8f000000-0000-4000-8000-0000000000e4', '8f000000-0000-4000-8000-0000000000d4',
   'active', 'export-media-other', 'US', '+14155550168');

insert into public.calls
  (company_id, phone_number_id, call_session_id, outcome, created_at, voicemail_path, voicemail_deleted_at)
values
  ('8f000000-0000-4000-8000-0000000000d3', '8f000000-0000-4000-8000-0000000000e3',
   'export-media-good', 'voicemail', now() - interval '1 hour', 'media/good.mp3', null),
  ('8f000000-0000-4000-8000-0000000000d3', '8f000000-0000-4000-8000-0000000000e3',
   'export-media-deleted', 'voicemail', now() - interval '1 hour', 'media/deleted.mp3', now()),
  ('8f000000-0000-4000-8000-0000000000d3', '8f000000-0000-4000-8000-0000000000e3',
   'export-media-after', 'voicemail', now(), 'media/after.mp3', null),
  ('8f000000-0000-4000-8000-0000000000d4', '8f000000-0000-4000-8000-0000000000e4',
   'export-media-other', 'voicemail', now() - interval '1 hour', 'media/other.mp3', null);

do $$
declare
  company constant uuid := '8f000000-0000-4000-8000-0000000000d3';
  line constant uuid := '8f000000-0000-4000-8000-0000000000e3';
  cutoff constant timestamptz := now() - interval '30 minutes';
  paths text[];
begin
  select array_agg(storage_path) into paths from public.api_workspace_export_media(
    company, cutoff, 'voicemail', null, null, 10, '{}'
  );
  if paths is distinct from array['media/good.mp3'] then
    raise exception 'export file list leaked omitted files: %', paths;
  end if;

  if exists (select from public.api_workspace_export_media(company, cutoff, 'voicemail', null, null, 10, array[line])) then
    raise exception 'export file list leaked a hidden number';
  end if;
end
$$;

rollback;
