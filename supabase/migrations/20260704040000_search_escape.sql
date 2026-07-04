-- Global search: escape LIKE metacharacters in the search term (D29 follow-up).
-- api_search_v2 (20260704020000) feeds p_q straight into five ilike operands
-- (contacts name/phone, tasks title/description, attachments file_name,
-- templates name/body). Unescaped, a `%` or `_` in the query becomes a LIKE
-- wildcard — '50%' matches "5000 units", a bare '_' dumps every row, and a
-- trailing backslash breaks the pattern outright.
--
-- A NEW migration create-or-replaces the function so a fresh db reset applies
-- cleanly in order (20260704020000 is treated as shipped — never edited).
-- Only the ilike operands change: p_q is wrapped in a nested replace() that
-- escapes the backslash FIRST (\ → \\), THEN percent (% → \%), THEN underscore
-- (_ → \_), then surrounded with % wildcards for the substring match. LIKE's
-- default escape is backslash, so the doubled/prefixed backslashes make each
-- metacharacter a literal. Escaping the backslash first is essential — do it
-- last and it would double the backslashes just added for % and _.
--
-- The trigram similarity arms (operator(extensions.%) / operator(<%)) are
-- metacharacter-agnostic and stay untouched, so fuzzy matching is unchanged.
-- Signature, security posture (SECURITY DEFINER, empty search_path), and the
-- REVOKE/GRANT block are identical to the shipped function.

create or replace function public.api_search_v2(
  p_company_id         uuid,
  p_q                  text,
  p_conversation_limit int,
  p_contact_limit      int,
  p_task_limit         int,
  p_attachment_limit   int,
  p_template_limit     int,
  p_cursor_ts          timestamptz default null,
  p_cursor_id          uuid        default null
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
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
          and (t.name ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
               or t.body ilike ('%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
               or t.name operator(extensions.%) p_q
               or p_q operator(extensions.<%) t.body)
        order by sim desc, t.id
        limit greatest(p_template_limit, 0)
      ) k
    ), '[]'::jsonb)
  )
$$;

-- ---------------------------------------------------------------------------
-- Privileges: deny-by-default posture (SPEC §6). Functions default to PUBLIC
-- EXECUTE — strip it, then grant only service_role (the Worker). No end-user
-- role can reach this even with a valid Supabase Auth JWT.
-- ---------------------------------------------------------------------------
revoke execute on function public.api_search_v2(uuid, text, int, int, int, int, int, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.api_search_v2(uuid, text, int, int, int, int, int, timestamptz, uuid)
  to service_role;
