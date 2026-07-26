-- ===========================================================================
-- [#342] Continued inbound to a spam-marked thread, made visible.
--
-- D7 rule 3 silently appends to a closed spam thread, #49 freezes its
-- `last_message_at` so it cannot jump a list, and the notification pipeline
-- skips it. For a robotext sender that is exactly right and none of it changes
-- here.
--
-- The failure is what happens when the mark is wrong — a mis-tap, a first
-- message that looked like spam, a recycled number, a difficult customer
-- someone did not want to deal with. The customer keeps texting; no
-- notification fires, no count moves, and the thread is pinned at the moment
-- it was marked, sinking steadily in the one view someone might open. From the
-- business's side that person simply stopped texting. From theirs, they are
-- being ignored by a business they are trying to pay.
--
-- NOTHING NEW IS CAPTURED. `spam_marked` already records who and when, and the
-- messages that appended afterwards are already rows. The evidence exists; it
-- is on a page nobody opens. This is a read-model over what is already there,
-- plus one column to remember "yes, still spam" so the prompt can be answered
-- instead of nagging.
--
-- IT MUST STAY QUIET FOR REAL SPAM. A robotext appending forever must produce
-- nothing, or this reintroduces the noise rule 3 exists to remove. So the
-- model does not list spam threads with activity — it lists the ones whose
-- activity does not look like spam.
-- ===========================================================================

-- "Yes, this is still spam." Moves the watermark so the same messages are not
-- raised twice; new activity past it can raise it again. NULL = never asked.
alter table public.conversations
  add column if not exists spam_reviewed_at timestamptz;

comment on column public.conversations.spam_reviewed_at is
  '#342: when someone last confirmed a spam mark was right. The review model only counts inbound after this, so a confirmed mark stops nagging without becoming permanent again.';

-- The read path: spam threads for one company, newest mark first.
create index if not exists conversations_spam_review_idx
  on public.conversations (company_id, is_spam)
  where is_spam;

-- ---------------------------------------------------------------------------
-- [#342] What has arrived since a thread was marked spam, and whether it looks
-- like a mistake.
--
-- Three signals, in the order they are trusted:
--
--   1. WE TEXTED THEM FIRST. The strongest by far. A number this business sent
--      to before marking it spam is a number somebody chose to contact — the
--      issue's "reply-shaped message", made concrete. A robotexter is not
--      someone you texted.
--   2. SUSTAINED. Inbound spread across days rather than arriving in one
--      burst. Campaigns fire and stop; a person trying to reach you keeps
--      trying next week.
--   3. VOLUME. Enough messages that it is worth a human glance regardless.
--
-- A thread matching none of them is not returned at all. That is the point:
-- the ordinary case produces an empty list and no one is bothered.
-- ---------------------------------------------------------------------------
create or replace function public.api_spam_review(
  p_company_id        uuid,
  p_limit             int default 20,
  p_hidden_number_ids uuid[] default null,
  -- Thresholds as parameters so the tests can pin the behaviour without
  -- waiting three days or sending ten texts.
  p_sustained_days    int default 3,
  p_volume            int default 10
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with marked as (
    select c.id, c.contact_id, c.phone_number_id, c.spam_reviewed_at,
           (select max(e.created_at)
              from public.conversation_events e
             where e.conversation_id = c.id
               and e.type = 'spam_marked') as marked_at,
           (select e.actor_user_id
              from public.conversation_events e
             where e.conversation_id = c.id
               and e.type = 'spam_marked'
             order by e.created_at desc
             limit 1) as marked_by
      from public.conversations c
     where c.company_id = p_company_id
       and c.is_spam
       -- #106: a restricted member must not learn that a hidden number's
       -- conversations exist, review strip included.
       and (p_hidden_number_ids is null
            or c.phone_number_id is null
            or not (c.phone_number_id = any(p_hidden_number_ids)))
  ),
  watermarked as (
    -- Count from the LATER of "when it was marked" and "when someone last
    -- confirmed the mark" — answering the prompt has to mean something.
    select m.*, greatest(m.marked_at, coalesce(m.spam_reviewed_at, m.marked_at)) as since
      from marked m
     where m.marked_at is not null
  ),
  activity as (
    select w.id, w.contact_id, w.marked_at, w.marked_by, w.since,
           count(*) as inbound_since,
           min(msg.created_at) as first_inbound_at,
           max(msg.created_at) as last_inbound_at
      from watermarked w
      join public.messages msg
        on msg.conversation_id = w.id
       and msg.direction = 'inbound'
       and msg.created_at > w.since
     group by w.id, w.contact_id, w.marked_at, w.marked_by, w.since
  ),
  judged as (
    select a.*,
           -- Any outbound to this contact, in any thread, before the mark.
           exists (
             select 1
               from public.messages om
               join public.conversations oc on oc.id = om.conversation_id
              where oc.company_id = p_company_id
                and oc.contact_id = a.contact_id
                and om.direction = 'outbound'
                and om.created_at < a.marked_at
           ) as we_texted_them,
           (a.inbound_since >= 2
            and a.last_inbound_at - a.first_inbound_at
                >= make_interval(days => p_sustained_days)) as sustained,
           (a.inbound_since >= p_volume) as high_volume
      from activity a
  )
  select coalesce(jsonb_agg(row order by rank, last_inbound_at desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'conversation_id', j.id,
               'contact', (select jsonb_build_object('id', ct.id, 'name', ct.name,
                                                     'phone_e164', ct.phone_e164)
                             from public.contacts ct where ct.id = j.contact_id),
               'marked_at', j.marked_at,
               'marked_by_user_id', j.marked_by,
               'inbound_since', j.inbound_since,
               -- The REAL latest message time, not the frozen sort key — the
               -- whole reason this thread is invisible is that the two differ.
               'last_inbound_at', j.last_inbound_at,
               'we_texted_them', j.we_texted_them,
               'sustained', j.sustained,
               'high_volume', j.high_volume
             ) as row,
             -- Strongest signal first, so the most-likely mistake is the first
             -- thing read rather than the busiest robotexter.
             case when j.we_texted_them then 0
                  when j.sustained then 1
                  else 2 end as rank,
             j.last_inbound_at
        from judged j
       where j.we_texted_them or j.sustained or j.high_volume
       order by rank, j.last_inbound_at desc
       limit p_limit
    ) ranked
$$;

revoke execute on function public.api_spam_review(uuid, int, uuid[], int, int)
  from public, anon, authenticated;
grant execute on function public.api_spam_review(uuid, int, uuid[], int, int)
  to service_role;
