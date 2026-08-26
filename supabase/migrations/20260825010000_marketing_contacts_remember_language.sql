-- #228 — a French comparison request stays French after it crosses the API.
--
-- `consent_text` already snapshots the exact words shown, but it cannot safely
-- double as a locale switch for the requested email. Remember the route locale
-- explicitly so retries and later sends use the language the prospect chose.

alter table public.marketing_contacts
  add column consent_locale text not null default 'en'
  constraint marketing_contacts_consent_locale_check
  check (consent_locale in ('en', 'fr-CA'));

comment on column public.marketing_contacts.consent_locale is
  'Language of the consent surface and the commercial email requested there.';

-- A new trailing argument preserves every existing positional caller: the
-- fourth argument remains the daily cap and omitted locale remains English.
drop function if exists public.api_claim_marketing_contact(text, text, text, int);

create function public.api_claim_marketing_contact(
  p_email        text,
  p_source       text,
  p_consent_text text,
  p_cap          int default 50,
  p_locale       text default 'en'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email       text := lower(trim(p_email));
  v_today_count int;
  v_reason      text;
  v_token       uuid;
begin
  if v_email = '' or position('@' in v_email) = 0
     or p_locale is null or p_locale not in ('en', 'fr-CA') then
    return jsonb_build_object('ok', false, 'reason', 'validation_failed');
  end if;

  perform pg_advisory_xact_lock(hashtext('marketing_contact_claim'));

  select reason into v_reason
    from public.email_suppressions
   where email = v_email
     and cleared_at is null
   limit 1;
  if v_reason = 'complaint' then
    return jsonb_build_object('ok', false, 'reason', 'suppressed');
  end if;

  select count(*) into v_today_count
    from public.marketing_contacts
   where created_at >= date_trunc('day', now() at time zone 'utc');
  if v_today_count >= greatest(p_cap, 1) then
    return jsonb_build_object('ok', false, 'reason', 'daily_cap');
  end if;

  update public.email_suppressions
     set cleared_at = now()
   where email = v_email
     and cleared_at is null
     and reason = 'hard_bounce';

  insert into public.marketing_contacts
    (email, consent_source, consent_text, consent_locale)
  values (v_email, p_source, p_consent_text, p_locale)
  on conflict (email) do update
     set consent_source  = excluded.consent_source,
         consent_text    = excluded.consent_text,
         consent_locale  = excluded.consent_locale,
         unsubscribed_at = null
  returning unsubscribe_token into v_token;

  return jsonb_build_object('ok', true, 'token', v_token);
end;
$$;

revoke execute on function public.api_claim_marketing_contact(text, text, text, int, text)
  from public, anon, authenticated;
grant execute on function public.api_claim_marketing_contact(text, text, text, int, text)
  to service_role;
