-- Choose-your-number, phase 1 (honest status): a coarse, customer-SAFE reason a
-- number provision failed. Today provision_failed renders identically to
-- provisioning ("still setting up… you don't need to do anything") on every
-- surface — a lie when the backend has actually given up (e.g. an exhausted
-- area code like 416). This column lets the UI tell the truth and offer the
-- right action ("no numbers in 416 — choose another") WITHOUT leaking the raw
-- vendor error, which stays server-only in last_provision_error.
--
-- Written by recordProvisionFailure (classified from the failure cause),
-- cleared on activation. Additive + nullable; no backfill; fully backward
-- compatible (null = today's behavior).
alter table public.phone_numbers
  add column provision_failure_reason text null
  check (
    provision_failure_reason in ('no_inventory', 'carrier', 'unknown')
  );

comment on column public.phone_numbers.provision_failure_reason is
  'Coarse customer-safe reason the last provision failed (no_inventory|carrier|unknown); null until a failure, cleared on activation. The raw error lives in last_provision_error and is never sent to clients.';
