-- #298 — tag sprawl: merge the duplicates, see the sprawl, and let a crew that
-- wants a controlled taxonomy have one.
--
-- ---------------------------------------------------------------------------
-- MERGE IS THE OPERATION THAT WAS MISSING, AND WHY
--
-- #298: "delete is the only cleanup, and it is destructive. An admin who finds
-- six variants can only delete five, losing the associations. There is no way
-- to say 'these are the same thing'."
--
-- That is the whole problem. Sprawl is not painful because there are too many
-- tags; it is painful because filtering by "emergency" misses every thread
-- tagged "Emergency", and returns a confident, complete-looking result. A
-- filter that quietly under-returns is worse than no filter, because the reader
-- trusts it.
--
-- ---------------------------------------------------------------------------
-- THE CASES THAT MAKE THIS MORE THAN AN UPDATE
--
-- A conversation carrying BOTH tags. The primary key is (conversation_id,
-- tag_id), so a naive UPDATE violates it. Those rows are dropped rather than
-- moved, keeping the earlier `created_at` — the thread was in that category
-- from the first time somebody said so, whichever spelling they used.
--
-- A PIPELINE STAGE on either side (#354/D108). The stage travels with the
-- survivor: merging an ordinary tag into a stage keeps the stage, and merging a
-- stage into an ordinary tag MOVES it rather than dropping it, because the
-- alternative is silently losing a workspace's win rate to a tidy-up. Two stage
-- tags cannot merge at all — the unique index already refuses a second tag on
-- one stage, and that is exactly what stops a merge from doubling every count.

create or replace function public.api_merge_tags(
  p_company_id uuid,
  p_from_tag   uuid,
  p_into_tag   uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from public.tags;
  v_into public.tags;
  v_moved integer;
  v_merged integer;
begin
  select * into v_from from public.tags
   where id = p_from_tag and company_id = p_company_id;
  select * into v_into from public.tags
   where id = p_into_tag and company_id = p_company_id;

  if v_from.id is null or v_into.id is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_from.id = v_into.id then
    return jsonb_build_object('outcome', 'same_tag');
  end if;

  -- Two stages cannot merge: the survivor can only carry one, and picking
  -- silently would throw away the other's history.
  if v_from.pipeline_stage is not null and v_into.pipeline_stage is not null then
    return jsonb_build_object(
      'outcome', 'two_stages',
      'from_stage', v_from.pipeline_stage,
      'into_stage', v_into.pipeline_stage);
  end if;

  -- Conversations already on BOTH: keep the earlier stamp on the survivor and
  -- drop the loser's row, so "since when" stays true.
  update public.conversation_tags into_row
     set created_at = least(into_row.created_at, from_row.created_at)
    from public.conversation_tags from_row
   where into_row.tag_id = p_into_tag
     and from_row.tag_id = p_from_tag
     and from_row.conversation_id = into_row.conversation_id;
  get diagnostics v_merged = row_count;

  delete from public.conversation_tags dup
   where dup.tag_id = p_from_tag
     and exists (select 1 from public.conversation_tags keep
                  where keep.tag_id = p_into_tag
                    and keep.conversation_id = dup.conversation_id);

  update public.conversation_tags set tag_id = p_into_tag where tag_id = p_from_tag;
  get diagnostics v_moved = row_count;

  -- D108: the stage travels with the survivor, in both directions.
  --
  -- The loser's stage is CLEARED FIRST. `tags_pipeline_stage_uq` is unique on
  -- (company_id, pipeline_stage), so assigning the survivor a stage the loser
  -- still holds violates it — the two rows both carry it for the instant
  -- between the update and the delete. Found by TG-3, which is the only place
  -- the constraint and the merge meet.
  if v_from.pipeline_stage is not null then
    update public.tags set pipeline_stage = null where id = p_from_tag;
    update public.tags set pipeline_stage = v_from.pipeline_stage
     where id = p_into_tag;
  end if;

  delete from public.tags where id = p_from_tag;

  return jsonb_build_object(
    'outcome', 'merged',
    'moved', v_moved,
    'already_both', v_merged,
    'stage_moved', v_from.pipeline_stage is not null);
end;
$$;

revoke execute on function public.api_merge_tags(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.api_merge_tags(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Seeing the sprawl.
--
-- #298: "cleanup is impossible without being able to see the problem." A count
-- and a last-used date per tag is the whole of it — the dead ones and the
-- near-duplicates both become obvious in one list, and neither is visible from
-- the tag names alone.
-- ---------------------------------------------------------------------------
create or replace function public.api_tag_usage(p_company_id uuid)
returns table (
  tag_id     uuid,
  name       text,
  uses       bigint,
  last_used  timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id,
    t.name,
    count(ct.conversation_id)::bigint,
    max(ct.created_at)
  from public.tags t
  left join public.conversation_tags ct on ct.tag_id = t.id
  where t.company_id = p_company_id
  group by t.id, t.name
  -- Busiest first: the ones worth keeping are obvious, and the tail is where
  -- the duplicates and the dead ones both live.
  order by count(ct.conversation_id) desc, t.name
$$;

revoke execute on function public.api_tag_usage(uuid) from public, anon, authenticated;
grant execute on function public.api_tag_usage(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Optional governance, OFF by default.
--
-- #298's devil's advocate is the design: "the temptation is to impose a
-- taxonomy. That is the wrong move for this market — a plumber's categories are
-- not an HVAC company's, and a locked-down tag list would be ignored in favour
-- of the notes field."
--
-- So this restricts CREATION only. Attaching an existing tag stays open to
-- everybody, because a tech who cannot categorise a thread will not categorise
-- it in the notes instead, they will leave it uncategorised.
-- ---------------------------------------------------------------------------
alter table public.companies
  add column if not exists tags_locked boolean not null default false;

comment on column public.companies.tags_locked is
  '#298: when true, only owners and admins may CREATE a tag. Attaching an '
  'existing one stays open to every member — a crew that cannot categorise a '
  'thread does not categorise it elsewhere, it leaves it uncategorised. Off by '
  'default: most shops want no taxonomy at all, and forcing one on a '
  'two-person crew is friction for no benefit.';
