-- [#340] Every table is classified in the personal-data inventory.
--
-- `contact_messages` was found by listing all the tables and noticing one
-- nobody had thought about. `docs/PERSONAL-DATA-INVENTORY.md` is the result,
-- and this is what stops it quietly becoming untrue.
--
-- THE FAILURE MODE OF AN INVENTORY IS NOT BEING WRONG ON DAY ONE. It is being
-- right on day one and never updated — at which point it answers an access or
-- erasure request confidently and incorrectly, which is worse than having no
-- document at all. A table added without a line in that file fails here.
--
-- Same shape as tenant_scope.test.sql: the roster lives in the test, and a new
-- table is a deliberate decision somebody records rather than an omission
-- nobody notices.
--
-- Run with:
--   docker exec -i supabase_db_Loonext psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/personal_data_inventory.test.sql

\set ON_ERROR_STOP on

do $$
declare
  -- Every table classified in docs/PERSONAL-DATA-INVENTORY.md, §1 through §6.
  --
  -- THIS SCRIPT CANNOT OPEN THAT DOCUMENT, and for a long time nothing did.
  -- The header above says this is "what stops it quietly becoming untrue",
  -- and the mechanism was a convention — "edited in the same commit" — which
  -- is the thing people do not do. `activation_stall_state` sat in this array
  -- and appeared nowhere in the document while this reported all tables
  -- classified.
  --
  -- The document half is checked by apps/api/src/personal-data-inventory-doc
  -- .test.ts, which reads both files and fails on a name here that is missing
  -- there. This array still owns the CATALOG half, which is the part psql can
  -- actually see.
  classified text[] := array[
    -- §1 contact data (the customer's customer)
    'contacts', 'messages', 'conversations', 'conversation_events',
    -- #247: the cached thread catch-up. Classified with `messages` and not as
    -- a derived cache, because every line of it is a quotation from the thread
    -- by construction — s.183 treats "the substance, meaning or purport" of a
    -- communication as the communication, and an erasure that took the bodies
    -- and left this would leave the customer's words under another name.
    'conversation_summaries',
    'attachments', 'message_attachments', 'calls', 'call_member_legs',
    'opt_outs', 'blocked_senders', 'contact_consent_events', 'tasks',
    'number_port_outs',
    -- #291: a customer's addresses, plural. Squarely contact data — it is
    -- where somebody lives, which is the most sensitive thing in the
    -- record after the phone number itself.
    'contact_addresses',
    -- #291: a customer's OTHER numbers. Personal data of the same class
    -- as the primary on `contacts`, and reached by the same erasure and
    -- export because it cascades from the contact.
    'contact_phones',
    -- #291: the DEFINITIONS carry no customer data — they are a
    -- workspace's field names. Classified as business configuration
    -- rather than left out, because "no personal data" is a real
    -- answer that has to be written down. The VALUES live on
    -- contacts.custom_fields and are covered by that row.
    'contact_field_defs',
    'text_enablement_orders',
    -- #233: an unsent message body addressed to a contact. Classified with
    -- `messages` rather than as configuration, because it IS a message — it
    -- has simply not gone yet, and a workspace's export and erasure have to
    -- treat it as one.
    'scheduled_messages',
    -- #313: a customer's opinion of a job, and which member it was attributed
    -- to. Classified with the conversation data rather than as configuration:
    -- it is a statement BY the customer about a visit to their home, and an
    -- export or an erasure has to treat it as theirs.
    'job_ratings',
    -- #237: the workspace's own reminder wording, and how long before a job it
    -- goes. No customer data — but it is company-scoped and must die with the
    -- workspace, because a rule outliving closure would be the template for a
    -- text from a business that no longer exists.
    'appointment_reminder_rules',
    -- §2 user data (our own customers)
    'profiles', 'company_members', 'invites', 'user_sessions',
    'push_subscriptions', 'device_push_tokens', 'member_telephony_credentials',
    'notification_prefs', 'notification_reads', 'notification_read_items',
    'mfa_recovery_codes', 'mfa_recovery_attempts', 'audit_log',
    -- #293: a member's own deferral of a thread, and their own note about it.
    'conversation_snoozes',
    -- #280: a member's own saved list filters, under a name they wrote. The
    -- name is free text on a member's row, so it is classified here rather
    -- than waved through as configuration.
    'saved_views',
    -- #277: which member said the workspace was leaving, and what they wrote.
    -- `detail` is free text somebody typed while annoyed, which is the most
    -- candid thing in the database and can name a person, a competitor or a
    -- price. Classified here rather than as business data because the row is
    -- attributable to the member who wrote it.
    'cancellation_reasons',
    -- #244: which member was holding the phone and when — a record of one
    -- person's working hours, which is employment data rather than a
    -- preference; and which member a page went to and who claimed it. Both
    -- classified here rather than as operational data for that reason.
    'on_call_shifts', 'alert_escalations',
    -- #297: which member was told about which conversation, and when. A
    -- queue of pending notifications, so it names a person and a thread.
    'pending_notifications',
    -- §3 business data
    'companies', 'messaging_registrations', 'port_requests', 'phone_numbers',
    'number_access', 'number_health', 'company_ai_settings', 'templates', 'tags',
    -- #309: a recording of one of OUR users' voices, never a contact's.
    'voicemail_greetings',
    'lead_sources',
    -- #224: the ask for money, and the mirror of the Stripe account it lands
    -- in. Both hold business data with a personal edge — the description is
    -- free text a crew member typed — and neither holds a card or a bank
    -- number, which Stripe keeps.
    'payment_requests', 'stripe_connect_accounts',
    -- #287: the amount and what it is for, in the crew's own words.
    'quotes',
    -- §4 prospect data
    'contact_messages', 'marketing_contacts',
    -- #232/D124: a website visitor's mobile number and IP, plus a code HASH,
    -- kept 30 days for abuse forensics. Prospect data rather than contact
    -- data: at the moment the row is written the person is a stranger on
    -- somebody else's website, and they only become a contact once the code
    -- is answered.
    'widget_verifications',
    'calendar_feed_tokens',
    -- §5 operational data with an identifier attached
    'prepayments', 'referrals',
    'email_events', 'email_suppressions', 'email_ledger', 'public_link_access',
    'public_links', 'webhook_events', 'webhook_rejections', 'inbound_canary_runs',
    -- #243: the outbound half. `webhook_deliveries` is `webhook_events` facing
    -- the other way and carries the same content, so it is classified beside it
    -- rather than anywhere gentler.
    'webhook_deliveries', 'webhook_endpoints',
    -- #243: the credentials themselves. No contact data, and said so in §5
    -- rather than left implied.
    'api_keys',
    'data_exports', 'usage_events', 'usage_alerts', 'egress_events',
    'company_ai_usage', 'call_records', 'provider_costs', 'billing_disputes',
    -- §6 no personal data
    'app_release_policy', 'company_modules', 'conversation_reads',
    'conversation_tags', 'feature_flags', 'feature_flag_overrides',
    'grace_notices', 'high_priority_push_budget', 'high_priority_push_days',
    'inbound_notification_days', 'liveness_heartbeats', 'message_mentions',
    'outbound_call_authorizations', 'outbound_dial_leases',
    -- #537: a workspace id, a user id, a step, and a HASH of the emailed code.
    -- A credential rather than personal data, and dead within ten minutes.
    'ownership_confirmations', 'ownership_transfers',
    'call_silence_state', 'retention_notices',
    -- #475: a template id, a count and a timestamp. Deliberately carries no
    -- contact and no conversation — "which reply did you send this person"
    -- is a per-contact fact and no feature in scope needs it, so the table
    -- stays here rather than becoming a new personal-data surface.
    'template_uses',
    -- #477: probe name, pass/fail, latency, and a short failure CODE. In §6
    -- only because the code is capped and never a message — see the note there.
    'probe_results',
    -- #281: a company id and funnel timestamps. Names WHICH workspace is
    -- struggling, which is commercial rather than personal.
    'activation_stall_state'
  ];
  v_missing text;
  v_stale   text;
begin
  -- A table in the database that nobody has classified. THE case this exists
  -- for, and the one that produced #340.
  select string_agg(t.table_name, ', ' order by t.table_name) into v_missing
    from information_schema.tables t
   where t.table_schema = 'public'
     and t.table_type = 'BASE TABLE'
     and not (t.table_name = any(classified));

  if v_missing is not null then
    raise exception
      'PDI-1 FAILED: table(s) with no line in docs/PERSONAL-DATA-INVENTORY.md: %. '
      'Decide which section they belong to — including "no personal data", which '
      'is a real answer and must be written down rather than left implied. An '
      'unclassified table is how contact_messages sat unnoticed holding names, '
      'emails and IP addresses of non-customers forever.',
      v_missing;
  end if;

  -- And the reverse: a classified table that no longer exists. Harmless to the
  -- database, corrosive to the document — a reader cannot tell a stale line
  -- from a current one, so every line becomes suspect.
  select string_agg(name, ', ' order by name) into v_stale
    from unnest(classified) as name
   where not exists (
     select 1 from information_schema.tables t
      where t.table_schema = 'public'
        and t.table_type = 'BASE TABLE'
        and t.table_name = name
   );

  if v_stale is not null then
    raise exception
      'PDI-2 FAILED: the inventory classifies table(s) that no longer exist: %. '
      'Remove them from the document and from this list — a stale line makes '
      'every other line unverifiable.',
      v_stale;
  end if;

  raise notice 'PDI PASSED: all % public tables are classified',
    array_length(classified, 1);
end $$;
