/**
 * #301 — the owner's own vocabulary for where customers come from.
 *
 * LS-R3 is the one that decides whether this is safe. A source id is the axis
 * of a report about money, and the FK only says the row exists somewhere — so
 * without a company check a member could file their conversations, or their
 * phone line, under another business's source, and the name would appear in
 * their own report. This is #309's greeting-selection lesson applied before it
 * could be a bug rather than after.
 */
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppEnv } from "../context";
import type { Bindings } from "../env";
import { ApiError, errorResponse } from "../http/errors";
import { FakeRest } from "../telnyx/test-support";
import { completeEnv, stubFetch } from "../test/support";
import { leadSourcesRoutes } from "./lead-sources";

const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const OTHER_COMPANY = "99999999-0000-4000-8000-000000000099";
const OWNER_ID = "10000000-aaaa-4000-8000-000000000001";
const TRUCK = "eeeeeeee-0000-4000-8000-0000000000f1";
const THEIRS = "eeeeeeee-0000-4000-8000-0000000000f9";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function buildHarness(sources: Record<string, unknown>[] = []) {
  const env = completeEnv();
  const rest = new FakeRest(env);
  rest.table("lead_sources", {}, [["company_id", "name"]]);
  rest.table("audit_log");
  for (const row of sources) rest.insert("lead_sources", row);

  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("userId", OWNER_ID);
    c.set("companyId", COMPANY_ID);
    c.set("role", "owner");
    c.set("memberId", "m-1");
    await next();
  });
  app.route("/v1", leadSourcesRoutes);
  app.onError((error, c) => {
    if (error instanceof ApiError) return errorResponse(c, error.code, error.message);
    return c.json({ error: { code: "internal_error", message: String(error) } }, 500);
  });

  stubFetch(rest.route());
  return {
    env,
    rest,
    request: (path: string, init?: RequestInit) =>
      app.request(path, init, env as unknown as Bindings),
  };
}

function json(body: unknown, method = "POST"): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("#301 lead sources", () => {
  it("LS-R1: a workspace starts with nothing, because the list is theirs", async () => {
    // Owner-defined rather than a fixed taxonomy: "Neighbour" matters to a
    // plumber and "Trade counter" to an electrician, and a list we chose
    // would be wrong for both. Suggest, never impose (#298's tag argument).
    const harness = buildHarness();
    const res = await harness.request("/v1/lead-sources");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
  });

  it("LS-R2: a duplicate name says which, and says why it matters", async () => {
    // The commonest way this call fails, because an ARCHIVED source still
    // holds the name — and two identical names is a report that cannot tell
    // them apart.
    const harness = buildHarness([
      { id: TRUCK, company_id: COMPANY_ID, name: "Truck", archived_at: null },
    ]);
    const res = await harness.request("/v1/lead-sources", json({ name: "Truck" }));
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(text).toContain("already have a source called");
    expect(text).toMatch(/archived/i);
  });

  it("LS-R3: another workspace's source is refused", async () => {
    // THE ONE THAT MATTERS. The FK only says the row exists somewhere, so
    // without this a member could file their own conversations under another
    // business's source and see the name in their own report.
    const harness = buildHarness([
      { id: THEIRS, company_id: OTHER_COMPANY, name: "Theirs", archived_at: null },
    ]);
    const { assertOwnLeadSource } = await import("./lead-sources");
    await expect(
      assertOwnLeadSource(
        { get: () => COMPANY_ID, env: harness.env } as never,
        THEIRS,
      ),
    ).rejects.toThrow(/No such source/);
  });

  it("LS-R4: an archived source takes nothing new, but keeps what it has", async () => {
    // The point of archiving is that the list shrinks while the history
    // stands. Letting new work be filed under a retired name would mean the
    // list never actually shrinks.
    const harness = buildHarness([
      {
        id: TRUCK,
        company_id: COMPANY_ID,
        name: "Truck",
        archived_at: "2026-08-01T00:00:00.000Z",
      },
    ]);
    const { assertOwnLeadSource } = await import("./lead-sources");
    await expect(
      assertOwnLeadSource(
        { get: () => COMPANY_ID, env: harness.env } as never,
        TRUCK,
      ),
    ).rejects.toThrow(/archived/i);
  });

  it("LS-R5: archiving is offered and deleting is not", async () => {
    // A source is the axis of a report about the past, so there is no DELETE
    // on this route at all — the FK refuses it, and this is the supported way
    // out: gone from the picker, kept in the record.
    const harness = buildHarness([
      { id: TRUCK, company_id: COMPANY_ID, name: "Truck", archived_at: null },
    ]);

    const archived = await harness.request(
      `/v1/lead-sources/${TRUCK}`,
      json({ archived: true }, "PATCH"),
    );
    expect(archived.status).toBe(200);
    expect(
      (harness.rest.rows("lead_sources")[0] as { archived_at: string | null })
        .archived_at,
    ).not.toBeNull();

    // And it comes back, because retiring a channel is not a decision anybody
    // should have to be sure about.
    const restored = await harness.request(
      `/v1/lead-sources/${TRUCK}`,
      json({ archived: false }, "PATCH"),
    );
    expect(restored.status).toBe(200);
    expect(
      (harness.rest.rows("lead_sources")[0] as { archived_at: string | null })
        .archived_at,
    ).toBeNull();

    const deleted = await harness.request(`/v1/lead-sources/${TRUCK}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(404);
  });

  it("LS-R6: renaming an id that is not ours is a 404, not a rename", async () => {
    const harness = buildHarness([
      { id: THEIRS, company_id: OTHER_COMPANY, name: "Theirs", archived_at: null },
    ]);
    const res = await harness.request(
      `/v1/lead-sources/${THEIRS}`,
      json({ name: "Mine now" }, "PATCH"),
    );
    expect(res.status).toBe(404);
    expect((harness.rest.rows("lead_sources")[0] as { name: string }).name).toBe(
      "Theirs",
    );
  });

  it("LS-R7: every change to the report's axis is on the record", async () => {
    // Renaming or archiving a source silently changes what last quarter looks
    // like, and "who changed what our sources are called" is the question
    // asked the moment two reports disagree.
    const harness = buildHarness();
    await harness.request("/v1/lead-sources", json({ name: "Yard sign" }));
    const actions = harness.rest
      .rows("audit_log")
      .map((row) => (row as { action: string }).action);
    expect(actions).toContain("lead_source.created");
  });
});
