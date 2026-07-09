-- Choose-your-number honest status, phase 2: a fourth provision-failure reason,
-- 'timeout', for a Telnyx number_order that sits 'pending' so long it is
-- effectively stuck. Before this, recoverFromOrder returned such a row UNCHANGED
-- forever (never incrementing attempts), so a genuinely-stuck order pinned the
-- phone_numbers row at status='provisioning' indefinitely and every surface kept
-- showing "usually under a minute." — a frozen lie with no escape.
--
-- provisioning.ts now bounds the pending dwell (STUCK_PENDING_MS, measured from
-- the immutable created_at) and flips such a row to provision_failed with this
-- reason, which opens the SAME self-service "Choose a number" remediation the
-- no-inventory path uses. Additive + backward compatible (null = today's
-- behavior); deploy this migration BEFORE the Worker that writes 'timeout'.
alter table public.phone_numbers
  drop constraint if exists phone_numbers_provision_failure_reason_check;
alter table public.phone_numbers
  add constraint phone_numbers_provision_failure_reason_check
  check (provision_failure_reason in ('no_inventory', 'carrier', 'unknown', 'timeout'));

comment on column public.phone_numbers.provision_failure_reason is
  'Coarse customer-safe reason the last provision failed (no_inventory|carrier|unknown|timeout); null until a failure, cleared on activation. The raw error lives in last_provision_error and is never sent to clients.';
