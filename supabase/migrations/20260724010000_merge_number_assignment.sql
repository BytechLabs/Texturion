-- Telnyx saga hardening #40 (round-3) — race-safe per-number merge into the
-- campaign's numberAssignments / assignmentFailureNotified JSON ledgers.
--
-- Both ledgers were updated with a read-modify-write of the WHOLE `data` object
-- (handle10dlcEvent for 10dlc.phone_number.update, and assignNumbersToCampaign
-- at R3): read `data`, mutate one phone's entry in TS, write the whole object
-- back. Telnyx delivers one phone_number.update PER number and retries them, so
-- two events for different numbers on the same campaign (or a phone_number.update
-- racing the R3 bulk assign) run concurrently — the last writer's whole-object
-- PUT clobbers the other's key. Lost assignment state means a number silently
-- shows unassigned / a failure-email never fires.
--
-- This SECURITY DEFINER RPC does the per-key merge in ONE UPDATE statement, so
-- concurrent writers on the same row serialize and re-read the committed data
-- (READ COMMITTED) — each merges its own phone key rather than overwriting the
-- other's. Mirrors bump_registration_counter (service-role-only, SPEC §6).
--
-- p_status         : the phone's assignment state ('added' | 'pending' | 'failed').
-- p_notified_at    : when non-null, stamp assignmentFailureNotified[phone] (the
--                    one-shot post-port failure email marker). NULL = leave it.
-- p_clear_notified : when true, delete assignmentFailureNotified[phone] (the
--                    ADDED path clears the stamp so a future re-failure re-notifies).
create or replace function public.merge_number_assignment(
  p_row_id         uuid,
  p_company_id     uuid,
  p_phone          text,
  p_status         text,
  p_notified_at    timestamptz,
  p_clear_notified boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.messaging_registrations
     set data =
       coalesce(data, '{}'::jsonb)
       -- Merge this one number's status into numberAssignments (other numbers
       -- concurrently merged by other callers are preserved by the re-read).
       || jsonb_build_object(
            'numberAssignments',
            coalesce(data -> 'numberAssignments', '{}'::jsonb)
              || jsonb_build_object(p_phone, p_status))
       -- Set / clear / leave this one number's failure-notified stamp.
       || jsonb_build_object(
            'assignmentFailureNotified',
            case
              when p_clear_notified then
                coalesce(data -> 'assignmentFailureNotified', '{}'::jsonb) - p_phone
              when p_notified_at is not null then
                coalesce(data -> 'assignmentFailureNotified', '{}'::jsonb)
                  || jsonb_build_object(p_phone, p_notified_at)
              else
                coalesce(data -> 'assignmentFailureNotified', '{}'::jsonb)
            end)
   where id = p_row_id and company_id = p_company_id;
end $$;

revoke execute on function
  public.merge_number_assignment(uuid, uuid, text, text, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function
  public.merge_number_assignment(uuid, uuid, text, text, timestamptz, boolean)
  to service_role;
