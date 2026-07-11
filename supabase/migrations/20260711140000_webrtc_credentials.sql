-- #135 (D43) phase 1: per-member Telnyx telephony credentials — the browser
-- softphone's identity. One durable credential per membership, minted
-- on-demand on the shared credential connection (TELNYX_WEBRTC_CONNECTION_ID)
-- the first time a member asks for a token; reused across sessions (stable
-- sip_username = a stable inbound ring target later in D43 phase 2);
-- deleting the Telnyx credential revokes the member's voice access
-- immediately (member deactivation hooks it).
create table public.member_telephony_credentials (
  company_id            uuid not null references public.companies(id) on delete cascade,
  user_id               uuid not null references auth.users(id) on delete cascade,
  telnyx_credential_id  text not null,
  sip_username          text not null,
  created_at            timestamptz not null default now(),
  primary key (company_id, user_id)
);

alter table public.member_telephony_credentials enable row level security;
-- deny-by-default: only the service role (API) reads or writes credentials.
