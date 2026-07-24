-- Tag create-on-attach was a findByName(ilike) → insert → re-findByName dance
-- that used escapeLike() for the exact name lookup. escapeLike is built for the
-- fuzzy `q` search and DELETES '*' entirely (PostgREST maps '*'->'%' with no
-- escape), so a tag name containing '*' ("VIP*", "5*") matched the WRONG tag
-- (silently attaching a different tag) or, on the second attach, 500'd (the
-- post-conflict re-select still couldn't find its own row). It also raced the
-- concurrent create/select.
--
-- Replace it with one atomic, case-insensitive, any-character find-or-create,
-- keyed on the existing unique index (company_id, lower(name)). ON CONFLICT DO
-- UPDATE SET name = tags.name is a no-op that makes the conflicting EXISTING row
-- (its original casing + color) the RETURNING result — reuse-else-create in a
-- single statement, no race.
create or replace function public.api_find_or_create_tag(
  p_company_id uuid,
  p_name text
)
returns table (id uuid, name text, color text)
language sql
security definer
set search_path = ''
as $$
  insert into public.tags (company_id, name)
  values (p_company_id, p_name)
  on conflict (company_id, lower(name)) do update set name = public.tags.name
  returning public.tags.id, public.tags.name, public.tags.color;
$$;

-- Only the API's service-role key calls it (it scopes p_company_id); end-user
-- roles must not (they could mint tags in any company).
revoke execute on function public.api_find_or_create_tag(uuid, text)
  from public, anon, authenticated;
grant execute on function public.api_find_or_create_tag(uuid, text)
  to service_role;
