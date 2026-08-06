-- [#247] Lou reads the thread and says what it is about.
--
-- The expensive part of coming back to a busy inbox is READING: reconstructing
-- what was asked, what the crew committed to, and what is still owed. Every AI
-- feature we had operated on a single message, a single field, or a single
-- recording. None of them could tell anybody what a conversation was ABOUT.
--
-- Two things land here, and nothing else. The catch-up itself is a route
-- (apps/api/src/routes/conversations.ts) over the existing `runAiFeature` gate,
-- so the cap, the reservation, the alert and the timeout are already built and
-- are not re-implemented.
--
--   1. `company_ai_settings.summarize_threads` — the workspace's own switch,
--      alongside the four it already has.
--   2. `conversation_summaries` — the cache, so re-opening an unchanged thread
--      costs nothing.
--
-- ON BY DEFAULT, like every toggle except voicemail intake. The exception's
-- reasoning (D89) is about WHO a feature speaks to: intake changes what a
-- stranger hears in the business's own name, which is a thing done to somebody
-- who never agreed to anything with us. A catch-up changes nothing anyone
-- outside the crew can observe — it hands a member a card, one tap from the raw
-- messages, and a human decides what to do about it.
--
-- The counter-argument is real and is recorded rather than skipped: this sends
-- MORE of a customer's words than any other feature, up to forty messages
-- instead of the twelve reply drafting sends. That is a difference of degree
-- from a feature that has been default-on since 20260724090000 — same thread,
-- same model, same workspace's own service — and the public disclosure page
-- names it in its own row with the number in it either way.

alter table public.company_ai_settings
  add column if not exists summarize_threads boolean not null default true;

comment on column public.company_ai_settings.summarize_threads is
  '#247: whether a long or long-forgotten thread can be summarised on demand. '
  'Sends up to the 40 most recent customer-visible messages for inference; '
  'internal notes are never included. On by default: the output is a card a '
  'member reads with the real thread one tap away.';

-- ---------------------------------------------------------------------------
-- upsert_company_ai_settings carries it, DEFAULTED, so the eight-argument call
-- the currently deployed Worker makes still binds during the window between
-- `supabase db push` and `wrangler deploy` — the same expand/contract reasoning
-- as 20260730090000 and 20260802080000. The old signature is dropped first so
-- the two can never be ambiguous.
--
-- The default is NULL rather than TRUE, meaning "leave whatever is stored": an
-- old Worker omitting the argument must not flip a company that has
-- deliberately turned this off back on just by saving the other switches. The
-- INSERT path coalesces to true, which is the column default.
-- ---------------------------------------------------------------------------
drop function if exists public.upsert_company_ai_settings(
  uuid, boolean, boolean, boolean, text, boolean, boolean, boolean);

create or replace function public.upsert_company_ai_settings(
  p_company_id            uuid,
  p_enrich_task_address   boolean,
  p_enrich_task_due       boolean,
  p_suggest_replies       boolean default true,
  p_business_description  text default null,
  p_transcribe_voicemail  boolean default true,
  p_voicemail_intake      boolean default null,
  p_call_wrapup           boolean default null,
  p_summarize_threads     boolean default null
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
       call_wrapup, summarize_threads, updated_at)
    values (p_company_id, p_enrich_task_address, p_enrich_task_due,
            p_suggest_replies, v_description, p_transcribe_voicemail,
            coalesce(p_voicemail_intake, false),
            coalesce(p_call_wrapup, true),
            coalesce(p_summarize_threads, true), now())
  on conflict (company_id) do update
    set enrich_task_address  = excluded.enrich_task_address,
        enrich_task_due      = excluded.enrich_task_due,
        suggest_replies      = excluded.suggest_replies,
        transcribe_voicemail = excluded.transcribe_voicemail,
        voicemail_intake     = case
          when p_voicemail_intake is null
            then public.company_ai_settings.voicemail_intake
          else p_voicemail_intake
        end,
        call_wrapup          = case
          when p_call_wrapup is null
            then public.company_ai_settings.call_wrapup
          else p_call_wrapup
        end,
        -- Same reasoning again: a workspace that turned catch-ups off stays off
        -- when an older client saves the rest.
        summarize_threads    = case
          when p_summarize_threads is null
            then public.company_ai_settings.summarize_threads
          else p_summarize_threads
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
  uuid, boolean, boolean, boolean, text, boolean, boolean, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.upsert_company_ai_settings(
  uuid, boolean, boolean, boolean, text, boolean, boolean, boolean, boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- THE CACHE.
--
-- #247: "cached against the last message id so re-opening a thread is free".
-- That is a cost requirement before it is a latency one — a summary is the
-- largest input this product sends, and paying for it again to answer a
-- question nothing has changed the answer to is the shape of spend the
-- cost-protection mandate exists to refuse.
--
-- ONE ROW PER CONVERSATION, not per (conversation, message). A superseded
-- summary is worthless: nobody wants last week's catch-up on a thread that has
-- moved on, and keeping the history would make this table grow with message
-- volume for no reader. The row is overwritten in place.
--
-- WHY `last_message_id` AND NOT `last_message_at`. A timestamp answers "is
-- there anything newer" with a comparison that has to be got right at every
-- call site, and two messages can share one. An id is an identity: either the
-- newest customer-visible message is the one this summary was written from, or
-- it is not, and there is no third answer and no clock skew.
--
-- ON DELETE CASCADE from the anchor message is deliberate. If the message a
-- summary was written from is gone — retention, a purge, a deleted thread — the
-- summary is a claim about words that no longer exist, and serving it would be
-- the only way this feature could show somebody something with no message
-- behind it. The route additionally drops any cached LINE whose cited message
-- is not in the window it just read, so a partially purged thread cannot leave
-- a citation pointing at nothing.
-- ---------------------------------------------------------------------------
create table if not exists public.conversation_summaries (
  conversation_id uuid primary key
    references public.conversations(id) on delete cascade,
  company_id      uuid not null references public.companies(id) on delete restrict,
  -- The newest CUSTOMER-VISIBLE message at the time of writing. Notes are
  -- excluded from the summary, so a note must not invalidate the cache either:
  -- otherwise every internal comment on a thread would buy another model call.
  last_message_id uuid not null references public.messages(id) on delete cascade,
  -- The cited lines, exactly as they were served. jsonb rather than a child
  -- table because nothing queries INTO them: they are read whole, by one
  -- conversation, and written whole.
  lines           jsonb not null,
  -- Which model wrote it. A cache entry from a model we no longer call is not
  -- something to serve silently, and this is what lets a later change say so.
  model           text not null,
  created_at      timestamptz not null default now()
);

-- The only read: this workspace's summary for this thread. company_id is in the
-- index because tenant scoping is a filter on every query in this product, and
-- an index that makes the scoping free is an index that never tempts anyone to
-- drop it.
create index if not exists conversation_summaries_company_idx
  on public.conversation_summaries (company_id, conversation_id);

-- Deny-by-default RLS (SPEC §6 / D8): enabled, no policies, no end-user grants.
-- Every read and write goes through the Worker with the service key, which is
-- where the company scoping is enforced.
alter table public.conversation_summaries enable row level security;

comment on table public.conversation_summaries is
  '#247: the cached catch-up for one conversation, anchored to the newest '
  'customer-visible message it was written from. Overwritten in place; a stale '
  'summary is worthless, so there is no history to keep. Cascades away with '
  'that message, because a summary of words that no longer exist is a claim '
  'with nothing behind it.';

-- ---------------------------------------------------------------------------
-- THE ERASURE HAS TO REACH IT, EXPLICITLY.
--
-- The two cascades above (to `conversations` and to `messages`) already mean a
-- purge removes these rows as a side effect, so this could be left out and
-- nothing would visibly break. It is added anyway, because a summary is a
-- QUOTATION of a customer's own messages: Canada's Criminal Code s.183 treats
-- "the substance, meaning or purport" of a communication as the communication,
-- and an erasure that reached the messages and left this behind would leave the
-- customer's words in the workspace under a different table name.
--
-- A guarantee that important should not rest on an implicit edge. D48's own
-- teardown comment says the list is the contract — "a new company-scoped table
-- missing from both is a workspace that cannot be erased" — and the survivor
-- check in supabase/tests/purge_workspace.test.sql names its tables by hand, so
-- a cascade nobody listed is a cascade nobody tests.
--
-- Positioned before `messages`, per the child-before-parent convention the rest
-- of the order follows. `create or replace` rather than an edit to
-- 20260726000500, because a shipped migration is never rewritten (D7/D14).
--
-- A TRAP WORTH LEAVING WRITTEN DOWN, because it caught this change. Replacing a
-- function means restating its WHOLE body, so the base to copy is the LATEST
-- definition and not the one that created it. The first draft of this block
-- copied the array from 20260726000500 and silently dropped `template_uses`,
-- which 20260802000000 had added since — a purge that would have left an
-- unbounded ledger behind, from an edit about something else entirely.
-- `grep -rln purge_workspace_step supabase/migrations` is how to find the real
-- base; `template_uses.test.sql` TU-8 is what refused it.
-- ---------------------------------------------------------------------------
create or replace function public.purge_workspace_step(
  p_company_id uuid,
  p_limit      int default 500
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tables text[] := array[
    'usage_events', 'tasks', 'message_mentions', 'message_attachments',
    'attachments',
    -- #247: before `messages`, which it hangs off.
    'conversation_summaries',
    'messages', 'conversation_events', 'conversations',
    'call_records', 'calls', 'port_requests', 'text_enablement_orders',
    'contacts', 'phone_numbers',
    -- #475: before `templates`, so the batch loop drains the ledger rather
    -- than leaving one cascade to delete an unbounded number of rows.
    'template_uses',
    'tags',
    'templates', 'invites', 'messaging_registrations', 'grace_notices',
    'inbound_notification_days', 'usage_alerts', 'egress_events', 'audit_log',
    'company_members',
    'call_member_legs', 'company_ai_settings', 'company_ai_usage',
    'company_modules', 'email_ledger', 'member_telephony_credentials',
    'notification_prefs', 'notification_read_items', 'notification_reads',
    'number_access', 'outbound_call_authorizations', 'outbound_dial_leases',
    'provider_costs'
  ];
  v_table text;
  v_deleted int;
begin
  if p_limit is null or p_limit <= 0 then
    raise exception 'purge_workspace_step: p_limit must be > 0';
  end if;
  if not exists (
    select 1 from public.companies
     where id = p_company_id
       and deleted_at is not null
       and purge_after is not null
       and purge_after <= now()
  ) then
    raise exception 'purge_workspace_step: % is not past its purge window', p_company_id;
  end if;

  foreach v_table in array v_tables loop
    execute format(
      'delete from public.%I where ctid in (
         select ctid from public.%I where company_id = $1 limit $2
       )', v_table, v_table)
      using p_company_id, p_limit;
    get diagnostics v_deleted = row_count;
    if v_deleted > 0 then
      return jsonb_build_object('step', v_table, 'deleted', v_deleted, 'done', false);
    end if;
  end loop;

  return jsonb_build_object('step', null, 'deleted', 0, 'done', true);
end $$;

revoke execute on function public.purge_workspace_step(uuid, int)
  from public, anon, authenticated;
grant execute on function public.purge_workspace_step(uuid, int) to service_role;
