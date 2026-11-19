create table public.webhook_disable_emails (
  audit_id uuid primary key references public.audit_log(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now()
);

create index webhook_disable_emails_due_idx on public.webhook_disable_emails (next_attempt_at, audit_id);
alter table public.webhook_disable_emails enable row level security;
revoke all on public.webhook_disable_emails from public, anon, authenticated;
grant select, delete on public.webhook_disable_emails to service_role;

create function public.api_claim_webhook_disable_emails(p_limit integer default 20)
returns table (audit_id uuid, company_id uuid)
language sql
security definer
set search_path = ''
as $$
  with due as (
    select pending.audit_id
    from public.webhook_disable_emails pending
    where pending.next_attempt_at <= now()
      and pending.created_at > now() - interval '23 hours'
    order by pending.next_attempt_at, pending.audit_id
    for update skip locked
    limit least(greatest(p_limit, 1), 50)
  )
  update public.webhook_disable_emails pending
  set next_attempt_at = now() + interval '10 minutes'
  from due where due.audit_id = pending.audit_id
  returning pending.audit_id, pending.company_id;
$$;

revoke execute on function public.api_claim_webhook_disable_emails(integer) from public, anon, authenticated;
grant execute on function public.api_claim_webhook_disable_emails(integer) to service_role;

create index audit_log_webhook_disabled_idx on public.audit_log (company_id, occurred_at desc, id)
  where action = 'webhook.endpoint_disabled';
