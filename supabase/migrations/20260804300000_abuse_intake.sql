-- #303 — somewhere for a carrier or a recipient to report abuse, and a budget
-- that ordinary traffic cannot eat.
--
-- The intake itself already exists: `POST /contact` has a honeypot, a rate
-- limit, a captcha and append-only storage. What it did not have is a reason
-- to treat an abuse report differently from a sales enquiry, and that turned
-- out to matter more than it sounds.
--
-- ── THE BUG THIS FIXES ────────────────────────────────────────────────────
--
-- `api_claim_contact_message` counts EVERY submission against one global daily
-- cap. The cap exists for a good reason — each stored row sends two emails, so
-- an uncapped form is a bot army running up the Resend bill. But it means
-- twenty sales enquiries exhaust the day, and the abuse report that arrives at
-- four in the afternoon is silently dropped.
--
-- That is the cost protection suppressing the reports that protect the sending
-- pool: one abusive workspace's filtering lands on every other customer, so an
-- abuse report is worth more than the twenty messages that used up the budget.
-- Per-kind budgets, so neither can starve the other.
--
-- ── WHY 'abuse' IS NOT SIMPLY A HIGHER CAP ────────────────────────────────
--
-- It is a separate counter, not a bigger number. A shared pool with a raised
-- ceiling still lets ordinary traffic consume whatever an abuse report needs;
-- only separate budgets make "a carrier can always reach us" true regardless
-- of what else happened today.

alter table public.contact_messages
  add column if not exists kind text not null default 'general';

alter table public.contact_messages
  drop constraint if exists contact_messages_kind_check;
alter table public.contact_messages
  add constraint contact_messages_kind_check
  check (kind in ('general', 'abuse'));

comment on column public.contact_messages.kind is
  '#303: ''abuse'' is a report about a Loonext number — from a recipient, a '
  'carrier, or anybody. Budgeted separately from ''general'' so ordinary '
  'traffic can never exhaust the day and drop a report that protects every '
  'customer''s deliverability.';

-- Reading "what came in today, of this kind" is the only query the cap makes.
create index if not exists contact_messages_kind_day_idx
  on public.contact_messages (kind, created_at desc);

-- The old signature counted globally. Dropped rather than left beside the new
-- one: two claim functions where one enforces a shared cap and the other a
-- per-kind cap is a coin-toss about which the route calls.
drop function if exists public.api_claim_contact_message(text, text, text, text, text, int);

create or replace function public.api_claim_contact_message(
  p_name    text,
  p_email   text,
  p_company text,
  p_message text,
  p_ip      text,
  p_cap     int,
  p_kind    text default 'general'
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
  if p_kind not in ('general', 'abuse') then
    raise exception 'api_claim_contact_message: unknown kind %', p_kind;
  end if;

  -- Locked per KIND, so a burst of sales enquiries does not serialise behind
  -- itself and delay a report, and neither counter can race its own re-count.
  perform pg_advisory_xact_lock(hashtext('contact_messages_daily:' || p_kind));

  select count(*) into v_today
    from public.contact_messages
   where created_at >= date_trunc('day', now())
     and kind = p_kind;
  if v_today >= p_cap then
    return jsonb_build_object('allowed', false);
  end if;

  insert into public.contact_messages (name, email, company, message, ip, kind)
  values (p_name, p_email, p_company, p_message, p_ip, p_kind)
  returning id into v_id;

  return jsonb_build_object('allowed', true, 'id', v_id);
end $$;

revoke execute on function
  public.api_claim_contact_message(text, text, text, text, text, int, text)
  from public, anon, authenticated;
grant execute on function
  public.api_claim_contact_message(text, text, text, text, text, int, text)
  to service_role;
