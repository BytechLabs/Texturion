/**
 * #304 — the work, as a file.
 *
 * TE-2 and TE-4 are the pair that carry this. A task list reads like internal
 * admin, and both tests exist because it is not:
 *
 *   TE-2 — every task hangs off a conversation (D17), so #106 number access
 *   applies exactly as it does to a message thread. A task on a line somebody
 *   cannot see is not in their file, and the count is stated.
 *
 *   TE-4 — `tasks` has NO completion column; done-ness derives from the source
 *   message's `done_at`. Miss that and every task reads as open forever, which
 *   is the single most useless way this could be wrong: "what is outstanding"
 *   is the question people export this to answer.
 */
import { describe, expect, it } from "vitest";

import { buildTaskExport, isDone, TASK_EXPORT_CAP } from "./tasks-export";
import { endpoint, makeHarness } from "../test/billing-support";
import { completeEnv, stubFetch } from "../test/support";
import { getDb } from "../db";

const COMPANY_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const USER_ID = "aaaaaaaa-1111-4222-8333-444444444444";
const MATE_ID = "bbbbbbbb-1111-4222-8333-444444444444";
const OPEN_LINE = "11111111-1111-4111-8111-111111111111";
const HIDDEN_LINE = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-07-02T09:00:00.000Z");

function task(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    title: "Replace the flue",
    description: "Customer says it whistles",
    due_at: "2026-07-10T09:00:00.000Z",
    created_at: "2026-07-01T09:00:00.000Z",
    assigned_user_id: MATE_ID,
    conversation_id: "c1",
    messages: { done_at: null },
    conversations: {
      phone_number_id: OPEN_LINE,
      contact_phone_e164: "+14155559001",
      contacts: { name: "Dana Reed" },
    },
    ...over,
  };
}

function world(options: { tasks?: unknown[]; hidden?: string[]; role?: string } = {}) {
  return makeHarness([
    // Deliberately `member`, not `admin`. Owner and admin short-circuit to
    // UNRESTRICTED before the resolver runs, so an admin fixture would make
    // TE-2 pass against an implementation with no access check at all — which
    // is exactly how it was written first, and it passed.
    endpoint("GET", /\/rest\/v1\/company_members/, () => [
      { role: options.role ?? "member" },
    ]),
    // #480: the rule lives in SQL. The resolver returns rows only for
    // RESTRICTED numbers, and only level 'none' joins the deny list.
    endpoint("POST", /\/rpc\/member_number_levels/, () =>
      (options.hidden ?? []).map((id) => ({ phone_number_id: id, level: "none" })),
    ),
    endpoint("GET", /\/rest\/v1\/profiles/, () => [
      { user_id: MATE_ID, display_name: "Sam Okafor" },
    ]),
    endpoint("GET", /\/rest\/v1\/tasks/, () => options.tasks ?? [task()]),
  ]);
}

async function build(
  options: { tasks?: unknown[]; hidden?: string[]; filters?: Record<string, string> } = {},
) {
  const h = world(options);
  stubFetch(h.route);
  const written = new Map<string, string>();
  const result = await buildTaskExport(
    getDb(completeEnv()),
    {
      companyId: COMPANY_ID,
      requestedBy: USER_ID,
      filters: options.filters ?? {},
      prefix: "c/e1",
      now: NOW,
    },
    async (path, body) => {
      written.set(path, body);
    },
  );
  return { result, written, harness: h };
}

describe("#304 the task export", () => {
  it("TE-1: writes a spreadsheet and a document", async () => {
    const { written } = await build();
    expect([...written.keys()].sort()).toEqual(["c/e1/tasks.csv", "c/e1/tasks.html"]);
  });

  it("TE-2: a task on a line they cannot see is not in the file, and is counted", async () => {
    // THE ONE THAT MATTERS. #106 access, resolved at build time, exactly as
    // the history export does it — a task names a customer and quotes what
    // they asked for.
    const { result, written } = await build({
      hidden: [HIDDEN_LINE],
      tasks: [
        task(),
        task({
          id: "t2",
          title: "Secret job",
          conversations: {
            phone_number_id: HIDDEN_LINE,
            contact_phone_e164: "+14155559002",
            contacts: { name: "Hidden Customer" },
          },
        }),
      ],
    });

    expect(result).toEqual({ tasks: 1, withheld: 1, capped: false });
    const html = written.get("c/e1/tasks.html")!;
    expect(html).not.toContain("Hidden Customer");
    expect(html).not.toContain("Secret job");
    // Stated, not silent: a file quietly missing a job is one somebody puts in
    // front of a customer believing it is whole.
    expect(html).toMatch(/1 task is not included/);
    expect(written.get("c/e1/tasks.csv")).not.toContain("Hidden Customer");
  });

  it("TE-3: someone who has left the workspace gets nothing", async () => {
    const h = makeHarness([
      endpoint("GET", /\/rest\/v1\/company_members/, () => []),
    ]);
    stubFetch(h.route);
    await expect(
      buildTaskExport(
        getDb(completeEnv()),
        { companyId: COMPANY_ID, requestedBy: USER_ID, filters: {}, prefix: "c/e1", now: NOW },
        async () => {},
      ),
    ).rejects.toThrow(/no longer in the workspace/);
  });

  it("TE-4: done comes from the source message, not from the task", async () => {
    // `tasks` has no completion column (D17). A reader who assumed otherwise
    // produces a file in which nothing was ever finished.
    expect(isDone({ messages: { done_at: "2026-07-02T08:00:00Z" } })).toBe(true);
    expect(isDone({ messages: { done_at: null } })).toBe(false);
    expect(isDone({ messages: null })).toBe(false);

    const { written } = await build({
      tasks: [
        task(),
        task({ id: "t2", title: "Fitted the valve", messages: { done_at: "2026-07-02T08:00:00Z" } }),
      ],
    });
    const csv = written.get("c/e1/tasks.csv")!;
    expect(csv).toMatch(/Replace the flue.*Open/);
    expect(csv).toMatch(/Fitted the valve.*Done/);
  });

  it("TE-5: filtering to outstanding work leaves the finished out", async () => {
    // Applied after the join on purpose: done-ness lives on the embedded
    // message, and PostgREST cannot filter a root row on an embedded column —
    // asking it to would quietly return everything.
    const { result, written } = await build({
      filters: { state: "open" },
      tasks: [
        task(),
        task({ id: "t2", title: "Fitted the valve", messages: { done_at: "2026-07-02T08:00:00Z" } }),
      ],
    });
    expect(result.tasks).toBe(1);
    expect(written.get("c/e1/tasks.csv")).not.toContain("Fitted the valve");
    expect(written.get("c/e1/tasks.html")).toContain("Still outstanding");
  });

  it("TE-6: filtering to finished work is the mirror", async () => {
    const { result, written } = await build({
      filters: { state: "done" },
      tasks: [
        task(),
        task({ id: "t2", title: "Fitted the valve", messages: { done_at: "2026-07-02T08:00:00Z" } }),
      ],
    });
    expect(result.tasks).toBe(1);
    expect(written.get("c/e1/tasks.csv")).not.toContain("Replace the flue");
  });

  it("TE-7: deleted work stays deleted", async () => {
    // The query asks for it. A file that resurrected soft-deleted tasks would
    // be the one artifact contradicting what the product shows.
    const { harness: h } = await build();
    const url = h.callsTo("GET", /\/rest\/v1\/tasks/)[0].url.href;
    expect(url).toContain("deleted_at=is.null");
  });

  it("TE-8: the period filters reach the query", async () => {
    const { harness: h } = await build({
      filters: { from: "2026-06-01T00:00:00.000Z", to: "2026-06-30T23:59:59.999Z" },
    });
    const url = h.callsTo("GET", /\/rest\/v1\/tasks/)[0].url.href;
    expect(url).toContain("created_at=gte.2026-06-01");
    expect(url).toContain("created_at=lte.2026-06-30");
  });

  it("TE-9: says who, not a UUID — and says so when nobody is on it", async () => {
    const { written } = await build({
      tasks: [task(), task({ id: "t2", title: "Unclaimed", assigned_user_id: null })],
    });
    const csv = written.get("c/e1/tasks.csv")!;
    expect(csv).toContain("Sam Okafor");
    expect(csv).not.toContain(MATE_ID);
    // "Nobody yet" rather than an empty cell: an unassigned job is the row a
    // reader most needs to notice.
    expect(csv).toContain("Nobody yet");
  });

  it("TE-10: a customer with no name is still identifiable", async () => {
    // The phone number, not "unknown". Whoever reads this has to be able to
    // ring them back.
    const { written } = await build({
      tasks: [
        task({
          conversations: {
            phone_number_id: OPEN_LINE,
            // #291: the number this THREAD is on, which for a customer with
            // several is not necessarily the one on their contact record.
            contact_phone_e164: "+14155559099",
            contacts: { name: "  " },
          },
        }),
      ],
    });
    expect(written.get("c/e1/tasks.csv")).toContain("+14155559099");
  });

  it("TE-11: a task with no due date says so", async () => {
    // Not blank. "No date" is the difference between a list somebody can
    // triage and one where a missing cell reads as an error.
    const { written } = await build({ tasks: [task({ due_at: null })] });
    expect(written.get("c/e1/tasks.csv")).toContain("no date");
  });

  it("TE-12: a run at the cap says it stopped short", async () => {
    const many = Array.from({ length: TASK_EXPORT_CAP + 1 }, (_, i) =>
      task({ id: `t${i}` }),
    );
    const { result, written } = await build({ tasks: many });
    expect(result.capped).toBe(true);
    expect(result.tasks).toBe(TASK_EXPORT_CAP);
    expect(written.get("c/e1/tasks.html")).toMatch(/stops at/);
  });

  it("TE-13: a read failure fails loudly", async () => {
    const h = makeHarness([
      endpoint("GET", /\/rest\/v1\/company_members/, () => [{ role: "member" }]),
      endpoint("POST", /\/rpc\/member_number_levels/, () => []),
      endpoint(
        "GET",
        /\/rest\/v1\/tasks/,
        () => new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
      ),
    ]);
    stubFetch(h.route);
    await expect(
      buildTaskExport(
        getDb(completeEnv()),
        { companyId: COMPANY_ID, requestedBy: USER_ID, filters: {}, prefix: "c/e1", now: NOW },
        async () => {},
      ),
    ).rejects.toThrow(/task export read failed/);
  });

  it("TE-14: a spreadsheet formula in a title is neutered", async () => {
    // Titles are seeded from message bodies, which strangers write.
    const { written } = await build({
      tasks: [task({ title: "=cmd|'/c calc'!A1" })],
    });
    const csv = written.get("c/e1/tasks.csv")!;
    expect(csv).not.toMatch(/(^|,)"?=cmd/);
  });
});
