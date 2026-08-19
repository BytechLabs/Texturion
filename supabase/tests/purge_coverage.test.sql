-- Erasure must reach every table that holds a workspace's data.
--
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/purge_coverage.test.sql
--
-- ## Why this exists
--
-- `purge_workspace_step` deletes from a hand-written array of table names, and
-- D48 ANONYMISES the `companies` row rather than deleting it — so the
-- `on delete cascade` every company-scoped table declares never fires. A table
-- that is not named in that array, and is not reachable by cascade from one that
-- is, is deleted by nothing at all. It stays for the life of the install, after
-- the customer has been emailed a receipt saying their workspace was erased.
--
-- Twenty-one tables were in exactly that state (#581), including the free-text
-- reason a member typed about a blocked person, a 2,000-character exit interview,
-- and a recording of the owner's own voice.
--
-- ## Why it derives instead of listing
--
-- A test carrying its own list of tables is the same artefact as the array it is
-- checking, written twice — it would have been correct on the day it was written
-- and silent every day after. So this computes the answer from
-- `information_schema` and `pg_constraint` on every run: every base table with a
-- `company_id`, minus what the function names, minus what cascade removes.
--
-- It asserts a set, not a count. A count passes when one table is added and
-- another forgotten.
--
-- No fixtures and no writes — it reads the catalog. Wrapped in a transaction and
-- rolled back anyway, so it composes with the suites either side of it.

\set ON_ERROR_STOP on

begin;

do $$
declare
  v_missing text[];
  v_expected text[] := array[
    -- THE ONLY TWO TABLES ALLOWED TO SURVIVE, and both are decisions with a
    -- reason written down rather than tables somebody forgot.
    --
    -- A STOP belongs to the person who sent it, not to the business it was sent
    -- to, and it has to keep working after that business is gone — DELETION.md
    -- says "kept whole, forever", and the column is NOT NULL precisely so a
    -- teardown cannot orphan it.
    'opt_outs',
    -- The CASL artifact, kept to the statutory floor: the number, the timestamps
    -- and the source, so a regulator's question still has an answer.
    'contact_consent_events'
  ];
begin
  with recursive fn as (
    select p.prosrc
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'purge_workspace_step'
  ),
  -- Tables the function names. Matched on the quoted literal so a name that is
  -- merely a substring of another ('calls' inside 'call_records') cannot count
  -- as covered.
  purged as (
    select c.relname::text as t
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and (select prosrc from fn) like '%''' || c.relname || '''%'
  ),
  -- …and everything a cascade takes with them, transitively.
  cascaded as (
    select t from purged
    union
    select ch.relname::text
    from pg_constraint k
    join pg_class ch on ch.oid = k.conrelid
    join pg_class pa on pa.oid = k.confrelid
    join cascaded c on c.t = pa.relname::text
    where k.contype = 'f' and k.confdeltype = 'c'
  ),
  scoped as (
    select c.table_name::text as t
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name = 'company_id'
      and tb.table_type = 'BASE TABLE'
  )
  select coalesce(array_agg(s.t order by s.t), array[]::text[])
  into v_missing
  from scoped s
  where s.t not in (select t from cascaded);

  -- Loud when it finds nothing to reason about: a catalog query that matched no
  -- company-scoped tables at all would pass this file silently while checking
  -- nothing, which reads exactly like a clean bill of health.
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and column_name = 'company_id') < 20 then
    raise exception
      'PC-0 FAILED: fewer than 20 company-scoped columns found — the catalog '
      'query has stopped matching reality, so a pass here means nothing';
  end if;

  if not (v_missing <@ v_expected and v_expected <@ v_missing) then
    raise exception
      'PC-1 FAILED: erasure coverage has drifted. Not deleted and not expected: %. Expected but now deleted: %',
      (select coalesce(string_agg(x, ', '), '(none)')
         from unnest(v_missing) x where x <> all(v_expected)),
      (select coalesce(string_agg(x, ', '), '(none)')
         from unnest(v_expected) x where x <> all(v_missing));
  end if;

  raise notice
    'PC-1 PASSED: every company-scoped table is deleted or cascades, except the '
    'two kept on purpose (opt_outs, contact_consent_events)';
end $$;

-- Every bucket a purge has to sweep is named in `OBJECT_SOURCES`, and that list
-- lives in TypeScript — so this half checks the database's side of the same
-- promise: a table that stores a storage path must be one the purge deletes,
-- or its objects are stranded with nothing left pointing at them. That is what
-- `voicemail_greetings` did: the row survived, so the audio was unreachable and
-- unswept at the same time.
do $$
declare
  v_orphan text[];
begin
  with recursive fn as (
    select p.prosrc from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'purge_workspace_step'
  ),
  purged as (
    select c.relname::text as t
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and (select prosrc from fn) like '%''' || c.relname || '''%'
  ),
  cascaded as (
    select t from purged
    union
    select ch.relname::text
    from pg_constraint k
    join pg_class ch on ch.oid = k.conrelid
    join pg_class pa on pa.oid = k.confrelid
    join cascaded c on c.t = pa.relname::text
    where k.contype = 'f' and k.confdeltype = 'c'
  )
  select coalesce(array_agg(distinct c.table_name::text order by c.table_name::text), array[]::text[])
  into v_orphan
  from information_schema.columns c
  join information_schema.tables tb
    on tb.table_schema = c.table_schema and tb.table_name = c.table_name
  where c.table_schema = 'public'
    and tb.table_type = 'BASE TABLE'
    and c.column_name in ('storage_path', 'voicemail_path')
    and c.table_name::text not in (select t from cascaded);

  if array_length(v_orphan, 1) is not null then
    raise exception
      'PC-2 FAILED: % holds a storage path and is never deleted by the purge, '
      'so its objects are stranded in the bucket forever',
      array_to_string(v_orphan, ', ');
  end if;

  raise notice 'PC-2 PASSED: every table holding a storage path is reached by the purge';
end $$;

-- The `companies` row SURVIVES erasure — D48 anonymises it rather than deleting
-- it, so a STOP still works after the business is gone. That makes the list of
-- columns cleared by `anonymize_purged_workspace` the whole of what erasure means
-- for the business's own record, and it is a hand-written list inside a function
-- with nothing comparing it to the table. Two columns of exactly the kind it
-- clears — the business's own words to its own customers — were added later and
-- never added to it (#581).
--
-- So: every text column either goes, or is named below with a reason.
do $$
declare
  v_undecided text[];
  v_kept text[] := array[
    -- The regulator's question is whether consent existed, on what date, in what
    -- jurisdiction. Documented in DELETION.md as kept, deliberately.
    'country', 'timezone',
    -- The record of WHY data was preserved. Clearing it would leave the hold in
    -- place with its justification destroyed, which is worse than keeping it.
    'legal_hold_reason',
    -- The abuse history, kept so the same actor cannot be re-onboarded with no
    -- memory of why they left.
    'aup_enforcement', 'aup_enforcement_note',
    -- Configuration, not identity: none of these says anything about who the
    -- business was or who its customers were.
    'after_hours_calls', 'billing_currency', 'call_screening', 'crew_size',
    'locale', 'ring_strategy', 'requested_area_code',
    -- A pointer into `email_ledger`, which the purge deletes; the address itself
    -- is cleared by the function.
    'purge_receipt_email_id',
    -- Shared publicly by the business itself while it existed, and every row that
    -- joins against it is deleted by the purge.
    'referral_code'
  ];
begin
  with fn as (
    select p.prosrc from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'anonymize_purged_workspace'
  )
  select coalesce(array_agg(c.column_name::text order by c.column_name::text), array[]::text[])
  into v_undecided
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'companies'
    -- ARRAYS AND JSONB TOO, which this could not see.
    --
    -- It read `data_type in ('text','character varying')`, and
    -- information_schema reports `text[]` as ARRAY and jsonb as jsonb. So
    -- neither was examined — while the very function under test already
    -- cleared a jsonb column (`business_hours = '{}'::jsonb`), which is the
    -- proof those types hold data worth clearing.
    --
    -- Three columns had survived erasure behind that gap: `emergency_keywords`
    -- (the words the business chose as triggers, sitting one line below the
    -- `emergency_message` this function does clear), `business_hours_exceptions`
    -- (each carries a `note` the business wrote) and `signup_first_touch` (the
    -- rest of the attribution whose other two columns are cleared here).
    and (
      c.data_type in ('text', 'character varying', 'jsonb')
      or c.udt_name::text in ('_text', '_varchar')
    )
    -- `<col> =` is how the update assigns it; a column merely MENTIONED in a
    -- comment does not count as cleared.
    --
    -- A WORD MATCH, not a substring. `like '%' || column_name || ' ='` counted a
    -- column as cleared whenever its name was the tail of an assigned one:
    -- `display_name` would have matched `cnam_display_name =`, `source` matches
    -- `signup_source =`, `message` matches `away_message =`. Postgres `\m` and
    -- `\M` are word boundaries, and `_` is a word character, so
    -- `\mdisplay_name\M` cannot match inside `cnam_display_name`.
    and (select prosrc from fn) !~ ('\m' || c.column_name::text || '\M\s*=')
    and c.column_name::text <> all(v_kept);

  if array_length(v_undecided, 1) is not null then
    raise exception
      'PC-3 FAILED: % on `companies` is neither cleared by anonymize_purged_workspace nor in this test''s keep-list. Decide which, and write the reason next to it',
      array_to_string(v_undecided, ', ');
  end if;

  raise notice 'PC-3 PASSED: every text column on companies is cleared on erasure or kept for a stated reason';
end $$;

rollback;
