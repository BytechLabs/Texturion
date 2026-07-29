-- #340 — the marketing contact form kept non-customers' data forever.
--
-- `contact_messages` holds a name, an email, a company, a free-text message
-- and an IP address, for people who are not customers, have no account, and
-- appear in no deletion path we own. It was found by listing all 45 tables and
-- noticing one nobody had thought about.
--
-- The realistic worst case is a handful of stale records rather than a breach.
-- What makes it worth fixing is the one circumstance where it is genuinely
-- embarrassing: an access or erasure request, where "we hold your name, email,
-- message and IP indefinitely and had no plan for it" is materially worse than
-- the data itself warrants.
--
-- ---------------------------------------------------------------------------
-- TWO WINDOWS, because the IP is a different kind of thing.
--
-- The IP exists for abuse forensics — telling a spam flood from a real
-- enquiry. That question is answered within days, never months, so keeping it
-- longer is keeping a precise identifier for a purpose that has expired. It
-- goes at 30 days while the rest of the message survives.
--
-- The message itself is a business enquiry somebody chose to send us, and a
-- reply might reasonably come weeks later. Twelve months, matching the
-- audit-log window so there is one number to remember, then the whole row.

/** The IP goes first, and on its own. */
create or replace function public.api_prune_contact_ips(p_days int default 30)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.contact_messages
     set ip = null
   where ip is not null
     and created_at < now() - make_interval(days => greatest(p_days, 1));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/** Then the whole row, once a reply is no longer plausible. */
create or replace function public.api_prune_contact_messages(p_days int default 365)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  delete from public.contact_messages
   where created_at < now() - make_interval(days => greatest(p_days, 1));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- The erasure path.
--
-- A non-customer who asks us to delete their data has no account to delete, so
-- until now the honest answer would have been improvised. It does not need to
-- be self-serve at our scale — it needs to EXIST, and to return a count so
-- whoever handles the request can tell the person what was actually removed
-- rather than "it should be gone".
--
-- Case-insensitive because somebody writing in from a mail client will not
-- reproduce the casing they typed into a form months ago.
-- ---------------------------------------------------------------------------

create or replace function public.api_erase_contact_messages(p_email text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if p_email is null or length(trim(p_email)) = 0 then
    raise exception 'api_erase_contact_messages: an email is required';
  end if;

  delete from public.contact_messages
   where lower(email) = lower(trim(p_email));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.api_erase_contact_messages(text) is
  '#340: erasure path for a non-customer contact-form submission. Returns the '
  'count so the reply can state what was removed rather than what should be.';

revoke all on function public.api_prune_contact_ips(int) from public, anon, authenticated;
grant execute on function public.api_prune_contact_ips(int) to service_role;

revoke all on function public.api_prune_contact_messages(int)
  from public, anon, authenticated;
grant execute on function public.api_prune_contact_messages(int) to service_role;

revoke all on function public.api_erase_contact_messages(text)
  from public, anon, authenticated;
grant execute on function public.api_erase_contact_messages(text) to service_role;
