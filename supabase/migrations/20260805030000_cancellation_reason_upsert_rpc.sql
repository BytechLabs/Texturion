-- #277 - the cancellation reason was never actually being written.
--
-- `20260804600000_cancellation_reasons.sql` created the table with a PARTIAL
-- unique index:
--
--   create unique index cancellation_reasons_open_idx
--     on public.cancellation_reasons (company_id) where confirmed_at is null;
--
-- and the route upserted through PostgREST with `on_conflict=company_id`.
-- PostgREST emits `ON CONFLICT (company_id)` and has no way to attach an index
-- predicate, and Postgres will not infer a PARTIAL index from a bare column
-- list. Every call therefore raised
--
--   42P10: there is no unique or exclusion constraint matching the ON CONFLICT
--          specification
--
-- which `expectOk` turned into a 500. The table has never received a row.
--
-- It went unnoticed because the route's own tests stub the HTTP layer and
-- assert only that `on_conflict=company_id` was SENT, which it faithfully was.
-- Nothing exercised the statement against a real database, so a guard that
-- could only ever pass was standing in for one that could fail. The suite in
-- `supabase/tests/cancellation_reason_upsert.test.sql` is the one that can.
--
-- The fix is a function rather than a different index, because the index is
-- right and says something the table needs to keep saying:
--
--   * ONE open statement per workspace. Opening the cancel screen three times
--     is one person giving one reason. A plain unique index on company_id
--     would enforce that too, but it would also make a SECOND cancellation,
--     years later, overwrite the first - and the confirmed rows are the
--     history the whole report is built on.
--   * A CONFIRMED row must never block a new open one. Somebody can cancel,
--     come back, and cancel again, and both statements are true.
--
-- Postgres can infer a partial index when the statement repeats the predicate,
-- so `on conflict (company_id) where confirmed_at is null` is exactly right.
-- It just cannot be spelled over PostgREST, which is what an RPC is for.

create or replace function public.api_record_cancellation_reason(
  p_company_id uuid,
  p_user_id    uuid,
  p_reason     text,
  p_detail     text
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.cancellation_reasons (company_id, user_id, reason, detail)
  values (p_company_id, p_user_id, p_reason, p_detail)
  on conflict (company_id) where confirmed_at is null
  do update set
    reason  = excluded.reason,
    detail  = excluded.detail,
    -- Whoever spoke last is who we heard from. An owner correcting an admin's
    -- answer on the same open statement should not be filed under the admin.
    user_id = excluded.user_id;
$$;

comment on function public.api_record_cancellation_reason(uuid, uuid, text, text) is
  '#277: record why a workspace says it is leaving, upserting the single OPEN '
  'statement. Exists because the partial unique index it targets cannot be '
  'named through PostgREST, which can only emit a bare ON CONFLICT column list.';

-- Service-role only, like every other write path here: the API holds the key
-- and the table has RLS enabled with no end-user policy. The grant is explicit
-- rather than inherited, which `api_functions.test.sql` F5 requires of every
-- `api_*` function: a revoke without a matching grant reads as tightened
-- security and is actually a function nothing can call.
revoke all on function public.api_record_cancellation_reason(uuid, uuid, text, text) from public;
revoke all on function public.api_record_cancellation_reason(uuid, uuid, text, text) from anon;
revoke all on function public.api_record_cancellation_reason(uuid, uuid, text, text) from authenticated;
grant execute on function public.api_record_cancellation_reason(uuid, uuid, text, text) to service_role;
