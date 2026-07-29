-- ===========================================================================
-- [#463] The two-minute nudge is removed, and telling the crew stands alone.
--
-- Owner direction, and the reasoning is worth keeping because #388 argued the
-- opposite in good faith:
--
--   "why do we have 'buzz again after 2 minutes'... useless, remove it. Why is
--   'tell the whole crew after 5 minutes' a child of the first one... I think
--   this option is good as is by itself"
--
-- BOTH HALVES WERE REAL, and the second one is a defect rather than a
-- preference. `lead_chase_crew_enabled` could never fire on its own: rung 2
-- required `chase_level = 1`, which only ever happened because rung 1 had
-- already fired. So a workspace that wanted "tell the whole crew if nobody
-- answers in five minutes" and NOT the two-minute buzz could not have it —
-- the setting was there and the state machine made it unreachable.
--
-- On the nudge itself: #388's reasoning was not wrong on its own terms (a
-- reminder that arrives at the deadline is a post-mortem). It was wrong about
-- the cost, which is paid in every alert the crew stops reading — a second
-- buzz 120 seconds after the first, about the same conversation, reads as a
-- duplicate and trains people to swipe.
--
-- WHAT THE SURVIVING RUNG KEEPS, and why: it still requires an ASSIGNED
-- conversation. The original rationale holds unchanged — a new conversation is
-- unassigned, so its first notification already went to the whole crew (D52),
-- and "widening" it reaches nobody new. The chase only does work when the
-- first alert went to ONE person.
--
-- `lead_chase_enabled` is left in place and simply no longer read: dropping a
-- column is a destructive migration for zero gain, and D4 set that precedent.
-- ===========================================================================

drop function if exists public.api_due_lead_chases(timestamptz, integer, integer, integer);

create or replace function public.api_due_lead_chases(
  p_now           timestamptz,
  p_widen_minutes integer,
  p_limit         integer default 200
) returns jsonb
language sql
stable
security definer
set search_path = 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'conversation_id',   c.id,
           'company_id',        c.company_id,
           'assigned_user_id',  c.assigned_user_id,
           'phone_number_id',   c.phone_number_id,
           'contact_name',      ct.name,
           'contact_phone',     ct.phone_e164,
           'awaiting_since',    c.awaiting_reply_since,
           'from_level',        c.chase_level,
           -- Still 2, not 1. `conversations.chase_level` already holds 2 for
           -- every lead widened before this change, and renumbering the
           -- surviving rung would make those live rows mean something they did
           -- not mean when they were written.
           'to_level',          2,
           'timezone',          co.timezone,
           'business_hours',    co.business_hours)
         order by c.awaiting_reply_since), '[]'::jsonb)
    from public.conversations c
    join public.companies co on co.id = c.company_id
    join public.contacts  ct on ct.id = c.contact_id
   where c.awaiting_reply_since is not null
     and c.closed_at is null
     and c.is_spam = false
     and co.deleted_at is null
     -- No subscription-status gate, deliberately. A push costs nothing at
     -- either end, the ordinary inbound notification does not gate on billing
     -- state either, and a workspace still receiving texts is a workspace
     -- whose leads still matter. An allowlist here would be one unanticipated
     -- status away from silently switching off the feature the brand is named
     -- after — the #387 failure shape exactly.
     --
     -- #463: ONE rung, and it fires from chase_level = 0 rather than 1. That
     -- is the whole fix for "it is a child of the first one" — the crew-wide
     -- alert no longer waits for a nudge that no longer exists.
     and c.chase_level = 0
     and co.lead_chase_crew_enabled
     and c.assigned_user_id is not null
     and c.awaiting_reply_since <= p_now - make_interval(mins => p_widen_minutes)
   limit p_limit
$function$;

revoke execute on function public.api_due_lead_chases(timestamptz, integer, integer)
  from public, anon, authenticated;
grant execute on function public.api_due_lead_chases(timestamptz, integer, integer)
  to service_role;

comment on column public.companies.lead_chase_enabled is
  '#463: RETIRED. Was the 2-minute nudge; no longer read by anything. Kept because dropping a column is destructive for zero gain (D4 precedent).';
comment on column public.companies.lead_chase_crew_enabled is
  '#463: the ONE lead-chase setting — tell everyone who can see the thread when an assigned lead goes unanswered for LEAD_CHASE_WIDEN_MINUTES. No longer depends on lead_chase_enabled.';
