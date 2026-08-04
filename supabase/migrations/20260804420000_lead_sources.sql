-- [#301] Where this customer came from.
--
-- Every conversation arrives as a phone number and nothing else. Whether that
-- customer found the business through Google, a lawn sign, a neighbour, a truck
-- wrap or an ad the owner pays for every month, we throw the answer away — at
-- the exact moment it is knowable, which is first contact.
--
-- "Where do my customers come from?" is the question every small-business owner
-- asks and almost none can answer, and it is the one with the most money
-- attached: a contractor spending $2,000 a month with no idea which half works
-- is the normal case.
--
-- ---------------------------------------------------------------------------
-- PER-NUMBER ATTRIBUTION LEADS, BECAUSE IT COSTS THE CREW NOTHING.
--
-- #301's devil's-advocate section names the trap precisely: asking the tech to
-- categorise every inbound is a tax on the person with the least time, and a
-- source field that is empty 80% of the time produces a MISLEADING report
-- rather than no report.
--
-- A number on the truck, a number on the yard sign, a number in the ad — the
-- product already supports that structurally, and attribution then comes free
-- from which line rang. No tap, no prompt, nobody to remember. That is why this
-- migration's centre of gravity is a trigger rather than a form.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The owner's own list.
--
-- Owner-defined rather than a fixed taxonomy, for the same reason #298 argued
-- about tags: "Neighbour" matters to a plumber and "Trade counter" matters to
-- an electrician, and a list we chose would be wrong for both. Suggest, never
-- impose — so the table starts empty for every workspace.
-- ---------------------------------------------------------------------------
create table if not exists public.lead_sources (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  -- What the owner calls it: "Truck", "Yard sign", "Google", "Referral".
  name        text not null,
  -- ARCHIVED, NEVER DELETED — see the FK note below.
  archived_at timestamptz,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),

  constraint lead_sources_name_unique unique (company_id, name),
  -- Short on purpose: this is a chip in a picker a tech taps one-handed, not a
  -- campaign name. Forty characters is a label; four hundred is a paragraph
  -- nobody can read in a list.
  constraint lead_sources_name_len check (char_length(btrim(name)) between 1 and 40)
);

create index if not exists lead_sources_company_idx
  on public.lead_sources (company_id, archived_at, name);

alter table public.lead_sources enable row level security;

comment on table public.lead_sources is
  'Owner-defined lead sources (#301). Archived, never deleted: deleting one would erase where existing customers came from.';

-- ---------------------------------------------------------------------------
-- The line's own source. This is the free attribution.
-- ---------------------------------------------------------------------------
alter table public.phone_numbers
  add column if not exists lead_source_id uuid
    references public.lead_sources (id) on delete restrict;

comment on column public.phone_numbers.lead_source_id is
  'Where calls and texts to THIS line come from (#301). Stamped onto every conversation the line creates, with no human input.';

-- ---------------------------------------------------------------------------
-- The conversation's source, and how we came to believe it.
--
-- `on delete restrict` on BOTH references, which is the opposite of what every
-- other optional FK in this schema does, and the reason is the whole point of
-- the feature: `set null` would let deleting one row erase where four hundred
-- customers came from, silently and irreversibly. A source that stops being
-- used is ARCHIVED — it vanishes from the picker and stays in the history.
--
-- `lead_source_origin` is a column rather than an inference from `set_by`
-- because the honest report #301 asks for depends on the difference. It also
-- survives the case that would corrupt the inference: an actor's row being
-- deleted would null a `set_by` and quietly turn a human's answer into a
-- machine's fact.
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column if not exists lead_source_id uuid
    references public.lead_sources (id) on delete restrict;

alter table public.conversations
  add column if not exists lead_source_origin text;

alter table public.conversations
  add column if not exists lead_source_set_by uuid
    references auth.users (id) on delete set null;

alter table public.conversations
  drop constraint if exists conversations_lead_source_origin_check;
alter table public.conversations
  add constraint conversations_lead_source_origin_check
  check (lead_source_origin is null or lead_source_origin in ('number', 'manual'));

-- A source without a story about where it came from is exactly the "inferred
-- source presented as a fact" #301 forbids, and an origin with no source is a
-- story about nothing.
alter table public.conversations
  drop constraint if exists conversations_lead_source_consistency;
alter table public.conversations
  add constraint conversations_lead_source_consistency
  check ((lead_source_id is null) = (lead_source_origin is null));

create index if not exists conversations_lead_source_idx
  on public.conversations (company_id, lead_source_id);

comment on column public.conversations.lead_source_id is
  'Where this customer came from (#301). Copied from the line at creation, or set by a person.';
comment on column public.conversations.lead_source_origin is
  '''number'' = attributed automatically by which line rang; ''manual'' = a person said so (#301).';

-- ---------------------------------------------------------------------------
-- The stamp, as a TRIGGER rather than as eight edited RPCs.
--
-- Eight functions in this schema insert into `conversations` — the inbound
-- pipeline, the missed-call path, the outbound starter, the call threader, and
-- three more in the contact-phones migration alone. Copying "and also set the
-- lead source" into each is how the ninth one, written six months from now,
-- silently creates unattributed conversations that no report can explain.
--
-- IT IS A SNAPSHOT, and that is a decision rather than an implementation
-- detail. A number retired from the yard sign and reused for a Google ad must
-- not retroactively relabel last year's customers as having come from Google.
-- What the line meant AT FIRST CONTACT is the fact; what it means today is a
-- different fact about a different period.
-- ---------------------------------------------------------------------------
create or replace function public.conversations_stamp_lead_source()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source uuid;
begin
  -- A source supplied by the caller is a person's answer, and it wins. The
  -- origin is only defaulted when the caller did not say — an explicit
  -- 'number' from a backfill stays 'number'.
  if new.lead_source_id is not null then
    if new.lead_source_origin is null then
      new.lead_source_origin := 'manual';
    end if;
    return new;
  end if;

  select lead_source_id into v_source
    from public.phone_numbers
   where id = new.phone_number_id;

  if v_source is not null then
    new.lead_source_id := v_source;
    new.lead_source_origin := 'number';
  end if;
  return new;
end;
$$;

drop trigger if exists conversations_stamp_lead_source on public.conversations;
create trigger conversations_stamp_lead_source
  before insert on public.conversations
  for each row execute function public.conversations_stamp_lead_source();

comment on function public.conversations_stamp_lead_source() is
  'Copies the line''s lead source onto a new conversation (#301). A trigger and not eight call sites, and a snapshot so retiring a tracked number never rewrites history.';
