-- Global search (D29): GET /v1/search grows from two arms (message FTS +
-- contact trigram) to the full palette set — tasks, note-borne attachments,
-- templates — all Postgres (pg_trgm), no external service (SPEC §Search/D7).
-- A NEW migration — the shipped api_search (20260701010000) is never edited
-- (D7/D14); the Worker moves to api_search_v2 below.
--
-- MMS media is NOT filename-searchable — message_attachments has no file_name
-- column (carrier media carries no filename; D29 states this on purpose so
-- nobody "fixes" it later). The attachments arm covers the generic (note-
-- borne) table only; MMS images stay reachable through the thread/gallery.

-- ===========================================================================
-- 1. Trigram GIN indexes for the new arms (pg_trgm lives in `extensions`,
--    20260701000100). Partial on each table's live-row predicate where one
--    exists: tasks and attachments soft-delete via deleted_at (D17/D19), so
--    their indexes exclude dead rows exactly like their read-path indexes
--    (20260702060000). templates has NO deleted_at — the route hard-deletes
--    (routes/templates.ts) — so its indexes are full, mirroring that.
-- ===========================================================================
create index tasks_title_trgm on public.tasks
  using gin (title extensions.gin_trgm_ops)
  where deleted_at is null;
create index tasks_description_trgm on public.tasks
  using gin (description extensions.gin_trgm_ops)
  where deleted_at is null;

create index attachments_file_name_trgm on public.attachments
  using gin (file_name extensions.gin_trgm_ops)
  where deleted_at is null;

create index templates_name_trgm on public.templates
  using gin (name extensions.gin_trgm_ops);
create index templates_body_trgm on public.templates
  using gin (body extensions.gin_trgm_ops);

-- ===========================================================================
-- 2. api_search_v2 (D29): one jsonb object
--      { conversations, contacts, tasks, attachments, templates }.
--
--    conversations + contacts are the v1 arms verbatim, with ONE addition:
--    each conversation hit also carries the matched message's `direction`,
--    so a note hit (notes are messages rows, direction='note') is labelable
--    in the palette. Conversations remain the only paginated arm (keyset on
--    (matched_at, id) DESC); every other arm is first-page-only via its own
--    limit param, following the p_contact_limit pattern — the Worker passes
--    0 on cursored pages.
--
--    New arms (relevance = similarity/recency per arm; sections, never a
--    blended list):
--      tasks       — live rows; title/description substring (ilike) plus
--                    trigram word-similarity for misspellings; `done` is the
--                    DERIVED join read of the source message's done_at (D17 —
--                    no task-side status column exists, same derivation as
--                    /v1/tasks); matched_at = created_at.
--      attachments — live generic rows; fuzzy file_name (ilike + trigram
--                    similarity, the contacts idiom). Deep link target is the
--                    owning conversation, so conversation_id rides along.
--      templates   — name/body substring + trigram; each hit carries a
--                    left(body, 160) snippet (the list-snippet convention,
--                    20260701050000).
-- ===========================================================================
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
          and (ct.name ilike ('%' || p_q || '%')
               or ct.phone_e164 ilike ('%' || p_q || '%')
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
          and (t.title ilike ('%' || p_q || '%')
               or t.description ilike ('%' || p_q || '%')
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
          and (a.file_name ilike ('%' || p_q || '%')
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
          and (t.name ilike ('%' || p_q || '%')
               or t.body ilike ('%' || p_q || '%')
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
