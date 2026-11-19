alter table public.calls
  add column voicemail_pending_since timestamptz,
  add column voicemail_pending_started_at timestamptz,
  add column voicemail_pending_ended_at timestamptz,
  add column voicemail_pending_attempted_at timestamptz;

create index calls_voicemail_pending_idx
  on public.calls (voicemail_pending_attempted_at nulls first, voicemail_pending_since, id)
  where voicemail_pending_since is not null and voicemail_deleted_at is null and deleted_at is null;

create function public.api_defer_voicemail(
  p_session_id text,
  p_started_at timestamptz,
  p_ended_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.calls
     set voicemail_pending_since = coalesce(voicemail_pending_since, now()),
         voicemail_pending_started_at = coalesce(voicemail_pending_started_at, p_started_at),
         voicemail_pending_ended_at = coalesce(voicemail_pending_ended_at, p_ended_at)
   where call_session_id = p_session_id and voicemail_deleted_at is null and deleted_at is null;
  if found then return true; end if;
  return exists (select 1 from public.calls where call_session_id = p_session_id);
end $$;

revoke execute on function public.api_defer_voicemail(text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.api_defer_voicemail(text, timestamptz, timestamptz) to service_role;
