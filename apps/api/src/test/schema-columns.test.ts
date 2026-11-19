import { afterEach, describe, expect, it, vi } from "vitest";

import { checkLogicalExpression, checkRestRequest, checkSelect } from "./schema-columns";
import { stubFetch } from "./support";

const REST = "https://example.test/rest/v1";

describe("schema column checks (#750)", () => {
  it("accepts aliases, casts, embeds and computed columns", () => {
    expect(
      checkSelect(
        "id,title,done_state:task_done_at,source_call:calls!source_call_id(id,state),contacts(name)",
        "tasks",
      ),
    ).toEqual([]);
  });

  it("names the column the table lacks, at any depth", () => {
    expect(checkSelect("user_id,email", "profiles").map((p) => p.column)).toEqual([
      "email",
    ]);
    expect(
      checkSelect("id,contacts(id,nope)", "tasks").map((p) => `${p.table}.${p.column}`),
    ).toEqual(["contacts.nope"]);
  });

  it("refuses an embed with no foreign key between the tables", () => {
    expect(checkSelect("profiles!inner(display_name)", "company_members")).toHaveLength(1);
  });

  it("reads the columns inside or/and groups", () => {
    expect(
      checkLogicalExpression("(a_b.is.null,and(id.eq.1,nope.lt.2))", "tasks").map(
        (p) => p.column,
      ),
    ).toEqual(["a_b", "nope"]);
  });

  it("accepts null filtering on a selected relation", () => {
    const url = new URL("https://example.test/contacts?select=id,contact_addresses()&or=(name.ilike.*elm*,contact_addresses.not.is.null)");
    expect(checkRestRequest("GET", "contacts", url, undefined)).toEqual([]);

    url.searchParams.set("or", "(name.ilike.*elm*,contact_addresses.eq.elm)");
    expect(checkRestRequest("GET", "contacts", url, undefined).map((problem) => problem.column))
      .toEqual(["contact_addresses"]);
  });
});

describe("PostgREST request shape", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts null filters on an embedded relation alias", async () => {
    stubFetch(() => Response.json([]));
    const url = new URL(`${REST}/tasks`);
    url.searchParams.set("select", "id,calendar_hold:task_calendar_links()");
    url.searchParams.set("calendar_hold", "is.null");
    expect((await fetch(url)).status).toBe(200);

    url.searchParams.set("calendar_hlod", "is.null");
    expect((await fetch(url)).status).toBe(400);
  });

  it("checks required RPC arguments before a registered responder runs", async () => {
    const responder = vi.fn(() => Response.json({ ok: true }));
    stubFetch(responder);
    const run = (rpc: string, args: Record<string, string>) => fetch(`${REST}/rpc/${rpc}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });

    const valid = { p_user_id: "user", p_session_id: "session" };
    expect((await run("api_authorize_request", valid)).status).toBe(200);
    expect((await run("api_authorize_request", { ...valid, p_workspace_id: "workspace" })).status).toBe(404);
    expect((await run("api_authorize_request", { p_user_id: "user" })).status).toBe(404);
    const unknown = await run("api_does_not_exist", valid);
    expect(unknown.status).toBe(404);
    await expect(unknown.json()).resolves.toMatchObject({ code: "PGRST202" });
    const trigger = await run("broadcast_conversation_change", {});
    expect(trigger.status).toBe(404);
    await expect(trigger.json()).resolves.toMatchObject({ code: "PGRST202" });
    expect(responder).toHaveBeenCalledOnce();
  });

  it("rejects an upsert target with existing columns but no matching unique key", async () => {
    stubFetch(() => Response.json({ ok: true }));
    const upsert = (target: string) => fetch(`${REST}/phone_numbers?on_conflict=${target}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify({ provisioning_key: "test" }),
    });

    expect((await upsert("provisioning_key")).status).toBe(200);
    const invalid = await upsert("id,provisioning_key");
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ code: "42P10" });
  });
});
