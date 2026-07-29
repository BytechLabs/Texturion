-- #430 — let the business decide whether a customer's words leave our servers.
--
-- SPEC §8 puts the contact name plus 80 characters of the message body in
-- every inbound push, and THAT DEFAULT IS RIGHT. #388 argues the five-minute
-- window decides the job, and triage-without-unlocking is what makes it
-- possible: a tech on a roof needs to know whether this is a lead or a
-- "thanks" before deciding to climb down. A contentless "you have a new
-- message" makes every alert equally urgent, which is the same as none of them
-- being urgent.
--
-- ---------------------------------------------------------------------------
-- WHY A CONTROL EXISTS AT ALL, GIVEN THE DEFAULT IS RIGHT.
--
-- The content is not the tech's own information. It is a THIRD PARTY'S. A
-- homeowner wrote their address, their situation, sometimes a gate code, to a
-- business — and this crew works inside other people's homes. The phone is not
-- on a desk in an office; it is on a truck dashboard or face-up on a kitchen
-- counter in the NEXT customer's house, showing the previous customer's words.
--
-- In the structure that governs this product the business is the controller
-- and we are the processor, and the controller had no lever here at all. iOS
-- and Android both offer preview controls, but they are per-device and buried
-- in OS settings: an owner who has decided customer content must not render on
-- lock screens could only ask fifteen people to change a phone setting.
--
-- ---------------------------------------------------------------------------
-- WHY IT IS NOT PER-MEMBER, UNLIKE EVERY OTHER NOTIFICATION SETTING.
--
-- `notification_prefs` is per-member because the exposure is the member's own
-- attention. Here the exposure is the CUSTOMER'S, so the decision belongs to
-- the business that holds the customer relationship — not to each tech, who
-- cannot answer for a homeowner's data on behalf of the company. This is
-- deliberately the opposite shape.
--
-- ---------------------------------------------------------------------------
-- WHY IT IS WORTH HAVING WHEN THE OS ALREADY HIDES PREVIEWS.
--
-- The OS decides whether a payload we sent is DISPLAYED. This decides whether
-- the payload CONTAINS the content at all. If we send name-only, no phone
-- setting on any device can reveal what was never transmitted — and that is
-- the only version of this control a business can actually rely on.

alter table public.companies
  add column if not exists push_include_content boolean not null default true;

comment on column public.companies.push_include_content is
  '#430: when false, no push leaves this workspace carrying words a person '
  'typed — the contact name still rides, because a name on a lock screen is '
  'what any phone shows for any caller and it is most of the triage value. '
  'Default true: SPEC §8 behaviour is unchanged for anyone who never asks.';
