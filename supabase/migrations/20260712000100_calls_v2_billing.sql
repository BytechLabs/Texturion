-- #135 (D43) phase 2, billing arm: when an inbound call is ANSWERED IN THE
-- BROWSER there is no forward leg — the INBOUND (PSTN) leg is the whole call,
-- so IT becomes the billed measure. New call_records leg 'in_browser': the
-- inbound leg's TALK time (answered_at → ended, never ring time), recorded on
-- its hangup and summed into the one D36 pool alongside 'forward' (legacy
-- cell-forwarded calls in flight) and 'out_customer' (outbound). Voicemail
-- recording time is NOT billed to the pool — voicemails are bounded (120 s)
-- and absorbing that cost is the fair deal, like inbound SMS.
--
-- calls.answered_at is the talk-time anchor: stamped when a member's browser
-- leg wins the answer race (the bridge moment), read back on the inbound
-- leg's hangup to compute billable seconds. NULL = never answered (missed /
-- voicemail) = zero billable.

alter table public.calls
  add column answered_at timestamptz;

alter table public.call_records
  drop constraint call_records_leg_check;
alter table public.call_records
  add constraint call_records_leg_check
    check (leg in ('inbound', 'forward', 'out_agent', 'out_customer', 'in_browser'));

-- The billed measure: far-party seconds, both directions — now including
-- browser-answered inbound talk time.
create or replace function public.api_period_forward_seconds(
  p_company_id uuid,
  p_since      timestamptz
) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(cr.billable_seconds), 0)::bigint
  from public.call_records cr
  where cr.company_id = p_company_id
    and cr.leg in ('forward', 'out_customer', 'in_browser')
    and cr.created_at >= p_since
$$;

-- api_period_forwarded_calls (the per-dial fee counter) intentionally does
-- NOT count 'in_browser': that row is the inbound leg (nobody dialed it),
-- and the member ring legs are SIP legs we absorb.

-- Voicemail recordings live in their OWN private bucket — never 'attachments'
-- (whose lifecycle sweeps assume attachments-table rows own the objects).
-- No storage.objects policy = service-role only; playback is a signed URL
-- minted by the API behind the #106 number-access check.
insert into storage.buckets (id, name, public)
values ('voicemails', 'voicemails', false)
on conflict (id) do nothing;

-- The list read gains the v2 surface: the session id (voicemail playback +
-- live-call correlation), the carrier screening verdict + STIR/SHAKEN
-- attestation + dipped caller name (honest labels), the voicemail duration
-- (player affordance without a second fetch), and who answered. An
-- outcome-less row IS meaningful now — it is a call in progress.
create or replace function public.api_list_calls(
  p_company_id         uuid,
  p_limit              int,
  p_outcome            text default null,
  p_cursor_ts          timestamptz default null,
  p_cursor_id          uuid default null,
  p_hidden_number_ids  uuid[] default null
) returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'call_session_id', c.call_session_id,
    'caller_e164', c.caller_e164,
    'contact_id', c.contact_id,
    'contact_name', ct.name,
    'caller_name', c.caller_name,
    'phone_number_id', c.phone_number_id,
    'conversation_id', c.conversation_id,
    'outcome', c.outcome,
    'direction', c.direction,
    'forward_seconds', c.forward_seconds,
    'screening_result', c.screening_result,
    'stir_attestation', c.stir_attestation,
    'voicemail_seconds', c.voicemail_seconds,
    'answered_by_user_id', c.answered_by_user_id,
    'started_at', c.started_at
  )
  from public.calls c
  left join public.contacts ct on ct.id = c.contact_id
  where c.company_id = p_company_id
    and (p_outcome is null or c.outcome = p_outcome)
    and (p_hidden_number_ids is null
         or c.phone_number_id is null
         or not (c.phone_number_id = any (p_hidden_number_ids)))
    and (p_cursor_ts is null
         or (c.started_at, c.id) < (p_cursor_ts, p_cursor_id))
  order by c.started_at desc, c.id desc
  limit greatest(p_limit, 0)
$$;
