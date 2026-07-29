-- #419 — search must not offer a saved reply that has been deleted.
--
-- `api_search_v2` was the ONLY reader of `templates` outside its own route, so
-- adding a soft delete without touching it would have left deleted saved
-- replies findable — and unopenable, since every other path now filters them.
--
-- Regenerated from the live definition (20260725010000) with one clause added,
-- because a function this size is safer restated in full than patched: the
-- argument list must match EXACTLY or `create or replace` builds an overload
-- instead of replacing, and an ambiguous api_search_v2 breaks every search in
-- the product.

CREATE OR REPLACE FUNCTION public.api_search_v2(p_company_id uuid, p_q text, p_conversation_limit integer, p_contact_limit integer, p_task_limit integer, p_attachment_limit integer, p_template_limit integer, p_cursor_ts timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_hidden_number_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'conversations',
    coalesce((
      select jsonb_agg(hit.row_json order by hit.matched_at desc, hit.cid desc)
      from (
        select c.id as cid, m.created_at as matched_at,
               jsonb_build_object(
                 'id', c.id,
                 'status', c.status,
                 'is_spam', c.is_spam,
                 'last_message_at', c.last_message_at,
                 'contact', jsonb_build_object(
                   'id', ct.id, 'name', ct.name, 'phone_e164', ct.phone_e164),
                 'matched_message_id', m.id,
                 'matched_at', m.created_at,
                 'direction', m.direction,
                 'snippet', ts_headline('english', m.body,
                                        websearch_to_tsquery('english', p_q))
               ) as row_json
        from (
          select distinct on (m0.conversation_id)
                 m0.id, m0.conversation_id, m0.created_at, m0.body, m0.direction
          from public.messages m0
          where m0.company_id = p_company_id
            and m0.body_tsv @@ websearch_to_tsquery('english', p_q)
          order by m0.conversation_id, m0.created_at desc, m0.id desc
        ) m
        join public.conversations c on c.id = m.conversation_id
        join public.contacts ct on ct.id = c.contact_id
        where (p_cursor_ts is null
               or (m.created_at, c.id) < (p_cursor_ts, p_cursor_id))
          -- #106: never surface a conversation on a number hidden from the caller.
          and (p_hidden_number_ids is null
               or c.phone_number_id is null
               or not (c.phone_number_id = any(p_hidden_number_ids)))
        order by m.created_at desc, c.id desc
        limit greatest(p_conversation_limit, 0)
      ) hit
    ), '[]'::jsonb),
    'contacts',
    coalesce((
      select jsonb_agg(
               jsonb_build_object('id', k.id, 'name', k.name,
                                  'phone_e164', k.phone_e164)
               order by k.sim desc, k.id)
      from (
        select ct.id, ct.name, ct.phone_e164,
               greatest(extensions.similarity(coalesce(ct.name, ''), p_q),
                        extensions.similarity(ct.phone_e164, p_q)) as sim
        from public.contacts ct
        where ct.company_id = p_company_id
          and ct.deleted_at is null
          and (ct.name ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
               or ct.phone_e164 ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
               -- Digits against digits, so a number typed or pasted the way
               -- it is READ finds the contact. Substring matching on the
               -- stored value cannot: it holds +16478923862, and every
               -- human spelling carries punctuation the pattern fails on.
               or (length(regexp_replace(p_q, '[^0-9]', '', 'g')) >= 3
                   and regexp_replace(ct.phone_e164, '[^0-9]', '', 'g')
                       like ('%' || regexp_replace(p_q, '[^0-9]', '', 'g') || '%'))
               or coalesce(ct.name, '') operator(extensions.%) p_q)
        order by sim desc, ct.id
        limit greatest(p_contact_limit, 0)
      ) k
    ), '[]'::jsonb),
    'tasks',
    coalesce((
      select jsonb_agg(k.row_json order by k.sim desc, k.created_at desc, k.id)
      from (
        select t.id, t.created_at,
               greatest(extensions.word_similarity(p_q, t.title),
                        extensions.word_similarity(p_q, t.description)) as sim,
               jsonb_build_object(
                 'id', t.id,
                 'title', t.title,
                 'conversation_id', t.conversation_id,
                 'done', (m.done_at is not null),
                 'matched_at', t.created_at
               ) as row_json
        from public.tasks t
        join public.messages m on m.id = t.message_id
        where t.company_id = p_company_id
          and t.deleted_at is null
          and (t.title ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
               or t.description ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
               or p_q operator(extensions.<%) t.title
               or p_q operator(extensions.<%) t.description)
          -- #106: hide a task whose conversation is on a hidden number.
          and (p_hidden_number_ids is null or not exists (
                select 1 from public.conversations cc
                 where cc.id = t.conversation_id
                   and cc.phone_number_id = any(p_hidden_number_ids)))
        order by sim desc, t.created_at desc, t.id
        limit greatest(p_task_limit, 0)
      ) k
    ), '[]'::jsonb),
    'attachments',
    coalesce((
      select jsonb_agg(k.row_json order by k.sim desc, k.created_at desc, k.id)
      from (
        select a.id, a.created_at,
               extensions.similarity(coalesce(a.file_name, ''), p_q) as sim,
               jsonb_build_object(
                 'id', a.id,
                 'file_name', a.file_name,
                 'owner_type', a.owner_type,
                 'conversation_id', a.conversation_id,
                 'content_type', a.content_type,
                 'created_at', a.created_at
               ) as row_json
        from public.attachments a
        where a.company_id = p_company_id
          and a.deleted_at is null
          and (a.file_name ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
               or a.file_name operator(extensions.%) p_q)
          -- #106: hide an attachment whose conversation is on a hidden number.
          and (p_hidden_number_ids is null or not exists (
                select 1 from public.conversations cc
                 where cc.id = a.conversation_id
                   and cc.phone_number_id = any(p_hidden_number_ids)))
        order by sim desc, a.created_at desc, a.id
        limit greatest(p_attachment_limit, 0)
      ) k
    ), '[]'::jsonb),
    'templates',
    coalesce((
      select jsonb_agg(k.row_json order by k.sim desc, k.id)
      from (
        select t.id,
               greatest(extensions.similarity(t.name, p_q),
                        extensions.word_similarity(p_q, t.body)) as sim,
               jsonb_build_object(
                 'id', t.id,
                 'name', t.name,
                 'snippet', left(t.body, 160)
               ) as row_json
        from public.templates t
        where t.company_id = p_company_id
          -- #419: a soft-deleted saved reply must not resurface here.
          -- Search was the one reader outside the route, and it would
          -- have kept offering a template nobody could open.
          and t.deleted_at is null
          and (t.name ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
               or t.body ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
               or t.name operator(extensions.%) p_q
               or p_q operator(extensions.<%) t.body)
        order by sim desc, t.id
        limit greatest(p_template_limit, 0)
      ) k
    ), '[]'::jsonb)
  )
$function$;

-- create or replace preserves grants; the access is restated rather than
-- relying on that, matching the migrations that defined this function.
revoke execute on function public.api_search_v2(
  uuid, text, int, int, int, int, int, timestamptz, uuid, uuid[]
) from public, anon, authenticated;
grant execute on function public.api_search_v2(
  uuid, text, int, int, int, int, int, timestamptz, uuid, uuid[]
) to service_role;
