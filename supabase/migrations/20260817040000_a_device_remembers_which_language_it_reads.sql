-- #228 — a push notification arrives in the reader's language.
--
-- ## Why the language goes on the DEVICE row rather than on the person
--
-- `20260813080000_a_member_reads_in_their_own_language.sql` put a `locale` on
-- `profiles` and said plainly why the DEVICE rung of the ladder could not live
-- there: "the answer differs per device for the same person". That is true of
-- `profiles`, and it is exactly why the rung has been unreachable on the server
-- ever since — `resolveUiLocale(user, device, company)` has three arguments and
-- the middle one has never had a value outside a running client.
--
-- Push is the one channel where the device is not an abstraction. Every send
-- goes to a ROW: one `push_subscriptions` row is one browser, one
-- `device_push_tokens` row is one phone. Storing the device's language beside
-- the endpoint we are about to encrypt to is not a guess about which device a
-- person is holding — it is a fact about the device the notification is going
-- to.
--
-- ## Why this matters more than it sounds
--
-- Every screen in all three apps is translated. Every push notification is
-- composed in English on the server. A member who set their language to French
-- gets a French app and English alerts — and the alert is the half they read
-- first, on a lock screen, in the van, before they have opened anything.
--
-- ## Null means "this device never said"
--
-- Not "English". A row written by a build that predates this column is silent
-- rather than wrong, and `resolveUiLocale` falls through it to the company's
-- language exactly as it does for a person who never chose. The column
-- self-heals: the next time that app registers its token it says so, and no
-- store release is on the critical path for the server to be correct.
--
-- The CHECK mirrors `LOCALES` in packages/shared/src/locale.ts. A device that
-- reports something else normalises to null on the way in
-- (`normalizeDeviceLocale`), so an unsupported language is stored as silence
-- rather than rejected — the phone is reporting a fact about itself, not making
-- a request that can fail.

alter table public.push_subscriptions
  add column if not exists locale text
    check (locale is null or locale in ('en', 'fr-CA'));

comment on column public.push_subscriptions.locale is
  '#228: the language THIS browser reads, for the device rung of resolveUiLocale. Null = never reported.';

alter table public.device_push_tokens
  add column if not exists locale text
    check (locale is null or locale in ('en', 'fr-CA'));

comment on column public.device_push_tokens.locale is
  '#228: the language THIS phone reads, for the device rung of resolveUiLocale. Null = never reported.';
