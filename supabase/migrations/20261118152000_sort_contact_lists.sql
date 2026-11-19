alter table public.contacts add column last_activity_at timestamptz;

create function public.set_contact_updated_at() returns trigger
language plpgsql set search_path = ''
as $$
declare
  derived constant text[] := array['last_activity_at', 'name_t9', 'custom_values'];
begin
  if new.last_activity_at is not distinct from old.last_activity_at
     or (to_jsonb(new) - derived) is distinct from (to_jsonb(old) - derived) then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger set_updated_at on public.contacts;
create trigger set_updated_at before update on public.contacts
  for each row execute function public.set_contact_updated_at();

update public.contacts ct set last_activity_at = activity.latest
from (
  select company_id, contact_id, max(last_message_at) as latest
  from public.conversations where deleted_at is null
  group by company_id, contact_id
) activity where ct.company_id = activity.company_id and ct.id = activity.contact_id;

create index contacts_sort_name_idx on public.contacts (company_id, lower(name), id)
  where deleted_at is null and merged_into is null;
create index contacts_sort_activity_idx on public.contacts (company_id, last_activity_at desc nulls last, id desc)
  where deleted_at is null and merged_into is null;

create function public.refresh_contact_last_activity() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  ids uuid[] := array[]::uuid[];
  company uuid := case when tg_op = 'DELETE' then old.company_id else new.company_id end;
begin
  if tg_op <> 'INSERT' then ids := array_append(ids, old.contact_id); end if;
  if tg_op <> 'DELETE' then ids := array_append(ids, new.contact_id); end if;

  perform 1 from public.contacts ct
   where ct.company_id = company and ct.id = any(ids)
   order by ct.id for no key update;

  with activity as (
    select ct.id, max(cv.last_message_at) as latest
    from public.contacts ct left join public.conversations cv
      on cv.company_id = company and cv.contact_id = ct.id and cv.deleted_at is null
    where ct.company_id = company and ct.id = any(ids)
    group by ct.id
  )
  update public.contacts ct set last_activity_at = activity.latest
  from activity where ct.id = activity.id and ct.last_activity_at is distinct from activity.latest;
  return null;
end;
$$;

create trigger refresh_contact_last_activity
after insert or update of contact_id, last_message_at, deleted_at or delete
on public.conversations for each row execute function public.refresh_contact_last_activity();

create function public.contact_matches_search(ct public.contacts, q text)
returns boolean language sql stable set search_path = ''
as $$
  select ct.name ilike search.pattern
      or ct.phone_e164 ilike search.pattern
      or coalesce(ct.name, '') operator(extensions.%) q
      or ct.address ilike search.pattern
      or ct.business_name ilike search.pattern
      or ct.email ilike search.pattern
      or ct.notes ilike search.pattern
      or ct.custom_values ilike search.pattern
      or exists (
        select 1 from public.contact_addresses a where a.company_id = ct.company_id
          and a.contact_id = ct.id and a.address ilike search.pattern
      )
      or (length(search.digits) >= 3 and (
        ct.phone_e164 like '%' || search.digits || '%'
        or exists (
          select 1 from public.contact_phones p where p.company_id = ct.company_id
            and p.contact_id = ct.id and p.phone_e164 like '%' || search.digits || '%'
        )
      ))
  from (
    select '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern,
      regexp_replace(q, '[^0-9]', '', 'g') as digits
  ) search;
$$;

create function public.api_sorted_contacts(
  p_company uuid, p_sort text, p_limit integer, p_q text default null,
  p_tag uuid default null, p_field text default null, p_value text default null,
  p_after_id uuid default null, p_after_name text default null, p_after_at timestamptz default null
) returns setof public.contacts
language sql stable security definer set search_path = ''
as $$
  select ct.* from public.contacts ct
  where ct.company_id = p_company and ct.deleted_at is null and ct.merged_into is null
    and (p_q is null or public.contact_matches_search(ct, p_q))
    and (p_tag is null or exists (
      select 1 from public.contact_tags t where t.company_id = p_company and t.contact_id = ct.id and t.tag_id = p_tag
    ))
    and (p_field is null or ct.custom_fields ->> p_field = p_value)
    and (p_after_id is null or case
      when p_sort = 'name' then
        case when p_after_name is null then ct.name is null and ct.id > p_after_id
             else ct.name is null or (lower(ct.name), ct.id) > (lower(p_after_name), p_after_id) end
      when p_sort = 'recent' then
        case when p_after_at is null then ct.last_activity_at is null and ct.id < p_after_id
             else ct.last_activity_at is null or (ct.last_activity_at, ct.id) < (p_after_at, p_after_id) end
      else (ct.created_at, ct.id) < (p_after_at, p_after_id)
    end)
  order by case when p_sort = 'name' then lower(ct.name) end asc nulls last,
           case when p_sort = 'name' then ct.id end asc,
           case when p_sort = 'recent' then ct.last_activity_at
                when p_sort = 'added' then ct.created_at end desc nulls last,
           ct.id desc
  limit least(greatest(p_limit, 1), 101);
$$;

do $migration$
declare
  target regprocedure := 'public.api_search_v2(uuid,text,integer,integer,integer,integer,integer,timestamptz,uuid,uuid[],integer)'::regprocedure;
  definition text := pg_get_functiondef(target);
  start_at integer := strpos(definition, 'and (ct.name ilike');
  end_at integer := strpos(definition, 'order by sim desc, ct.id');
begin
  if start_at = 0 or start_at >= end_at then
    raise exception 'api_search_v2 contact predicate changed';
  end if;
  execute overlay(definition placing 'and public.contact_matches_search(ct, p_q)' || E'\n        '
    from start_at for end_at - start_at);
end $migration$;

revoke execute on function public.refresh_contact_last_activity() from public, anon, authenticated;
revoke execute on function public.set_contact_updated_at() from public, anon, authenticated;
revoke execute on function public.contact_matches_search(public.contacts, text) from public, anon, authenticated;
revoke execute on function public.api_sorted_contacts(uuid, text, integer, text, uuid, text, text, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_sorted_contacts(uuid, text, integer, text, uuid, text, text, uuid, text, timestamptz)
  to service_role;
