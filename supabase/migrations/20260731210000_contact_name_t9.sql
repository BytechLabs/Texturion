-- #459 — dial by name, from the same screen.
--
-- The founder's ask was "dial by name instead of number? somehow? from the same
-- screen?" and the answer has been printed on every telephone since 1963: the
-- letters on the keys. 2 is ABC, 6 is MNO, so typing 2-6-2 spells BOB. There is
-- no search field to add because the keypad already is one.
--
-- WHY THIS IS A COLUMN AND NOT CLIENT-SIDE MATCHING. Translating digits back
-- into letters is exponential (three digits is 27 possible prefixes, four is
-- 81), so the only sane direction is name → digits. Doing that on the client
-- means shipping the whole address book to a phone to search it, which is fine
-- for a crew of four and wrong for anyone who imported five thousand customers.
-- Doing it here means one indexed query, the same for every client, and the
-- device address book stays the only thing a phone has to rank locally.
--
-- WHY GENERATED AND NOT AN EXPRESSION INDEX. `contacts_phone_digits_trgm`
-- (#308) is an expression index and PostgREST cannot filter on an expression,
-- so it only ever served the search RPC. The list endpoint the dialer calls
-- goes through PostgREST, which can filter on a real column. Generated keeps it
-- honest: there is no write path that can forget to update it.

alter table public.contacts
  add column if not exists name_t9 text
  generated always as (
    translate(
      -- Every run of non-alphanumerics becomes ONE space, so "Smith-Jones",
      -- "O'Brien" and "Mc  Coy" all split into words the same way. The match
      -- rule is per-word: typing the start of a surname has to find it, and
      -- letters buried mid-word must not.
      btrim(regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]+', ' ', 'g')),
      'abcdefghijklmnopqrstuvwxyz',
      '22233344455566677778889999'
    )
  ) stored;

comment on column public.contacts.name_t9 is
  '#459: the contact name as keypad digits (T9), for dial-by-name. Derived from '
  'name, so it is personal data and lives under the same retention and erasure '
  'rules as the name itself.';

-- Serves both patterns the dialer sends: a first-word prefix ('262%') and a
-- later-word one ('% 262%'). Trigram rather than text_pattern_ops because only
-- one of the two is a left-anchored prefix.
create index if not exists contacts_name_t9_trgm
  on public.contacts
  using gin (name_t9 extensions.gin_trgm_ops);
