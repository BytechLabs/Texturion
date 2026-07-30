-- #480 — a NEW number has to be announced somewhere a client is already listening.
--
-- Found by an adversarial review of the step-5 client work, and it is a hole in
-- the previous migration rather than in the clients.
--
-- THE CHICKEN AND EGG. `number.updated` is number-scoped, so after the contract
-- step it publishes only to `company:{id}:number:{n}`. That is the correct scope
-- for a status change on a number you can already see — and it is useless as the
-- announcement that the number EXISTS, because hearing it requires having already
-- joined the topic of a number you have never heard of.
--
-- `access.changed` cannot cover it either: a brand-new number has no
-- `number_access` rows at all (no rules means open to everyone, which is the
-- product's default), so nothing fires.
--
-- Post-contract that means a company's second number would have realtime for
-- NOBODY until every client restarted. Inbound texts on it would simply not
-- appear. Silent, and on the surface the socket looks perfectly healthy.
--
-- THE FIX IS THE SIGNAL WE ALREADY HAVE. `access.changed` means "the set of
-- numbers you can reach may have changed — ask again". A number appearing,
-- activating or being released changes that set exactly as an access rule does,
-- and all three clients already respond to it by re-deriving their list from the
-- server's access-filtered answer and reconciling their subscriptions.
--
-- So `phone_numbers` fires it too. This deliberately widens what the event means
-- from "a number_access row changed" to "your visible number set may have
-- changed", which is the useful meaning and the one the clients already
-- implement. A second event name would need three more client changes to say the
-- same thing.
--
-- STILL NO LEAK. The payload is the company id and nothing else — the same
-- discipline as the original: naming the number would tell every member that a
-- number they may be denied exists, which is precisely the metadata the
-- access-filtered list withholds. A client learns only that it should ask again,
-- and the answer it gets back is already filtered for it.
--
-- CHATTINESS IS BOUNDED AND WORTH IT. This fires on every `phone_numbers` UPDATE,
-- including each status tick while a number provisions. Provisioning is rare, a
-- company holds very few numbers, and the cost of one extra `/v1/me` per tick is
-- nothing against a number that never comes alive for anyone.

create or replace function public.broadcast_provisioning_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'phone_numbers' then
    -- The status change itself, scoped to the number it is about (#480 step 4).
    perform public.broadcast_number_scoped(
      jsonb_build_object('number_id', new.id, 'status', new.status),
      'number.updated', new.company_id, new.id);

    -- And the company-wide "ask again", so a number nobody has joined yet can
    -- still be discovered. Without this the event above is unhearable for a new
    -- number once the company-topic send is removed.
    perform realtime.send(
      jsonb_build_object('company_id', new.company_id),
      'access.changed', 'company:' || new.company_id::text, true);
  else
    -- Company-wide by construction: unique (company_id, kind), and the
    -- registration authorizes every number the company has.
    perform realtime.send(
      jsonb_build_object('kind', new.kind, 'status', new.status),
      'registration.updated', 'company:' || new.company_id::text, true);
  end if;
  return null;
end $$;

comment on function public.broadcast_provisioning_change() is
  '#480: a phone_numbers change emits BOTH number.updated (scoped to that '
  'number) and a company-wide access.changed, because the scoped event is '
  'unhearable for a number the client has not joined yet — which is every new '
  'number. Payload of the company-wide one is the company id only.';
