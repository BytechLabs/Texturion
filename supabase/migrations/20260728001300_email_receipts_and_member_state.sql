-- #386 asks 2 and 4 — the member-facing half, and evidence for the legal sends.
--
-- ASK 2. A hard-bounced address must be VISIBLE and FIXABLE rather than merely
-- broken. Right now the only symptom is that a crew member stops getting
-- notifications, which is indistinguishable from a quiet week — the same
-- confusion #386 is about, moved from the platform to one person.
--
-- ASK 4. PIPEDA and Law 25 both care that we responded to a deletion or access
-- request. Resend's accepted-id proves we handed a message to a queue; it is
-- not evidence of receipt. Storing the id ON the row lets a request be
-- answered with "delivered at 14:02" rather than "we sent it, we think".

-- ---------------------------------------------------------------------------
-- api_user_email_state — "can we reach you?", for the signed-in member
-- ---------------------------------------------------------------------------
-- Reads auth.users internally rather than making the Worker resolve the
-- address first. GET /v1/me runs on every app load and already fans out three
-- queries in parallel; making this a fourth parallel call costs nothing, while
-- resolving the email through GoTrue and then querying would be two serial
-- round trips on the hottest route in the product.
--
-- Returns null when the address is fine, so "no news" needs no interpretation
-- on three clients.
create or replace function public.api_user_email_state(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  select jsonb_build_object(
           'email', u.email,
           'reason', s.reason,
           'since', s.first_seen_at,
           -- A hard bounce is nearly always a typo and the person who owns the
           -- address is the one who can fix it. A complaint is not ours to
           -- undo — we do not get to decide that somebody who reported us as
           -- spam wants mail again.
           'fixable', s.reason = 'hard_bounce')
    from auth.users u
    join public.email_suppressions s
      on s.email = lower(trim(u.email))
     and s.cleared_at is null
   where u.id = p_user_id
$function$;

-- ---------------------------------------------------------------------------
-- api_clear_email_suppression — the member fixes their own address
-- ---------------------------------------------------------------------------
-- Only a HARD BOUNCE can be cleared, and only by the person whose address it
-- is. A complaint is permanent: continuing to mail somebody who reported us as
-- spam is the fastest route to a blocklist, and "they clicked a button in our
-- app" is not consent to resume.
--
-- Clearing does not re-deliver anything. It re-opens the address, and the next
-- bounce suppresses it again — which is the correct loop for a typo that was
-- corrected somewhere else.
create or replace function public.api_clear_email_suppression(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $function$
declare
  v_email text;
  v_reason text;
begin
  select lower(trim(u.email)) into v_email from auth.users u where u.id = p_user_id;
  if v_email is null then
    return jsonb_build_object('cleared', false, 'reason', 'no_user');
  end if;

  select s.reason into v_reason
    from public.email_suppressions s
   where s.email = v_email and s.cleared_at is null;

  if v_reason is null then
    -- Nothing to clear. Reported as a no-op rather than an error: the member
    -- may simply have fixed it from another device.
    return jsonb_build_object('cleared', false, 'reason', 'not_suppressed');
  end if;
  if v_reason <> 'hard_bounce' then
    return jsonb_build_object('cleared', false, 'reason', v_reason);
  end if;

  update public.email_suppressions
     set cleared_at = now(), cleared_by_user_id = p_user_id
   where email = v_email and cleared_at is null;

  return jsonb_build_object('cleared', true);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Ask 4: the legal sends carry the id their delivery is recorded against
-- ---------------------------------------------------------------------------
alter table public.data_exports
  add column if not exists notify_email_id text;

comment on column public.data_exports.notify_email_id is
  '#386: Resend id of the "your export is ready" email. Joins to email_events so a Law 25 / PIPEDA request can be answered with a delivery outcome rather than an accepted-id.';

alter table public.companies
  add column if not exists purge_receipt_email_id text;

comment on column public.companies.purge_receipt_email_id is
  '#386: Resend id of the erasure receipt (#371). Same reason as data_exports.notify_email_id — an accepted-id is not evidence of receipt.';

-- ---------------------------------------------------------------------------
-- api_email_delivery_state — what actually happened to one sent message
-- ---------------------------------------------------------------------------
-- The join that makes the two columns above worth having. Null when we have no
-- outcome yet, which is honest: an email we sent four seconds ago has not been
-- delivered OR bounced, and reporting either would be a guess.
create or replace function public.api_email_delivery_state(p_resend_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $function$
  select jsonb_build_object(
           'event', e.event,
           'occurred_at', e.occurred_at,
           'bounce_type', e.bounce_type)
    from public.email_events e
   where e.resend_email_id = p_resend_id
   -- The last word wins: a delivered message can still be followed by a
   -- complaint, and the complaint is the one that matters.
   order by e.occurred_at desc
   limit 1
$function$;

revoke execute on function public.api_user_email_state(uuid)
  from public, anon, authenticated;
grant execute on function public.api_user_email_state(uuid) to service_role;
revoke execute on function public.api_clear_email_suppression(uuid)
  from public, anon, authenticated;
grant execute on function public.api_clear_email_suppression(uuid) to service_role;
revoke execute on function public.api_email_delivery_state(text)
  from public, anon, authenticated;
grant execute on function public.api_email_delivery_state(text) to service_role;
