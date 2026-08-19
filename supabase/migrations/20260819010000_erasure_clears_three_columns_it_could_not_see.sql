-- Erasure clears three more columns on `companies`, and PC-3 can see them.
--
-- `20260812160000_erasure_clears_the_words_a_business_wrote.sql` added PC-3 to
-- make this class of miss impossible: "A text column added to `companies` in
-- future fails the build until somebody decides which side it is on — which is
-- the only thing that stops this happening a third time."
--
-- Two filters in PC-3 meant it never could.
--
-- 1. `data_type in ('text', 'character varying')`. `information_schema` reports
--    `text[]` as ARRAY and jsonb as jsonb, so neither was examined — even
--    though the function it checks already clears a jsonb column
--    (`business_hours = '{}'::jsonb`), which is the proof those types carry
--    data worth clearing.
--
-- 2. `prosrc not like '%' || column_name || ' =%'` is a SUBSTRING test, so a
--    column whose name is a suffix of an assigned one reads as cleared:
--    `display_name` would match `cnam_display_name =`, `source` matches
--    `signup_source =`, `message` matches `away_message =`.
--
-- With the filters corrected, three columns turn out to have survived erasure:
--
--   emergency_keywords         the words the business itself chose as
--                              emergency triggers. The same class as
--                              `emergency_message` directly above it in the
--                              function, added at the same time, and missed.
--   business_hours_exceptions  {from, to, hours, note} — and `note` is a
--                              sentence the business wrote about its own
--                              closure.
--   signup_first_touch         referrer and campaign parameters. Exactly the
--                              class as `signup_source` and
--                              `signup_landing_path`, which the function
--                              already clears with the reason "it has no
--                              purpose once the business is gone".
--
-- `emergency_keywords` goes to NULL rather than '{}': its own migration records
-- that NULL means "the product's list" and '{}' means "no keywords at all", so
-- NULL is the absence of a choice and '{}' would be a choice nobody made.
--
-- The whole function body is restated because `create or replace` needs it, and
-- copying the current one is the only safe way — a body rewritten from memory
-- is how a clear-list loses an entry.

create or replace function public.anonymize_purged_workspace(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.companies
     where id = p_company_id and deleted_at is not null
       and purge_after is not null and purge_after <= now()
  ) then
    raise exception 'anonymize_purged_workspace: % is not past its purge window', p_company_id;
  end if;

  update public.companies
     set name = 'Closed workspace',
         stripe_customer_id = null,
         stripe_subscription_id = null,
         telnyx_messaging_profile_id = null,
         chosen_number_e164 = null,
         away_message = null,
         mctb_message = null,
         voicemail_greeting = null,
         cnam_display_name = null,
         -- #581: the same class as `away_message` above — the business's own
         -- words, sent to its own customers — added after this function was
         -- written and never added to it. `DELETION.md` stated an exhaustive
         -- Kept list that did not include them, so the document was wrong about
         -- its own product.
         emergency_message = null,
         -- And the TRIGGERS for that message, which are also the business's own
         -- words and were missed the same way. NULL, not '{}': null means "the
         -- product's list" and '{}' would record a deliberate empty choice.
         emergency_keywords = null,
         offramp_message = null,
         -- Attribution about how this business found us. It has no purpose once
         -- the business is gone, and it is about them rather than about their
         -- customers, which is the same reason the plan identifiers above go.
         signup_source = null,
         signup_landing_path = null,
         -- The rest of that same first touch. Named separately here only
         -- because it is jsonb, which is the reason PC-3 could not see it.
         signup_first_touch = null,
         business_hours = '{}'::jsonb,
         -- Each exception carries a `note` the business wrote about its own
         -- closure. '[]' rather than null: the column is NOT NULL with that
         -- default, and an empty list is "no exceptions", which is true.
         business_hours_exceptions = '[]'::jsonb,
         -- #371: read by the sweep before this runs, gone once it has.
         purge_receipt_email = null,
         purged_at = now()
   where id = p_company_id;

  return jsonb_build_object('outcome', 'anonymized');
end $$;
