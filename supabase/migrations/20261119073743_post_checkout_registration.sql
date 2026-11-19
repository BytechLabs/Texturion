alter table public.messaging_registrations
  add column brand_submission_lease_until timestamptz;

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
       and r.status = 'draft'
       and r.telnyx_id is null
       and r.submission_count = 0
       and not (r.data ? 'brandSubmitAttemptedAt')
       and r.updated_at < now() - make_interval(days => greatest(p_days, 1))
       and c.subscription_status in ('incomplete', 'incomplete_expired')
       and c.subscription_started_at is null
       and c.registration_fee_paid_at is null
       and c.legal_hold_at is null
       for update of r, c skip locked
  )
  delete from public.messaging_registrations r
  using stale
  where r.id = stale.id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.api_prune_abandoned_identity(int) is
  'Removes stale business details saved before a workspace ever paid. Retains carrier records and texting drafts.';
