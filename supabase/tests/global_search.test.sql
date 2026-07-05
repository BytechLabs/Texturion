-- Loonext global-search assertion suite (D29 — migration
-- 20260704020000_global_search.sql): trigram indexes for the new arms,
-- api_search_v2 privilege posture, and every arm company-scoped with the
-- promised hit shapes (note direction on conversation hits, derived task
-- done, fuzzy description/filename matching, template snippet).
-- psql-runnable: every test is a DO block that RAISEs EXCEPTION on failure.
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/global_search.test.sql
-- The whole suite runs in one transaction and ROLLS BACK: it never pollutes
-- the local database.

\set ON_ERROR_STOP on

begin;

-- ===========================================================================
-- G1. Indexes: the five trigram GIN indexes exist; the tasks/attachments
--     ones are partial on the live-row predicate (deleted_at IS NULL);
--     templates has no soft-delete, so its indexes are full.
-- ===========================================================================
do $$
declare
  bad text := '';
  def text;
begin
  for def in
    select x.tbl || '.' || x.name
    from (values ('tasks', 'tasks_title_trgm'),
                 ('tasks', 'tasks_description_trgm'),
                 ('attachments', 'attachments_file_name_trgm'),
                 ('templates', 'templates_name_trgm'),
                 ('templates', 'templates_body_trgm')) as x(tbl, name)
    where not exists (select 1 from pg_indexes
      where schemaname = 'public' and tablename = x.tbl and indexname = x.name)
  loop
    bad := bad || ' missing:' || def;
  end loop;

  for def in
    select x.name
    from (values ('tasks_title_trgm'), ('tasks_description_trgm'),
                 ('attachments_file_name_trgm')) as x(name)
    where not exists (select 1 from pg_indexes
      where schemaname = 'public' and indexname = x.name
        and indexdef ilike '%using gin%'
        and indexdef ilike '%gin_trgm_ops%'
        and indexdef ilike '%WHERE (deleted_at IS NULL)%')
  loop
    bad := bad || ' not-partial-trgm-gin:' || def;
  end loop;

  for def in
    select x.name
    from (values ('templates_name_trgm'), ('templates_body_trgm')) as x(name)
    where not exists (select 1 from pg_indexes
      where schemaname = 'public' and indexname = x.name
        and indexdef ilike '%using gin%'
        and indexdef ilike '%gin_trgm_ops%'
        and indexdef not ilike '%WHERE%')
  loop
    bad := bad || ' template-index-wrong:' || def;
  end loop;

  if bad <> '' then
    raise exception 'G1 FAILED:%', bad;
  end if;
  raise notice 'G1 PASSED: trigram GIN indexes exist with the right predicates';
end $$;

-- ===========================================================================
-- G2. Privileges: api_search_v2 is service-role-only (deny-by-default,
--     SPEC §6) — anon/authenticated cannot execute it.
-- ===========================================================================
do $$
declare
  foid oid := 'public.api_search_v2(uuid, text, int, int, int, int, int, timestamptz, uuid)'::regprocedure;
begin
  if has_function_privilege('anon', foid, 'execute') then
    raise exception 'G2 FAILED: anon can execute api_search_v2';
  end if;
  if has_function_privilege('authenticated', foid, 'execute') then
    raise exception 'G2 FAILED: authenticated can execute api_search_v2';
  end if;
  if not has_function_privilege('service_role', foid, 'execute') then
    raise exception 'G2 FAILED: service_role cannot execute api_search_v2';
  end if;
  raise notice 'G2 PASSED: api_search_v2 executable by service_role only';
end $$;

-- ===========================================================================
-- Shared fixtures: TWO companies (isolation), each with a conversation,
-- messages (inbound + note), tasks (live open / live done via the source
-- message's done_at / soft-deleted), note attachments (live + soft-deleted),
-- and a template.
-- ===========================================================================
do $$
declare
  owner_id uuid := '31111111-1111-4111-8111-111111111111';
  cid_a uuid; cid_b uuid;
  num_a uuid; num_b uuid;
  ct_a uuid; ct_b uuid;
  cv_a uuid; cv_b uuid;
  m_a1 uuid; m_a2 uuid; m_a3 uuid;  -- inbound / note / inbound(done source)
  m_b1 uuid; m_b2 uuid;             -- inbound / note
  t_a1 uuid; t_a2 uuid;             -- open task / done task (t_a3 is soft-deleted)
  t_b1 uuid;
  at_a1 uuid; at_b1 uuid;           -- live note attachments (at_a2 soft-deleted)
  tpl_a uuid; tpl_b uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (owner_id, 'owner@globalsearch.test', '{"display_name":"GS Owner"}'::jsonb);

  cid_a := (public.api_create_company(owner_id, 'Search Co A', 'US', '212', true)->>'id')::uuid;
  cid_b := (public.api_create_company(owner_id, 'Search Co B', 'US', '415', true)->>'id')::uuid;

  insert into public.phone_numbers (company_id, status, provisioning_key, country, number_e164)
  values (cid_a, 'active', 'gs-key-a', 'US', '+12125551000') returning id into num_a;
  insert into public.phone_numbers (company_id, status, provisioning_key, country, number_e164)
  values (cid_b, 'active', 'gs-key-b', 'US', '+14155551000') returning id into num_b;

  insert into public.contacts (company_id, phone_e164, name)
  values (cid_a, '+14165550201', 'Pat Rivera') returning id into ct_a;
  insert into public.contacts (company_id, phone_e164, name)
  values (cid_b, '+14165550301', 'Sam Bravo') returning id into ct_b;

  insert into public.conversations
    (company_id, contact_id, phone_number_id, status, last_message_at)
  values (cid_a, ct_a, num_a, 'open', '2026-07-03T12:10:00Z') returning id into cv_a;
  insert into public.conversations
    (company_id, contact_id, phone_number_id, status, last_message_at)
  values (cid_b, ct_b, num_b, 'open', '2026-07-03T12:00:00Z') returning id into cv_b;

  -- Company A messages: an inbound text, a NOTE (direction='note', status
  -- null — the messages_note_status constraint), and a second inbound that
  -- becomes the done task's source.
  insert into public.messages (company_id, conversation_id, direction, body, status, created_at)
  values (cid_a, cv_a, 'inbound', 'Please send the invoice for the deck job', 'received',
          '2026-07-03T12:00:00Z') returning id into m_a1;
  insert into public.messages (company_id, conversation_id, direction, body, status, sent_by_user_id, created_at)
  values (cid_a, cv_a, 'note', 'Customer prefers morning gutter visits', null, owner_id,
          '2026-07-03T12:05:00Z') returning id into m_a2;
  insert into public.messages (company_id, conversation_id, direction, body, status, created_at)
  values (cid_a, cv_a, 'inbound', 'Thanks again for the spring cleanup', 'received',
          '2026-07-03T12:10:00Z') returning id into m_a3;

  -- Company B messages: same searchable words as A — isolation must be by
  -- company_id, not by luck of vocabulary.
  insert into public.messages (company_id, conversation_id, direction, body, status, created_at)
  values (cid_b, cv_b, 'inbound', 'Please send the invoice for the patio job', 'received',
          '2026-07-03T12:00:00Z') returning id into m_b1;
  insert into public.messages (company_id, conversation_id, direction, body, status, sent_by_user_id, created_at)
  values (cid_b, cv_b, 'note', 'B-side note', null, owner_id,
          '2026-07-03T12:01:00Z') returning id into m_b2;

  -- Tasks. Completion DERIVES from the source message's done_at (D17):
  -- t_a2's source message is marked done below; t_a1 stays open. t_a3 shares
  -- t_a1's message (allowed: the partial-unique counts live rows only) and is
  -- soft-deleted — it must never surface.
  insert into public.tasks (company_id, message_id, conversation_id, title, description, created_by_user_id, created_at)
  values (cid_a, m_a1, cv_a, 'Send the invoice', 'Replace the busted furnace filter first', owner_id,
          '2026-07-03T13:00:00Z') returning id into t_a1;
  insert into public.tasks (company_id, message_id, conversation_id, title, description, created_by_user_id, created_at)
  values (cid_a, m_a3, cv_a, 'Schedule spring cleanup', '', owner_id,
          '2026-07-03T13:05:00Z') returning id into t_a2;
  insert into public.tasks (company_id, message_id, conversation_id, title, description, created_by_user_id, created_at, deleted_at)
  values (cid_a, m_a1, cv_a, 'Send the invoice reminder', '', owner_id,
          '2026-07-03T13:10:00Z', now());
  insert into public.tasks (company_id, message_id, conversation_id, title, description, created_by_user_id)
  values (cid_b, m_b1, cv_b, 'Send the invoice', '', owner_id) returning id into t_b1;

  update public.messages set done_at = now(), done_by_user_id = owner_id where id = m_a3;

  -- Note-borne attachments (D19 generic table): one live, one soft-deleted.
  insert into public.attachments
    (company_id, owner_type, owner_id, conversation_id, storage_path, file_name, content_type, size_bytes, uploaded_by_user_id)
  values (cid_a, 'note', m_a2, cv_a,
          'attachments/' || cid_a || '/note/' || m_a2 || '/x-invoice.pdf',
          'invoice.pdf', 'application/pdf', 1234, owner_id)
  returning id into at_a1;
  insert into public.attachments
    (company_id, owner_type, owner_id, conversation_id, storage_path, file_name, content_type, size_bytes, uploaded_by_user_id, deleted_at)
  values (cid_a, 'note', m_a2, cv_a,
          'attachments/' || cid_a || '/note/' || m_a2 || '/x-invoice-old.pdf',
          'invoice-old.pdf', 'application/pdf', 1234, owner_id, now());
  insert into public.attachments
    (company_id, owner_type, owner_id, conversation_id, storage_path, file_name, content_type, size_bytes, uploaded_by_user_id)
  values (cid_b, 'note', m_b2, cv_b,
          'attachments/' || cid_b || '/note/' || m_b2 || '/x-invoice.pdf',
          'invoice.pdf', 'application/pdf', 1234, owner_id)
  returning id into at_b1;

  insert into public.templates (company_id, name, body, created_by)
  values (cid_a, 'Quote follow-up',
          'Hey there, just checking in on the quote we sent over. Any questions?', owner_id)
  returning id into tpl_a;
  insert into public.templates (company_id, name, body, created_by)
  values (cid_b, 'Quote follow-up', 'Invoice attached for your records.', owner_id)
  returning id into tpl_b;

  create temporary table gs_fixture as
  select cid_a, cid_b, cv_a, cv_b, m_a1, m_a2, t_a1, t_a2, t_b1,
         at_a1, at_b1, tpl_a, tpl_b;
end $$;

-- ===========================================================================
-- G3. Conversations arm: hits now expose the matched message's `direction`
--     — an inbound hit says 'inbound'; a note-only match says 'note' (so the
--     palette can label notes). Snippets stay highlighted.
-- ===========================================================================
do $$
declare
  f record;
  r jsonb;
begin
  select * into f from gs_fixture;

  r := public.api_search_v2(f.cid_a, 'invoice', 10, 10, 10, 10, 10);
  if jsonb_array_length(r->'conversations') <> 1
     or (r->'conversations'->0->>'id')::uuid <> f.cv_a then
    raise exception 'G3 FAILED: invoice conversation hit wrong: %', r->'conversations';
  end if;
  if r->'conversations'->0->>'direction' <> 'inbound' then
    raise exception 'G3 FAILED: inbound hit direction wrong: %',
      r->'conversations'->0->>'direction';
  end if;
  if (r->'conversations'->0->>'matched_message_id')::uuid <> f.m_a1 then
    raise exception 'G3 FAILED: wrong matched message';
  end if;

  -- 'gutter' lives only in the note — the hit must be labeled direction='note'.
  r := public.api_search_v2(f.cid_a, 'gutter', 10, 10, 10, 10, 10);
  if jsonb_array_length(r->'conversations') <> 1
     or r->'conversations'->0->>'direction' <> 'note'
     or (r->'conversations'->0->>'matched_message_id')::uuid <> f.m_a2 then
    raise exception 'G3 FAILED: note hit not exposed as direction=note: %',
      r->'conversations';
  end if;
  if r->'conversations'->0->>'snippet' not like '%<b>%' then
    raise exception 'G3 FAILED: snippet not highlighted';
  end if;

  raise notice 'G3 PASSED: conversation hits expose direction (inbound + note)';
end $$;

-- ===========================================================================
-- G4. Tasks arm: live rows only (soft-deleted excluded), title substring
--     match, FUZZY match on the description (trigram word similarity), and
--     `done` derived from the source message's done_at (D17 join read).
-- ===========================================================================
do $$
declare
  f record;
  r jsonb;
  hit jsonb;
begin
  select * into f from gs_fixture;

  -- Title substring: only the live A task — the soft-deleted 'Send the
  -- invoice reminder' and company B's identical title never surface.
  r := public.api_search_v2(f.cid_a, 'invoice', 10, 10, 10, 10, 10);
  if jsonb_array_length(r->'tasks') <> 1 then
    raise exception 'G4 FAILED: expected 1 task hit, got %', r->'tasks';
  end if;
  hit := r->'tasks'->0;
  if (hit->>'id')::uuid <> f.t_a1
     or hit->>'title' <> 'Send the invoice'
     or (hit->>'conversation_id')::uuid <> f.cv_a
     or (hit->>'done')::boolean is distinct from false
     or (hit->>'matched_at') is null then
    raise exception 'G4 FAILED: task hit shape wrong: %', hit;
  end if;

  -- Fuzzy description: 'furnac' (typo) matches 'furnace' inside the
  -- description via trigram word similarity — no substring, no title match.
  r := public.api_search_v2(f.cid_a, 'furnac', 10, 10, 10, 10, 10);
  if jsonb_array_length(r->'tasks') <> 1
     or (r->'tasks'->0->>'id')::uuid <> f.t_a1 then
    raise exception 'G4 FAILED: fuzzy description match missed: %', r->'tasks';
  end if;

  -- Derived done: t_a2's source message is done → the hit says done=true.
  r := public.api_search_v2(f.cid_a, 'cleanup', 10, 10, 10, 10, 10);
  if jsonb_array_length(r->'tasks') <> 1
     or (r->'tasks'->0->>'id')::uuid <> f.t_a2
     or (r->'tasks'->0->>'done')::boolean is distinct from true then
    raise exception 'G4 FAILED: derived done wrong: %', r->'tasks';
  end if;

  raise notice 'G4 PASSED: tasks arm — live-only, fuzzy description, derived done';
end $$;

-- ===========================================================================
-- G5. Attachments arm: fuzzy file_name (misspelled 'invoise' finds
--     invoice.pdf), soft-deleted rows excluded, hit carries owner_type /
--     conversation_id / content_type for the deep link.
-- ===========================================================================
do $$
declare
  f record;
  r jsonb;
  hit jsonb;
begin
  select * into f from gs_fixture;

  r := public.api_search_v2(f.cid_a, 'invoise', 10, 10, 10, 10, 10);
  if jsonb_array_length(r->'attachments') <> 1 then
    raise exception 'G5 FAILED: fuzzy filename expected 1 hit, got %', r->'attachments';
  end if;
  hit := r->'attachments'->0;
  if (hit->>'id')::uuid <> f.at_a1
     or hit->>'file_name' <> 'invoice.pdf'
     or hit->>'owner_type' <> 'note'
     or (hit->>'conversation_id')::uuid <> f.cv_a
     or hit->>'content_type' <> 'application/pdf'
     or (hit->>'created_at') is null then
    raise exception 'G5 FAILED: attachment hit shape wrong: %', hit;
  end if;

  -- Substring match too; still exactly one (the soft-deleted invoice-old.pdf
  -- never surfaces; B''s invoice.pdf is another company).
  r := public.api_search_v2(f.cid_a, 'invoice', 10, 10, 10, 10, 10);
  if jsonb_array_length(r->'attachments') <> 1
     or (r->'attachments'->0->>'id')::uuid <> f.at_a1 then
    raise exception 'G5 FAILED: substring filename match wrong: %', r->'attachments';
  end if;

  raise notice 'G5 PASSED: attachments arm — fuzzy filename, live-only, deep-link fields';
end $$;

-- ===========================================================================
-- G6. Templates arm: name match and body match, each hit carrying a body
--     snippet (left 160 — the list-snippet convention).
-- ===========================================================================
do $$
declare
  f record;
  r jsonb;
begin
  select * into f from gs_fixture;

  r := public.api_search_v2(f.cid_a, 'follow', 10, 10, 10, 10, 10);
  if jsonb_array_length(r->'templates') <> 1
     or (r->'templates'->0->>'id')::uuid <> f.tpl_a
     or r->'templates'->0->>'name' <> 'Quote follow-up' then
    raise exception 'G6 FAILED: template name match wrong: %', r->'templates';
  end if;

  -- 'checking' lives only in the body; the snippet must carry it.
  r := public.api_search_v2(f.cid_a, 'checking', 10, 10, 10, 10, 10);
  if jsonb_array_length(r->'templates') <> 1
     or (r->'templates'->0->>'id')::uuid <> f.tpl_a then
    raise exception 'G6 FAILED: template body match wrong: %', r->'templates';
  end if;
  if r->'templates'->0->>'snippet' not like '%checking%'
     or length(r->'templates'->0->>'snippet') > 160 then
    raise exception 'G6 FAILED: template snippet wrong: %', r->'templates'->0;
  end if;

  raise notice 'G6 PASSED: templates arm — name + body match with snippet';
end $$;

-- ===========================================================================
-- G7. Cross-company isolation: company B (which owns rows with the SAME
--     searchable words) sees only its own hits in every arm; a company that
--     owns nothing sees empty arms everywhere.
-- ===========================================================================
do $$
declare
  f record;
  r jsonb;
begin
  select * into f from gs_fixture;

  r := public.api_search_v2(f.cid_b, 'invoice', 10, 10, 10, 10, 10);
  if jsonb_array_length(r->'conversations') <> 1
     or (r->'conversations'->0->>'id')::uuid <> f.cv_b then
    raise exception 'G7 FAILED: B conversations leaked/missed: %', r->'conversations';
  end if;
  if jsonb_array_length(r->'tasks') <> 1
     or (r->'tasks'->0->>'id')::uuid <> f.t_b1 then
    raise exception 'G7 FAILED: B tasks leaked/missed: %', r->'tasks';
  end if;
  if jsonb_array_length(r->'attachments') <> 1
     or (r->'attachments'->0->>'id')::uuid <> f.at_b1 then
    raise exception 'G7 FAILED: B attachments leaked/missed: %', r->'attachments';
  end if;
  if jsonb_array_length(r->'templates') <> 1
     or (r->'templates'->0->>'id')::uuid <> f.tpl_b then
    raise exception 'G7 FAILED: B templates leaked/missed: %', r->'templates';
  end if;

  -- A company that owns nothing: every arm empty.
  r := public.api_search_v2(gen_random_uuid(), 'invoice', 10, 10, 10, 10, 10);
  if jsonb_array_length(r->'conversations') <> 0
     or jsonb_array_length(r->'contacts') <> 0
     or jsonb_array_length(r->'tasks') <> 0
     or jsonb_array_length(r->'attachments') <> 0
     or jsonb_array_length(r->'templates') <> 0 then
    raise exception 'G7 FAILED: cross-tenant leak: %', r;
  end if;

  raise notice 'G7 PASSED: every arm is company-scoped';
end $$;

-- ===========================================================================
-- G8. First-page-only arms: a 0 limit (what the Worker passes on cursored
--     pages, the p_contact_limit pattern) suppresses that arm while the
--     conversations arm keeps paginating.
-- ===========================================================================
do $$
declare
  f record;
  r jsonb;
begin
  select * into f from gs_fixture;

  r := public.api_search_v2(f.cid_a, 'invoice', 10, 0, 0, 0, 0);
  if jsonb_array_length(r->'conversations') <> 1 then
    raise exception 'G8 FAILED: conversations arm suppressed by other limits';
  end if;
  if jsonb_array_length(r->'contacts') <> 0
     or jsonb_array_length(r->'tasks') <> 0
     or jsonb_array_length(r->'attachments') <> 0
     or jsonb_array_length(r->'templates') <> 0 then
    raise exception 'G8 FAILED: 0 limits not honored: %', r;
  end if;

  raise notice 'G8 PASSED: 0-limit suppression for first-page-only arms';
end $$;

-- ===========================================================================
-- G9. LIKE-metacharacter escaping (20260704040000_search_escape.sql): the four
--     new ilike arms treat `%`, `_`, and `\` in the query as LITERAL text, not
--     wildcards. Exercised on the attachments arm because its only fuzzy path
--     is similarity() on file_name — which scores 0 for these one-/three-char
--     queries against the decoys — so the ONLY way a row surfaces is the
--     (now-escaped) ilike substring match, isolating the fix.
--
--     Six files in one company: one carries a literal '50%', a decoy carries
--     '5000' (a wildcard '%50%%' would false-match it), one carries an
--     underscore, a decoy carries a plain letter there, one carries a
--     backslash, and one is arbitrary. Before the fix a bare '%' or '_' dumped
--     ALL six and '50%' matched the 5000 decoy; after, each query returns only
--     the row that literally contains the metacharacter.
-- ===========================================================================
do $$
declare
  owner_id uuid := '32222222-2222-4222-8222-222222222222';
  cid uuid; num uuid; ct uuid; cv uuid; m uuid;
  r jsonb;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (owner_id, 'owner@searchesc.test', '{"display_name":"Esc Owner"}'::jsonb);
  cid := (public.api_create_company(owner_id, 'Esc Co', 'US', '212', true)->>'id')::uuid;
  insert into public.phone_numbers (company_id, status, provisioning_key, country, number_e164)
  values (cid, 'active', 'esc-key', 'US', '+12125559000') returning id into num;
  insert into public.contacts (company_id, phone_e164, name)
  values (cid, '+14165559201', 'Esc Contact') returning id into ct;
  insert into public.conversations (company_id, contact_id, phone_number_id, status, last_message_at)
  values (cid, ct, num, 'open', '2026-07-03T12:00:00Z') returning id into cv;
  insert into public.messages (company_id, conversation_id, direction, body, status, sent_by_user_id, created_at)
  values (cid, cv, 'note', 'esc note', null, owner_id, '2026-07-03T12:00:00Z') returning id into m;

  insert into public.attachments
    (company_id, owner_type, owner_id, conversation_id, storage_path, file_name, content_type, size_bytes, uploaded_by_user_id)
  values
    (cid, 'note', m, cv, 'p/pct.pdf',   'report 50% off.pdf',    'application/pdf', 1, owner_id),
    (cid, 'note', m, cv, 'p/dec.pdf',   'report 5000 units.pdf', 'application/pdf', 1, owner_id),
    (cid, 'note', m, cv, 'p/us.pdf',    'under_score.pdf',       'application/pdf', 1, owner_id),
    (cid, 'note', m, cv, 'p/ux.pdf',    'underXscore.pdf',       'application/pdf', 1, owner_id),
    (cid, 'note', m, cv, 'p/bs.pdf',
      'C' || chr(92) || 'Users' || chr(92) || 'home.pdf',        'application/pdf', 1, owner_id),
    (cid, 'note', m, cv, 'p/plain.pdf', 'quarterly-summary.pdf', 'application/pdf', 1, owner_id);

  -- A bare '%' is a wildcard pre-fix (would match all six). Escaped, it matches
  -- only the file whose name literally contains a percent sign.
  r := public.api_search_v2(cid, '%', 0, 0, 0, 10, 0);
  if jsonb_array_length(r->'attachments') <> 1
     or r->'attachments'->0->>'file_name' <> 'report 50% off.pdf' then
    raise exception 'G9 FAILED: bare %% not escaped: %', r->'attachments';
  end if;

  -- A bare '_' is a single-char wildcard pre-fix. Escaped, only the underscore
  -- file surfaces — not underXscore.pdf.
  r := public.api_search_v2(cid, '_', 0, 0, 0, 10, 0);
  if jsonb_array_length(r->'attachments') <> 1
     or r->'attachments'->0->>'file_name' <> 'under_score.pdf' then
    raise exception 'G9 FAILED: bare _ not escaped: %', r->'attachments';
  end if;

  -- '50%' must match the literal-'50%' file and NOT the '5000' row that a
  -- trailing-wildcard '%50%%' would have false-matched, nor any arbitrary row.
  r := public.api_search_v2(cid, '50%', 0, 0, 0, 10, 0);
  if jsonb_array_length(r->'attachments') <> 1
     or r->'attachments'->0->>'file_name' <> 'report 50% off.pdf' then
    raise exception 'G9 FAILED: 50%% gave false positives: %', r->'attachments';
  end if;

  -- A single backslash: escaped to a literal, it finds the one file whose name
  -- contains a backslash (pre-fix a trailing '\' broke the pattern entirely).
  r := public.api_search_v2(cid, chr(92), 0, 0, 0, 10, 0);
  if jsonb_array_length(r->'attachments') <> 1
     or r->'attachments'->0->>'file_name' <> 'C' || chr(92) || 'Users' || chr(92) || 'home.pdf' then
    raise exception 'G9 FAILED: backslash not findable: %', r->'attachments';
  end if;

  raise notice 'G9 PASSED: ilike arms escape %%, _, and \\ as literals';
end $$;

rollback;

select 'ALL GLOBAL SEARCH TESTS PASSED' as result;
