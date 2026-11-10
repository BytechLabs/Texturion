-- #721: an inbound call sent to voicemail before anyone was rung left no trace
-- of why. A workspace with after-hours calls set to voicemail and no hours set
-- had every call routed that way for three months, and nothing in the product
-- said so.
--
-- Each inbound call now records the route the call machine chose when it
-- arrived. The values are `CALL_ROUTINGS` in packages/shared/src/call-routing.ts;
-- a test reads this file and fails if the two lists differ.

alter table public.calls
  add column if not exists routing text;

alter table public.calls
  drop constraint if exists calls_routing_check;

alter table public.calls
  add constraint calls_routing_check check (
    routing is null or routing in (
      'blocked',
      'line_busy',
      'screened',
      'after_hours',
      'paused',
      'over_cap',
      'nobody_reachable',
      'rang'
    )
  );

comment on column public.calls.routing is
  '#721: where an inbound call went when it arrived and why: rang, or the '
  'reason nobody was rung (blocked, line_busy, screened, after_hours, paused, '
  'over_cap, nobody_reachable). Null for outbound calls and calls from before '
  'this column existed.';
