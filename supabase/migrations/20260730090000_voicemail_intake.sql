-- #367 depth (1) — the receptionist that answers by ASKING.
--
-- #367 sets out three depths of "AI answers the call nobody can take" and says
-- only the first is buildable on what already exists: ask the caller what the
-- problem is and where, and write the answers down as structured text. No
-- booking, no promises, no dialogue tree. D89 records the decision.
--
-- Two halves, and the split matters. The GREETING asks the two questions —
-- that half is copy, costs nothing, and cannot fail. The TRANSCRIPT is then
-- read once by a cheap text model into the columns below. Everything here
-- happens after the recording is already stored, threaded and playable, so no
-- failure of it can cost a customer a message.

alter table public.calls
  add column voicemail_intake jsonb,
  add column voicemail_intake_at timestamptz;

comment on column public.calls.voicemail_intake is
  'What the caller said, pulled out of voicemail_transcript: {problem,address,callback,name}, each nullable. Extraction only — never a judgement about urgency or what to do, and nothing downstream acts on it. Null means not extracted (feature off, over cap, transcript too short, or the model found nothing).';

comment on column public.calls.voicemail_intake_at is
  'When the intake extraction last reached a model for this call. Stamped even when the model found nothing, so opening the call does not buy the same reading a second time — the same role voicemail_transcript_attempted_at plays for transcription.';

-- The per-company opt-in, and it is the ONE AI toggle in this product that
-- defaults OFF.
--
-- Every other AI feature produces a suggestion a member reads before anything
-- reaches a customer, which is what makes default-on defensible for them. This
-- one changes the words a STRANGER hears when they ring the business, spoken in
-- that business's name. Turning that on for somebody without asking would be
-- deciding how their company answers the phone. So it is opt-in, exactly as
-- #367's acceptance criteria require, and the default is a decision rather than
-- an oversight (D89).
alter table public.company_ai_settings
  add column voicemail_intake boolean not null default false;

comment on column public.company_ai_settings.voicemail_intake is
  'Whether the voicemail greeting asks callers for the problem and the address, and the transcript is then broken out into those fields. OFF by default — it changes what callers hear (D89).';

-- upsert_company_ai_settings carries it. DEFAULTED so the six-argument call the
-- currently deployed Worker makes still binds during the window between
-- `supabase db push` and `wrangler deploy` — the same expand/contract reasoning
-- as 20260724090000, 20260724120000 and 20260724140000. The old signature is
-- dropped first so the two can never be ambiguous.
--
-- The default here is FALSE rather than the column default being relied on,
-- because this function is `insert ... on conflict do update`: an old Worker
-- omitting the argument must leave an opted-in company opted in on the insert
-- path and — via the coalesce below — untouched on the update path.
drop function if exists public.upsert_company_ai_settings(uuid, boolean, boolean, boolean, text, boolean);

create or replace function public.upsert_company_ai_settings(
  p_company_id            uuid,
  p_enrich_task_address   boolean,
  p_enrich_task_due       boolean,
  p_suggest_replies       boolean default true,
  p_business_description  text default null,
  p_transcribe_voicemail  boolean default true,
  p_voicemail_intake      boolean default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row         public.company_ai_settings%rowtype;
  v_description text;
begin
  -- Empty string clears; null leaves whatever is already stored.
  v_description := nullif(btrim(coalesce(p_business_description, '')), '');

  insert into public.company_ai_settings
      (company_id, enrich_task_address, enrich_task_due, suggest_replies,
       business_description, transcribe_voicemail, voicemail_intake, updated_at)
    values (p_company_id, p_enrich_task_address, p_enrich_task_due,
            p_suggest_replies, v_description, p_transcribe_voicemail,
            coalesce(p_voicemail_intake, false), now())
  on conflict (company_id) do update
    set enrich_task_address  = excluded.enrich_task_address,
        enrich_task_due      = excluded.enrich_task_due,
        suggest_replies      = excluded.suggest_replies,
        transcribe_voicemail = excluded.transcribe_voicemail,
        -- Null means "leave it alone", so a client that predates this toggle
        -- cannot silently change how the business answers its phone just by
        -- saving the other switches.
        voicemail_intake     = case
          when p_voicemail_intake is null
            then public.company_ai_settings.voicemail_intake
          else p_voicemail_intake
        end,
        business_description = case
          when p_business_description is null
            then public.company_ai_settings.business_description
          else v_description
        end,
        updated_at           = now()
  returning * into v_row;
  return to_jsonb(v_row);
end $$;

revoke execute on function public.upsert_company_ai_settings(
  uuid, boolean, boolean, boolean, text, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.upsert_company_ai_settings(
  uuid, boolean, boolean, boolean, text, boolean, boolean) to service_role;

-- The calls list projection gains the intake object, so the log and the call
-- detail can show what the caller said without a second read per row. Additive
-- and nullable; the signature is unchanged, so CREATE OR REPLACE suffices and
-- every existing call site is untouched. Body otherwise identical to
-- 20260724150000 (voicemail_transcript).
--
-- voicemail_intake_at is deliberately NOT projected: it exists to stop the same
-- reading being bought twice, which is a server-side concern. A client has no
-- use for "when we last asked" and would only be tempted to render it as though
-- it said something about the call.

create or replace function public.api_list_calls(
  p_company_id         uuid,
  p_limit              int,
  p_outcome            text default null,
  p_cursor_ts          timestamptz default null,
  p_cursor_id          uuid default null,
  p_hidden_number_ids  uuid[] default null,
  p_contact_id         uuid default null
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
    'state', c.state,
    'direction', c.direction,
    'forward_seconds', c.forward_seconds,
    'screening_result', c.screening_result,
    'stir_attestation', c.stir_attestation,
    'voicemail_seconds', c.voicemail_seconds,
    'voicemail_transcript', c.voicemail_transcript,
    'voicemail_intake', c.voicemail_intake,
    'answered_by_user_id', c.answered_by_user_id,
    'answered_at', c.answered_at,
    'started_at', c.started_at
  )
  from public.calls c
  left join public.contacts ct on ct.id = c.contact_id
  where c.company_id = p_company_id
    and (p_contact_id is null or c.contact_id = p_contact_id)
    and (p_outcome is null or c.outcome = p_outcome)
    and (p_hidden_number_ids is null
         or c.phone_number_id is null
         or not (c.phone_number_id = any (p_hidden_number_ids)))
    and (p_cursor_ts is null
         or (c.started_at, c.id) < (p_cursor_ts, p_cursor_id))
  order by c.started_at desc, c.id desc
  limit greatest(p_limit, 0)
$$;

revoke execute on function public.api_list_calls(uuid, int, text, timestamptz, uuid, uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.api_list_calls(uuid, int, text, timestamptz, uuid, uuid[], uuid)
  to service_role;
