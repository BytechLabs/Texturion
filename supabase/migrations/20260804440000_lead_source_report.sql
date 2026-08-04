-- [#301] Conversations by source, for a window.
--
-- One aggregate rather than a page of conversations the Worker counts itself:
-- the inbox is the busiest table in the product, and a report that streams
-- every row of a quarter to a Worker to be tallied is a report that gets
-- slower every month a workspace succeeds.
--
-- ---------------------------------------------------------------------------
-- THE UNKNOWN BUCKET IS A ROW, NOT AN OMISSION.
--
-- #301's fourth Acceptance line: "Reporting distinguishes attributed from
-- unknown, and never infers silently." A `where lead_source_id is not null`
-- here would make every percentage downstream a percentage of the wrong
-- denominator, and the table would look complete. So conversations with no
-- source are grouped under a NULL id and counted like anything else; the
-- Worker turns that row into the coverage number an owner actually needs.
-- ---------------------------------------------------------------------------

create or replace function public.api_lead_source_report(
  p_company_id uuid,
  p_since      timestamptz,
  p_until      timestamptz
)
returns table (
  lead_source_id uuid,
  name           text,
  by_number      bigint,
  by_person      bigint,
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
    count(*) filter (where c.lead_source_origin = 'number') as by_number,
    count(*) filter (where c.lead_source_origin = 'manual') as by_person,
    -- TOTAL IS ITS OWN COLUMN and not by_number + by_person, which is the
    -- whole reason the unknown bucket survives. An unattributed conversation
    -- has no origin at all, so both filters skip it and the sum would be zero
    -- — the row would come back and then read as nothing. The SQL suite caught
    -- exactly that.
    count(*) as total
  from public.conversations c
  left join public.lead_sources s on s.id = c.lead_source_id
  where c.company_id = p_company_id
    and c.created_at >= p_since
    and c.created_at <  p_until
    -- Spam is not a customer, and counting it would credit whichever line the
    -- robotext happened to reach. The inbox already treats it as noise.
    and c.is_spam = false
  group by c.lead_source_id, s.name;
$$;

comment on function public.api_lead_source_report(uuid, timestamptz, timestamptz) is
  'Conversations by lead source for a window (#301). Groups unattributed under a NULL id so the caller can report coverage rather than a percentage of the wrong denominator.';

revoke all on function public.api_lead_source_report(uuid, timestamptz, timestamptz) from public;
grant execute on function public.api_lead_source_report(uuid, timestamptz, timestamptz) to service_role;
