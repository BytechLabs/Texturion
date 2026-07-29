-- #381 — stop holding a stranger's government identifier.
--
-- The onboarding wizard's `business` step collects the owner's legal name,
-- address, and on the no-EIN path the LAST 4 OF THEIR SSN/SIN. Until 4dc1811
-- that came before the paywall, so every signup that abandoned at checkout
-- left those fields sitting in a draft row for a company that never became a
-- customer.
--
-- The reorder stops new ones accumulating. It does nothing about the ones
-- already there, and nothing about a signup that pays, starts the identity
-- form, and walks away — which the reorder makes MORE likely, not less, since
-- the form now sits after the money.
--
-- PIPEDA and Law 25 both run on collecting no more than necessary and keeping
-- it no longer than necessary. A SIN fragment belonging to somebody who never
-- became a customer fails the second test on any reading.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DOES AND DOES NOT TOUCH.
--
-- Only `draft` and `rejected` rows — never anything submitted. A submitted
-- registration is a live carrier relationship whose data we are required to be
-- able to reproduce, and deleting under it would break the thing it describes.
--
-- It clears the IDENTITY fields and leaves the rest of the draft alone. The
-- business name and website are ordinary trade details somebody puts on a van;
-- the SSN/SIN last-4, the personal names and the mobile used for the OTP are
-- not, and they are the whole of what this removes. A returning customer
-- retypes four digits rather than the entire form.

create or replace function public.api_prune_abandoned_identity(p_days int default 30)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  with stale as (
    select r.id
      from public.messaging_registrations r
      join public.companies c on c.id = r.company_id
     where r.kind = 'brand'
       -- Never a submitted row: see the header. `draft` and `rejected` are the
       -- two states where nothing downstream depends on the data.
       and r.status in ('draft', 'rejected')
       and r.updated_at < now() - make_interval(days => greatest(p_days, 1))
       -- Never a paying customer. `registration_fee_paid_at` rather than the
       -- subscription status: a lapsed customer is still a customer whose
       -- registration we may need to resubmit, and a canceled subscription is
       -- not the same thing as a signup that never happened.
       and c.registration_fee_paid_at is null
       -- And only where there is actually something to remove, so the job does
       -- no writes on a quiet month.
       and (
         r.data ? 'ein' or r.data ? 'firstName' or r.data ? 'lastName'
         or r.data ? 'mobilePhone'
       )
  )
  update public.messaging_registrations r
     -- `-` on a jsonb object removes the keys. The rest of the draft survives:
     -- a returning signup retypes four digits, not the whole form.
     set data = r.data - 'ein' - 'firstName' - 'lastName' - 'mobilePhone',
         updated_at = now()
    from stale
   where r.id = stale.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.api_prune_abandoned_identity(int) is
  '#381: clears SSN/SIN last-4, personal names and the OTP mobile from brand '
  'drafts belonging to signups that never paid. Never touches a submitted row.';

revoke all on function public.api_prune_abandoned_identity(int)
  from public, anon, authenticated;
grant execute on function public.api_prune_abandoned_identity(int) to service_role;
