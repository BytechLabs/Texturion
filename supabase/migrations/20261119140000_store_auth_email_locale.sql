create function public.normalize_auth_email_locale() returns trigger
language plpgsql set search_path = '' as $$
begin
  if jsonb_typeof(new.raw_user_meta_data) is distinct from 'object' then
    new.raw_user_meta_data := '{}'::jsonb;
  end if;
  if (tg_op = 'INSERT' or new.raw_user_meta_data ? 'locale') and
     coalesce(new.raw_user_meta_data->>'locale', '') not in ('en', 'fr-CA') then
    new.raw_user_meta_data := jsonb_set(new.raw_user_meta_data, '{locale}', '"en"');
  end if;
  return new;
end $$;

create trigger normalize_auth_email_locale
  before insert or update of raw_user_meta_data on auth.users
  for each row execute function public.normalize_auth_email_locale();

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- A locale-only change must leave profile names edited in the app intact.
  if tg_op = 'UPDATE' and
     new.raw_user_meta_data->>'display_name' is not distinct from old.raw_user_meta_data->>'display_name' and
     exists (select 1 from public.profiles where user_id = new.id) then
    return new;
  end if;

  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', ''))
  on conflict (user_id) do update set display_name = excluded.display_name;
  return new;
end $$;

create function public.sync_profile_auth_email_locale() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  email_locale text := coalesce(new.locale, 'en');
begin
  if tg_op = 'INSERT' and new.locale is null then
    return new;
  end if;
  update auth.users
     set raw_user_meta_data = jsonb_set(
       case when jsonb_typeof(raw_user_meta_data) = 'object' then raw_user_meta_data else '{}'::jsonb end,
       '{locale}', to_jsonb(email_locale)
     )
   where id = new.user_id
     and raw_user_meta_data->>'locale' is distinct from email_locale;
  return new;
end $$;

create trigger sync_profile_auth_email_locale
  after insert or update of locale on public.profiles
  for each row execute function public.sync_profile_auth_email_locale();

-- Accounts without a preference keep their workspace fallback for app emails.
-- Supabase templates already use English when metadata has no locale.
update auth.users u
   set raw_user_meta_data = jsonb_set(
     case when jsonb_typeof(u.raw_user_meta_data) = 'object' then u.raw_user_meta_data else '{}'::jsonb end,
     '{locale}', to_jsonb(p.locale)
   )
  from public.profiles p
 where u.id = p.user_id
   and p.locale is not null
   and u.raw_user_meta_data->>'locale' is distinct from p.locale;

revoke execute on function public.normalize_auth_email_locale() from public, anon, authenticated;
revoke execute on function public.sync_profile_auth_email_locale() from public, anon, authenticated;
