-- #725: a call that ended on its own (the caller hung up, the ring window ran
-- out, every phone declined, the cleanup timer cut it off) left no trace of
-- why. The member's app and the call page showed a call that simply stopped.
--
-- Each call now records the reason the call machine ended it, set by the
-- terminal transition from the event that caused it. The values are
-- `CALL_END_REASONS` in packages/shared/src/call-end-reasons.ts; a test reads
-- this file and fails if the two lists differ.

alter table public.calls
  add column if not exists ended_reason text;

alter table public.calls
  drop constraint if exists calls_ended_reason_check;

alter table public.calls
  add constraint calls_ended_reason_check check (
    ended_reason is null or ended_reason in (
      'answered',
      'caller_hung_up',
      'no_answer_in_time',
      'declined_by_everyone',
      'nobody_reachable',
      'left_voicemail',
      'rejected_blocked',
      'rejected_over_limit',
      'line_paused',
      'stuck_call_cleaned_up',
      'intent_expired',
      'voicemail_failed',
      'carrier_refused',
      'placer_hung_up',
      'customer_hung_up',
      'no_answer'
    )
  );

comment on column public.calls.ended_reason is
  '#725: why the call machine ended the call: answered, caller_hung_up, '
  'no_answer_in_time, declined_by_everyone, nobody_reachable, left_voicemail, '
  'rejected_blocked, rejected_over_limit, line_paused, stuck_call_cleaned_up, '
  'intent_expired, voicemail_failed, carrier_refused, placer_hung_up, '
  'customer_hung_up or no_answer. Null for a call still in progress and for '
  'calls from before this column existed.';
