-- #251 — the plans behind the hot reads, on a workspace worth selling to.
--
-- Run `seed-volume.sql` first.
--
-- WHY PLANS AND NOT A TIMING LOOP. `scripts/ops/query-load.mjs` already times
-- these end to end, and that number includes node, the driver and JSON. This
-- asks the narrower question that survives being run on a different machine:
-- WHICH ACCESS PATH did Postgres choose. A sequential scan that is fast at
-- 50,000 rows is the same sequential scan at 500,000, and reading "Seq Scan on
-- contacts" is how you know before it hurts.
--
-- Usage:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < scripts/load/measure.sql

\set ON_ERROR_STOP on
\set load_company '''11111111-1111-4111-8111-111111111111'''
\set load_owner   '''22222222-2222-4222-8222-222222222222'''

\echo ''
\echo '=== 1. INBOX LIST — the first screen, every session ==='
explain (analyze, buffers, timing off)
select v.id, v.last_message_at, v.status, v.contact_phone_e164
  from public.conversations v
 where v.company_id = :load_company::uuid
   and v.status = 'open'
 order by v.last_message_at desc
 limit 50;

\echo ''
\echo '=== 2. MESSAGE FULL-TEXT — a SELECTIVE term ==='
-- Selective on purpose. A term that matches most of the table is correctly
-- answered by a sequential scan, and measuring one taught this file its own
-- lesson once: see the fixture note in docs/CAPACITY.md.
explain (analyze, buffers, timing off)
select distinct on (m0.conversation_id) m0.id, m0.conversation_id, m0.created_at
  from public.messages m0
 where m0.company_id = :load_company::uuid
   and m0.body_tsv @@ websearch_to_tsquery('english', 'jobref31337')
 order by m0.conversation_id, m0.created_at desc, m0.id desc;

\echo ''
\echo '=== 3. CONTACT SEARCH — the whole OR, as api_search writes it ==='
explain (analyze, buffers, timing off)
select ct.id, ct.name
  from public.contacts ct
 where ct.company_id = :load_company::uuid
   and ct.deleted_at is null
   and (ct.name ilike '%jobref31337%' or ct.phone_e164 ilike '%jobref31337%'
        or coalesce(ct.name, '') operator(extensions.%) 'jobref31337')
 limit 25;

\echo ''
\echo '=== 3b. THE SAME, WITHOUT the coalesce() branch ==='
-- The two together are the finding: drop the one unindexable branch and the
-- planner uses both trigram indexes. Keep it and none of them can be used.
explain (analyze, buffers, timing off)
select ct.id, ct.name
  from public.contacts ct
 where ct.company_id = :load_company::uuid
   and ct.deleted_at is null
   and (ct.name ilike '%jobref31337%' or ct.phone_e164 ilike '%jobref31337%')
 limit 25;

\echo ''
\echo '=== 4. FOR YOU — the ranked queue ==='
explain (analyze, buffers, timing off)
select * from public.api_for_you(
  :load_company::uuid, :load_owner::uuid, now(), 50, array[]::uuid[]
);
