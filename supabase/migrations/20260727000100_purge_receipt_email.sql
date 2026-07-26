-- ===========================================================================
-- [#371] Somewhere to send the erasure receipt.
--
-- The purge finishes up to 30 days after the workspace closes, and by the time
-- it does, `company_members` is one of the tables it deleted. There is no
-- owner left to look up, so the address has to be captured at close time and
-- carried across the window.
--
-- It is held for exactly one purpose — proving to the customer that the
-- erasure happened, which is the artefact PIPEDA and Law 25 ask for — and
-- `anonymize_purged_workspace` clears it in the same statement that stamps
-- `purged_at`. Keeping an address on a workspace whose whole point is that it
-- has been erased would be the contradiction this feature exists to avoid.
-- ===========================================================================

alter table public.companies
  add column if not exists purge_receipt_email text;

comment on column public.companies.purge_receipt_email is
  '#371: where to send the erasure receipt, captured when the workspace closed. Cleared by anonymize_purged_workspace once the receipt has somewhere to have been sent from.';

-- ---------------------------------------------------------------------------
-- Same function as 20260726000500, with the receipt address cleared alongside
-- the rest of the identifying columns. Replacing it wholesale rather than
-- patching around it keeps one readable definition of what an anonymised
-- workspace looks like.
-- ---------------------------------------------------------------------------
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
         business_hours = '{}'::jsonb,
         -- #371: read by the sweep before this runs, gone once it has.
         purge_receipt_email = null,
         purged_at = now()
   where id = p_company_id;

  return jsonb_build_object('outcome', 'anonymized');
end $$;

revoke execute on function public.anonymize_purged_workspace(uuid)
  from public, anon, authenticated;
grant execute on function public.anonymize_purged_workspace(uuid) to service_role;
