-- SPEC §6 — Worker data access (companion to 20260701000300_rls.sql).
--
-- The Worker talks to Supabase over PostgREST with the sb_secret_ key, which
-- executes as the `service_role`. That role has BYPASSRLS, but under the kept
-- post-May-2026 no-auto-grant default it receives NO table privileges
-- automatically — so every direct table read/write from the Worker (webhook
-- ledgers, membership lookups, crons, all routes) fails with 42501 unless the
-- privileges are granted explicitly.
--
-- Grant service_role full DML on all public tables plus sequence usage, and
-- set matching default privileges so tables created by later migrations (run
-- as `postgres`) are covered too. The deny-by-default posture for the
-- PostgREST end-user roles (`anon`, `authenticated`) established in
-- 20260701000300_rls.sql is unchanged: they keep zero grants.

grant usage on schema public to service_role;

grant select, insert, update, delete
  on all tables in schema public to service_role;

grant usage, select
  on all sequences in schema public to service_role;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;
