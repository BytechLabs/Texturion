-- SPEC §7 — security-definer SQL functions backing /v1 routes that PostgREST
-- cannot express directly (D8, D13):
--
--   api_create_company     POST /v1/companies      — atomic company + owner
--                          membership + pre-seeded pipeline tags +
--                          notification_prefs (SPEC §4.1 step 2, §6 tags note)
--   api_list_conversations GET /v1/conversations   — keyset pagination on
--                          (last_message_at, id) DESC with the §7 filters
--                          (status, assigned_user_id, tag_id, is_spam, unread,
--                          q); `unread` is a NOT-EXISTS over per-user
--                          conversation_reads, inexpressible in PostgREST
--   api_search             GET /v1/search          — messages FTS
--                          (websearch_to_tsquery over body_tsv) grouped by
--                          conversation with ts_headline snippets, plus
--                          contacts trgm matching (SPEC §6 Search)
--   api_period_segments    GET /v1/usage           — exact sum(quantity) of
--                          usage_events for the current period (a plain
--                          PostgREST read would truncate at the row cap)
--
-- All functions: SECURITY DEFINER, empty search_path (fully-qualified
-- references), EXECUTE revoked from end-user roles — only service_role (the
-- Worker's sb_secret_ key) may call them. The Worker passes an explicit
-- p_company_id everywhere (SPEC §10 tenant isolation).

-- ---------------------------------------------------------------------------
-- POST /v1/companies (SPEC §4.1 step 2, §7): company + owner membership +
-- pre-seeded pipeline tags ('Quote sent', 'Scheduled', 'Won', 'Lost' — D7) +
-- notification_prefs row, in ONE transaction. Returns the company row as
-- jsonb. aup_accepted_at is stamped here: the route only accepts
-- aup_accepted: true (422 otherwise), so reaching this function IS acceptance.
-- ---------------------------------------------------------------------------
create or replace function public.api_create_company(
  p_owner_user_id       uuid,
  p_name                text,
  p_country             text,
  p_requested_area_code text,
  p_us_texting_enabled  boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company public.companies;
begin
  insert into public.companies
    (name, owner_user_id, country, us_texting_enabled, requested_area_code,
     aup_accepted_at)
  values
    (p_name, p_owner_user_id, p_country, p_us_texting_enabled,
     p_requested_area_code, now())
  returning * into v_company;

  insert into public.company_members (company_id, user_id, role)
  values (v_company.id, p_owner_user_id, 'owner');

  insert into public.tags (company_id, name)
  values (v_company.id, 'Quote sent'),
         (v_company.id, 'Scheduled'),
         (v_company.id, 'Won'),
         (v_company.id, 'Lost');

  insert into public.notification_prefs (user_id, company_id)
  values (p_owner_user_id, v_company.id);

  return to_jsonb(v_company);
end $$;

-- ---------------------------------------------------------------------------
-- GET /v1/conversations (SPEC §7): keyset page on (last_message_at, id) DESC.
-- Each row: the conversation (minus the internal last_notified_at debounce
-- stamp) + embedded contact summary + tags + per-caller `unread` flag.
-- `p_q` matches the contact's name/phone (pg_trgm-indexed ilike); the Worker
-- escapes LIKE wildcards in user input before calling. Spam stays out of the
-- inbox unless explicitly requested (`is_spam` filter, SPEC §6 threading
-- step 3: clients see spam only in the spam view).
-- ---------------------------------------------------------------------------
create or replace function public.api_list_conversations(
  p_company_id       uuid,
  p_user_id          uuid,
  p_limit            int,
  p_status           text        default null,
  p_assigned_user_id uuid        default null,
  p_tag_id           uuid        default null,
  p_is_spam          boolean     default false,
  p_unread           boolean     default false,
  p_q                text        default null,
  p_cursor_ts        timestamptz default null,
  p_cursor_id        uuid        default null
) returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select (to_jsonb(c.*) - 'last_notified_at')
    || jsonb_build_object(
         'contact', jsonb_build_object(
           'id', ct.id, 'name', ct.name, 'phone_e164', ct.phone_e164),
         'tags', coalesce(
           (select jsonb_agg(
                     jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color)
                     order by t.name)
              from public.conversation_tags cx
              join public.tags t on t.id = cx.tag_id
             where cx.conversation_id = c.id),
           '[]'::jsonb),
         'unread', c.last_message_at > coalesce(
           (select r.last_read_at
              from public.conversation_reads r
             where r.conversation_id = c.id and r.user_id = p_user_id),
           '-infinity'::timestamptz))
  from public.conversations c
  join public.contacts ct on ct.id = c.contact_id
  where c.company_id = p_company_id
    and c.is_spam = coalesce(p_is_spam, false)
    and (p_status is null or c.status = p_status::public.conversation_status)
    and (p_assigned_user_id is null or c.assigned_user_id = p_assigned_user_id)
    and (p_tag_id is null or exists (
          select 1 from public.conversation_tags cx
           where cx.conversation_id = c.id and cx.tag_id = p_tag_id))
    and (not coalesce(p_unread, false) or c.last_message_at > coalesce(
          (select r.last_read_at
             from public.conversation_reads r
            where r.conversation_id = c.id and r.user_id = p_user_id),
          '-infinity'::timestamptz))
    and (p_q is null
         or ct.name ilike ('%' || p_q || '%')
         or ct.phone_e164 ilike ('%' || p_q || '%'))
    and (p_cursor_ts is null
         or (c.last_message_at, c.id) < (p_cursor_ts, p_cursor_id))
  order by c.last_message_at desc, c.id desc
  limit greatest(p_limit, 0)
$$;

-- ---------------------------------------------------------------------------
-- GET /v1/search (SPEC §6 Search, §7): one jsonb object
--   { "conversations": [...], "contacts": [...] }.
-- Conversations: message FTS via websearch_to_tsquery over the generated
-- body_tsv, grouped by conversation (DISTINCT ON keeps the newest matching
-- message per thread), each hit carrying a ts_headline snippet; keyset-
-- paginated on (matched_at, conversation id) DESC. Contacts: pg_trgm partial
-- name / partial phone (ilike) plus similarity-threshold matching for
-- misspellings, ranked by similarity; fetched only for the first page
-- (p_contact_limit = 0 on cursor requests).
-- ---------------------------------------------------------------------------
create or replace function public.api_search(
  p_company_id         uuid,
  p_q                  text,
  p_conversation_limit int,
  p_contact_limit      int,
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
                 'snippet', ts_headline('english', m.body,
                                        websearch_to_tsquery('english', p_q))
               ) as row_json
        from (
          select distinct on (m0.conversation_id)
                 m0.id, m0.conversation_id, m0.created_at, m0.body
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
    ), '[]'::jsonb)
  )
$$;

-- ---------------------------------------------------------------------------
-- GET /v1/usage (SPEC §7, §9): exact outbound-segment total for the current
-- period from usage_events (the app-side source of truth — never Stripe).
-- SUM in SQL: a PostgREST row read would silently truncate at the server row
-- cap once a period has more usage events than the cap.
-- ---------------------------------------------------------------------------
create or replace function public.api_period_segments(
  p_company_id uuid,
  p_since      timestamptz
) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(quantity), 0)::bigint
  from public.usage_events
  where company_id = p_company_id
    and created_at >= p_since
$$;

-- ---------------------------------------------------------------------------
-- Privileges: deny-by-default posture (SPEC §6). Functions default to PUBLIC
-- EXECUTE — strip it, then grant only service_role (the Worker). No end-user
-- role can reach these even with a valid Supabase Auth JWT.
-- ---------------------------------------------------------------------------
revoke execute on function public.api_create_company(uuid, text, text, text, boolean)
  from public, anon, authenticated;
revoke execute on function public.api_list_conversations(uuid, uuid, int, text, uuid, uuid, boolean, boolean, text, timestamptz, uuid)
  from public, anon, authenticated;
revoke execute on function public.api_search(uuid, text, int, int, timestamptz, uuid)
  from public, anon, authenticated;
revoke execute on function public.api_period_segments(uuid, timestamptz)
  from public, anon, authenticated;

grant execute on function public.api_create_company(uuid, text, text, text, boolean)
  to service_role;
grant execute on function public.api_list_conversations(uuid, uuid, int, text, uuid, uuid, boolean, boolean, text, timestamptz, uuid)
  to service_role;
grant execute on function public.api_search(uuid, text, int, int, timestamptz, uuid)
  to service_role;
grant execute on function public.api_period_segments(uuid, timestamptz)
  to service_role;
