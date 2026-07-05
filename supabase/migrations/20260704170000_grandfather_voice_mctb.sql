-- #12: the initial company_modules grandfather (20260704160000) seeded 'voice'
-- only for companies with a forward number. But a company using missed-call
-- text-back WITHOUT a forward number (the no-forward missed path — the call
-- rings out and its hangup is the missed signal) also relies on voice, so it
-- must keep the module when the settings voice-gate lands. Seed those too.

insert into public.company_modules (company_id, module)
  select id, 'voice' from public.companies
   where deleted_at is null and mctb_enabled = true
  on conflict do nothing;
