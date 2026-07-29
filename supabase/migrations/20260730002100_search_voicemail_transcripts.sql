-- #409 — a phrase spoken in a voicemail is findable by the same box that finds
-- it when the customer types it instead.
--
-- D29's search covers messages, contacts, tasks, note-borne attachments and
-- templates, and it is careful work — it even documents a deliberate exclusion
-- so nobody undoes it. But it PREDATES the calls feature, and the three
-- transcript migrations that shipped afterwards never touched it. Nothing was
-- decided; an arm was never added.
--
-- The irony was expensive. We pay Workers AI per audio-minute, store the
-- words, cap and alert on the spend, and render them on three clients — and
-- then the one thing text is uniquely good for did not work.
--
-- ---------------------------------------------------------------------------
-- DROP FIRST. This is the api_authorize_request lesson, and it is why this
-- file is longer than its diff. `create or replace` does NOT replace a
-- function whose ARGUMENT LIST differs — it builds an overload. With the new
-- parameter defaulted, a ten-argument call would then match both and Postgres
-- refuses it as ambiguous, which breaks every search in the product.
drop function if exists public.api_search_v2(
  uuid, text, int, int, int, int, int, timestamptz, uuid, uuid[]
);

-- Only the rows that HAVE words. Transcription is best-effort and capped, so
-- most calls carry none, and an index over the whole table would be mostly
-- empty pages.
create index if not exists calls_transcript_trgm
  on public.calls using gin (voicemail_transcript extensions.gin_trgm_ops)
  where voicemail_transcript is not null;

CREATE OR REPLACE FUNCTION public.api_search_v2(p_company_id uuid, p_q text, p_conversation_limit integer, p_contact_limit integer, p_task_limit integer, p_attachment_limit integer, p_template_limit integer, p_cursor_ts timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_hidden_number_ids uuid[] DEFAULT NULL::uuid[], p_voicemail_limit integer DEFAULT 0)
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
    ), '[]'::jsonb),
    -- #409: the words we paid to write down.
    --
    -- Transcription exists because somebody on a roof or next to a running
    -- compressor cannot play a voicemail, and one nobody listens to is a
    -- missed customer. We spend Workers AI money per audio-minute, store the
    -- words, cap and alert on the spend, and render them on three clients —
    -- and then the one thing text is uniquely good for, finding it again
    -- later, did not work. "What did that guy say about the boiler on Elm
    -- Street?" three weeks on is a real daily question.
    --
    -- #106 IS ENFORCED HERE, directly. A call carries `phone_number_id`, so
    -- the deny-list filter is a plain predicate rather than the subquery the
    -- attachment arm needs — but it is not optional: a transcript is customer
    -- speech, and an arm that forgot this would be a way to read around the
    -- deny list. That is exactly the trap #368 describes, a rule enforced by
    -- N independent implementations where the newest one forgets.
    'voicemails',
    coalesce((
      select jsonb_agg(k.row_json order by k.sim desc, k.id)
      from (
        select c.id,
               extensions.word_similarity(p_q, c.voicemail_transcript) as sim,
               jsonb_build_object(
                 'id', c.id,
                 'call_session_id', c.call_session_id,
                 'contact_id', c.contact_id,
                 'caller_e164', c.caller_e164,
                 'started_at', c.started_at,
                 'snippet', left(c.voicemail_transcript, 160)
               ) as row_json
        from public.calls c
        where c.company_id = p_company_id
          and c.voicemail_transcript is not null
          and (c.voicemail_transcript ilike ('%' || replace(replace(replace(p_q, '', '\'), '%', '\%'), '_', '\_') || '%')
               or p_q operator(extensions.<%) c.voicemail_transcript)
          and (p_hidden_number_ids is null
               or c.phone_number_id is null
               or not (c.phone_number_id = any(p_hidden_number_ids)))
        order by sim desc, c.started_at desc, c.id
        limit greatest(p_voicemail_limit, 0)
      ) k
    ), '[]'::jsonb)
  )
$function$;

revoke execute on function public.api_search_v2(
  uuid, text, int, int, int, int, int, timestamptz, uuid, uuid[], int
) from public, anon, authenticated;
grant execute on function public.api_search_v2(
  uuid, text, int, int, int, int, int, timestamptz, uuid, uuid[], int
) to service_role;
