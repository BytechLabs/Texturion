-- [#240] Attachment previews — assertion suite for
-- supabase/migrations/20260804480000_attachment_previews.sql.
--
-- A note attachment is 25 MB and a thread re-fetches it on every scroll. The
-- fix is a second, small object under the same row — which means two things
-- that already exist have to learn about it: the sweep that deletes objects
-- nothing points at, and the sums that say what a workspace costs.
--
-- One transaction, rolled back. Fixtures use an 'ap' id prefix.

\set ON_ERROR_STOP on

begin;

insert into auth.users (id, email) values
  ('ab000000-0000-4000-8000-00000000000a'::uuid, 'preview-owner@test.local');

insert into public.companies
  (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
values
  ('ab000000-0000-4000-8000-0000000000c1'::uuid, 'Preview Co',
   'ab000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());

insert into public.phone_numbers
  (id, company_id, status, provisioning_key, country, number_e164)
values
  ('ab000000-0000-4000-8000-0000000000b1'::uuid,
   'ab000000-0000-4000-8000-0000000000c1'::uuid, 'active', 'ab-key-1', 'US',
   '+14155550801');

insert into public.contacts (id, company_id, phone_e164)
values ('ab000000-0000-4000-8000-0000000000e1'::uuid,
        'ab000000-0000-4000-8000-0000000000c1'::uuid, '+16135558001');

insert into public.conversations (id, company_id, contact_id, phone_number_id, status)
values ('ab000000-0000-4000-8000-0000000000d1'::uuid,
        'ab000000-0000-4000-8000-0000000000c1'::uuid,
        'ab000000-0000-4000-8000-0000000000e1'::uuid,
        'ab000000-0000-4000-8000-0000000000b1'::uuid, 'open');

do $$
declare
  v_co   uuid := 'ab000000-0000-4000-8000-0000000000c1'::uuid;
  v_conv uuid := 'ab000000-0000-4000-8000-0000000000d1'::uuid;
  v_note uuid;
  v_a1   uuid;
  v_a2   uuid;
  v      jsonb;
begin
  insert into public.messages
    (company_id, conversation_id, direction, body, status)
  values (v_co, v_conv, 'note', 'Photos from the roof.', null)
  returning id into v_note;

  -- A 20 MB original with a 180 KB preview beside it.
  insert into public.attachments
    (company_id, owner_type, owner_id, conversation_id, storage_path,
     file_name, content_type, size_bytes, preview_path, preview_bytes)
  values (v_co, 'note', v_note, v_conv, 'ab/original-1.jpg',
          'roof.jpg', 'image/jpeg', 20971520, 'ab/preview-1.jpg', 184320)
  returning id into v_a1;

  -- ==========================================================================
  -- A PREVIEW IS STORAGE, AND STORAGE IS COUNTED.
  --
  -- The D34 abuse tripwire and the #240 cost report both read these sums. A
  -- workspace's bill does not care which of a row's two objects a byte belongs
  -- to, so neither may under-count.
  -- ==========================================================================
  v := public.api_storage_usage(v_co);
  if (v ->> 'attachments_bytes')::bigint is distinct from 20971520 + 184320 then
    raise exception 'the preview must be counted as stored: %', v;
  end if;

  -- ==========================================================================
  -- A NULL ORIGINAL SIZE MUST NOT SWALLOW THE PREVIEW.
  --
  -- `size_bytes` is nullable, `sum()` skips nulls, and `null + 12` is null. So
  -- summing the two COLUMNS and adding the results drops every preview byte on
  -- a row whose original size was never recorded — silently, and only on rows
  -- old or odd enough that nobody is looking.
  -- ==========================================================================
  insert into public.attachments
    (company_id, owner_type, owner_id, conversation_id, storage_path,
     file_name, content_type, size_bytes, preview_path, preview_bytes)
  values (v_co, 'note', v_note, v_conv, 'ab/original-2.jpg',
          'gutter.jpg', 'image/jpeg', null, 'ab/preview-2.jpg', 90000)
  returning id into v_a2;

  v := public.api_storage_usage(v_co);
  if (v ->> 'attachments_bytes')::bigint is distinct from 20971520 + 184320 + 90000 then
    raise exception 'a null original size must not lose the preview: %', v;
  end if;

  -- …and the same row ALONE, which is the case that actually distinguishes the
  -- two spellings. Mixed with a sized row, `sum(size_bytes)` is a number and
  -- the wrong version still adds up; it is a workspace whose every original
  -- size is null that returns null and loses the lot. Asserted on its own
  -- company because that is the only way to isolate it.
  insert into public.companies
    (id, name, owner_user_id, country, requested_area_code, aup_accepted_at)
  values ('ab000000-0000-4000-8000-0000000000c2'::uuid, 'Null Sizes Co',
          'ab000000-0000-4000-8000-00000000000a'::uuid, 'US', '415', now());
  insert into public.attachments
    (company_id, owner_type, owner_id, conversation_id, storage_path,
     file_name, content_type, size_bytes, preview_path, preview_bytes)
  values ('ab000000-0000-4000-8000-0000000000c2'::uuid, 'note', v_note, null,
          'ab/original-3.jpg', 'sill.jpg', 'image/jpeg', null,
          'ab/preview-3.jpg', 45000);

  v := public.api_storage_usage('ab000000-0000-4000-8000-0000000000c2'::uuid);
  if (v ->> 'attachments_bytes')::bigint is distinct from 45000 then
    raise exception
      'a workspace whose originals are all unsized still stores its previews: %',
      v;
  end if;
  if (select stored_bytes from public.api_storage_fleet(30, 200)
       where company_id = 'ab000000-0000-4000-8000-0000000000c2'::uuid) is distinct from 45000 then
    raise exception 'the fleet report loses the same bytes';
  end if;

  -- The fleet report reads the same rows and must agree with the per-company
  -- number, or the two surfaces tell an owner and ops different things.
  if (select stored_bytes from public.api_storage_fleet(30, 200)
       where company_id = v_co) is distinct from 20971520 + 184320 + 90000 then
    raise exception 'the fleet report disagrees with the company usage read';
  end if;
  -- Added-in-window is the same rows, so it carries the previews too.
  if (select added_bytes from public.api_storage_fleet(30, 200)
       where company_id = v_co) is distinct from 20971520 + 184320 + 90000 then
    raise exception 'the growth figure must count previews too';
  end if;

  -- ==========================================================================
  -- A SOFT-DELETED ROW STOPS COUNTING, BOTH OBJECTS AT ONCE.
  -- ==========================================================================
  update public.attachments set deleted_at = now() where id = v_a2;
  v := public.api_storage_usage(v_co);
  if (v ->> 'attachments_bytes')::bigint is distinct from 20971520 + 184320 then
    raise exception 'a deleted row must take its preview with it: %', v;
  end if;

  raise notice 'attachment previews (#240): storage accounting assertions passed';
end $$;

-- ---------------------------------------------------------------------------
-- THE ORPHAN SWEEP MUST NOT EAT THE PREVIEW.
--
-- #15's pass 2 removes any object in the bucket that no `attachments` row
-- points at, which is the right rule when one row means one object. A preview
-- is a second object under one row: without the `or a.preview_path = o.name`
-- arm it is swept the moment it ages past the cutoff, and the failure shows up
-- as thread images that quietly stop loading on old conversations.
do $$
declare
  v_co  uuid := 'ab000000-0000-4000-8000-0000000000c1'::uuid;
  v_old timestamptz := now() - interval '2 days';
  v_orphans text[];
begin
  -- Storage rows for the two objects of the live attachment, plus one that
  -- really is an orphan, all older than the cutoff.
  insert into storage.buckets (id, name)
  values ('attachments', 'attachments')
  on conflict (id) do nothing;

  insert into storage.objects (bucket_id, name, created_at)
  values
    ('attachments', 'ab/original-1.jpg', v_old),
    ('attachments', 'ab/preview-1.jpg', v_old),
    ('attachments', 'ab/nobody-claims-this.jpg', v_old);

  select array_agg(o order by o)
    into v_orphans
    from public.api_orphan_attachment_objects(now() - interval '1 hour', 100) as o;

  if v_orphans is distinct from array['ab/nobody-claims-this.jpg'] then
    raise exception
      'the sweep must claim the preview and only sweep the real orphan: %',
      v_orphans;
  end if;

  raise notice 'attachment previews (#240): the sweep spares the preview';
end $$;

-- Service-role only, like every other api_* function these amend.
do $$
begin
  if has_function_privilege('authenticated', 'public.api_storage_usage(uuid)', 'execute')
     or has_function_privilege('anon', 'public.api_orphan_attachment_objects(timestamptz, int)', 'execute')
     or has_function_privilege('authenticated', 'public.api_storage_fleet(int, int)', 'execute') then
    raise exception 'the amended storage functions must stay service_role only';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- [#240 item 3] THE SAME FILE, STORED ONCE — and never taken from under a row
-- that is still using it.
do $$
declare
  v_co   uuid := 'ab000000-0000-4000-8000-0000000000c1'::uuid;
  v_co2  uuid := 'ab000000-0000-4000-8000-0000000000c2'::uuid;
  v_conv uuid := 'ab000000-0000-4000-8000-0000000000d1'::uuid;
  v_note uuid;
  v      jsonb;
  v_used text[];
begin
  select id into v_note from public.messages
   where company_id = v_co and direction = 'note' limit 1;

  insert into public.attachments
    (company_id, owner_type, owner_id, conversation_id, storage_path,
     file_name, content_type, size_bytes, preview_path, preview_bytes,
     content_sha256)
  values (v_co, 'note', v_note, v_conv, 'ab/shared.pdf', 'spec.pdf',
          'application/pdf', 5000000, null, null, repeat('a', 64));

  -- A second upload of the same bytes finds the first.
  v := public.api_attachment_by_content(v_co, repeat('a', 64));
  if v ->> 'storage_path' is distinct from 'ab/shared.pdf' then
    raise exception 'the twin must be found: %', v;
  end if;

  -- ==========================================================================
  -- NEVER ACROSS TENANTS.
  --
  -- Cross-company dedup would save more and would have one workspace's row
  -- serving bytes another uploaded. A bug near the reference counting would
  -- then be a data leak rather than a broken image.
  -- ==========================================================================
  if public.api_attachment_by_content(v_co2, repeat('a', 64)) is not null then
    raise exception 'another company must never match these bytes';
  end if;

  -- A soft-deleted row is not a candidate: it is on its way to the sweep, and
  -- pointing a new upload at an object about to be reclaimed is the worst
  -- possible saving.
  update public.attachments set deleted_at = now() where storage_path = 'ab/shared.pdf';
  if public.api_attachment_by_content(v_co, repeat('a', 64)) is not null then
    raise exception 'a soft-deleted row must not be shared with';
  end if;
  update public.attachments set deleted_at = null where storage_path = 'ab/shared.pdf';

  -- ==========================================================================
  -- THE DELETION RULE.
  --
  -- Two rows, one object. Deleting one must not take the bytes the other is
  -- rendering — the failure arrives weeks later, from a customer, as "the app
  -- lost my picture".
  -- ==========================================================================
  insert into public.attachments
    (company_id, owner_type, owner_id, conversation_id, storage_path,
     file_name, content_type, size_bytes, content_sha256, deleted_at)
  values (v_co, 'note', v_note, v_conv, 'ab/shared.pdf', 'spec-again.pdf',
          'application/pdf', 5000000, repeat('a', 64), now());

  select array_agg(p order by p) into v_used
    from public.api_attachment_paths_in_use(
      array['ab/shared.pdf', 'ab/nobody-else.pdf']
    ) as p;
  if v_used is distinct from array['ab/shared.pdf'] then
    raise exception 'the shared object must read as in use: %', v_used;
  end if;

  -- And a row's PREVIEW counts as a reference too — dedup reuses the pair.
  select array_agg(p order by p) into v_used
    from public.api_attachment_paths_in_use(array['ab/preview-1.jpg']) as p;
  if v_used is distinct from array['ab/preview-1.jpg'] then
    raise exception 'a live preview must read as in use: %', v_used;
  end if;

  raise notice 'attachment dedup (#240): assertions passed';
end $$;

-- Service-role only, like every other api_* function here.
do $$
begin
  if has_function_privilege('authenticated', 'public.api_attachment_by_content(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.api_attachment_paths_in_use(text[])', 'execute') then
    raise exception 'the dedup functions must stay service_role only';
  end if;
end $$;

rollback;
