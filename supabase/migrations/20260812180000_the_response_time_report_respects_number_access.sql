-- The response-time report showed lines the reader is not allowed to see.
--
-- `by_number` is built from every conversation in the workspace, and the route
-- then labels each row with its number's E.164. Neither half asked about
-- per-number access (#106), so a member restricted to one line saw every other
-- line's real phone number on their own dashboard, with how many leads it took
-- and how many went unanswered.
--
-- Filtered in the LEADS CTE rather than at the end, so a denied number leaves the
-- report entirely: it cannot appear in `by_number`, and it does not quietly move
-- the medians either. The three-part shape is the one every other filtered read
-- already uses — null hides nothing (the state of a workspace with no access
-- rules, which is most of them), and a conversation with no number belongs to
-- everybody.
--
-- DROPPED AND RECREATED rather than replaced, because the argument list changes.
-- A defaulted parameter added to a `create or replace` makes a SECOND overload
-- beside the old four-argument one; PostgREST would go on resolving the old
-- signature and this fix would ship as a no-op that tests green. The grant is
-- re-issued for the reason it always must be after a drop: a recreated function
-- comes back with the default PUBLIC execute, which anon and authenticated
-- inherit.

drop function if exists public.api_response_time_stats(uuid, timestamptz, timestamptz, int);

create or replace function public.api_response_time_stats(
  p_company_id uuid,
  p_since timestamptz,
  p_until timestamptz,
  p_max_rows int default 5000,
  -- #581: the numbers this reader is denied (#106). Null means no rules, which
  -- is the state of most workspaces and hides nothing.
  p_hidden_number_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_result jsonb;
begin
  if p_company_id is null then
    raise exception 'api_response_time_stats: p_company_id is required';
  end if;
  -- A cap of zero or less would return no rows while the aggregates looked
  -- healthy, which is the silent-truncation failure this function is written to
  -- avoid. Clamp rather than trust the caller.
  p_max_rows := greatest(coalesce(p_max_rows, 5000), 1);

  -- ONE statement, no temp table. A temp table would have meant a DELETE with
  -- no WHERE (which the migration guard rightly refuses to read as safe) and,
  -- worse, temp state inside a pooled PostgREST connection whose transaction
  -- boundary is not this function's to assume. A CTE is visible to every
  -- subquery in the statement, which is all the reuse this needs.
  with first_message as (
    -- The opening message of each thread. Notes are not messages for this
    -- purpose (rule 3), so they cannot become the thread's first row and
    -- disqualify it.
    select
      m.conversation_id,
      m.created_at,
      m.direction,
      row_number() over (
        partition by m.conversation_id
        order by m.created_at, m.id
      ) as rn
    from public.messages m
    where m.company_id = p_company_id
      and m.direction <> 'note'
  ),
  leads as (
    select
      f.conversation_id,
      c.phone_number_id,
      f.created_at as opened_at
    from first_message f
    join public.conversations c on c.id = f.conversation_id
    where f.rn = 1
      and f.direction = 'inbound'          -- rule 1
      and c.is_spam = false                -- rule 4
      and c.company_id = p_company_id
      -- #581: a denied number's leads leave the report entirely, so its E.164
      -- and its lead and unanswered counts cannot appear in `by_number`, and it
      -- does not quietly move the medians either. Same three-part shape every
      -- other filtered read uses: null hides nothing, and a conversation with NO
      -- number belongs to everybody.
      and (p_hidden_number_ids is null
           or c.phone_number_id is null
           or not (c.phone_number_id = any(p_hidden_number_ids)))
      and f.created_at >= p_since
      and f.created_at < p_until
  ),
  scored as (
    select
      l.conversation_id,
      l.phone_number_id,
      l.opened_at,
      r.created_at as responded_at,
      r.sent_by_user_id as responder_user_id,
      case
        when r.created_at is null then null
        else extract(epoch from (r.created_at - l.opened_at))
      end as response_seconds
    from leads l
    left join lateral (
      -- Rule 2: the first HUMAN outbound at or after the opening message.
      select m.created_at, m.sent_by_user_id
      from public.messages m
      where m.conversation_id = l.conversation_id
        and m.direction = 'outbound'
        and m.automated = false
        and m.created_at >= l.opened_at
      order by m.created_at, m.id
      limit 1
    ) r on true
  ),
  answered as (
    select * from scored where response_seconds is not null
  )
  select jsonb_build_object(
    'since', p_since,
    'until', p_until,
    -- Every aggregate below is over ALL qualifying leads, never over the capped
    -- row list, so the headline number cannot quietly become a number about a
    -- sample.
    'leads', (select count(*) from scored),
    'answered', (select count(*) from answered),
    -- Rule 6: counted, never dropped. Excluding them would let a workspace
    -- improve its median by ignoring more leads.
    'unanswered', (select count(*) from scored where response_seconds is null),
    'median_seconds', (
      select percentile_cont(0.5) within group (order by response_seconds)
      from answered
    ),
    'p90_seconds', (
      select percentile_cont(0.9) within group (order by response_seconds)
      from answered
    ),
    'by_member', (
      select coalesce(jsonb_agg(m order by (m->>'median_seconds')::numeric), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'user_id', responder_user_id,
          'answered', count(*),
          'median_seconds', percentile_cont(0.5) within group (
            order by response_seconds
          )
        ) as m
        from answered
        where responder_user_id is not null
        group by responder_user_id
      ) s
    ),
    'by_number', (
      select coalesce(jsonb_agg(n), '[]'::jsonb)
      from (
        select jsonb_build_object(
          'phone_number_id', phone_number_id,
          'leads', count(*),
          'answered', count(*) filter (where response_seconds is not null),
          'median_seconds', percentile_cont(0.5) within group (
            order by response_seconds
          ) filter (where response_seconds is not null)
        ) as n
        from scored
        where phone_number_id is not null
        group by phone_number_id
      ) s
    ),
    -- The rows, capped, for the Worker's business-hours classification. Newest
    -- first so a truncated list is the recent window rather than an arbitrary
    -- slice.
    'rows', (
      select coalesce(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
      from (
        select
          conversation_id,
          phone_number_id,
          opened_at,
          responded_at,
          responder_user_id,
          response_seconds
        from scored
        order by opened_at desc
        limit p_max_rows
      ) t
    ),
    -- Named, never implied. A caller that cannot see the cap will report a
    -- business-hours split about a subset as though it covered everything.
    'row_limit', p_max_rows,
    'truncated', (select count(*) from scored) > p_max_rows
  )
  into v_result;

  return v_result;
end;
$function$;

revoke all on function public.api_response_time_stats(uuid, timestamptz, timestamptz, int, uuid[])
  from public, anon, authenticated;
grant execute on function public.api_response_time_stats(uuid, timestamptz, timestamptz, int, uuid[])
  to service_role;
