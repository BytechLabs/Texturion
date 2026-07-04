-- FEATURE-GAPS BUILD-NOW voice wave — enum additions, in their OWN migration
-- (a new enum value cannot be USED in the same transaction that adds it —
-- Postgres restriction; each migration file is its own transaction). The values
-- are first USED by 20260703070000_voice_wave_functions.sql, the application
-- code (apps/api), and the SQL tests — never inside this file.
--
-- 1. number_source 'hosted' — the keep-your-number TEXT-ENABLEMENT path
--    (landline hosted-SMS order): a phone_numbers row whose voice stays on the
--    owner's existing carrier while Telnyx adds SMS. Distinct from 'provisioned'
--    (new number) and 'ported' (full transfer). The shipped
--    phone_numbers_porting_status_consistency CHECK
--    ((source='ported') = (porting_status is not null)) is satisfied as-is: a
--    hosted row is source='hosted' (not 'ported') and carries porting_status
--    NULL, so the equality holds. Editing a shipped constraint is forbidden
--    (D7/D14) — none is edited here.
--
-- 2. conversation_event_type 'missed_call' — Step 1: logged on the caller's
--    conversation when a call is COMPUTED missed (dial timeout / AMD "machine"
--    or no forward target), so the crew sees the missed call and the text-back
--    in the thread. Actor NULL (system). Always carries a non-null
--    conversation_id, so the shipped conversation_events_conv_required CHECK
--    (which only PERMITS a null conversation_id for opted_out/opt_out_revoked/
--    consent_attested) is satisfied — not altered.
--
-- IF NOT EXISTS makes each ADD VALUE idempotent (re-runnable safely).

alter type public.number_source add value if not exists 'hosted';
alter type public.conversation_event_type add value if not exists 'missed_call';
