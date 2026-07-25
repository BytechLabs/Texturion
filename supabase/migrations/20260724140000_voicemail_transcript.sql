-- Voicemails you can read.
--
-- We already own the audio: the recording is downloaded into our own bucket
-- and the Telnyx copy deleted (calls.voicemail_path). Someone on a roof, in a
-- truck, or standing next to a running compressor cannot play it, and a
-- voicemail nobody listens to is a missed customer. A transcript makes the
-- contents skimmable in the same list the call already appears in.
--
-- Naturally bounded: one transcription per voicemail, and voicemails are
-- bounded by inbound call volume. It still reserves against the per-feature
-- monthly ledger like every other AI cost center (cost-protection mandate),
-- under its own feature key so a runaway here cannot starve task enrichment or
-- reply drafting.

alter table public.calls
  add column voicemail_transcript text;

comment on column public.calls.voicemail_transcript is
  'Speech-to-text of voicemail_path, written best-effort after the recording is stored. Null means not transcribed (feature off, over cap, too long, or the model failed) — never a reason to hide the audio.';

-- The per-company opt-in, defaulted ON to match the other AI features (the
-- founder''s standing call: every output is reviewable and the monthly cap
-- bounds the spend).
alter table public.company_ai_settings
  add column transcribe_voicemail boolean not null default true;

comment on column public.company_ai_settings.transcribe_voicemail is
  'Whether new voicemails are transcribed. Off leaves the recording exactly as it was.';

-- upsert_company_ai_settings carries it. The new parameter is DEFAULTED so the
-- five-argument call the currently deployed Worker makes still binds during the
-- window between `supabase db push` and `wrangler deploy` (the same
-- expand/contract reasoning as 20260724090000 and 20260724120000). The old
-- signature is dropped first so the two can never be ambiguous.
drop function if exists public.upsert_company_ai_settings(uuid, boolean, boolean, boolean, text);

create or replace function public.upsert_company_ai_settings(
  p_company_id            uuid,
  p_enrich_task_address   boolean,
  p_enrich_task_due       boolean,
  p_suggest_replies       boolean default true,
  p_business_description  text default null,
  p_transcribe_voicemail  boolean default true
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
       business_description, transcribe_voicemail, updated_at)
    values (p_company_id, p_enrich_task_address, p_enrich_task_due,
            p_suggest_replies, v_description, p_transcribe_voicemail, now())
  on conflict (company_id) do update
    set enrich_task_address  = excluded.enrich_task_address,
        enrich_task_due      = excluded.enrich_task_due,
        suggest_replies      = excluded.suggest_replies,
        transcribe_voicemail = excluded.transcribe_voicemail,
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
  uuid, boolean, boolean, boolean, text, boolean)
  from public, anon, authenticated;
grant execute on function public.upsert_company_ai_settings(
  uuid, boolean, boolean, boolean, text, boolean) to service_role;
