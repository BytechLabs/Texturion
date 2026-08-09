-- Erasing a workspace has to erase the words it wrote to its customers.
--
-- `anonymize_purged_workspace` clears the columns that identify a business, and
-- `away_message` — the sentence a customer gets when nobody is at the desk — has
-- always been one of them, because it is the business speaking in its own voice.
--
-- Two more of exactly that kind were added to `companies` after this function
-- was written, and nobody came back to it: `emergency_message` (what a customer
-- is told when they use an emergency keyword) and `offramp_message` (what they
-- are told when the conversation is being handed off). Both survived erasure.
--
-- `docs/DELETION.md` published an EXHAUSTIVE list of what is kept, and that list
-- did not mention either one, so the document was wrong about its own product.
-- It is corrected in the same change.
--
-- Also cleared here, and this one is a judgement rather than an oversight:
-- `signup_source` and `signup_landing_path`. They record how this business found
-- us. That is data about them, it serves no purpose once they are gone, and it
-- is the same argument that already retires the billing identifiers above.
--
-- WHAT DELIBERATELY STAYS, so the next reader does not "finish the job":
--
--   country, timezone      — the regulator's question is whether consent existed,
--                            on what date, in what jurisdiction. Documented.
--   legal_hold_reason      — the record of WHY data was preserved. Clearing it
--                            would destroy the justification for the hold while
--                            leaving the hold, which is worse than keeping it.
--   aup_enforcement,
--   aup_enforcement_note   — the abuse history. Kept so the same actor cannot be
--                            re-onboarded with no memory of why they left.
--   the settings columns   — ring strategy, call screening, locale, currency and
--                            the rest are configuration, not identity, and say
--                            nothing about who the business or its customers were.
--
-- `supabase/tests/purge_coverage.test.sql` now asserts the cleared set against
-- the catalog, with that keep-list named in it. A text column added to
-- `companies` in future fails the build until somebody decides which side it is
-- on — which is the only thing that stops this happening a third time.

create or replace function public.anonymize_purged_workspace(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.companies
     where id = p_company_id and deleted_at is not null
       and purge_after is not null and purge_after <= now()
  ) then
    raise exception 'anonymize_purged_workspace: % is not past its purge window', p_company_id;
  end if;

  update public.companies
     set name = 'Closed workspace',
         stripe_customer_id = null,
         stripe_subscription_id = null,
         telnyx_messaging_profile_id = null,
         chosen_number_e164 = null,
         away_message = null,
         mctb_message = null,
         voicemail_greeting = null,
         cnam_display_name = null,
         -- #581: the same class as `away_message` above — the business's own
         -- words, sent to its own customers — added after this function was
         -- written and never added to it. `DELETION.md` stated an exhaustive
         -- Kept list that did not include them, so the document was wrong about
         -- its own product.
         emergency_message = null,
         offramp_message = null,
         -- Attribution about how this business found us. It has no purpose once
         -- the business is gone, and it is about them rather than about their
         -- customers, which is the same reason the plan identifiers above go.
         signup_source = null,
         signup_landing_path = null,
         business_hours = '{}'::jsonb,
         -- #371: read by the sweep before this runs, gone once it has.
         purge_receipt_email = null,
         purged_at = now()
   where id = p_company_id;

  return jsonb_build_object('outcome', 'anonymized');
end $$;
