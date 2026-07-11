-- #134 (D42): calling is included on every plan — the Calling module is
-- RETIRED (the #103/#121 playbook). Live `voice` module rows become inert
-- the moment the API stops reading them; disable them so member-visible
-- surfaces (company view enabled_modules) stop echoing a module that no
-- longer exists. Historic rows keep their values (the module CHECK still
-- allows 'voice', like 'mms' before it); the Stripe-side $8 items are
-- stripped with prorated credit by the daily retired-price sweep.
update public.company_modules
   set disabled_at = now()
 where module = 'voice'
   and disabled_at is null;
