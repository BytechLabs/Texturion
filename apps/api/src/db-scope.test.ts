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
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { productionSources as readProductionSources } from "./test/source-tree";

const SRC = fileURLToPath(new URL(".", import.meta.url));

/**
 * Every table carrying a `company_id`, mirrored from the live schema.
 *
 * TWO LISTS, AND THE LINK BETWEEN THEM IS BELOW, NOT IN THIS SENTENCE. This
 * docblock used to claim `supabase/tests/tenant_scope.test.sql` kept the list
 * honest. It cannot: that suite compares the DATABASE against its own copy of
 * the roster, and a psql script has no way to read a TypeScript constant. So
 * the SQL suite proves the database and the SQL copy agree, and nothing at all
 * proved the SQL copy and THIS one did.
 *
 * They had already drifted. `template_uses` was in the SQL roster and not here,
 * which meant every query against it was silently exempt from this whole scan —
 * exactly the failure mode the paragraph above claimed was impossible. (#519:
 * "the guard asserts that something is MENTIONED rather than that it WORKS".)
 *
 * `matches the SQL roster it is supposed to mirror` below is the actual link: a
 * TS test CAN read a .sql file, which is the direction that was available all
 * along.
 */
const TENANT_TABLES = new Set([
  "attachments", "audit_log", "billing_disputes", "blocked_senders",
  "call_member_legs",
  "call_records", "calls", "company_ai_settings", "company_ai_usage",
  "company_members", "company_modules", "contact_consent_events",
  "contacts", "conversation_events", "conversation_snoozes",
  "conversations", "data_exports", "egress_events", "email_ledger",
  "grace_notices", "high_priority_push_budget", "high_priority_push_days",
  "inbound_notification_days", "invites", "member_telephony_credentials",
  "message_attachments", "message_mentions", "messages",
  "messaging_registrations", "notification_prefs", "notification_read_items",
  "notification_reads", "number_access", "number_port_outs", "opt_outs",
  "outbound_call_authorizations", "outbound_dial_leases",
  "activation_stall_state", "prepayments", "referrals", "saved_views",
  "scheduled_messages",
  "call_silence_state", "feature_flag_overrides", "number_health",
  "retention_notices",
  "ownership_transfers", "phone_numbers",
  "public_links",
  "port_requests", "provider_costs", "tags", "task_map_rows", "tasks",
  "template_uses",
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
    count: 2,
    why:
      "#387 outbound-SMS probe: asks whether ANY workspace got a text to the " +
      "carrier in the window. Per-tenant it would be noise — one plumber " +
      "having a quiet afternoon is not an outage; every inbox silent is. " +
      "#510 adds the second: the same question over a WEEK, because 'every " +
      "inbox silent' is also what a platform with three customers looks like " +
      "on a Sunday, and an alert that cannot tell that from an outage fires " +
      "forever and teaches its reader to delete it",
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
    count: 3,
    why:
      "provisioning reconcile: finds numbers wedged mid-order, all tenants. " +
      "The third was hidden until the predicate required a real filter — it " +
      "sweeps `.neq(\"status\", \"released\")` platform-wide and merely SELECTS " +
      "company_id, which is the reconcile's output, not its scope",
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
    count: 2,
    why:
      "#378, both halves of the same platform-wide queue. `pruneExpiredExports` " +
      "deletes exports past their seven-day promise; `buildDataExports` drains " +
      "the pending queue. Each row is a full copy of a workspace, so neither " +
      "may be scoped — a scoped reaper would leave every OTHER tenant's export " +
      "sitting in storage past the promise we made about it",
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

  // ---- The twelve below were invisible until the predicate above began
  // requiring a real filter. Every one of them passed on `.select("…,
  // company_id,…")` — the column being READ, which is the opposite of a filter:
  // it means the query is asking which company a row belongs to, across all of
  // them. Each was checked against its caller rather than judged by its shape.

  // ---- More platform-wide sweeps, same family as the block at the top.
  "billing/grace.ts::phone_numbers": {
    count: 1,
    why:
      "`companiesWithUnreleasedResources`: which CANCELED workspaces still " +
      "hold a number we are being billed for. The question is only meaningful " +
      "across all of them",
  },
  "billing/grace.ts::messaging_registrations": {
    count: 1,
    why: "the same sweep, for live 10DLC campaigns still costing us money",
  },
  "billing/overage-warning.ts::usage_alerts": {
    count: 1,
    why:
      "`runOverageDigestJob`: which workspaces crossed a cost projection in " +
      "the window, for one digest to us. Per-tenant it would not be a digest",
  },
  "tasks/due-notice.ts::tasks": {
    count: 1,
    why:
      "the due-task notifier, batched across all tenants. It selects " +
      "company_id precisely so it can fan the notices back out per workspace",
  },
  "telnyx/registration-stalls.ts::messaging_registrations": {
    count: 1,
    why: "stall detector: registrations stuck at the carrier, every tenant",
  },

  // ---- "Which company owns this number?" — the scope is the ANSWER, so the
  // query cannot carry one. In all four the number arrives in a TELNYX WEBHOOK
  // PAYLOAD (the leg a call came in on, the `to` of an inbound message, the
  // numbers named in a port-out notice), never from a request we serve.
  //
  // DELIBERATELY NOT A RULE, though it looks like one. A rule would exempt
  // every future `.eq("number_e164", …)`, and a phone number is ENUMERABLE in a
  // way the ids behind `pk-keyed` and `opaque-provider-key` are not: a route
  // that looked one up from user input would let anybody ask which workspace
  // owns any number in North America, and would inherit the exemption silently.
  // The judgement that matters here is where the number came from, which is a
  // per-site fact — so each site says it.
  "messaging/inbound.ts::phone_numbers": {
    count: 1,
    why: "inbound SMS: resolves the receiving number (webhook `to`) → company",
  },
  "messaging/voice-webhook.ts::phone_numbers": {
    count: 1,
    why: "inbound call: resolves the dialed number (webhook `to`) → company",
  },
  "calls/runtime.ts::phone_numbers": {
    count: 1,
    why: "`loadInitiatedContext`: same lookup on `payload.to` from the call event",
  },
  "telnyx/portout.ts::phone_numbers": {
    count: 1,
    why:
      "a port-out notice names numbers leaving us; this finds whose they were " +
      "so the right workspace is told its number is being taken",
  },

  // ---- "Which workspaces is this user in?" — again the set of tenants is the
  // answer. Not a rule, for the same reason: `.eq("user_id", …)` on a user id
  // taken from a request would tell you every workspace a person belongs to.
  "routes/me.ts::company_members": {
    count: 1,
    why: "the caller's own memberships, keyed on the verified `userId` from the JWT",
  },
  "routes/account.ts::company_members": {
    count: 1,
    why:
      "`listMemberships` under DELETE /account — the same verified caller, " +
      "used to work out what closing the account has to unwind",
  },
  "routes/workspace-closure.ts::company_members": {
    count: 1,
    why:
      "deliberately cross-tenant, and the feature breaks if it is not. For a " +
      "member of the workspace being closed it asks whether any OTHER live " +
      "workspace remains, because push rows are per person: scoping this would " +
      "silence a plumber's other crew's customer messages on the same phone",
  },
};

/**
 * #492: delegated to the one shared reader — `withFileTypes` instead of a
 * `statSync` per entry (5× fewer syscalls on this tree), memoised, one
 * definition of "a production source file" instead of ten, and an IO failure
 * that says it is one rather than surfacing as whatever this suite asserts.
 */
const sources = readProductionSources;

/**
 * Comments blanked out, LENGTH-PRESERVINGLY, before anything else reads the
 * file. Two separate things depend on this running FIRST.
 *
 * A comment must not COUNT as scoping — a sentence mentioning `company_id`
 * satisfies a substring check as well as a filter does. That is the difference
 * between "this query is scoped" and "somebody wrote the words near it".
 *
 * And a comment must not TRUNCATE a statement, which is the half that was
 * still wrong. The window below ends at a delimiter and prose is full of them:
 * `// the company row rides along on this lookup, so it costs no round trip`
 * ends the statement at that comma. Stripping afterwards — as this did — means
 * the window was cut by a docstring before anyone looked for a scope. That
 * produces false ALARMS rather than holes, which is why it had never been
 * noticed, and it made the sibling fix below appear to find a hole in
 * `messaging/inbound.ts` that did not exist.
 *
 * Blanking rather than deleting keeps every offset and line number exact, so
 * a failure still points at the line it means.
 */
const blankOut = (comment: string): string => comment.replace(/[^\n]/g, " ");

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blankOut)
    .replace(/\/\/[^\n]*/g, blankOut);
}

/**
 * The statement a `.from(` starts.
 *
 * Ends at the `;` that closes it — and ALSO at the two delimiters that mean
 * this chain is over without one, because a `;` is not the only way a query
 * ends:
 *
 *   await Promise.all([
 *     db.from("messages").select("id").eq("company_id", a),
 *     db.from("tasks").select("id"),          <- no scope, and no `;` after it
 *   ]);
 *
 * Scanning to the first depth-0 `;` gives the SECOND entry a window running to
 * the end of the whole `Promise.all`, which contains the FIRST entry's
 * `.eq("company_id", …)`. One sibling's scope would exempt every other query in
 * the array. So the window also ends on a depth-0 comma (the next element) and
 * on a bracket closing something opened before the statement began (leaving the
 * array or argument list entirely).
 *
 * Measured: this changes no verdict on today's code — the hole is real and
 * nothing currently sits in it. Worth closing anyway, because the shape it
 * admits (a batch of queries in one `Promise.all`) is ordinary, and the cost of
 * being wrong is a cross-tenant read that CI called scoped.
 */
function statementAt(src: string, index: number): string {
  let depth = 0;
  for (let i = index; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth -= 1;
      if (depth < 0) return src.slice(index, i);
    } else if ((ch === ";" || ch === ",") && depth <= 0) {
      return src.slice(index, i);
    }
  }
  return src.slice(index, index + 800);
}

/**
 * Does this statement FILTER on the tenant column, or merely contain its name?
 *
 * The predicate used to be `statement.includes("company_id")`, and the gap
 * between those two questions was the largest hole in this guard: thirteen
 * sites passed on the strength of `.select("id,company_id,status")`. A selected
 * COLUMN is the opposite of a filter — it means the query is asking which
 * company a row belongs to, across all of them.
 *
 * `.eq` and `.in` are the only two forms in the codebase; verified rather than
 * assumed, and deliberately not widened to the ten other PostgREST operators
 * that could theoretically appear. Two of those would be actively wrong:
 * `.neq("company_id", x)` is every OTHER tenant, and `.is("company_id", null)`
 * is the unscoped rows themselves. A guard that accepted them would bless the
 * two worst queries in the product. If a third legitimate form ever appears,
 * the guard fails loudly and somebody adds it on purpose.
 */
const SCOPING_CALL = /\.(eq|in)\(\s*["'`]company_id["'`]/;

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
    // Stripped on the way in, so the window below is measured over code only.
    const src = stripComments(readFileSync(file, "utf8"));
    const re = /\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(src)) !== null) {
      const table = match[1];
      if (!TENANT_TABLES.has(table)) continue;
      const statement = statementAt(src, match.index).replace(/\s+/g, " ");
      if (SCOPING_CALL.test(statement)) continue;
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

  /**
   * The guard's own machinery, tested directly.
   *
   * #519's finding about this file was that it asserted a name was MENTIONED
   * rather than that a filter was APPLIED — and the reason that survived so
   * long is that the three helpers doing the deciding were only ever exercised
   * through a whole-tree scan that passes. A scan cannot tell you it looked at
   * the wrong window; it can only tell you it found nothing.
   */
  describe("the helpers that decide, on fixtures that would otherwise be silent", () => {
    it("does not let one query in a batch scope its siblings", () => {
      // The failure the window fix exists for. Read to the first depth-0 `;`
      // and the second entry's window contains the first entry's scope.
      const batch = `await Promise.all([
        db.from("messages").select("id").eq("company_id", a),
        db.from("tasks").select("id"),
      ]);`;
      const second = statementAt(batch, batch.indexOf('.from("tasks")'));
      expect(second).not.toContain("company_id");
      expect(SCOPING_CALL.test(second)).toBe(false);

      // ...while the genuinely scoped sibling still reads as scoped.
      const first = statementAt(batch, batch.indexOf('.from("messages")'));
      expect(SCOPING_CALL.test(first)).toBe(true);
    });

    it("does not let a comma in a comment cut a statement short", () => {
      // Prose is full of delimiters. Stripping after windowing meant a comment
      // ended the statement before anyone looked for the scope below it.
      const source = `db.from("messages")
        // the company row rides along here, so it costs no extra round trip
        .eq("company_id", id);`;
      expect(SCOPING_CALL.test(statementAt(stripComments(source), 0))).toBe(true);
    });

    it("keeps every offset exact, so a failure names the right line", () => {
      const source = 'a\n// comment, with a comma\nb\n/* block\nspans */\nc';
      const stripped = stripComments(source);
      expect(stripped).toHaveLength(source.length);
      expect(stripped.split("\n")).toHaveLength(source.split("\n").length);
      expect(stripped).not.toContain("comment");
    });

    it("reads a SELECTED company_id as what it is — not a filter", () => {
      // The thirteen sites this uncovered all looked like this one.
      expect(
        SCOPING_CALL.test('.from("tasks").select("id,company_id,title")'),
      ).toBe(false);
    });

    it("refuses the two operators that would bless the worst queries", () => {
      // `.neq` is every OTHER tenant; `.is(…, null)` is the unscoped rows.
      // A predicate widened to "any operator naming the column" accepts both.
      expect(SCOPING_CALL.test('.neq("company_id", id)')).toBe(false);
      expect(SCOPING_CALL.test('.is("company_id", null)')).toBe(false);
      expect(SCOPING_CALL.test('.eq("company_id", id)')).toBe(true);
      expect(SCOPING_CALL.test('.in("company_id", ids)')).toBe(true);
    });
  });

  it("still finds the query sites it is here to protect", () => {
    // The scan is regex over source, so it fails OPEN: if `.from(` usage were
    // refactored into a helper this whole test would pass by finding nothing,
    // and would keep passing forever. A floor makes that visible.
    //
    // #519: the floor used to be `> 300` over EVERY `.from(` in the tree — 595
    // sites, of which only 443 are on tenant tables. A guard protecting 443
    // things could be satisfied by the 152 it does not protect plus a third of
    // the ones it does. So the floor now counts the population it actually
    // guards, and sits close enough underneath it to notice a real collapse
    // rather than to tolerate one.
    const tenantSites = sources(SRC)
      .flatMap((file) => [
        ...stripComments(readFileSync(file, "utf8")).matchAll(
          /\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/g,
        ),
      ])
      .filter((match) => TENANT_TABLES.has(match[1]));
    expect(tenantSites.length).toBeGreaterThan(400);
  });

  it("matches the SQL roster it is supposed to mirror", () => {
    // THE LINK THE DOCBLOCK USED TO ONLY CLAIM. `tenant_scope.test.sql` proves
    // its own copy of the roster matches the live database; this proves ours
    // matches that copy. Without both halves, a table can carry `company_id`,
    // be known to the SQL suite, and still be invisible here — which is what
    // `template_uses` was.
    //
    // Parsed rather than shared, because there is no format both a psql script
    // and a TS module can import. That makes the parse the weak point, so it
    // asserts it found a plausible roster before comparing: a rename or a
    // reformat that broke the scrape would otherwise compare two empty sets and
    // pass.
    const sql = readFileSync(
      fileURLToPath(new URL("../../../supabase/tests/tenant_scope.test.sql", import.meta.url)),
      "utf8",
    );
    const block = /known text\[\] := array\[([\s\S]*?)\];/.exec(sql)?.[1];
    expect(block, "could not find the `known` roster in tenant_scope.test.sql")
      .toBeTruthy();
    const sqlTables = new Set(
      [...(block ?? "").matchAll(/'([a-z_]+)'/g)].map((match) => match[1]),
    );
    expect(sqlTables.size).toBeGreaterThan(50);

    const missingHere = [...sqlTables].filter((t) => !TENANT_TABLES.has(t));
    const missingThere = [...TENANT_TABLES].filter((t) => !sqlTables.has(t));
    expect(
      { missingHere, missingThere },
      `\n\nThe two tenant-table rosters disagree.\n` +
        `  in the SQL roster, missing from TENANT_TABLES: ${missingHere.join(", ") || "none"}\n` +
        `    → every query against those is silently EXEMPT from this scan.\n` +
        `  in TENANT_TABLES, missing from the SQL roster: ${missingThere.join(", ") || "none"}\n` +
        `    → the SQL suite cannot tell you when one of those loses company_id.\n`,
    ).toEqual({ missingHere: [], missingThere: [] });
  });
});
