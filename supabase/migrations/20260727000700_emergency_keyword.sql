-- ===========================================================================
-- [#414] The emergency reply the product asked for, made real.
--
-- The default away message ships enabled and is kept by most owners, because a
-- good default is exactly what people keep. It ends:
--
--   "For a no-heat or burst-pipe emergency, reply URGENT and we'll call you."
--
-- Nothing handled URGENT. It threaded as an ordinary message, at normal push
-- priority, on a phone face-down on a bedside table. At 11pm in January that
-- is a family in a cold house who was told help was coming.
--
-- The promise is the PRODUCT's, not the owner's. The homeowner never agreed to
-- anything with us and had no way to know the instruction went nowhere.
--
-- WHY A COLUMN AND NOT A CONSTANT. `away-reply.ts` refuses to hard-code
-- "we're closed" on the grounds that the owner must control what is promised
-- — and then the default hard-coded a far stronger promise with nothing behind
-- it. A shop that does not offer emergency service must be able to turn this
-- off rather than promise a callback it will not make.
--
-- DEFAULT ON, deliberately. The copy that creates the expectation is already
-- on by default; shipping the mechanism off would leave the promise exactly as
-- unkept as it is today for every owner who never finds the switch.
-- ===========================================================================

alter table public.companies
  add column if not exists emergency_keyword_enabled boolean not null default true;

comment on column public.companies.emergency_keyword_enabled is
  '#414: when a customer replies URGENT/EMERGENCY/911/SOS, wake the whole crew at high priority rather than threading it as an ordinary message. On by default because the away-message copy that asks for it is on by default.';

-- The timeline needs a word for it. Without one, the only trace of the most
-- consequential message a workspace can receive is an ordinary inbound row.
alter type public.conversation_event_type
  add value if not exists 'emergency_flagged';
