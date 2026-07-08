-- Contact form storage + guarded daily claim (email-hardening batch: the
-- public POST /contact endpoint that replaces the marketing site's mailto
-- link). Two objects:
--
--   contact_messages          append-only store for submissions (RLS enabled
--                             with NO policies; only the api Worker's
--                             service-role credential touches it, and its
--                             table grants stop at select+insert so even that
--                             credential cannot rewrite history).
--   api_claim_contact_message guarded-claim RPC (advisory-lock re-count +
--                             insert in one transaction, the api_create_company
--                             idiom): stores the submission ONLY while today's
--                             global count is under the cap, so a bot army can
--                             never run up the Resend bill (each stored row
--                             triggers at most two emails).

create table public.contact_messages (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name       text not null check (char_length(name) <= 100),
  email      text not null check (char_length(email) <= 254),
  company    text check (char_length(company) <= 120),
  message    text not null check (char_length(message) between 1 and 4000),
  -- CF-Connecting-IP as seen by the Worker: abuse forensics only.
  ip         text
);

comment on table public.contact_messages is
  'Marketing contact-form submissions (public POST /contact). Append-only; service role only.';

-- The daily-cap count scans today''s rows.
create index contact_messages_created_at_idx
  on public.contact_messages (created_at);

-- RLS on with no policies: anon/authenticated PostgREST access is denied
-- outright; the service role (bypassrls) is the only reader/writer.
alter table public.contact_messages enable row level security;

-- Append-only even for the service role: select + insert, never update or
-- delete (default privileges in this project grant more; restate exactly).
revoke all on table public.contact_messages
  from public, anon, authenticated, service_role;
grant select, insert on table public.contact_messages to service_role;

-- api_claim_contact_message — store a submission iff today's global count is
-- under p_cap. The advisory xact lock serializes concurrent claims so the
-- re-count can never overshoot (a read-check-insert in the app would race).
-- Returns jsonb: { "allowed": true, "id": <uuid> } or { "allowed": false }.
create or replace function public.api_claim_contact_message(
  p_name    text,
  p_email   text,
  p_company text,
  p_message text,
  p_ip      text,
  p_cap     int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today int;
  v_id    uuid;
begin
  if p_cap is null or p_cap < 1 then
    raise exception 'api_claim_contact_message: p_cap must be >= 1';
  end if;

  perform pg_advisory_xact_lock(hashtext('contact_messages_daily'));

  select count(*) into v_today
    from public.contact_messages
   where created_at >= date_trunc('day', now());
  if v_today >= p_cap then
    return jsonb_build_object('allowed', false);
  end if;

  insert into public.contact_messages (name, email, company, message, ip)
  values (p_name, p_email, p_company, p_message, p_ip)
  returning id into v_id;

  return jsonb_build_object('allowed', true, 'id', v_id);
end $$;

-- Deny-by-default execute posture (as every api_* function in this repo).
revoke execute on function
  public.api_claim_contact_message(text, text, text, text, text, int)
  from public, anon, authenticated;
grant execute on function
  public.api_claim_contact_message(text, text, text, text, text, int)
  to service_role;
