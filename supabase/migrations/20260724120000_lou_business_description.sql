-- Tell Lou what the business actually does.
--
-- Lou is given the workspace NAME and nothing else, so when a customer asks
-- something it cannot answer from the thread, it fills the hole itself: a
-- production draft read "We're a small trade business, we specialize in
-- residential renovations" for a workspace that had never said any such thing,
-- and another refused a job by inventing a reason. Both are now blocked, which
-- makes the drafts safe but not smart — Lou still cannot say what the crew does.
--
-- One sentence from the owner fixes the cause rather than the symptom: with a
-- real description, saying what the business does stops being invention and the
-- drafts can answer "do you do X?" honestly. Without one, nothing changes and
-- the ban still holds.
--
-- Short on purpose. This rides in every drafting prompt, so it is a sentence,
-- not an About page: 280 characters is about two SMS segments of context.

alter table public.company_ai_settings
  add column business_description text
    check (business_description is null or length(business_description) <= 280);

comment on column public.company_ai_settings.business_description is
  'One sentence describing what this business does, used to ground Lou''s drafts. Null = Lou may not describe the business at all.';

-- upsert_company_ai_settings carries it. The new parameter is DEFAULTED so the
-- four-argument call the currently deployed Worker makes still binds during the
-- window between `supabase db push` and `wrangler deploy` (the same
-- expand/contract reasoning as migration 20260724090000). The old signature is
-- dropped first so the two can never be ambiguous for a four-argument call.
--
-- A DEFAULT of null would wipe the description on any settings save from a
-- client that does not send it, so the parameter is a nullable "leave it alone"
-- marker instead: only a non-null value writes, and clearing is done by sending
-- an empty string, which normalizes back to null.
drop function if exists public.upsert_company_ai_settings(uuid, boolean, boolean, boolean);

create or replace function public.upsert_company_ai_settings(
  p_company_id            uuid,
  p_enrich_task_address   boolean,
  p_enrich_task_due       boolean,
  p_suggest_replies       boolean default true,
  p_business_description  text default null
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
       business_description, updated_at)
    values (p_company_id, p_enrich_task_address, p_enrich_task_due,
            p_suggest_replies, v_description, now())
  on conflict (company_id) do update
    set enrich_task_address  = excluded.enrich_task_address,
        enrich_task_due      = excluded.enrich_task_due,
        suggest_replies      = excluded.suggest_replies,
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
  uuid, boolean, boolean, boolean, text)
  from public, anon, authenticated;
grant execute on function public.upsert_company_ai_settings(
  uuid, boolean, boolean, boolean, text) to service_role;
