-- #214 — Task enrichment (AI-inferred address + due date/time) FOUNDATION.
-- A NEW migration; never edits a shipped one.
--
-- Three parts:
--   1. tasks gains a structured, editable job ADDRESS + a provenance marker. A
--      task can now carry "where the work is" (fix sink @ 123 Main St), which
--      #214's enrichment pre-fills from the message text (or the linked
--      contact, or area-code inference) for the user to confirm before save.
--   2. company_ai_settings — per-company, per-enrichment opt-in toggles.
--      Default OFF: an AI call costs money AND sees task text, so it is never
--      made until the company turns the specific enrichment on. 1:1 with
--      companies.
--   3. company_ai_usage — the per-company monthly enrichment counter behind the
--      cost cap-and-drop (cost-protection mandate): an atomic reserve RPC that
--      increments, reports over-cap (caller then skips the AI call), and fires a
--      one-shot alert-before-cap.
--
-- create_task / update_task are recreated (dropping the prior signatures) to
-- carry the address through the same atomic RPCs — the address is never a
-- second write that could half-commit against the task row.

-- ---------------------------------------------------------------------------
-- 1. tasks address columns
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column addr_street      text,
  add column addr_unit        text,
  add column addr_city        text,
  add column addr_state       text,
  add column addr_postal_code text,
  add column addr_country     text,
  -- Where the confirmed address came from, for the provenance badge:
  --   message — extracted from the task/message text
  --   contact — fell back to the linked contact's address on file
  --   company — only area-code/country geographic inference (region, no street)
  --   manual  — the user typed/edited it themselves
  add column addr_provenance  text
    check (addr_provenance in ('message', 'contact', 'company', 'manual'));

comment on column public.tasks.addr_provenance is
  '#214 provenance of the task address for the UI badge; null when no address.';

-- ---------------------------------------------------------------------------
-- 2. company_ai_settings — per-enrichment opt-in (default OFF)
-- ---------------------------------------------------------------------------
create table public.company_ai_settings (
  company_id           uuid primary key
                         references public.companies(id) on delete cascade,
  enrich_task_address  boolean not null default false,
  enrich_task_due      boolean not null default false,
  updated_at           timestamptz not null default now()
);
-- No policies: the api Worker (service_role) is the only accessor; clients reach
-- it solely through the /v1 routes. RLS-on with no policy denies everyone else.
alter table public.company_ai_settings enable row level security;

-- ---------------------------------------------------------------------------
-- 3. company_ai_usage — monthly cap-and-drop counter
-- ---------------------------------------------------------------------------
create table public.company_ai_usage (
  company_id     uuid not null references public.companies(id) on delete cascade,
  -- Calendar month bucket 'YYYY-MM' (UTC) — coarse but cheap; resets monthly.
  period         text not null,
  request_count  integer not null default 0,
  -- One-shot alert-before-cap ledger: set the first time the count crosses the
  -- alert threshold, so the ops email fires exactly once per company per month.
  alerted_at     timestamptz,
  primary key (company_id, period)
);
alter table public.company_ai_usage enable row level security;

-- ai_enrich_reserve — atomically claim ONE enrichment against the monthly cap.
-- Upserts the (company, current-month) row, increments the counter, and reports
-- whether this request is over the cap (caller then SKIPS the AI call — the
-- cap-and-drop) and whether it just crossed the alert threshold (caller sends
-- the one-shot ops alert). One statement, so concurrent enrichments on the same
-- company can neither double-spend the cap nor double-fire the alert.
create or replace function public.ai_enrich_reserve(
  p_company_id      uuid,
  p_cap             integer,
  p_alert_threshold integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period       text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_count        integer;
  v_alerted      timestamptz;
  v_should_alert boolean := false;
begin
  insert into public.company_ai_usage (company_id, period, request_count)
    values (p_company_id, v_period, 1)
  on conflict (company_id, period) do update
    set request_count = public.company_ai_usage.request_count + 1
  returning request_count, alerted_at into v_count, v_alerted;

  -- Fire once, the first time we cross the threshold and are still at/under the
  -- hard cap (over-cap is its own separate signal to the caller).
  if v_alerted is null and v_count >= p_alert_threshold and v_count <= p_cap then
    update public.company_ai_usage
       set alerted_at = now()
     where company_id = p_company_id and period = v_period;
    v_should_alert := true;
  end if;

  return jsonb_build_object(
    'count', v_count,
    'over_cap', v_count > p_cap,
    'should_alert', v_should_alert);
end $$;

grant execute on function public.ai_enrich_reserve(uuid, integer, integer)
  to service_role;

-- upsert_company_ai_settings — set the toggles (creates the row on first use).
create or replace function public.upsert_company_ai_settings(
  p_company_id          uuid,
  p_enrich_task_address boolean,
  p_enrich_task_due     boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.company_ai_settings%rowtype;
begin
  insert into public.company_ai_settings
      (company_id, enrich_task_address, enrich_task_due, updated_at)
    values (p_company_id, p_enrich_task_address, p_enrich_task_due, now())
  on conflict (company_id) do update
    set enrich_task_address = excluded.enrich_task_address,
        enrich_task_due     = excluded.enrich_task_due,
        updated_at          = now()
  returning * into v_row;
  return to_jsonb(v_row);
end $$;

grant execute on function public.upsert_company_ai_settings(uuid, boolean, boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. create_task — carry the (optional) enriched address through the same
--    atomic promotion RPC. New address params default null so the pre-#214 call
--    shape still binds. Signature grows → drop the old overload first.
-- ---------------------------------------------------------------------------
drop function if exists public.create_task(
  uuid, uuid, text, text, uuid, timestamptz, uuid);

create or replace function public.create_task(
  p_company_id       uuid,
  p_message_id       uuid,
  p_title            text,
  p_description      text,
  p_assigned_user_id uuid,
  p_due_at           timestamptz,
  p_actor_user_id    uuid,
  p_addr_street      text default null,
  p_addr_unit        text default null,
  p_addr_city        text default null,
  p_addr_state       text default null,
  p_addr_postal_code text default null,
  p_addr_country     text default null,
  p_addr_provenance  text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation_id uuid;
  v_body            text;
  v_title           text;
  v_has_address     boolean;
  v_provenance      text;
  v_task            public.tasks%rowtype;
begin
  -- Resolve + company-scope the source message (§10).
  select m.conversation_id, m.body
    into v_conversation_id, v_body
    from public.messages m
   where m.company_id = p_company_id
     and m.id = p_message_id;
  if not found then
    return jsonb_build_object('outcome', 'no_message', 'task', null);
  end if;

  -- Assignee must be an active member of the company (validation_failed).
  if p_assigned_user_id is not null then
    perform 1
      from public.company_members cm
     where cm.company_id = p_company_id
       and cm.user_id = p_assigned_user_id
       and cm.deactivated_at is null;
    if not found then
      return jsonb_build_object('outcome', 'not_member', 'task', null);
    end if;
  end if;

  -- Title defaults to the message-body snippet (whitespace-collapsed, ≤500),
  -- matching routes/tasks.ts `snippet()`; an empty body yields 'Task'.
  v_title := coalesce(
    nullif(p_title, ''),
    left(nullif(trim(regexp_replace(coalesce(v_body, ''), '\s+', ' ', 'g')), ''), 500),
    'Task');

  -- A provenance marker without any address is meaningless — force it null so
  -- the row is internally consistent (the check constraint allows null).
  v_has_address := coalesce(
    p_addr_street, p_addr_unit, p_addr_city, p_addr_state,
    p_addr_postal_code, p_addr_country) is not null;
  v_provenance := case when v_has_address then p_addr_provenance else null end;

  begin
    insert into public.tasks
      (company_id, message_id, conversation_id, title, description,
       assigned_user_id, due_at, created_by_user_id,
       addr_street, addr_unit, addr_city, addr_state, addr_postal_code,
       addr_country, addr_provenance)
    values
      (p_company_id, p_message_id, v_conversation_id, v_title,
       coalesce(p_description, ''), p_assigned_user_id, p_due_at,
       p_actor_user_id,
       p_addr_street, p_addr_unit, p_addr_city, p_addr_state,
       p_addr_postal_code, p_addr_country, v_provenance)
    returning * into v_task;
  exception when unique_violation then
    -- A second live promotion of the same message (tasks_message_uq).
    return jsonb_build_object('outcome', 'conflict', 'task', null);
  end;

  -- T2.1 audit — one task_created row on the source conversation, same txn.
  insert into public.conversation_events
    (company_id, conversation_id, actor_user_id, type, payload)
  values
    (p_company_id, v_conversation_id, p_actor_user_id, 'task_created',
     jsonb_build_object('task_id', v_task.id, 'message_id', p_message_id));

  return jsonb_build_object('outcome', 'created', 'task', to_jsonb(v_task));
end $$;

grant execute on function public.create_task(
  uuid, uuid, text, text, uuid, timestamptz, uuid,
  text, text, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. update_task — the address is an editable field like title/description.
--    p_set_address distinguishes "replace the whole address block" (true —
--    including clearing it by passing all-nulls) from "leave it untouched"
--    (false), exactly as p_clear_due distinguishes clear-vs-keep for due_at.
--    Address edits carry no audit event, matching title/description.
-- ---------------------------------------------------------------------------
drop function if exists public.update_task(
  uuid, uuid, text, text, timestamptz, boolean, uuid);

create or replace function public.update_task(
  p_company_id       uuid,
  p_task_id          uuid,
  p_title            text,
  p_description      text,
  p_due_at           timestamptz,
  p_clear_due        boolean,
  p_actor_user_id    uuid,
  p_set_address      boolean default false,
  p_addr_street      text default null,
  p_addr_unit        text default null,
  p_addr_city        text default null,
  p_addr_state       text default null,
  p_addr_postal_code text default null,
  p_addr_country     text default null,
  p_addr_provenance  text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task        public.tasks%rowtype;
  v_new_title   text;
  v_new_desc    text;
  v_new_due     timestamptz;
  v_new_prov    text;
  v_has_address boolean;
  v_due_changed boolean := false;
  v_addr_changed boolean := false;
  v_changed     boolean := false;
begin
  select * into v_task
    from public.tasks t
   where t.company_id = p_company_id
     and t.id = p_task_id
     and t.deleted_at is null
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found', 'task', null);
  end if;

  v_new_title := coalesce(p_title, v_task.title);
  v_new_desc  := coalesce(p_description, v_task.description);
  -- due_at target: an explicit clear wins; else a provided value; else keep.
  if p_clear_due then
    v_new_due := null;
  elsif p_due_at is not null then
    v_new_due := p_due_at;
  else
    v_new_due := v_task.due_at;
  end if;

  -- Address: when p_set_address, the params ARE the new block (all-null clears
  -- it); a provenance with no address is forced null for row consistency.
  if p_set_address then
    v_has_address := coalesce(
      p_addr_street, p_addr_unit, p_addr_city, p_addr_state,
      p_addr_postal_code, p_addr_country) is not null;
    v_new_prov := case when v_has_address then p_addr_provenance else null end;
    v_addr_changed :=
         (p_addr_street      is distinct from v_task.addr_street)
      or (p_addr_unit        is distinct from v_task.addr_unit)
      or (p_addr_city        is distinct from v_task.addr_city)
      or (p_addr_state       is distinct from v_task.addr_state)
      or (p_addr_postal_code is distinct from v_task.addr_postal_code)
      or (p_addr_country     is distinct from v_task.addr_country)
      or (v_new_prov         is distinct from v_task.addr_provenance);
  end if;

  v_changed := (v_new_title is distinct from v_task.title)
            or (v_new_desc  is distinct from v_task.description)
            or (v_new_due   is distinct from v_task.due_at)
            or v_addr_changed;
  if not v_changed then
    return jsonb_build_object('outcome', 'unchanged', 'task', to_jsonb(v_task));
  end if;

  v_due_changed := v_new_due is distinct from v_task.due_at;

  update public.tasks
     set title = v_new_title,
         description = v_new_desc,
         due_at = v_new_due,
         addr_street      = case when p_set_address then p_addr_street      else addr_street end,
         addr_unit        = case when p_set_address then p_addr_unit        else addr_unit end,
         addr_city        = case when p_set_address then p_addr_city        else addr_city end,
         addr_state       = case when p_set_address then p_addr_state       else addr_state end,
         addr_postal_code = case when p_set_address then p_addr_postal_code else addr_postal_code end,
         addr_country     = case when p_set_address then p_addr_country     else addr_country end,
         addr_provenance  = case when p_set_address then v_new_prov         else addr_provenance end
   where id = v_task.id
  returning * into v_task;

  -- Only a due_at change is audited (T2.1 canonical list: task_due_set). Title/
  -- description/address edits carry no event, matching routes/tasks.ts.
  if v_due_changed then
    insert into public.conversation_events
      (company_id, conversation_id, actor_user_id, type, payload)
    values
      (p_company_id, v_task.conversation_id, p_actor_user_id, 'task_due_set',
       jsonb_build_object('task_id', v_task.id, 'due_at', v_new_due));
  end if;

  return jsonb_build_object('outcome', 'updated', 'task', to_jsonb(v_task));
end $$;

grant execute on function public.update_task(
  uuid, uuid, text, text, timestamptz, boolean, uuid,
  boolean, text, text, text, text, text, text, text) to service_role;
