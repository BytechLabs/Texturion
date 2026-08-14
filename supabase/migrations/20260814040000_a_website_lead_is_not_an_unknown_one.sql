-- #232 — a conversation that came from the customer's own website is not an
-- "unknown" source, and counting it as one is worse than not counting it.
--
-- `api_lead_source_report` groups by `lead_source_id`, and a widget
-- conversation has none: nobody put a lead source on it, because it did not
-- arrive on an advertised line. So it lands in the NULL group, which the card
-- renders as "Don't know".
--
-- That is wrong in both directions at once. It UNDERSTATES coverage — the one
-- number the card uses to decide whether its own ranking is worth trusting —
-- while hiding the widget's entire contribution behind the label that means
-- "we could not tell". A workspace whose website produces half its work would
-- read "half your conversations, we don't know where they came from".
--
-- The count rides on the existing rollup rather than becoming a second report:
-- it is the same question, over the same window, on the same card, and a second
-- panel asking a near-identical question is exactly the shape #540 spent a pass
-- removing.
--
-- DROP FIRST, because the RETURN TYPE changes. `create or replace` cannot
-- change a function's output columns, and adding a defaulted argument instead
-- would leave two overloads and make every existing call ambiguous — the trap
-- `thread_inbound_message` hit earlier today.

drop function if exists public.api_lead_source_report(uuid, timestamptz, timestamptz);

create or replace function public.api_lead_source_report(
  p_company_id uuid,
  p_since      timestamptz,
  p_until      timestamptz
) returns table (
  lead_source_id uuid,
  name           text,
  by_number      bigint,
  by_person      bigint,
  by_widget      bigint,
  total          bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.lead_source_id,
    -- Left join, deliberately: an ARCHIVED source still names itself for the
    -- period it was in use, which is the whole reason archiving exists
    -- instead of deleting. A source row that somehow vanished reads as a null
    -- name and the Worker labels it rather than dropping the count.
    s.name,
    count(*) filter (where c.lead_source_origin = 'number' and not w.credited) as by_number,
    count(*) filter (where c.lead_source_origin = 'manual') as by_person,
    -- #232: the website's own conversations, taken OUT of the group above
    -- rather than added alongside it, so the buckets still partition the
    -- window. A row that overlapped its neighbours would make the card's rows
    -- sum past its own footer.
    count(*) filter (where w.credited) as by_widget,
    -- TOTAL IS ITS OWN COLUMN and not by_number + by_person, which is the
    -- whole reason the unknown bucket survives. An unattributed conversation
    -- has no origin at all, so both filters skip it and the sum would be zero
    -- — the row would come back and then read as nothing. The SQL suite caught
    -- exactly that.
    count(*) filter (where not w.credited) as total
  from public.conversations c
  left join public.lead_sources s on s.id = c.lead_source_id
  -- THE RULE, WRITTEN ONCE. Four counts above depend on it, and four copies of
  -- a predicate is four chances for one of them to drift.
  --
  -- A conversation that STARTED at the customer's website came from the
  -- website. It may well have landed on a number carrying a lead source — the
  -- widget texts one of their numbers, so it usually does — but that source is
  -- an INFERENCE from which line rang, and "started at the widget" is a fact.
  -- The fact wins, which is the same rule #301 already applies everywhere else.
  --
  -- Except against a person. `manual` means somebody looked at the thread and
  -- said where this customer came from; a visitor can perfectly well find the
  -- website because a neighbour recommended the company, and overriding that
  -- with "Website" would erase a human's explicit answer in favour of our own
  -- inference — #301's forbidden move, run backwards.
  cross join lateral (
    select (c.first_source = 'widget'
            and c.lead_source_origin is distinct from 'manual') as credited
  ) w
  where c.company_id = p_company_id
    and c.created_at >= p_since
    and c.created_at <  p_until
    -- Spam is not a customer, and counting it would credit whichever line the
    -- robotext happened to reach. The inbox already treats it as noise.
    and c.is_spam = false
  group by c.lead_source_id, s.name;
$$;

comment on function public.api_lead_source_report(uuid, timestamptz, timestamptz) is
  'Conversations by lead source for a window (#301), plus the #232 count of '
  'those that started from the website widget — which is known rather than '
  'unknown, and must not be reported as the latter.';

revoke all on function public.api_lead_source_report(uuid, timestamptz, timestamptz) from public;
grant execute on function public.api_lead_source_report(uuid, timestamptz, timestamptz) to service_role;
