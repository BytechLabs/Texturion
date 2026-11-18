create function public.api_find_thread_messages(p_company uuid, p_thread uuid, p_query text)
returns table (id uuid, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select m.id, m.created_at
    from public.messages m
    join public.conversations c on c.id = m.conversation_id and c.company_id = m.company_id
   where m.company_id = p_company and m.conversation_id = p_thread
     and c.deleted_at is null and m.deleted_at is null
     and m.reaction_to_message_id is null
     and m.body_tsv @@ public.search_tsquery(p_query)
   order by m.created_at desc, m.id desc
   limit 51;
$$;

revoke execute on function public.api_find_thread_messages(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.api_find_thread_messages(uuid, uuid, text) to service_role;
