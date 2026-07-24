-- #214 follow-up (founder): AI task enrichment is ON by default.
--
-- Flip the company_ai_settings column defaults so any future direct insert
-- defaults ON. The endpoint's code fallback ({true, true}) already covers
-- companies that have NEVER set a row (the common case). Existing rows —
-- companies that explicitly chose their toggles in Settings → AI — are left
-- untouched, so a deliberate opt-out still stands.
alter table public.company_ai_settings
  alter column enrich_task_address set default true,
  alter column enrich_task_due     set default true;
