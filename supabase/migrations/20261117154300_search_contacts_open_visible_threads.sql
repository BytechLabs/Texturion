do $migration$
declare
  search_function regprocedure := 'public.api_search_v2(uuid,text,integer,integer,integer,integer,integer,timestamptz,uuid,uuid[],integer)'::regprocedure;
  definition text := pg_get_functiondef(search_function);
  updated text;
begin
  updated := replace(definition,
    $old$'phone_e164', k.phone_e164)$old$,
    $new$'phone_e164', k.phone_e164,
                 'conversation', (
                   select jsonb_build_object(
                     'id', cv.id, 'status', cv.status, 'last_message_at', cv.last_message_at
                   )
                   from public.conversations cv
                   where cv.company_id = p_company_id
                     and cv.contact_id = k.id
                     and cv.deleted_at is null
                     and not cv.is_spam
                     and (
                       p_hidden_number_ids is null or cv.phone_number_id is null
                       or not (cv.phone_number_id = any(p_hidden_number_ids))
                     )
                   order by cv.last_message_at desc nulls last, cv.id desc
                   limit 1
                 ))$new$);
  if updated = definition then
    raise exception 'api_search_v2: the contact result columns changed';
  end if;

  definition := updated;
  updated := replace(definition,
    $old$from public.contacts ct
        where ct.company_id = p_company_id
          and ct.deleted_at is null$old$,
    $new$from public.contacts ct
        where ct.company_id = p_company_id
          and ct.deleted_at is null
          and ct.merged_into is null$new$);
  if updated = definition then
    raise exception 'api_search_v2: the contact filters changed';
  end if;
  execute updated;
end $migration$;

revoke execute on function public.api_search_v2(uuid, text, int, int, int, int, int, timestamptz, uuid, uuid[], int)
  from public, anon, authenticated;
grant execute on function public.api_search_v2(uuid, text, int, int, int, int, int, timestamptz, uuid, uuid[], int)
  to service_role;
