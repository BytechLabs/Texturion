-- #460 — the owner's words, not ours.
--
-- The founder's complaint, verbatim: "Lots of defaults assume user is in some
-- industry or business. Like default reply of 'For a no-heat or burst-pipe
-- emergency, reply URGENT' etc.. This is awful." It is. A landscaper, a
-- locksmith, a mobile mechanic and a cleaner all receive copy written for a
-- plumber, and there was no way to change the part that matters most.
--
-- Two things were configurable already (`away_message`, `mctb_message`) and two
-- were not: WHICH WORD summons the crew, and WHAT WE SAY BACK when it does.
-- Those are exactly the two an owner most needs, because the away message they
-- can already edit is the one that TELLS customers the word.
--
-- ---------------------------------------------------------------------------
-- `emergency_keywords` — NULL means "the product's list", not "no keywords".
--
-- Same nullable-means-default contract as `away_message` and `mctb_message`, and
-- for the same reason: a column that stored the defaults would freeze whatever
-- the list was on the day each workspace signed up, so improving it later would
-- reach nobody. An owner who wants URGENT plus their own word writes both; the
-- resolver in `packages/shared/src/emergency.ts` is the single place that turns
-- null into the product list, and the settings screens read the same answer the
-- inbound handler acts on. Two lists is the drift #414 was caused by.
--
-- The CHECK is deliberately narrow, and every clause is a bug somebody would
-- otherwise hit at 11pm:
--   * 1..10 entries — an empty array is not "no emergencies", it is a silent
--     switch-off with a switch (`emergency_keyword_enabled`) that already exists
--     and says so honestly.
--   * A..Z0-9 only, 2..15 chars — the matcher reads the FIRST WORD of an inbound
--     after splitting on whitespace and punctuation, so a keyword containing a
--     space or a hyphen could never match anything. Storing one would be
--     accepting a setting that cannot work.
--   * Uppercase — the matcher upper-cases the inbound word before comparing.
--     A lowercase row would simply never fire.
alter table public.companies
  add column if not exists emergency_keywords text[];

/**
 * The whole rule, in one immutable function.
 *
 * A CHECK constraint cannot contain a subquery, and both halves of this rule
 * need one (`unnest` to reach the elements, `distinct` to reject duplicates).
 * A function is the supported way to express it — and it is the better one
 * anyway, because the reason each clause exists can live next to the clause
 * rather than inside a constraint expression nobody can read.
 *
 * IMMUTABLE is honest here: it reads only its argument, and the regex and
 * bounds are literals. That matters because a CHECK is re-evaluated on every
 * write and Postgres will not accept a volatile function in one.
 */
create or replace function public.valid_emergency_keywords(p_words text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    -- 1..10. An empty array is NOT "no emergencies" — that is a silent
    -- switch-off, and `emergency_keyword_enabled` already says it honestly.
    -- Past ten it has stopped being an emergency word and become a tag system.
    coalesce(array_length(p_words, 1), 0) between 1 and 10
    -- Every entry must be one the matcher could actually match. It splits an
    -- inbound on whitespace and punctuation and upper-cases the first token, so
    -- a keyword with a space, a hyphen or a lowercase letter can never equal
    -- anything it sees. Storing one would show an owner a saved setting that
    -- does nothing, and they would find out on the night it mattered.
    and not exists (
      select 1 from unnest(p_words) w where w !~ '^[A-Z0-9]{2,15}$'
    )
    -- No duplicates: the settings screens count this list, so the same word
    -- twice would report a number nobody typed and read as a bug.
    and array_length(p_words, 1) = (
      select count(distinct w) from unnest(p_words) w
    )
$$;

comment on function public.valid_emergency_keywords(text[]) is
  '#460: the storable-equals-matchable rule for companies.emergency_keywords. '
  'A keyword the inbound matcher could never match is worse than no keyword, '
  'because the owner believes they are covered.';

alter table public.companies
  drop constraint if exists companies_emergency_keywords_ck;
alter table public.companies
  add constraint companies_emergency_keywords_ck check (
    emergency_keywords is null
    or public.valid_emergency_keywords(emergency_keywords)
  );

comment on column public.companies.emergency_keywords is
  '#460: the words this workspace treats as an emergency. NULL means the product '
  'list (EMERGENCY_KEYWORDS in packages/shared). Uppercase, single-word, 2-15 '
  'chars — the inbound matcher splits on whitespace and punctuation and '
  'upper-cases before comparing, so anything else could never match.';

-- ---------------------------------------------------------------------------
-- `emergency_message` — what we send back, minus the one line that is ours.
--
-- This one carries a real constraint from #414 ask 4, and it is a safety
-- property rather than a preference: *"Never auto-reply to the emergency keyword
-- with reassurance. 'We'll call you shortly' sent by a robot to someone with a
-- gas smell is worse than silence."* The product must not let an owner promise a
-- human it cannot wake.
--
-- The resolution is not to keep the whole message ours — that was the actual
-- complaint, and the trade-specific half of it ("you smell gas", "your utility's
-- emergency line") was never defensible for a locksmith. It is to split the
-- message: the owner writes the body, and the product ALWAYS appends one short
-- sentence naming the alternative. The owner controls what is promised; the
-- product keeps the sentence that stops the promise being a lie. See
-- `emergencyReplyBody` in packages/shared.
alter table public.companies
  add column if not exists emergency_message text
    check (emergency_message is null or length(emergency_message) <= 1000);

comment on column public.companies.emergency_message is
  '#460: the workspace''s own reply to an emergency keyword. NULL means the '
  'product default. The product''s safety sentence is appended to whatever is '
  'here and cannot be removed (#414 ask 4) — an owner controls what is promised, '
  'not whether the alternative is named.';
