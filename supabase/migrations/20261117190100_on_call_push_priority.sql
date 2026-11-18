alter table public.high_priority_push_days
  drop constraint high_priority_push_days_reason_check,
  add constraint high_priority_push_days_reason_check
    check (reason in ('lead', 'lead_chase', 'emergency', 'ring', 'call_end', 'on_call_page', 'escalation'));
