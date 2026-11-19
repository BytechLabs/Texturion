begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('96111111-0000-4000-8000-000000000001', 'localized-signup@example.test', '{"display_name":"Auth name","locale":"fr-CA"}'),
  ('96111111-0000-4000-8000-000000000002', 'default-signup@example.test', '{"locale":"es"}');

do $$
begin
  if (select raw_user_meta_data->>'locale' from auth.users
       where id = '96111111-0000-4000-8000-000000000001') is distinct from 'fr-CA' then
    raise exception 'Signup changed a supported locale';
  end if;
  if (select raw_user_meta_data->>'locale' from auth.users
       where id = '96111111-0000-4000-8000-000000000002') is distinct from 'en' then
    raise exception 'Signup failed to default to English';
  end if;
end $$;

update public.profiles set display_name = 'Profile name', locale = 'en'
where user_id = '96111111-0000-4000-8000-000000000001';

do $$
begin
  if (select raw_user_meta_data->>'locale' from auth.users
       where id = '96111111-0000-4000-8000-000000000001') is distinct from 'en' then
    raise exception 'Profile locale did not update Auth metadata';
  end if;
  if (select display_name from public.profiles
       where user_id = '96111111-0000-4000-8000-000000000001') is distinct from 'Profile name' then
    raise exception 'Updating the Auth locale changed the profile name';
  end if;
end $$;

rollback;
