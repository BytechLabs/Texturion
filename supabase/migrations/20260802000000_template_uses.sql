-- ---------------------------------------------------------------------------
-- #475 — which saved reply produced which message.
--
-- Nothing recorded it. A template sent 200 times and one created yesterday were
-- the same object to us, which blocks three reasonable things: confirming a
-- delete only when the template is load-bearing (#419 ask 4), sorting the
-- picker by what the crew actually uses instead of alphabetically, and telling
-- an owner which saved replies are dead.
--
-- # A ledger, not a column on `messages`
--
-- The obvious implementation is `messages.template_id`, and it is the wrong
-- one: `messages` is the highest-volume table in the product and the value
-- would be null for the large majority of rows. This costs one insert per
-- templated send and nothing at all on every other send.
--
-- # It deliberately does NOT record WHO it was sent to
--
-- #475 flags the privacy question and asks for it to be settled first rather
-- than after. Settled: a usage counter is aggregate; "which reply did you send
-- this person" is a per-contact fact, and no feature in scope needs it. Sorting
-- a picker, spotting a dead template and gating a delete confirmation are all
-- answered by counts. So there is no contact_id and no conversation_id here,
-- and this table stays in §6 of PERSONAL-DATA-INVENTORY.md rather than becoming
-- a new personal-data surface for a feature nobody asked for.
--
-- Adding either column later would move the table to §5 and needs its own
-- decision. That is the point of leaving them out now.
--
-- # Retention: it outlives neither the template nor the workspace
--
-- `on delete cascade` from both foreign keys, and a purged workspace takes it
-- along explicitly (purge_workspace_step below).
--
-- Note what that means with #419's SOFT delete: removing a template in the app
-- stamps `deleted_at` and the ledger rows stay. That is deliberate and it is
-- the point of a soft delete — an accidental delete is meant to be
-- recoverable, and a restored template that came back with its history erased
-- would be a different object wearing the same name. The rows die when the row
-- does, which today is a workspace purge.
--
-- The LIST filters deleted templates out (see api_template_usage), so the
-- retained rows are invisible until the template is back.
-- ---------------------------------------------------------------------------

create table if not exists public.template_uses (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  template_id uuid not null references public.templates(id) on delete cascade,
  /**
   * #274 item 3: whether the sender changed the words before sending.
   *
   * Carried from the start rather than added later, because it is the more
   * valuable half of the signal and costs one boolean: "a template edited every
   * single time is a defect report nobody filed, and it is the cheapest
   * possible input to writing better default copy."
   */
  edited      boolean not null default false,
  used_at     timestamptz not null default now()
);

comment on table public.template_uses is
  '#475: one row per templated send. Aggregate by design — no contact and no '
  'conversation, because sorting a picker and spotting a dead template need '
  'counts, and "which reply did you send this person" is a per-contact fact no '
  'feature in scope requires. Cascades from both the template and the company.';

-- The only access pattern: everything for one workspace's templates, newest
-- first. company_id leads because every query is tenant-scoped (tenant_scope
-- test TS-1 requires the column at all).
create index if not exists template_uses_company_template_idx
  on public.template_uses (company_id, template_id, used_at desc);

alter table public.template_uses enable row level security;
-- No policies: service_role only, like every other table the Worker owns.

revoke all on public.template_uses from public, anon, authenticated;
grant select, insert, delete on public.template_uses to service_role;

-- ---------------------------------------------------------------------------
-- Recording a use.
--
-- A function rather than a bare insert so the send path cannot accidentally
-- write a template belonging to another workspace: the id is verified against
-- the company in the same statement. A cross-tenant write here would be an
-- invisible one — it corrupts a counter, not a message, so nothing would ever
-- surface it.
--
-- Returns nothing and raises nothing on a miss. A template deleted between the
-- composer opening and the message sending is normal, and a send must never
-- fail because its bookkeeping did.
-- ---------------------------------------------------------------------------
create or replace function public.api_record_template_use(
  p_company_id  uuid,
  p_template_id uuid,
  p_edited      boolean default false
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.template_uses (company_id, template_id, edited)
  select p_company_id, p_template_id, coalesce(p_edited, false)
   where exists (
     select 1 from public.templates t
      where t.id = p_template_id and t.company_id = p_company_id
   );
$$;

revoke execute on function public.api_record_template_use(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.api_record_template_use(uuid, uuid, boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- The list, with its usage — #475's "readable in one query".
--
-- Returns EVERY template including the ones nobody has used, because the whole
-- point is telling those apart from the ones carrying the work. A join that
-- dropped them would answer the easy half of the question.
-- ---------------------------------------------------------------------------
create or replace function public.api_template_usage(p_company_id uuid)
returns table (
  template_id uuid,
  name        text,
  uses        bigint,
  edits       bigint,
  last_used   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id,
    t.name,
    count(u.id)::bigint,
    count(u.id) filter (where u.edited)::bigint,
    max(u.used_at)
  from public.templates t
  left join public.template_uses u on u.template_id = t.id
  where t.company_id = p_company_id
    -- #419 soft delete: a deleted template is not in the picker, so it has no
    -- business in the list that sorts the picker. Its rows survive for the
    -- undelete; they just do not show.
    and t.deleted_at is null
  group by t.id, t.name
  -- Busiest first: the ones carrying the work are obvious, and the tail is
  -- where the dead ones live.
  order by count(u.id) desc, t.name
$$;

revoke execute on function public.api_template_usage(uuid)
  from public, anon, authenticated;
grant execute on function public.api_template_usage(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Purge: the ledger goes with the workspace.
--
-- `template_uses` cascades from both `companies` and `templates`, so a purge
-- would clear it either way — but purge_workspace_step deletes in explicit
-- batches precisely so a huge table cannot stall the whole erasure inside one
-- statement, and a high-volume ledger is exactly that shape. It is listed
-- BEFORE `templates` so the batching does the work rather than one giant
-- cascade at the end.
--
-- Reproduced from 20260726000500 with ONE line added. Everything else — the
-- order, the default limit, the window guard — is verbatim: this function is
-- what erases a customer's workspace, and a "tidied" copy of it is how a table
-- silently stops being deleted.
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
  -- The order is forced by restrict edges BETWEEN company-scoped tables: a
  -- child goes before its parent whatever the company-level policy says.
  -- Mirrors docs/DELETION.md; a new company-scoped table missing from both is
  -- a workspace that cannot be erased.
  v_tables text[] := array[
    'usage_events', 'tasks', 'message_mentions', 'message_attachments',
    'attachments', 'messages', 'conversation_events', 'conversations',
    'call_records', 'calls', 'port_requests', 'text_enablement_orders',
    'contacts', 'phone_numbers',
    -- #475: before `templates`, so the batch loop drains the ledger rather
    -- than leaving one cascade to delete an unbounded number of rows.
    'template_uses',
    'tags',
    'templates', 'invites', 'messaging_registrations', 'grace_notices',
    'inbound_notification_days', 'usage_alerts', 'egress_events', 'audit_log',
    'company_members',
    -- Formerly cascading with the companies row; explicit now that it survives.
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
  -- Refuse to erase a workspace that is not closed, or whose window has not
  -- passed. The window is the customer's chance to change their mind, and a
  -- purge that ignores it is the one bug this whole design exists to prevent.
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
