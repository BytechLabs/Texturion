-- #354 — the marketed pipeline gets something underneath it.
--
-- ---------------------------------------------------------------------------
-- THE FIX IS A STABLE KEY, NOT A LOCK
--
-- #354's worry is that any member can rename "Quote sent" and silently break
-- the workflow /for/plumbers sells. The obvious answer is to protect the name.
-- That is the wrong answer twice: it makes a flexible convention into rigid
-- configuration (which #354's own devil's advocate warns against), and it does
-- not actually work, because the crew that wants "Quoted" will rename it anyway
-- and be right to.
--
-- So the name stops being load-bearing. A seeded tag carries a STAGE — a key
-- the product owns — and everything that reads the pipeline reads the stage.
-- Rename "Quote sent" to "Quoted" to "Estimate out" and the saved view, the
-- conversion report and the marketing claim all keep working, because none of
-- them ever looked at the name.
--
-- What remains genuinely destructive is DELETING one, which throws the stage
-- away. That is the act the API gates behind an explicit confirmation, and the
-- only one that needed a gate.
--
-- ---------------------------------------------------------------------------
-- WHY A COLUMN ON tags RATHER THAN A NEW TABLE
--
-- SPEC is explicit that stages are TAGS, not statuses, and D7 seeds them as
-- tags deliberately: no status machine, no forced process, and a crew can
-- ignore the whole thing. A separate pipeline table would quietly reintroduce
-- the state machine that decision rejected. A nullable column adds a fact about
-- four rows and changes nothing about what a tag is.

alter table public.tags
  add column if not exists pipeline_stage text
    check (pipeline_stage in ('quote_sent', 'scheduled', 'won', 'lost'));

comment on column public.tags.pipeline_stage is
  '#354: which marketed pipeline stage this seeded tag IS, independent of what '
  'the crew has renamed it to. Null for the tags a crew invents. Everything '
  'that reads the pipeline reads this, so a rename can never break it.';

-- One tag per stage per company. Without this a company could end up with two
-- "won" tags and every conversion count would double.
create unique index if not exists tags_pipeline_stage_uq
  on public.tags (company_id, pipeline_stage)
  where pipeline_stage is not null;

-- ---------------------------------------------------------------------------
-- Backfill: every workspace that already exists was seeded with these four
-- names and nothing else knew they were special.
--
-- Matched on the exact seeded name, case-insensitively. A crew that has already
-- renamed one keeps an unmarked tag, which is the honest outcome: we cannot
-- tell "Quoted" from a tag somebody invented, and guessing would attach the
-- machinery to the wrong row. They can still be marked later by hand.
-- ---------------------------------------------------------------------------
update public.tags t
   set pipeline_stage = m.stage
  from (values
        ('quote sent', 'quote_sent'),
        ('scheduled',  'scheduled'),
        ('won',        'won'),
        ('lost',       'lost')) as m(seeded_name, stage)
 where lower(btrim(t.name)) = m.seeded_name
   and t.pipeline_stage is null
   -- Only when this company has no tag on that stage yet, so a re-run cannot
   -- violate the unique index above.
   and not exists (
     select 1 from public.tags o
      where o.company_id = t.company_id and o.pipeline_stage = m.stage);

-- ---------------------------------------------------------------------------
-- Seed the stages, and the ready-made view, at creation.
--
-- #354 orders this deliberately: "ship the saved view first. It delivers the
-- marketed workflow with no loss of flexibility and no new constraints." The
-- Monday-morning ritual /for/plumbers describes — "open the Quote sent list" —
-- was a filter every member rebuilt every week on every device. Now it is one
-- shared view that exists before anybody asks.
--
-- Shared rather than personal (owner_user_id null): the whole point is that the
-- crew looks at the same list. #106 still applies per viewer, because a view is
-- a query and never a grant.
-- ---------------------------------------------------------------------------
create or replace function public.seed_pipeline(p_company_id uuid, p_owner_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote_tag uuid;
begin
  update public.tags set pipeline_stage = 'quote_sent'
   where company_id = p_company_id and lower(btrim(name)) = 'quote sent'
     and pipeline_stage is null;
  update public.tags set pipeline_stage = 'scheduled'
   where company_id = p_company_id and lower(btrim(name)) = 'scheduled'
     and pipeline_stage is null;
  update public.tags set pipeline_stage = 'won'
   where company_id = p_company_id and lower(btrim(name)) = 'won'
     and pipeline_stage is null;
  update public.tags set pipeline_stage = 'lost'
   where company_id = p_company_id and lower(btrim(name)) = 'lost'
     and pipeline_stage is null;

  select id into v_quote_tag from public.tags
   where company_id = p_company_id and pipeline_stage = 'quote_sent';
  if v_quote_tag is null then return; end if;

  -- "Open threads we have quoted and not closed." Open rather than every
  -- status, because the ritual is chasing outstanding money and a closed thread
  -- is not outstanding.
  insert into public.saved_views
    (company_id, owner_user_id, surface, name, filters, position, created_by)
  values (
    p_company_id, null, 'conversations', 'Quote sent',
    jsonb_build_object('status', 'open', 'tag_id', v_quote_tag::text),
    0, p_owner_user_id)
  on conflict do nothing;
end $$;

revoke execute on function public.seed_pipeline(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.seed_pipeline(uuid, uuid) to service_role;

-- Backfill the view for every workspace that already has a quote_sent tag.
do $$
declare
  v_row record;
begin
  for v_row in
    select c.id as company_id, c.owner_user_id
      from public.companies c
     where c.deleted_at is null
       and exists (select 1 from public.tags t
                    where t.company_id = c.id and t.pipeline_stage = 'quote_sent')
       and not exists (select 1 from public.saved_views v
                        where v.company_id = c.id
                          and v.surface = 'conversations'
                          and v.owner_user_id is null
                          and lower(btrim(v.name)) = 'quote sent')
  loop
    perform public.seed_pipeline(v_row.company_id, v_row.owner_user_id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- The conversion the tags have always held and nothing ever read.
--
-- #354: "'Quote sent' versus 'Won' is a win rate, sitting in the data,
-- uncounted." This is the cheapest honest business metric the product can show
-- an owner, and it needs no new writes at all — `conversation_tags.created_at`
-- already records when each stage was applied.
--
-- COUNTED PER CONVERSATION, NOT PER TAG EVENT. A thread tagged "Quote sent"
-- once is one quote however many times somebody re-tags it, and a thread that
-- reached "Won" counts as won whether or not the quote tag was removed on the
-- way. Counting tag rows instead would let a tidy-up inflate the win rate.
--
-- ATTRIBUTED TO THE QUOTE'S DATE, not the win's. An owner asking "how did
-- March's quotes do" means the quotes they sent in March; bucketing by the win
-- date would credit a March quote to the month it finally closed and make every
-- recent period look terrible.
-- ---------------------------------------------------------------------------
create or replace function public.api_pipeline_report(
  p_company_id uuid,
  p_since      timestamptz,
  p_until      timestamptz
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with quoted as (
    select ct.conversation_id, min(ct.created_at) as quoted_at
      from public.conversation_tags ct
      join public.tags t on t.id = ct.tag_id
     where t.company_id = p_company_id
       and t.pipeline_stage = 'quote_sent'
     group by ct.conversation_id
  ),
  outcomes as (
    select ct.conversation_id, t.pipeline_stage, min(ct.created_at) as at
      from public.conversation_tags ct
      join public.tags t on t.id = ct.tag_id
     where t.company_id = p_company_id
       and t.pipeline_stage in ('won', 'lost')
     group by ct.conversation_id, t.pipeline_stage
  ),
  windowed as (
    select q.conversation_id,
           q.quoted_at,
           max(o.at) filter (where o.pipeline_stage = 'won')  as won_at,
           max(o.at) filter (where o.pipeline_stage = 'lost') as lost_at
      from quoted q
      left join outcomes o on o.conversation_id = q.conversation_id
     where q.quoted_at >= p_since and q.quoted_at < p_until
     group by q.conversation_id, q.quoted_at
  )
  select jsonb_build_object(
    'quoted', count(*),
    'won',    count(*) filter (where won_at is not null),
    'lost',   count(*) filter (where lost_at is not null and won_at is null),
    'open',   count(*) filter (where won_at is null and lost_at is null),
    -- Median rather than mean days-to-win: one job that closed after eight
    -- months would drag a mean into uselessness, and the owner is asking how
    -- long a normal quote takes.
    'median_days_to_win', (
      select round(
        percentile_cont(0.5) within group (
          order by extract(epoch from (won_at - quoted_at)) / 86400.0
        )::numeric, 1)
        from windowed where won_at is not null)
  )
  from windowed
$$;

revoke execute on function public.api_pipeline_report(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_pipeline_report(uuid, timestamptz, timestamptz)
  to service_role;
