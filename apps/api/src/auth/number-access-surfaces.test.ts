/**
 * #368 — the Worker half of the number-access roll call.
 *
 * `supabase/tests/number_access_surfaces.test.sql` owns the SQL side: which
 * functions filter on `p_hidden_number_ids`, that each one actually uses it,
 * and that a denied number yields nothing. None of that helps if a ROUTE calls
 * one of those functions and forgets to pass the deny list — the function
 * would filter correctly against `null`, which means "hide nothing".
 *
 * That omission is invisible in every other way. It compiles, because the
 * parameter is defaulted. It passes the route's own tests, because those
 * fixtures rarely have a restricted member. And it fails SILENTLY IN THE
 * PERMISSIVE DIRECTION: a member sees a line they were denied, and nobody
 * files a bug about seeing too much.
 *
 * So this is a roll call, in the shape `destination-clock.test.ts` already
 * uses for quiet hours: the list of filtered read surfaces lives in one place,
 * and any call site that reaches one without the deny list fails CI.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/**
 * The RPCs that take `p_hidden_number_ids`, mirroring the roster in
 * `supabase/tests/number_access_surfaces.test.sql`.
 *
 * Two rosters rather than one because they guard different things — the SQL
 * one catches a function that stops filtering, this one catches a caller that
 * stops asking — and because a TypeScript test cannot read `pg_proc`. NA-1
 * keeps the SQL side honest against the database; this list is kept honest
 * against the SQL side by the assertion below that every name here is
 * reachable in the tree.
 */
const FILTERED_RPCS = [
  "api_for_you",
  "api_list_calls",
  "api_list_conversations",
  "api_notifications",
  "api_notifications_unread_count",
  "api_search_v2",
  "api_spam_review",
] as const;

function productionSources(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;
      found.push(full);
    }
  };
  walk(SRC);
  return found;
}

const repoPath = (file: string) => relative(SRC, file).replaceAll("\\", "/");

/**
 * The `db.rpc("name", { ... })` call, with its argument object, for one RPC.
 * Deliberately a source scan rather than a runtime spy: the failure being
 * guarded is a call site that was never exercised by a test with a restricted
 * member, so anything requiring the call to RUN would miss exactly the case
 * that matters.
 */
function rpcCalls(source: string, rpc: string): string[] {
  const calls: string[] = [];
  const opener = new RegExp(`\\.rpc\\(\\s*["'\`]${rpc}["'\`]`, "g");
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source)) !== null) {
    // Take from the call opener to the matching close of its argument object.
    const from = match.index;
    const braceStart = source.indexOf("{", from);
    if (braceStart === -1) continue;
    let depth = 0;
    let end = braceStart;
    for (; end < source.length; end += 1) {
      if (source[end] === "{") depth += 1;
      else if (source[end] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push(source.slice(from, end + 1));
  }
  return calls;
}

describe("#368 — every filtered read surface is called with the deny list", () => {
  it("passes p_hidden_number_ids at every call site of every filtered RPC", () => {
    const offenders: string[] = [];
    for (const file of productionSources()) {
      const source = readFileSync(file, "utf8");
      for (const rpc of FILTERED_RPCS) {
        for (const call of rpcCalls(source, rpc)) {
          if (call.includes("p_hidden_number_ids")) continue;
          offenders.push(`${repoPath(file)} calls ${rpc} without the deny list`);
        }
      }
    }
    // A route that omits it filters against null, which means "hide nothing" —
    // a member reads a line they were denied, and over-permissive failures are
    // the ones nobody reports.
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("keeps this roster honest — every rostered RPC is actually called", () => {
    // A name that no longer appears anywhere is either a surface somebody
    // deleted or a typo, and both make this test quietly weaker: it would keep
    // passing while guarding nothing.
    const all = productionSources()
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const unreachable = FILTERED_RPCS.filter(
      (rpc) => !new RegExp(`\\.rpc\\(\\s*["'\`]${rpc}["'\`]`).test(all),
    );
    expect(unreachable, `rostered but never called: ${unreachable.join(", ")}`)
      .toEqual([]);
  });

  it("rosters every file that reads number_access directly", () => {
    // #368 counted SEVEN implementations, all of them SQL. Running this roll
    // call for the first time found FOUR MORE, in TypeScript, where the SQL
    // roster cannot see them at all. The real number is eleven.
    //
    // They are NOT consolidated here, and that is deliberate. The issue's own
    // devil's advocate makes the case: folding working implementations into a
    // shared abstraction risks introducing the very bug it prevents, and this
    // is #347-sized work. What this test buys instead is that the list is
    // known, written down, and cannot grow silently — which is the mechanism
    // that was missing, and the thing that matters most before #348 changes
    // what "hidden" means.
    const ALLOWED: Record<string, string> = {
      // The resolver. Allowed to know the rules; everything else should ask it.
      "auth/number-access.ts": "the resolver itself",
      // Manages the rules rather than consuming them — the CRUD behind
      // Settings → Numbers. A reader, but of its own table.
      "routes/numbers.ts": "the access-rule CRUD (#106 write path)",
      // Computes who may be TOLD about a conversation, which is the same
      // question in a different direction. Named by #349.
      "auth/conversation-audience.ts": "notification audience (#349)",
      // The calls DO's 'text'-level filtering for dial targets and push
      // audience — CALLS-V3 §11, and named by #368 as a non-SQL point.
      "calls/runtime.ts": "dial targets + ring audience (CALLS-V3 §11)",
      // Live-call transfer targets: the same filter, on the transfer picker.
      "routes/live-calls.ts": "transfer targets (#135)",
    };
    const readers = productionSources()
      .filter((file) =>
        /from\(\s*["'`]number_access["'`]\s*\)/.test(readFileSync(file, "utf8")),
      )
      .map(repoPath);

    const unrostered = readers.filter((file) => !(file in ALLOWED));
    expect(
      unrostered,
      `a NEW implementation of "which numbers may this member see":\n${unrostered.join("\n")}\n` +
        "Either ask resolveNumberAccess instead, or roster it here with the " +
        "reason it cannot.",
    ).toEqual([]);

    // Stale entries make this weaker without anyone noticing: a rostered file
    // that stopped reading the table leaves a hole the next one slips through.
    const stale = Object.keys(ALLOWED).filter((file) => !readers.includes(file));
    expect(stale, `rostered but no longer reads number_access: ${stale.join(", ")}`)
      .toEqual([]);
  });
});
