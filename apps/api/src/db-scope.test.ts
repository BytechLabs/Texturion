/**
 * #347 — tenant isolation is a convention across hundreds of query sites, and
 * RLS cannot catch a mistake in one of them.
 *
 * SPEC §6 calls RLS "defense-in-depth" behind §10's tenant isolation. Read
 * together they describe ONE layer, not two: the Worker holds the `sb_secret_`
 * key, which is BYPASSRLS, so a deny-by-default policy is doing real work
 * against a threat model the architecture says never happens (a browser
 * reaching PostgREST) and NO work against the one that does — a query in our
 * own code missing its scope.
 *
 * So "Company A never sees Company B's conversations" rests entirely on every
 * query getting it right. This is the mechanism that makes the 480th one fail
 * loudly instead of quietly, which #347 asks for in exactly these terms:
 * "omission is a compile or lint failure rather than a review miss".
 *
 * WHY A SCAN AND NOT A WRAPPER. #347's first scope bullet asks for a builder a
 * query cannot escape. That is the stronger shape and it is deliberately not
 * what shipped: rewriting ~375 working call sites to prove a property they
 * already have is the single most likely way to introduce the cross-tenant bug
 * this exists to prevent, and it would collide with every other open change in
 * `routes/`. A scan buys the same CI guarantee for new code at none of that
 * risk. If the wrapper is ever built, this test is what proves the rewrite did
 * not drop a scope on the way.
 *
 * WHAT IT DOES NOT PROVE. That a scoped query used the RIGHT company id — only
 * that it HAS one. A handler that scopes to a company the caller is not a
 * member of would pass this and still be a breach; `companyContext()` is what
 * stops that, and #347's remaining ask is a cross-boundary assertion per read
 * route (today there are four, all in routes/messages.test.ts).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL(".", import.meta.url));

/**
 * Every table carrying a `company_id`, mirrored from the live schema.
 *
 * Kept honest in the other direction by `supabase/tests/tenant_scope.test.sql`,
 * which fails if the database grows a tenant table this list does not know —
 * otherwise a new table would be silently exempt from the whole check, which
 * is the failure mode a hardcoded list normally has.
 */
const TENANT_TABLES = new Set([
  "attachments", "audit_log", "billing_disputes", "call_member_legs",
  "call_records", "calls", "company_ai_settings", "company_ai_usage",
  "company_members", "company_modules", "contact_consent_events",
  "contacts", "conversation_events",
  "conversations", "data_exports", "egress_events", "email_ledger",
  "grace_notices", "high_priority_push_budget", "high_priority_push_days",
  "inbound_notification_days", "invites", "member_telephony_credentials",
  "message_attachments", "message_mentions", "messages",
  "messaging_registrations", "notification_prefs", "notification_read_items",
  "notification_reads", "number_access", "number_port_outs", "opt_outs",
  "outbound_call_authorizations", "outbound_dial_leases",
  "feature_flag_overrides", "number_health", "ownership_transfers", "phone_numbers",
  "public_links",
  "port_requests", "provider_costs", "tags", "task_map_rows", "tasks",
  "templates", "text_enablement_orders", "usage_alerts", "usage_events",
]);

/**
 * Exemptions that are a RULE rather than a place, both named by #347 as
 * legitimate. Being rules, they need no maintenance and cannot go stale.
 */
const RULES: { name: string; why: string; test: RegExp }[] = [
  {
    name: "pk-keyed",
    why:
      "keyed on the row's own primary key, which is globally unique — the id " +
      "itself identifies the row, and the caller is responsible for having " +
      "obtained it from a scoped read. This is the weakest of the rules and " +
      "worth saying so: it trusts the provenance of an id rather than " +
      "checking it.",
    test: /\.(eq|in)\(\s*["'`]id["'`]/,
  },
  {
    name: "opaque-provider-key",
    why:
      "keyed on a provider-generated identifier that is globally unique and " +
      "unguessable (a Telnyx call/message id, a Stripe event id). No tenant " +
      "can name another tenant's, so the key IS the scope.",
    test:
      /\.(eq|in)\(\s*["'`](call_session_id|call_leg_id|call_control_id|telnyx_message_id|event_id|provisioning_key|customer_call_control_id)["'`]/,
  },
  {
    name: "insert-under-a-not-null-scope",
    why:
      "an INSERT/UPSERT, where the DATABASE enforces the scope: `company_id` " +
      "is NOT NULL on 41 of the 44 tenant tables, so a row without one is " +
      "rejected by Postgres rather than silently written. That is a stronger " +
      "guarantee than this scan could give, and it is why the scan's real " +
      "job is reads and mutations — a SELECT/UPDATE/DELETE missing its scope " +
      "silently WIDENS the row set, which nothing rejects. " +
      "`supabase/tests/tenant_scope.test.sql` is what keeps that NOT NULL " +
      "claim true; the three nullable exceptions are excluded below.",
    // The scope lives in the row payload, which is usually built above the
    // call and outside the statement window — so matching on it here would be
    // unreliable in both directions. The constraint is the real check.
    test: /\.(insert|upsert)\(/,
  },
];

/**
 * Tenant tables whose `company_id` is NULLABLE, so the insert rule above does
 * NOT apply to them — Postgres would accept a row with no scope at all.
 * Derived from the live schema and asserted by the SQL suite.
 */
const NULLABLE_SCOPE = new Set([
  "billing_disputes",
  "number_port_outs",
  "task_map_rows",
]);

/**
 * Sites that are neither scoped nor covered by a rule, enumerated with the
 * reason each is safe. #347's second scope bullet: "an explicit, named
 * allow-list rather than indistinguishable from an accident".
 *
 * KEYED BY FILE + TABLE + COUNT, deliberately. Line numbers would break on
 * every unrelated edit and get "fixed" by bumping them, which trains people to
 * update this file without reading it. The count is what keeps it honest: a
 * NEW unscoped query against an already-exempt table in an already-exempt file
 * still fails CI, because the number changes.
 */
const ALLOWED: Record<string, { count: number; why: string }> = {
  // ---- Platform-wide cron sweeps. These process work across ALL tenants by
  // definition; a company scope would defeat the job rather than secure it.
  "attachments/sweep.ts::attachments": {
    count: 1,
    why: "D19 reclaim sweep: selects soft-deleted objects platform-wide",
  },
  "attachments/sweep.ts::egress_events": {
    count: 1,
    why: "egress ledger retention prune, platform-wide by age",
  },
  "billing/reconcile.ts::invites": {
    count: 1,
    why: "expired-invite count across the platform (a health number, not a read)",
  },
  "geocode/geocode-contacts.ts::contacts": {
    count: 1,
    why: "geocoding backfill: selects un-geocoded addresses platform-wide",
  },
  "geocode/geocode-tasks.ts::tasks": {
    count: 1,
    why: "task geocoding backfill, same shape as contacts",
  },
  "messaging/crons.ts::usage_events": {
    count: 1,
    why: "usage re-reporter: selects unreported rows platform-wide for Stripe",
  },
  "messaging/crons.ts::call_records": {
    count: 2,
    why: "voice usage re-reporter, same shape as usage_events",
  },
  "messaging/crons.ts::outbound_call_authorizations": {
    count: 1,
    why: "expiry prune of short-lived dial authorizations, by age",
  },
  "messaging/crons.ts::calls": {
    count: 2,
    why: "stale-call sweeper: finds calls wedged in-flight across all tenants",
  },
  "messaging/delivery-by-country.ts::messages": {
    count: 1,
    why:
      "#379 delivery-rate split: a PLATFORM statistic by destination country. " +
      "Per-tenant it would be meaningless — the signal is carrier filtering " +
      "of our traffic as a whole",
  },
  "observability/liveness-check.ts::messages": {
    count: 1,
    why:
      "#387 outbound-SMS probe: asks whether ANY workspace got a text to the " +
      "carrier in the window. Per-tenant it would be noise — one plumber " +
      "having a quiet afternoon is not an outage; every inbox silent is",
  },
  "observability/inbound-canary.ts::phone_numbers": {
    count: 1,
    why:
      "#308 canary: checks the destination belongs to the PLATFORM, which is " +
      "the whole point of the check. Scoping it to a company would make the " +
      "guard weaker, not stronger — it exists so a typo'd secret cannot text " +
      "a stranger",
  },
  "telnyx/provisioning.ts::phone_numbers": {
    count: 2,
    why: "provisioning reconcile: finds numbers wedged mid-order, all tenants",
  },
  "telnyx/provisioning.ts::port_requests": {
    count: 1,
    why: "reconcile: is a stuck number actually a port? platform-wide question",
  },
  "telnyx/provisioning.ts::text_enablement_orders": {
    count: 1,
    why: "keyed on phone_number_id, resolved from the row being reconciled",
  },
  "telnyx/porting.ts::port_requests": {
    count: 3,
    why:
      "port reconcile: one lookup by the carrier's own order id (opaque and " +
      "globally unique), two sweeps over in-flight ports across all tenants",
  },
  "telnyx/registration.ts::messaging_registrations": {
    count: 6,
    why:
      "the 10DLC poller and its recovery passes — every sweep is by carrier " +
      "state across all tenants, and one lookup is by the carrier's telnyx_id",
  },
  "telnyx/text-enablement.ts::text_enablement_orders": {
    count: 1,
    why: "hosted-order poller: in-flight orders across all tenants",
  },
  "workspace/export.ts::data_exports": {
    count: 1,
    why:
      "#378 reaper: deletes exports past their seven-day promise, platform-" +
      "wide. Each is a full copy of a workspace, so this must NOT be scoped",
  },
  "routes/team.ts::invites": {
    count: 1,
    why:
      "invites addressed to the CALLING USER's email, deliberately across " +
      "every company — you are shown invitations to workspaces you are not " +
      "yet a member of, which is exactly what an invite is. Scoped by the " +
      "verified email from the JWT, not by company",
  },
  "routes/porting.ts::port_requests": {
    count: 1,
    why:
      "keyed on a phone_number_id that was itself read WITH .eq(company_id) " +
      "immediately above (the idempotency-key replay path). Same shape as " +
      "the pk-keyed rule, on a foreign key",
  },
  "messaging/live-call.ts::conversation_events": {
    count: 1,
    why: "keyed on conversation_id + the call session, both from the live call",
  },
  // ---- Conversation/message-keyed reads whose key was itself resolved from a
  // scoped read in the same handler.
  "messaging/inbound.ts::message_attachments": {
    count: 1,
    why: "keyed on message_id, resolved by the threading RPC for this company",
  },
  "messaging/inbound-ring.ts::conversation_events": {
    count: 1,
    why: "keyed on conversation_id, resolved from the ringing number's company",
  },
};

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** The statement a `.from(` starts, up to the `;` that closes it at depth 0. */
function statementAt(src: string, index: number): string {
  let depth = 0;
  for (let i = index; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth -= 1;
    else if (ch === ";" && depth <= 0) return src.slice(index, i);
  }
  return src.slice(index, index + 800);
}

interface Site {
  key: string;
  file: string;
  table: string;
  line: number;
  statement: string;
}

function unscopedSites(): Site[] {
  const found: Site[] = [];
  for (const file of sources(SRC)) {
    const src = readFileSync(file, "utf8");
    const re = /\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(src)) !== null) {
      const table = match[1];
      if (!TENANT_TABLES.has(table)) continue;
      const statement = statementAt(src, match.index).replace(/\s+/g, " ");
      if (statement.includes("company_id")) continue;
      const applicable = NULLABLE_SCOPE.has(table)
        ? RULES.filter((rule) => rule.name !== "insert-under-a-not-null-scope")
        : RULES;
      if (applicable.some((rule) => rule.test.test(statement))) continue;
      const rel = relative(SRC, file).replaceAll("\\", "/");
      found.push({
        key: `${rel}::${table}`,
        file: rel,
        table,
        line: src.slice(0, match.index).split("\n").length,
        statement: statement.slice(0, 160),
      });
    }
  }
  return found;
}

describe("#347 — a query against a tenant table carries its company scope", () => {
  it("has no unscoped, unruled, unlisted query site", () => {
    const counts = new Map<string, Site[]>();
    for (const site of unscopedSites()) {
      const list = counts.get(site.key) ?? [];
      list.push(site);
      counts.set(site.key, list);
    }

    const problems: string[] = [];
    for (const [key, sites] of counts) {
      const allowed = ALLOWED[key];
      if (!allowed) {
        problems.push(
          `NEW unscoped query on a tenant table: ${key}\n` +
            sites.map((s) => `    ${s.file}:${s.line}  ${s.statement}`).join("\n") +
            `\n    → add .eq("company_id", …), or list it in ALLOWED with why it is safe.`,
        );
        continue;
      }
      if (sites.length !== allowed.count) {
        problems.push(
          `${key}: ${sites.length} unscoped site(s), allow-list says ${allowed.count}.\n` +
            sites.map((s) => `    ${s.file}:${s.line}  ${s.statement}`).join("\n") +
            (sites.length > allowed.count
              ? "\n    → a NEW unscoped query joined an already-exempt file. Scope it, or raise the count and say why."
              : "\n    → one was removed or scoped. Lower the count so the slot cannot be reused silently."),
        );
      }
    }
    expect(problems, `\n\n${problems.join("\n\n")}\n`).toEqual([]);
  });

  it("keeps the allow-list free of entries that no longer exist", () => {
    // A stale entry is a hole: it reserves a slot that a genuinely new
    // unscoped query can later occupy without anybody being told.
    const live = new Set(unscopedSites().map((site) => site.key));
    const stale = Object.keys(ALLOWED).filter((key) => !live.has(key));
    expect(stale, `allow-listed but no longer unscoped: ${stale.join(", ")}`)
      .toEqual([]);
  });

  it("still finds the query sites at all", () => {
    // The scan is regex over source, so it fails OPEN: if `.from(` usage were
    // refactored into a helper this whole test would pass by finding nothing,
    // and would keep passing forever. A floor makes that visible.
    const total = sources(SRC)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n")
      .match(/\.from\(\s*["'`][a-z_]+["'`]\s*\)/g);
    expect(total?.length ?? 0).toBeGreaterThan(300);
  });
});
