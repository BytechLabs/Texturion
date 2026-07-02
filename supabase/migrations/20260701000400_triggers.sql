-- SPEC §6 — Triggers: moddatetime updated_at, profile sync from auth.users,
-- and the §8 Broadcast-from-Database triggers (realtime.send with ID-only
-- payloads into the private topic company:{company_id}).

-- ---------------------------------------------------------------------------
-- updated_at on every mutable table (SPEC §6 list).
-- ---------------------------------------------------------------------------

create trigger set_updated_at before update on public.profiles
  for each row execute function extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.companies
  for each row execute function extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.company_members
  for each row execute function extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.invites
  for each row execute function extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.phone_numbers
  for each row execute function extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.messaging_registrations
  for each row execute function extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.contacts
  for each row execute function extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.conversations
  for each row execute function extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.messages
  for each row execute function extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.tags
  for each row execute function extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.opt_outs
  for each row execute function extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.templates
  for each row execute function extensions.moddatetime(updated_at);
create trigger set_updated_at before update on public.notification_prefs
  for each row execute function extensions.moddatetime(updated_at);

-- ---------------------------------------------------------------------------
-- Profile sync from Supabase Auth (SPEC §6).
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', ''))
  on conflict (user_id) do update set display_name = excluded.display_name;
  return new;
end $$;

create trigger on_auth_user_created after insert or update on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Realtime Broadcast triggers (SPEC §8): realtime.send() with ID-only payloads
-- into private topic company:{company_id}. Five events:
--   message.created {conversation_id, message_id, direction}
--   message.status  {message_id, status}
--   conversation.updated {conversation_id}
--   number.updated  {number_id, status}
--   registration.updated {kind, status}
-- ---------------------------------------------------------------------------

create or replace function public.broadcast_message_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform realtime.send(
      jsonb_build_object('conversation_id', new.conversation_id,
                         'message_id', new.id, 'direction', new.direction),
      'message.created', 'company:' || new.company_id::text, true);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    perform realtime.send(
      jsonb_build_object('message_id', new.id, 'status', new.status),
      'message.status', 'company:' || new.company_id::text, true);
  end if;
  return null;
end $$;

create trigger messages_broadcast after insert or update on public.messages
  for each row execute function public.broadcast_message_change();

create or replace function public.broadcast_conversation_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('conversation_id', new.id),
    'conversation.updated', 'company:' || new.company_id::text, true);
  return null;
end $$;

create trigger conversations_broadcast after update on public.conversations
  for each row execute function public.broadcast_conversation_change();

-- Onboarding live states (§4.1 step 6): number provisioning → active,
-- registration pending → approved render without refresh.
create or replace function public.broadcast_provisioning_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'phone_numbers' then
    perform realtime.send(
      jsonb_build_object('number_id', new.id, 'status', new.status),
      'number.updated', 'company:' || new.company_id::text, true);
  else
    perform realtime.send(
      jsonb_build_object('kind', new.kind, 'status', new.status),
      'registration.updated', 'company:' || new.company_id::text, true);
  end if;
  return null;
end $$;

create trigger phone_numbers_broadcast after update on public.phone_numbers
  for each row execute function public.broadcast_provisioning_change();
create trigger registrations_broadcast after insert or update on public.messaging_registrations
  for each row execute function public.broadcast_provisioning_change();
