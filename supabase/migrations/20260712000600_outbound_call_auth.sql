-- #135 (D43) — close the cross-tenant caller-ID / forged-tag residual on
-- browser-originated outbound calls. The browser ORIGINATES the WebRTC leg
-- itself, so the webhook cannot see WHO placed it — only the presented caller
-- number. Gating on that number's company let a member of tenant A present
-- tenant B's number and bill B (and let a note-only member or a forged tag
-- slip through). Fix: POST /v1/calls/browser — which already proves the
-- AUTHENTICATED member has 'text' access to THEIR OWN company's number —
-- mints a single-use authorization; the webhook requires it. A member can
-- only ever mint an authorization for a number their company owns, so a call
-- presenting any other number has no valid authorization and is rejected.

create table public.outbound_call_authorizations (
  nonce           text primary key,
  company_id      uuid not null references public.companies(id) on delete cascade,
  phone_number_id uuid not null references public.phone_numbers(id) on delete cascade,
  from_e164       text not null,   -- the caller ID this call is authorized to present
  customer_e164   text not null,   -- who it may call
  created_at      timestamptz not null default now()
);
create index outbound_call_auth_created_idx
  on public.outbound_call_authorizations (created_at);

alter table public.outbound_call_authorizations enable row level security;
-- deny-by-default: only the service role (route + webhook) touches it.

-- Atomically authorize a browser-originated outbound leg. Consumes the
-- single-use nonce IFF it was minted for exactly this caller number (from) and
-- is fresh, then creates the in-flight session row bound to the AUTHORIZED
-- company/number (never the browser-presented one). A replay of an
-- already-authorized call's call.initiated (the nonce already consumed but the
-- calls row exists) is recognised and allowed. Returns
-- { authorized, company_id, phone_number_id, replay }.
create function public.api_authorize_outbound_call(
  p_nonce          text,
  p_from           text,
  p_customer       text,
  p_call_session_id text,
  p_max_age_secs   int
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_number  uuid;
begin
  -- Serialize per session so two concurrent call.initiated deliveries can't
  -- both consume/insert.
  perform pg_advisory_xact_lock(hashtextextended(p_call_session_id, 0));

  -- Consume the nonce, binding the presented caller ID to what was authorized.
  delete from public.outbound_call_authorizations
   where nonce = p_nonce
     and from_e164 = p_from
     and created_at > now() - make_interval(secs => p_max_age_secs)
   returning company_id, phone_number_id into v_company, v_number;

  if v_company is null then
    -- Nonce gone (forged / expired / already consumed). A REPLAY of an
    -- authorized call has a calls row for this session — allow it; anything
    -- else is unauthorized.
    select company_id, phone_number_id into v_company, v_number
      from public.calls where call_session_id = p_call_session_id limit 1;
    if v_company is null then
      return jsonb_build_object('authorized', false);
    end if;
    return jsonb_build_object(
      'authorized', true, 'company_id', v_company,
      'phone_number_id', v_number, 'replay', true);
  end if;

  -- First pass: create the in-flight session row bound to the AUTHORIZED
  -- company/number (outcome null = the line is occupied).
  insert into public.calls as c
    (company_id, phone_number_id, call_session_id, caller_e164, direction)
  values (v_company, v_number, p_call_session_id, p_customer, 'outbound')
  on conflict (call_session_id) do nothing;

  return jsonb_build_object(
    'authorized', true, 'company_id', v_company,
    'phone_number_id', v_number, 'replay', false);
end;
$$;
revoke execute on function public.api_authorize_outbound_call(text, text, text, text, int)
  from public, anon, authenticated;
grant execute on function public.api_authorize_outbound_call(text, text, text, text, int)
  to service_role;
