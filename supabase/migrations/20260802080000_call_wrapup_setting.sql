-- [#507 Phase 1] The crew can dictate a wrap-up instead of typing it.
--
-- After a call ends, a crew member speaks a sentence or three into their own
-- handset — "quoted him $2,400 for the tank, parts Thursday, he's confirming
-- with his wife" — and it comes back as text they review and post as a note.
--
-- WHOSE VOICE, AND WHY THAT IS THE WHOLE DESIGN. D117: producing a summary of a
-- live two-party call means acquiring the OTHER party's voice, and every
-- interception statute attaches to that acquisition rather than to how long the
-- file is kept. This is one person, speaking knowingly, into their own phone,
-- about a call that has already ended. The customer's voice is never acquired,
-- so none of that is engaged. The live-call version is #509 and needs a consent
-- architecture this does not.
--
-- ON by default, like every other toggle except voicemail_intake. The reasoning
-- is D89's line: the exception is opt-in because it changes what a STRANGER
-- hears when they ring the business. This changes nothing anyone outside the
-- crew can observe — it hands a member text, and a human decides whether it
-- ever becomes a note.

alter table public.company_ai_settings
  add column if not exists call_wrapup boolean not null default true;

comment on column public.company_ai_settings.call_wrapup is
  '#507: whether a crew member can dictate a post-call wrap-up rather than '
  'typing it. Their own voice, about a finished call — never the customer''s '
  'and never the call itself (D117). On by default: the output is text a '
  'member reads and edits before it becomes anything.';

-- upsert_company_ai_settings carries it, DEFAULTED, so the seven-argument call
-- the currently deployed Worker makes still binds during the window between
-- `supabase db push` and `wrangler deploy` — the same expand/contract reasoning
-- as 20260730090000. The old signature is dropped first so the two can never be
-- ambiguous.
--
-- The default is NULL rather than TRUE, meaning "leave whatever is stored":
-- an old Worker omitting the argument must not flip a company that has
-- deliberately turned this off back on just by saving the other switches. The
-- INSERT path coalesces to true, which is the column default.
drop function if exists public.upsert_company_ai_settings(
  uuid, boolean, boolean, boolean, text, boolean, boolean);

create or replace function public.upsert_company_ai_settings(
  p_company_id            uuid,
  p_enrich_task_address   boolean,
  p_enrich_task_due       boolean,
  p_suggest_replies       boolean default true,
  p_business_description  text default null,
  p_transcribe_voicemail  boolean default true,
  p_voicemail_intake      boolean default null,
  p_call_wrapup           boolean default null
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
       business_description, transcribe_voicemail, voicemail_intake,
       call_wrapup, updated_at)
    values (p_company_id, p_enrich_task_address, p_enrich_task_due,
            p_suggest_replies, v_description, p_transcribe_voicemail,
            coalesce(p_voicemail_intake, false),
            coalesce(p_call_wrapup, true), now())
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
        -- Same reasoning: a workspace that turned dictation off stays off when
        -- an older client saves the rest.
        call_wrapup          = case
          when p_call_wrapup is null
            then public.company_ai_settings.call_wrapup
          else p_call_wrapup
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
  uuid, boolean, boolean, boolean, text, boolean, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.upsert_company_ai_settings(
  uuid, boolean, boolean, boolean, text, boolean, boolean, boolean) to service_role;
