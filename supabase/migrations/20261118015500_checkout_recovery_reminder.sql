alter table public.companies
  add column checkout_reminder_sent_at timestamptz;

comment on column public.companies.checkout_reminder_sent_at is
  'Claim for one checkout recovery reminder per workspace.';
