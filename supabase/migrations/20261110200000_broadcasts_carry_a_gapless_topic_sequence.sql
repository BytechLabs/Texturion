-- Hosted Realtime silently loses deliveries past a rate ceiling (CAPACITY.md 2e:
-- 14 to 16% at 40 inbound messages a second on one number topic, every webhook
-- 200, no socket dropped). A client that missed a broadcast on a healthy socket
-- shows stale data until the next focus or connection gap.
--
-- Every number-scoped broadcast, and the company-wide ones, now carry `seq`: a
-- per-topic counter with no gaps. A client that sees a gap it cannot explain
-- runs the same resync it runs after a connection gap.
--
-- Gapless because the counter is bumped in the SAME transaction as the send. A
-- rollback undoes both, so a failed write leaves no hole for a client to chase.
-- Order: the row lock is held to commit, so two transactions on one topic number
-- their sends in commit order.
--
-- COST. Each broadcast on a topic takes that topic's row lock until commit, so
-- transactions that broadcast on the same topic serialise from the trigger to
-- their commit. At 40 inbound messages a second on one number that is 40 short
-- queues a second, each as long as the rest of the transaction after the
-- trigger (a few statements), nowhere near a limit. The row is updated in
-- place without touching an indexed column, so the update is HOT and the
-- fillfactor leaves room on the page for it. Two transactions that broadcast
-- on two topics in opposite orders can deadlock; Postgres aborts one after 1 s.
-- Triggers fire one row at a time and a company has few topics, so that needs
-- two concurrent multi-number bulk writes.
--
-- Topics covered: `company:{id}:number:{n}` (everything sent through
-- broadcast_number_scoped) and `company:{id}` (registration.updated,
-- access.changed, read.notifications, and the null-number call.updated).

create table public.realtime_topic_seq (
  topic      text   primary key,
  company_id uuid   not null references public.companies(id) on delete cascade,
  seq        bigint not null
) with (fillfactor = 50);

comment on table public.realtime_topic_seq is
  'Last sequence sent on each Realtime topic. Bumped in the transaction that '
  'sends, so the sequence has no gaps. Service-role only; clients read the '
  'number from the broadcast payload.';

create index realtime_topic_seq_company_idx
  on public.realtime_topic_seq (company_id);

alter table public.realtime_topic_seq enable row level security;

grant select, insert, update, delete on public.realtime_topic_seq to service_role;

-- ---------------------------------------------------------------------------
-- The one place a broadcast takes its number.
-- ---------------------------------------------------------------------------
create or replace function public.realtime_send_sequenced(
  p_payload jsonb,
  p_event   text,
  p_topic   text,
  p_company uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_seq bigint;
begin
  insert into public.realtime_topic_seq as s (topic, company_id, seq)
  values (p_topic, p_company, 1)
  on conflict (topic) do update set seq = s.seq + 1
  returning s.seq into v_seq;

  perform realtime.send(
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('seq', v_seq),
    p_event, p_topic, true);
end;
$function$;

comment on function public.realtime_send_sequenced(jsonb, text, text, uuid) is
  'Send a private broadcast whose payload carries the next gapless sequence '
  'number for the topic. The counter and the send share the caller''s '
  'transaction.';

revoke all on function public.realtime_send_sequenced(jsonb, text, text, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- broadcast_number_scoped: body is the one from 20260730070000_contract_step.sql
-- with both sends made sequenced.
-- ---------------------------------------------------------------------------
create or replace function public.broadcast_number_scoped(
  p_payload jsonb,
  p_event text,
  p_company uuid,
  p_number uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_company is null then
    return;
  end if;

  if p_number is not null then
    perform public.realtime_send_sequenced(
      p_payload,
      p_event,
      'company:' || p_company::text || ':number:' || p_number::text,
      p_company);
  else
    -- A null-number call.updated has no number topic (D88 addendum).
    perform public.realtime_send_sequenced(
      p_payload, p_event, 'company:' || p_company::text, p_company);
  end if;
end;
$function$;

comment on function public.broadcast_number_scoped(jsonb, text, uuid, uuid) is
  '#484: publish a number-scoped event to the per-number topic, or to the company '
  'topic when it has no number. Every send carries the topic''s gapless sequence.';

revoke all on function public.broadcast_number_scoped(jsonb, text, uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The company-wide sends. Bodies are the current ones: provisioning from
-- 20260730050000, access from 20260730040000, notification reads from
-- 20260730002700; only the send changes.
-- ---------------------------------------------------------------------------
create or replace function public.broadcast_provisioning_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'phone_numbers' then
    perform public.broadcast_number_scoped(
      jsonb_build_object('number_id', new.id, 'status', new.status),
      'number.updated', new.company_id, new.id);

    perform public.realtime_send_sequenced(
      jsonb_build_object('company_id', new.company_id),
      'access.changed', 'company:' || new.company_id::text, new.company_id);
  else
    perform public.realtime_send_sequenced(
      jsonb_build_object('kind', new.kind, 'status', new.status),
      'registration.updated', 'company:' || new.company_id::text,
      new.company_id);
  end if;
  return null;
end $$;

comment on function public.broadcast_provisioning_change() is
  '#480: a phone_numbers change emits BOTH number.updated (scoped to that '
  'number) and a company-wide access.changed, because the scoped event is '
  'unhearable for a number the client has not joined yet. Payload of the '
  'company-wide one is the company id only (plus the topic sequence).';

revoke all on function public.broadcast_provisioning_change()
  from public, anon, authenticated;

create or replace function public.broadcast_number_access_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  co uuid := coalesce(new.company_id, old.company_id);
begin
  if co is null then return null; end if;
  perform public.realtime_send_sequenced(
    jsonb_build_object('company_id', co),
    'access.changed', 'company:' || co::text, co);
  return null;
end $$;

comment on function public.broadcast_number_access_changed() is
  '#480: tells every client in the company that number access changed, so they '
  're-derive their subscriptions. Payload is the company id and nothing else '
  '(plus the topic sequence): naming the number would leak the restriction.';

revoke all on function public.broadcast_number_access_changed()
  from public, anon, authenticated;

create or replace function public.broadcast_notifications_read() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.realtime_send_sequenced(
    jsonb_build_object('user_id', new.user_id),
    'read.notifications', 'company:' || new.company_id::text, new.company_id);
  return null;
end $$;

revoke all on function public.broadcast_notifications_read()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The erasure roster deletes by table name. Rewritten from the live definition
-- so a later change to the roster cannot be reverted by a stale copy here.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'purge_workspace_step';

  v_new := replace(v_def, $$'api_keys',$$, $$'api_keys', 'realtime_topic_seq',$$);
  if v_new = v_def then
    raise exception 'purge_workspace_step: the roster anchor was not found';
  end if;
  execute v_new;
end $mig$;

revoke execute on function public.purge_workspace_step(uuid, int)
  from public, anon, authenticated;
grant execute on function public.purge_workspace_step(uuid, int) to service_role;
