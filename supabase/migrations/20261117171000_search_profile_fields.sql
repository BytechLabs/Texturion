create index contacts_address_search_trgm_idx
  on public.contacts using gin (address extensions.gin_trgm_ops)
  where deleted_at is null;

create index contact_addresses_search_trgm_idx
  on public.contact_addresses using gin (address extensions.gin_trgm_ops);

create index tasks_address_search_trgm_idx
  on public.tasks using gin (addr_street extensions.gin_trgm_ops)
  where deleted_at is null;

do $migration$
declare
  search_function regprocedure :=
    'public.api_search_v2(uuid,text,integer,integer,integer,integer,integer,timestamptz,uuid,uuid[],integer)'::regprocedure;
  definition text := pg_get_functiondef(search_function);
  edit record;
  updated text;
begin
  for edit in
    select * from (values
      ($old$jsonb_build_object('id', k.id, 'name', k.name,$old$,
       $new$jsonb_build_object('id', k.id, 'name', k.name,
                                  'matched', details.field,
                                  'matched_line', substring(details.line
                                    from greatest(1, strpos(lower(details.line), lower(p_q)) - 40) for 160),$new$),
      ($old$select ct.id, ct.name, ct.phone_e164,$old$,
       $new$select ct.id, ct.name, ct.phone_e164,
               ct.address, ct.business_name, ct.email, ct.notes, ct.custom_values,$new$),
      ($old$or coalesce(ct.name, '') operator(extensions.%) p_q)$old$,
       $new$or coalesce(ct.name, '') operator(extensions.%) p_q
               or ct.address ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
               or ct.business_name ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
               or ct.email ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
               or ct.notes ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
               or ct.custom_values ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
               or exists (
                 select 1 from public.contact_addresses a
                 where a.company_id = p_company_id and a.contact_id = ct.id
                   and a.address ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
               ))$new$),
      ($old$limit greatest(p_contact_limit, 0)
      ) k$old$,
       $new$limit greatest(p_contact_limit, 0)
      ) k
      left join lateral (
        select candidate.field, candidate.line
        from (
          values (1, 'address', k.address),
                 (3, 'business_name', k.business_name),
                 (4, 'email', k.email),
                 (5, 'notes', k.notes),
                 (6, 'custom_values', k.custom_values)
          union all
          select 2, 'address', a.address
          from public.contact_addresses a
          where a.company_id = p_company_id and a.contact_id = k.id
        ) candidate(priority, field, line)
        where candidate.line ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
        order by candidate.priority, candidate.line
        limit 1
      ) details on true$new$),
      ($old$or p_q operator(extensions.<%) t.description)$old$,
       $new$or p_q operator(extensions.<%) t.description
               or t.addr_street ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
               or t.addr_city ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
               or t.addr_postal_code ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'))$new$)
    ) as edits(anchor, replacement)
  loop
    updated := replace(definition, edit.anchor, edit.replacement);
    if updated = definition then
      raise exception 'api_search_v2: the search profile anchor changed: %', edit.anchor;
    end if;
    definition := updated;
  end loop;
  execute definition;
end;
$migration$;

revoke execute on function public.api_search_v2(uuid, text, int, int, int, int, int, timestamptz, uuid, uuid[], int)
  from public, anon, authenticated;
grant execute on function public.api_search_v2(uuid, text, int, int, int, int, int, timestamptz, uuid, uuid[], int)
  to service_role;
