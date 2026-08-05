#!/usr/bin/env node
/**
 * Run every SQL assertion suite, in order.
 *
 * WHY THIS EXISTS. `db:test:all` was 62 suites concatenated with `&&` into one
 * npm script — 8,228 characters, against a Windows command-line limit of about
 * 8,191. Adding the 62nd pushed it over, and the whole chain stopped running
 * locally with "The command line is too long."
 *
 * It kept working in CI, which runs on Linux with a far larger limit, so the
 * failure mode was the worst kind: the gate still passed on the machine nobody
 * watches and became unrunnable on the machine where somebody is actually
 * changing the schema. A list in a file has no such ceiling.
 *
 * ORDER IS PRESERVED AND MATTERS. `schema` first because a broken schema makes
 * every later failure noise, and the rest follow the order they were added, which
 * is roughly the order the features shipped.
 *
 * FAILS ON THE FIRST BROKEN SUITE, like the `&&` chain did. A schema problem
 * usually breaks many suites at once, and 40 screens of consequential failures
 * bury the one that matters.
 *
 * Usage:
 *   node scripts/db-test-all.mjs
 *   node scripts/db-test-all.mjs --from bulk_conversations   # skip ahead
 *   node scripts/db-test-all.mjs --only ai_outcomes,marketing_contacts
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CONTAINER = "supabase_db_Loonext";
const DIR = "supabase/tests";

/**
 * The ordered suite list. `schema` leads; everything else is in the order it was
 * added. A new suite goes at the END — inserting into the middle implies an
 * ordering dependency that does not exist, since every suite sets up its own
 * fixtures and rolls back.
 */
const SUITES = [
  "schema",
  "api_functions",
  "messaging",
  "provisioning",
  "notifications",
  "service_role_grants",
  "done_and_timezone",
  "porting",
  "appv2",
  "for_you_notifications",
  "send_features",
  "voice_wave",
  "global_search",
  "storage_accounting",
  "message_pinning",
  "conversation_pinning",
  "pricing_phase0",
  "pricing_metering",
  "pricing_modules",
  "registration_caps",
  "route_limits",
  "calls_feature",
  "spam_freeze_and_grace_ledger",
  "offboard_member",
  "audit_log",
  "workspace_closure",
  "purge_workspace",
  "delete_account",
  "spam_review",
  "emergency_keyword",
  "lead_response_clock",
  "liveness",
  "email_deliverability",
  "billing_disputes",
  "high_priority_push",
  "webhook_liveness",
  "number_access_surfaces",
  "tenant_scope",
  "consent_ledger",
  "active_sessions",
  "ownership_transfer",
  "mfa",
  "app_version",
  "feature_flags",
  "number_reputation",
  "public_links",
  "identity_retention",
  "personal_data_inventory",
  "call_silence",
  "legal_hold",
  "retention_setting",
  "daily_outbound",
  "template_accountability",
  "retry_interrupted",
  "search_voicemail",
  "member_firsts",
  "activation_stall",
  "bulk_conversations",
  "geocode_fair_share",
  "ai_outcomes",
  "marketing_contacts",
  "number_reissue",
  "response_time",
  "member_number_level",
  "number_scoped_topics",
  "owner_emergency_config",
  "voicemail_intake",
  "retention_cohorts",
  "contact_timeline",
  "attachment_quarantine",
  "conversation_snooze",
  "saved_views",
  "pipeline_stages",
  "pricing_snapshot",
  "tag_governance",
  "template_uses",
  "contact_merge",
  "usage_events_channel",
  "signup_attribution",
  "billing_currency",
  "retention_enforce",
  "storage_fleet",
  "aup_signals",
  "list_conversations_awaiting",
  "scheduled_messages",
  "appointment_reminders",
  "job_ratings",
  "on_call",
  "notification_delivery",
  "contact_fields",
  "contact_custom_fields",
  "contact_phones",
  "contact_custom_values",
  "scoped_exports",
  "usage_window",
  "aup_enforcement",
  "abuse_intake",
  "per_number_identity",
  "per_number_mctb",
  "voicemail_greetings",
  "after_hours_call_routing",
  "ring_strategy",
  "lead_sources",
  "member_orientation",
  "attachment_previews",
  "locale",
  "cancellation_reason_upsert",
  "winback_dismissal",
  "paid_pause",
  "number_allowance",
  "dead_provisioning",
];

const args = process.argv.slice(2);
function flag(name) {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=")[1];
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

/**
 * Every suite on disk must be in the list, or a suite somebody wrote never runs.
 * That is the same class of failure as the chain being too long: a check that
 * exists and is not reached.
 */
function assertNoneMissed() {
  const onDisk = readdirSync(DIR)
    .filter((f) => f.endsWith(".test.sql"))
    .map((f) => f.replace(/\.test\.sql$/, ""));
  const missing = onDisk.filter((s) => !SUITES.includes(s));
  const ghosts = SUITES.filter((s) => !onDisk.includes(s));
  if (missing.length > 0 || ghosts.length > 0) {
    if (missing.length > 0) {
      console.error(
        `\nThese suites exist in ${DIR} and are NOT in the list, so they never ` +
          `run:\n  ${missing.join("\n  ")}\n\nAdd them to the END of SUITES.`,
      );
    }
    if (ghosts.length > 0) {
      console.error(
        `\nThese are in the list and not on disk:\n  ${ghosts.join("\n  ")}\n`,
      );
    }
    process.exit(2);
  }
}

assertNoneMissed();

const only = flag("only")?.split(",").map((s) => s.trim());
const from = flag("from");
let selected = only ?? SUITES;
if (from) {
  const index = selected.indexOf(from);
  if (index < 0) {
    console.error(`--from ${from} is not a known suite.`);
    process.exit(2);
  }
  selected = selected.slice(index);
}

console.log(`Running ${selected.length} SQL suite(s) against ${CONTAINER}\n`);

let ran = 0;
for (const suite of selected) {
  const path = join(DIR, `${suite}.test.sql`);
  if (!existsSync(path)) {
    console.error(`missing: ${path}`);
    process.exit(2);
  }
  try {
    // Same invocation the old chain used: psql reading the file on stdin, with
    // ON_ERROR_STOP so the first failing assertion aborts that suite.
    execFileSync(
      "docker",
      ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres",
       "-v", "ON_ERROR_STOP=1", "-f", "-"],
      { input: readFileSync(path), stdio: ["pipe", "pipe", "inherit"], encoding: "utf8" },
    );
    ran += 1;
    process.stdout.write(`  ok  ${suite}\n`);
  } catch (cause) {
    // psql already printed the failing assertion to stderr. Name the suite so it
    // is obvious which file to open, then stop — a schema break cascades, and
    // burying the first failure under forty more is how it gets missed.
    console.error(`\n  FAILED  ${suite}  (${path})`);
    console.error(String(cause.stdout ?? "").split("\n").slice(-12).join("\n"));
    process.exit(1);
  }
}

console.log(`\nAll ${ran} SQL suite(s) passed.`);
