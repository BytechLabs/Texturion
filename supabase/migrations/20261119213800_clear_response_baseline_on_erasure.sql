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
         pending_plan = null,
         pending_plan_effective_at = null,
         pending_plan_schedule_id = null,
         pending_plan_seat_limit = null,
         pending_plan_number_limit = null,
         telnyx_messaging_profile_id = null,
         chosen_number_e164 = null,
         away_message = null,
         mctb_message = null,
         voicemail_greeting = null,
         cnam_display_name = null,
         emergency_message = null,
         emergency_keywords = null,
         offramp_message = null,
         signup_source = null,
         signup_landing_path = null,
         signup_first_touch = null,
         business_hours = '{}'::jsonb,
         business_hours_exceptions = '[]'::jsonb,
         response_baseline = null,
         purge_receipt_email = null,
         purged_at = now()
   where id = p_company_id;

  return jsonb_build_object('outcome', 'anonymized');
end $$;
