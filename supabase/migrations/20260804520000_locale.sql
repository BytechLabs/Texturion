-- #228 — the language a business works in, and the language one customer reads.
--
-- We sell into Canada on purpose: there is a /canada page, a regions_ca billing
-- module, and Canadian number ordering is a tracked workstream. Roughly a fifth
-- of Canadians speak French at home, concentrated in the province where the
-- trades market we are chasing is largest. Every automated message this product
-- sends has been English.
--
-- TWO COLUMNS, because they answer different questions.
--
-- `companies.locale` is the language the BUSINESS works in, and it is the
-- default every new contact inherits. Not null, because a business always has
-- one and a null here would mean "ask again later", which nothing would.
--
-- `contacts.locale` is nullable ON PURPOSE, and the null is load-bearing: it
-- means "whatever the company works in", not "English". A bilingual crew in
-- Montreal set to fr-CA gets French for every customer they have not said
-- otherwise about, and flipping the company setting moves all of them at once.
-- Storing the resolved value per contact instead would freeze thousands of rows
-- at whatever the company was on the day each was created, and the owner who
-- changed the company setting would watch nothing happen.
--
-- WHY A CHECK CONSTRAINT AND NOT AN ENUM. `country` two lines above does the
-- same thing, so this matches what is here. It also matters that adding es-US
-- (the obvious third, given how much of the US trades workforce is
-- Spanish-speaking) is one ALTER on a constraint rather than an enum value that
-- can never be removed if the experiment fails.
--
-- BCP 47 casing, `fr-CA` rather than `fr_ca`, because that is what every client
-- platform speaks: Intl on web, Locale.forLanguageTag on Android,
-- Locale(identifier:) on iOS. A private spelling here would need translating in
-- three places and would be got wrong in one of them.

alter table public.companies
  add column if not exists locale text not null default 'en'
    check (locale in ('en', 'fr-CA'));

comment on column public.companies.locale is
  '#228: the language this business works in. Drives automated outbound copy '
  'and is the default every contact inherits. BCP 47.';

alter table public.contacts
  add column if not exists locale text
    check (locale in ('en', 'fr-CA'));

comment on column public.contacts.locale is
  '#228: the language THIS customer reads, overriding the company default. '
  'Null means inherit from companies.locale — not English. Storing the '
  'resolved value would freeze every existing row when the company setting '
  'changes.';

-- Every business already here works in English. Explicit rather than relying on
-- the column default: the default applies to rows created from now on, and
-- being able to read "no company was silently moved to French" off the
-- migration itself is worth one statement.
update public.companies
   set locale = 'en'
 where locale is null;
