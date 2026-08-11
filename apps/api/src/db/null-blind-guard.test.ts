/**
 * #528 — the null-blind guard, proven against every spelling of the defect.
 *
 * `scripts/check-sql-null-blind.mjs` exists because a SQL assertion can pass
 * BECAUSE its subject was NULL: `NULL <> '+1'` is NULL, so `if … then raise`
 * takes the false branch and waves through the very defect it was written for
 * (#248 CL-13).
 *
 * ITS FIRST VERSION HAD THE SAME DISEASE IT WAS TREATING. It refused `<>` inside
 * an `if` condition "at paren depth zero" and caught the one line it was
 * extracted from; five equivalent spellings walked past. The worst was
 * bracketing the condition — `if (a <> b) then` — because the depth was counted
 * from the start of the LINE, so the `if (` put the operator at depth 1 where
 * the rule said to allow it.
 *
 * A guard with no test is a guard nobody can tell has stopped working, which is
 * exactly the failure it was written to prevent. So this file is the vectors,
 * both directions, and the ALLOWED half is the more valuable one: four of those
 * eight were real false positives found by running the guard over the suites, and
 * a guard that cries wolf on legitimate SQL is one somebody switches off.
 */
import { describe, expect, it } from "vitest";

// The REAL guard, not a copy of its rules. It guards its own entry point, so
// importing it runs no scan — see the `process.argv[1]` check at its foot.
// @ts-expect-error — a plain .mjs with no types, which is what CI executes.
import { nullBlindOffences } from "../../../../scripts/check-sql-null-blind.mjs";

/** Ask the guard about one snippet. */
function offences(sql: string): { line: number; operator: string }[] {
  return nullBlindOffences(sql) as { line: number; operator: string }[];
}

/** An assertion block, which is what a suite is made of. */
const assertion = (body: string) => `do $$\nbegin\n${body}\nend $$;`;

describe("#528: every spelling of a NULL-blind assertion is refused", () => {
  it.each([
    [
      "the shape it was written for",
      assertion("  if r.phone <> '+1' then raise exception 'x'; end if;"),
    ],
    [
      "THE SAME LINE, IN BRACKETS — the depth bug that made the guard vacuous",
      assertion("  if (r.phone <> '+1') then raise exception 'x'; end if;"),
    ],
    [
      "!= , which is the same operator with the same NULL semantics",
      assertion("  if r.phone != '+1' then raise exception 'x'; end if;"),
    ],
    [
      "not (a = b), where NULL propagates through the NOT",
      assertion("  if not (r.phone = '+1') then raise exception 'x'; end if;"),
    ],
    [
      "a CASE judging a result, which is not an if/elsif",
      assertion("  v := case when r.phone <> '+1' then 1 else 0 end;"),
    ],
    [
      "an `if` that is not the first token on its line",
      assertion("  perform 1; if r.phone <> '+1' then raise exception 'x'; end if;"),
    ],
    [
      "elsif",
      assertion(
        "  if false then null; elsif r.phone <> '+1' then raise exception 'x'; end if;",
      ),
    ],
    [
      "a condition spanning several lines",
      assertion("  if r.phone\n       <> '+1'\n  then raise exception 'x'; end if;"),
    ],
  ])("refuses %s", (_name, sql) => {
    expect(offences(sql).length).toBeGreaterThan(0);
  });
});

describe("#528: and nothing legitimate is refused", () => {
  it.each([
    [
      "is distinct from — the one permitted spelling",
      assertion("  if r.phone is distinct from '+1' then raise exception 'x'; end if;"),
    ],
    [
      "<> CHOOSING ROWS in a subquery, where it decides what is looked at",
      assertion(
        "  if exists (select 1 from t where origin <> 'reminder') then raise exception 'x'; end if;",
      ),
    ],
    [
      "<> discussed in a comment, which two suites do about this very bug",
      assertion(
        "  -- `NULL <> '+1'` is NULL, which is the whole bug\n  if r.phone is distinct from '+1' then raise exception 'x'; end if;",
      ),
    ],
    [
      "<> inside a string literal",
      assertion(
        "  if r.note is distinct from 'use <> carefully' then raise exception 'x'; end if;",
      ),
    ],
    [
      "not exists",
      assertion(
        "  if not exists (select 1 from t where id = 1) then raise exception 'x'; end if;",
      ),
    ],
    ["not found", assertion("  if not found then raise exception 'x'; end if;")],
    [
      "a membership test, which is NULL-blind but needs coalesce, not this rule",
      assertion("  if not ('x' = any(mimes)) then raise exception 'x'; end if;"),
    ],
    [
      "PRODUCT CODE defined in a suite, where three-valued logic is often meant",
      "create or replace function f() returns text language sql as $$\n  select case when s <> 'active' then 'no' end\n$$;",
    ],
  ])("allows %s", (_name, sql) => {
    expect(offences(sql)).toEqual([]);
  });
});

describe("#528: the guard reports somewhere a person can look", () => {
  it("names the line the operator is on, not the line the condition started", () => {
    // The condition opens on line 3 and the operator is on line 4. A guard that
    // reports the `if` sends somebody to the wrong place in a 900-line suite.
    const sql = assertion("  if r.phone\n       <> '+1'\n  then raise exception 'x'; end if;");
    expect(offences(sql)[0].line).toBe(4);
  });

  it("says WHICH spelling it found, because the fix differs per shape", () => {
    expect(offences(assertion("  if a != b then raise exception 'x'; end if;"))[0]
      .operator).toBe("!=");
    expect(
      offences(assertion("  if not (a = b) then raise exception 'x'; end if;"))[0]
        .operator,
    ).toBe("not (… = …)");
  });
});

/**
 * A block that DECLARES its flag, which the rule below requires.
 *
 * `assertion` above has no `declare`, and the bare-boolean rule only fires on an
 * identifier declared `boolean` in the same file — a bare `if some_call()` is a
 * different question this cannot answer from source.
 */
const declared = (body: string) =>
  `do $$
declare
  v_ok boolean;
begin
${body}
end $$;`;

describe("#610: a bare boolean is judged by plpgsql truthiness, which loses NULL", () => {
  it.each([
    [
      "the refusal direction",
      declared("  if v_ok then raise exception 'x'; end if;"),
      "is distinct from false",
    ],
    [
      "the admission direction",
      declared("  if not v_ok then raise exception 'x'; end if;"),
      "is distinct from true",
    ],
  ])("refuses %s and names the spelling that fixes it", (_name, sql, wanted) => {
    const found = offences(sql);
    expect(found).toHaveLength(1);
    expect(found[0].operator).toContain(wanted);
  });

  it.each([
    [
      "an explicit comparison, which is the fix",
      declared("  if v_ok is distinct from true then raise exception 'x'; end if;"),
    ],
    [
      // The two directions need OPPOSITE rewrites, so flagging control flow
      // would invite somebody to invert a branch while "fixing" it.
      "a branch whose body does not raise, because that is control flow",
      declared("  if v_ok then insert into t values (1); end if;"),
    ],
    [
      "an identifier that is not a declared boolean",
      assertion("  if some_call() then raise exception 'x'; end if;"),
    ],
    [
      // The whole point of the strip: two suites explain this defect in prose.
      "the shape described in a comment",
      declared(`  -- if v_ok then raise ... would be wrong
  null;`),
    ],
  ])("allows %s", (_name, sql) => {
    expect(offences(sql)).toEqual([]);
  });
});
