/**
 * [#404] The shared floor under every support operation.
 *
 * The operational model before this was: connect to production Postgres with
 * the service-role credential and write SQL by hand. That is the single most
 * dangerous class of change we make — unreviewed, untested, run once, against
 * live data, usually on a Saturday because a customer is upset — and it was
 * the only class with no record that it happened.
 *
 * Two properties matter more than any individual script, and the issue's own
 * devil's advocate is right that they apply at seven customers as much as at
 * two hundred, because the risk scales with the number of manual statements
 * rather than with the customer count:
 *
 *   1. DRY RUN BY DEFAULT. Nothing writes without `--apply`. Every script
 *      prints the rows it would touch first, which catches the unqualified
 *      WHERE outright — the failure mode that turns a support request into a
 *      multi-tenant incident.
 *
 *   2. AN AUDIT ROW, ALWAYS. `audit_log` is deliberately hardened against the
 *      application (update/delete/truncate revoked from every role including
 *      service_role, so no route and no stolen key can rewrite history). It
 *      was never hardened against the console, because the console wrote
 *      nothing at all. These scripts write the row the app would have written,
 *      with a null actor and a `platform-ops/<script>` agent, so the console
 *      stops being the one unrecorded surface.
 *
 * Plain fetch against PostgREST, not the Supabase SDK — the same posture as
 * the other root scripts, and it means an ops script runs from anywhere with
 * nothing but node and two environment variables. Credentials come from the
 * environment, never from a flag: a secret in a shell argument is a secret in
 * the shell history.
 */

/** Parsed `--flag value` / `--flag` argv, with the node/script args dropped. */
export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

export function fail(message) {
  console.error(`\n  x ${message}\n`);
  process.exit(1);
}

/**
 * A tiny PostgREST client, or a loud exit.
 *
 * Refuses to guess the target: a script pointed at the wrong project is the
 * worst possible outcome, so both variables must be set explicitly by whoever
 * is running it.
 */
export function opsClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    fail(
      "SUPABASE_URL and SUPABASE_SECRET_KEY must be set.\n" +
        "  Never pass them as flags — a secret in an argument is a secret in " +
        "your shell history.",
    );
  }
  const base = url.replace(/\/+$/, "");
  const headers = {
    apikey: key,
    Authorization: "Bearer " + key,
    "Content-Type": "application/json",
  };

  /** `where` is PostgREST filter syntax: { id: "eq." + uuid }. */
  const target = (table, where, extra = {}) => {
    const params = new URLSearchParams({ ...where, ...extra });
    return `${base}/rest/v1/${table}?${params.toString()}`;
  };

  const send = async (what, url, init = {}) => {
    const response = await fetch(url, {
      ...init,
      headers: { ...headers, ...(init.headers ?? {}) },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${what} failed (HTTP ${response.status}): ${text}`);
    }
    return text ? JSON.parse(text) : [];
  };

  return {
    select: (table, select, where) =>
      send(`${table} lookup`, target(table, where, { select })),

    /**
     * The filter is the ONLY thing standing between a support fix and a
     * multi-tenant incident, so it is required rather than defaulted: a PATCH
     * with no filter updates every row in the table.
     */
    patch: (table, where, patch) => {
      if (!where || Object.keys(where).length === 0) {
        fail("refusing a PATCH with no filter — that would touch every row.");
      }
      return send(`${table} update`, target(table, where), {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(patch),
      });
    },

    insert: (table, row) =>
      send(`${table} insert`, target(table, {}), {
        method: "POST",
        body: JSON.stringify(row),
      }),

    count: async (table, where) => {
      const response = await fetch(target(table, where, { select: "id" }), {
        method: "HEAD",
        headers: { ...headers, Prefer: "count=exact" },
      });
      const range = response.headers.get("content-range") ?? "";
      return Number(range.split("/")[1] ?? 0);
    },
  };
}

/**
 * Say which database this is about to touch, every time.
 *
 * The one mistake nobody recovers from is running a fix against the wrong
 * project, and the only reliable defence is the host being on screen next to
 * the word APPLY before anybody presses return.
 */
export function announceTarget(apply) {
  const host = new URL(process.env.SUPABASE_URL ?? "http://unset").host;
  console.log("");
  console.log(`  target : ${host}`);
  console.log(
    `  mode   : ${apply ? "APPLY — this will write" : "dry run — nothing will be written"}`,
  );
  console.log("");
}

/** Print rows as a readable block rather than a wall of JSON. */
export function showRows(label, rows) {
  console.log(`  ${label} (${rows.length}):`);
  if (rows.length === 0) {
    console.log("    - none -");
    console.log("");
    return;
  }
  for (const row of rows) {
    console.log(
      "    " +
        Object.entries(row)
          .map(([key, value]) => `${key}=${value === null ? "null" : value}`)
          .join("  "),
    );
  }
  console.log("");
}

/**
 * The audit row for a platform action.
 *
 * `actor_user_id` is null, which the schema already reserves for system actors
 * (a cron, a provider webhook). The agent names the SCRIPT, so a reader six
 * months later can tell a support fix from a background job — very different
 * things to find in a history.
 *
 * Never best-effort. If the record cannot be written, the operator is told to
 * write it by hand: an unrecorded support edit is the exact hole this closes,
 * and one that failed silently would be worse than the ad-hoc SQL it replaced.
 */
export async function recordPlatformAudit(db, entry) {
  try {
    await db.insert("audit_log", {
      company_id: entry.companyId,
      actor_user_id: null,
      actor_ip: null,
      actor_agent: `platform-ops/${entry.script}`,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId ?? null,
      before: entry.before ?? {},
      after: entry.after ?? {},
    });
  } catch (cause) {
    fail(
      `the change was made but the audit row FAILED: ${cause.message}\n` +
        "  Write the record by hand before doing anything else — an " +
        "unrecorded support edit is the thing this tooling exists to prevent.",
    );
  }
}

/**
 * Wrap a script: parse args, announce the target, run, and turn any throw into
 * a readable failure rather than a stack trace nobody reads at 11pm.
 */
export async function runScript(name, run) {
  const args = parseArgs();
  const apply = args.apply === true;
  announceTarget(apply);
  try {
    await run({ args, apply, db: opsClient(), script: name });
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : String(cause));
  }
  if (!apply) {
    console.log("  Nothing was written. Re-run with --apply to make it real.\n");
  }
}
