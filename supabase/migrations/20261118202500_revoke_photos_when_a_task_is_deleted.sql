create function public.revoke_deleted_task_photo_links() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.api_revoke_public_links_for_subject(
    new.company_id, 'task_photos', new.id, 'task deleted'
  );
  return null;
end $$;

revoke execute on function public.revoke_deleted_task_photo_links() from public, anon, authenticated;

-- Conversation restore must preserve links to its jobs.
create trigger revoke_deleted_task_photo_links
after update of deleted_at on public.tasks
for each row when (
  old.deleted_at is null and new.deleted_at is not null and new.trashed_with_conversation_at is null
)
execute function public.revoke_deleted_task_photo_links();
