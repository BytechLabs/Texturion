-- SPEC §6 — Extensions & enums.
-- Extensions live in the `extensions` schema (Supabase convention); all objects
-- from them are referenced fully qualified in later migrations so nothing
-- depends on search_path.

create extension if not exists moddatetime with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists citext with schema extensions;

create type member_role         as enum ('owner','admin','member');
create type subscription_status as enum ('incomplete','incomplete_expired','active',
                                         'past_due','unpaid','canceled');
create type plan_id             as enum ('starter','pro');
create type number_status       as enum ('provisioning','active','suspended',
                                         'released','provision_failed');
create type registration_kind   as enum ('brand','campaign');
create type registration_status as enum ('draft','submitted','pending','approved','rejected');
create type conversation_status as enum ('new','open','waiting','closed');
create type message_direction   as enum ('inbound','outbound','note');
create type message_status      as enum ('received','queued','sent','delivered','failed');
create type opt_out_source      as enum ('stop_keyword','manual','import');
create type consent_source_t    as enum ('inbound_sms','attested');
create type usage_event_type    as enum ('sms_outbound','mms_outbound','adjustment');
create type conversation_event_type as enum
  ('status_changed','assigned','tag_added','tag_removed','opted_out',
   'opt_out_revoked','consent_attested','quiet_hours_confirmed',
   'spam_marked','spam_unmarked');
