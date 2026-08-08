-- ===========================================================================
-- [#535] The inbox stops sorting the whole workspace to show thirty rows.
--
-- 9c383266 stopped this function DECORATING every conversation. It still CHOSE
-- the page by reading all of them: 180ms at 50,000 conversations, a top-N sort
-- over the entire workspace, and 203,915 shared buffer hits.
--
-- The cause was one clause, and not the one the issue predicted. The search
-- filter read the joined contact:
--
--   join public.contacts ct on ct.id = c.contact_id
--   ...
--   and (p_q is null
--        or ct.name ilike ... or ct.phone_e164 ilike ...)
--
-- Because that disjunction mentions a column of the joined table, the filter
-- cannot be evaluated before the join. So the join is formed for the whole
-- workspace and the top thirty are found by sorting all of it — no ordered index
-- can be used, whatever indexes exist. Written as a semi-join the predicate
-- belongs to conversations alone, contacts leaves the page query entirely, and an
-- ordered index scan reads thirty rows and stops. Measured on the same data with
-- everything else held equal: 156ms against 0.65ms.
--
-- THE INDEX EARNS ITS PLACE HERE, and it did not before. docs/CAPACITY.md records
-- that this exact index changed nothing, twice, and that was true both times:
-- while the plan was a sort over the whole workspace there was nothing for it to
-- do. It is added in the same migration as the clause that makes it reachable,
-- because either one alone is a cost with no benefit.
--
-- WHAT THIS IS NOT: the dynamic SQL #535 was filed for. The theory was that one
-- cached plan across fifteen parameters could never use an index, and that
-- reaching the planner needed literals. That theory is wrong, and the check is in
-- the record: with plan_cache_mode set to force_generic_plan — the worst case, no
-- literals at all — the rewritten shape still uses the index and still returns in
-- under a millisecond. Forcing the opposite, force_custom_plan on the function,
-- changed nothing (211ms). The problem was never the plan cache. It was a filter
-- that could not be pushed down, and replanning does not help a shape that admits
-- only one plan.
--
-- So there is no dynamic SQL, no format(), and no interpolation of p_q — which
-- also means none of the injection surface that made #535 the risky option.
--
-- WHY DROPPING THE JOIN CANNOT LOSE A ROW, checked rather than assumed. The join
-- removed here was an INNER one, so it could in principle have discarded rows
-- BEFORE the limit, and the decoration below re-joins the same table AFTER it —
-- which would return twenty-nine rows where thirty were asked for. It cannot:
-- conversations.contact_id is NOT NULL and carries a foreign key to contacts with
-- ON DELETE RESTRICT, so every conversation has exactly one contact that exists,
-- and the re-join is a guaranteed one-to-one lookup rather than a filter.
--
-- The whole body is restated because a shipped migration is never edited
-- (D7/D14), and the base copied is the latest definition.
-- ===========================================================================
-- Ordered access for the page query, now that the page query can take it. The
-- leading equalities are what every call constrains; the trailing pair is the
-- order the rows are read in, and the cursor rides the same pair.
create index if not exists conversations_recent_idx
  on public.conversations (company_id, is_spam, last_message_at desc, id desc);

create or replace function public.api_list_conversations(
  p_company_id uuid,
  p_user_id uuid,
  p_limit integer,
  p_status text default null,
  p_assigned_user_id uuid default null,
  p_tag_id uuid default null,
  p_is_spam boolean default false,
  p_unread boolean default false,
  p_q text default null,
  p_cursor_ts timestamptz default null,
  p_cursor_id uuid default null,
  p_pinned text default null,
  p_hidden_number_ids uuid[] default null,
  p_snoozed text default 'exclude',
  p_awaiting text default null
)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $fn$

  -- THE PAGE, chosen with nothing hanging off it. Only the id is carried out:
  -- the decoration below re-reads the row by primary key, which keeps
  -- to_jsonb(c.*) exactly the shape it has always been rather than one carrying
  -- whatever this query needed in order to sort.
  --
  -- contacts is joined here only because the search filter reads the contact's
  -- name and number, and conversation_snoozes only because the deferral filter
  -- reads it. Both are needed to CHOOSE the page, so both stay.
  with page as (
    select c.id, c.last_message_at, c.pinned_at
    from public.conversations c
    -- The deferral is THIS member's. A colleague's snooze must not appear on
    -- their row, and must not hide the thread from them.
    left join public.conversation_snoozes sz
      on sz.conversation_id = c.id
     and sz.user_id = p_user_id
     and sz.until > now()
    where c.company_id = p_company_id
      and c.is_spam = coalesce(p_is_spam, false)
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
      and (p_status is null or c.status = p_status::public.conversation_status)
      and (p_assigned_user_id is null or c.assigned_user_id = p_assigned_user_id)
      and (p_tag_id is null or exists (
            select 1 from public.conversation_tags cx
             where cx.conversation_id = c.id and cx.tag_id = p_tag_id))
      and (not coalesce(p_unread, false) or exists (
            select 1
              from public.messages m
             where m.conversation_id = c.id
               and (m.sent_by_user_id is null or m.sent_by_user_id <> p_user_id)
               and m.created_at > coalesce(
                 (select r.last_read_at
                    from public.conversation_reads r
                   where r.conversation_id = c.id and r.user_id = p_user_id),
                 '-infinity'::timestamptz)))
      -- A SEMI-JOIN, not a join plus a disjunct over its columns. Written the
      -- other way this clause mentioned `contacts`, so the planner could not
      -- separate the join from the filter: it had to build the join for the whole
      -- workspace and then take the top thirty by sorting all of it. Measured at
      -- 50k conversations, that one difference is 156ms against 0.65ms, because
      -- this shape lets the ordered index below do the work instead.
      and (p_q is null
           or c.contact_id in (
                select ct.id
                  from public.contacts ct
                 where ct.name ilike ('%' || p_q || '%')
                    or ct.phone_e164 ilike ('%' || p_q || '%')))
      -- #13 pinned filter: 'only' keeps pinned, 'exclude' drops them, null = all.
      and (p_pinned is null
           or (p_pinned = 'only'    and c.pinned_at is not null)
           or (p_pinned = 'exclude' and c.pinned_at is null))
      -- #508: threads still waiting on a first reply. awaiting_reply_since is the
      -- #388 lead clock, trigger-maintained on every message: set on the first
      -- inbound of a new or reopened thread, cleared by a human outbound. Reading
      -- it here rather than deriving a second "needs a reply" predicate is what
      -- makes the three clients agree by construction — and it is the LIVE twin
      -- of the number the response-time card reports, which counts leads with no
      -- response. status='new' was neither: nothing moves a conversation off it
      -- when the crew replies, so it means "nobody re-filed this" rather than
      -- "nobody answered this".
      and (p_awaiting is null
           or p_awaiting not in ('only', 'exclude')
           or (p_awaiting = 'only'    and c.awaiting_reply_since is not null)
           or (p_awaiting = 'exclude' and c.awaiting_reply_since is null))
      -- #293 deferral: 'exclude' (the DEFAULT) hides what this member deferred,
      -- 'only' is the "what did I defer" view, 'all' opts out entirely. An
      -- unrecognised value falls through to showing everything rather than hiding
      -- a thread on a typo — the failure that costs a customer is the one where a
      -- thread disappears.
      and (p_snoozed is null
           or p_snoozed not in ('exclude', 'only')
           or (p_snoozed = 'exclude' and sz.conversation_id is null)
           or (p_snoozed = 'only'    and sz.conversation_id is not null))
      -- The keyset cursor rides (last_message_at, id) — untouched by pinning, so
      -- the 'exclude' main list paginates exactly as before.
      and (p_cursor_ts is null
           or (c.last_message_at, c.id) < (p_cursor_ts, p_cursor_id))
    -- 'only' sorts most-recently-pinned first; every other mode falls straight
    -- through to the legacy (last_message_at, id) order.
    order by (case when p_pinned = 'only' then c.pinned_at end) desc nulls last,
             c.last_message_at desc, c.id desc
    limit greatest(p_limit, 0)
  )
  -- THE DECORATION, thirty times rather than fifty thousand. The ORDER BY is
  -- restated because the order inside a CTE is not something the outer query
  -- inherits, and this list's order is the product.
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
         -- #293: when THIS member has deferred it, when it comes back and why.
         -- Carried on every row rather than only in the snoozed view, so a thread
         -- that returns mid-session can be labelled without a second read, and so
         -- the snoozed list needs no join of its own.
         'snoozed_until', sz.until,
         'snooze_note', sz.note,
         'unread', exists (
           select 1
             from public.messages m
            where m.conversation_id = c.id
              and (m.sent_by_user_id is null or m.sent_by_user_id <> p_user_id)
              and m.created_at > coalesce(
                (select r.last_read_at
                   from public.conversation_reads r
                  where r.conversation_id = c.id and r.user_id = p_user_id),
                '-infinity'::timestamptz)),
         'last_message', case when lm.id is null then null else
           jsonb_build_object(
             'id', lm.id,
             'direction', lm.direction,
             'body', left(lm.body, 160),
             'created_at', lm.created_at,
             'has_attachments', lm.attachment_count > 0,
             'attachment_count', lm.attachment_count,
             'attachment_kind', lm.attachment_kind)
         end)
  from page
  join public.conversations c on c.id = page.id
  join public.contacts ct on ct.id = c.contact_id
  left join public.conversation_snoozes sz
    on sz.conversation_id = c.id
   and sz.user_id = p_user_id
   and sz.until > now()
  left join lateral (
    select m.id, m.direction, m.body, m.created_at,
           att.attachment_count, att.attachment_kind
    from public.messages m
    left join lateral (
      select count(*)::int as attachment_count,
             case
               when count(*) filter (where a.content_type like 'image/%') > 0
                 then 'image'
               when count(*) filter (where a.content_type like 'audio/%') > 0
                 then 'audio'
               when count(*) filter (where a.content_type like 'video/%') > 0
                 then 'video'
               when count(*) > 0 then 'file'
               else null
             end as attachment_kind
        from public.message_attachments a
       where a.message_id = m.id
    ) att on true
    where m.conversation_id = c.id
    order by m.created_at desc, m.id desc
    limit 1
  ) lm on true
  order by (case when p_pinned = 'only' then c.pinned_at end) desc nulls last,
           c.last_message_at desc, c.id desc
$fn$;
