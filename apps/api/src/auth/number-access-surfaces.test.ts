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
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { productionSources as readProductionSources, stripComments } from "../test/source-tree";

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
  // #581: the response-time report names phone numbers. It was the outlier —
  // every sibling read surface filtered this list and this one did not, so a
  // restricted member saw a denied line's E.164 with its lead and unanswered
  // counts on their own dashboard.
  "api_response_time_stats",
  "api_search_v2",
  "api_spam_review",
] as const;

/**
 * #492: delegated to the one shared reader — `withFileTypes` instead of a
 * `statSync` per entry (5× fewer syscalls on this tree), memoised, one
 * definition of "a production source file" instead of ten, and an IO failure
 * that says it is one rather than surfacing as whatever this suite asserts.
 */
function productionSources(): string[] {
  const found = readProductionSources(SRC);
  return found;
}

const repoPath = (file: string) => relative(SRC, file).replaceAll("\\", "/");

/**
 * A file's CODE, with its prose removed.
 *
 * The #480 assertions below look for tokens, and the first run caught the
 * explanatory comment documenting WHY the token is gone — a guard flagging its own
 * footnote. Worse than the false positive is what it teaches: a check that fires on
 * prose gets its roster widened until it guards nothing.
 *
 * #519 CENTRALISED THIS AND THIS FILE KEPT A PRIVATE COPY under another name,
 * carrying the exact defect the shared one was written to fix:
 * `/\/\*[\s\S]*?\*\//` opens a block comment at the FIRST slash-star it meets,
 * wherever it is — including inside a string literal. Hono wildcard routes are
 * string literals full of slash-stars.
 *
 * On today's tree that deleted routes/widget.ts 199-295 — the whole prologue of
 * POST /widget/start, including `resolveWidgetNumber`, which is the code that
 * picks which of the workspace's lines to send from. A #106 precedence read
 * added there would have been blanked before either assertion below ran, and a
 * twelfth hand-rolled copy of the rule would have shipped with this reporting a
 * clean roster.
 *
 * The meta-guard that proves the shared stripper hides nothing (SC-5 in
 * test/strip-comments.test.ts) never covered the private copy — which is the
 * argument for not having one.
 */
const codeOf = stripComments;

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

  it("lets only the rule's CRUD read number_access directly (#480)", () => {
    // #368 counted seven implementations, all SQL. Running this roll call for the
    // first time found FOUR MORE in TypeScript, where the SQL roster cannot see
    // them — eleven in total. It left them alone deliberately and said why: the
    // issue's devil's advocate argued that folding working implementations into a
    // shared abstraction risks introducing the very bug it prevents, and that it
    // was #347-sized work.
    //
    // #480 IS THAT WORK, and it had to happen: the realtime topic policy needs
    // the same rule, and an RLS predicate cannot call TypeScript. Writing a
    // twelfth copy in SQL for the policy was the alternative.
    //
    // What is left is the CRUD. Everything else asks
    // `public.member_number_levels` — including the three paths that used to
    // apply the precedence themselves with their own owner/admin override, each
    // of which decided something a customer would notice: who gets told about a
    // message, whose phone rings, and who a live call may be transferred to.
    const ALLOWED: Record<string, string> = {
      // Manages the rules rather than consuming them — the CRUD behind
      // Settings → Numbers. A reader, but of its own table.
      "routes/numbers.ts": "the access-rule CRUD (#106 write path)",
    };
    const readers = productionSources()
      .filter((file) =>
        /from\(\s*["'`]number_access["'`]\s*\)/.test(
          codeOf(readFileSync(file, "utf8")),
        ),
      )
      .map(repoPath);

    const unrostered = readers.filter((file) => !(file in ALLOWED));
    expect(
      unrostered,
      `a NEW reader of the raw access rules:\n${unrostered.join("\n")}\n` +
        "Ask member_number_levels (every restricted number for one caller) or " +
        "number_member_levels (every member's level on one number) instead. " +
        "Reading the table means deciding the precedence, and #480 made that " +
        "one implementation.",
    ).toEqual([]);

    // Stale entries make this weaker without anyone noticing: a rostered file
    // that stopped reading the table leaves a hole the next one slips through.
    const stale = Object.keys(ALLOWED).filter((file) => !readers.includes(file));
    expect(stale, `rostered but no longer reads number_access: ${stale.join(", ")}`)
      .toEqual([]);
  });

  it("keeps the precedence rule out of TypeScript entirely (#480)", () => {
    // The stronger property, and the one the issue asks for: not just "who reads
    // the table" but "who DECIDES". Applying #106's precedence means looking at
    // `principal_kind` — that column is the rule's fingerprint, and it appears in
    // no production TypeScript once the rule lives in SQL.
    //
    // Without this, a future author can reintroduce the rule without touching
    // `from("number_access")` at all: read the rows through an RPC or a view,
    // sort them by specificity in TypeScript, and the roster above stays green
    // while there are two implementations again.
    const ALLOWED: Record<string, string> = {
      // The CRUD validates and writes the rows, so it names the column. It
      // never ranks them.
      "routes/numbers.ts": "validates the rule shape it writes",
    };
    const deciders = productionSources()
      .filter((file) => /principal_kind/.test(codeOf(readFileSync(file, "utf8"))))
      .map(repoPath);

    const unrostered = deciders.filter((file) => !(file in ALLOWED));
    expect(
      unrostered,
      `principal_kind appears in production TypeScript:\n${unrostered.join("\n")}\n` +
        "Ranking 'user' over 'role' over 'all' is the #106 precedence rule, and " +
        "it has exactly one home: public.member_number_levels in " +
        "supabase/migrations/20260730030000_member_number_level.sql. Two " +
        "implementations of one security decision is what D79 exists to prevent.",
    ).toEqual([]);

    const stale = Object.keys(ALLOWED).filter((file) => !deciders.includes(file));
    expect(stale, `rostered but no longer names principal_kind: ${stale.join(", ")}`)
      .toEqual([]);
  });

  it("finds files at all, so a passing run means something", () => {
    // Both assertions above are filesystem-derived, and a walk that silently
    // returned nothing would make them vacuous.
    const sources = productionSources();
    expect(sources.length).toBeGreaterThan(50);
    expect(sources.map(repoPath)).toContain("auth/number-access.ts");
  });
});
