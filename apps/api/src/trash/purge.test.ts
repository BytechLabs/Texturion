/**
 * #691 — the daily Trash sweep: objects before rows, one failure never stops the
 * rest, and nothing is erased that the database did not call due.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
import { purgeTrash } from "./purge";

const env = completeEnv();
const A = "aaaaaaaa-1111-4222-8333-444444444444";
const B = "bbbbbbbb-1111-4222-8333-444444444444";

afterEach(() => vi.unstubAllGlobals());

describe("purgeTrash", () => {
  it("removes each item's objects, then erases its rows", async () => {
    const order: string[] = [];
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_trash_due", () => [
      { kind: "conversation", id: A, company_id: "c" },
      { kind: "voicemail", id: B, company_id: "c" },
    ]);
    sb.on("POST", "/rest/v1/rpc/api_trash_object_paths", (req) => {
      const id = (req.body as { p_id: string }).p_id;
      order.push(`paths ${id}`);
      return [{ bucket: "voicemails", path: `co/${id}.mp3` }];
    });
    sb.on("DELETE", /^\/storage\/v1\/object\/voicemails$/, () => {
      order.push("remove");
      return [];
    });
    sb.on("POST", "/rest/v1/rpc/api_purge_trash_item", (req) => {
      const body = req.body as { p_id: string; p_actor: string | null };
      order.push(`rows ${body.p_id}`);
      // The cron has no actor: the audit row says the expiry did it.
      expect(body.p_actor).toBeNull();
      return { outcome: "purged", company_id: "c" };
    });
    stubFetch(sb.route);

    const summary = await purgeTrash(env);
    expect(summary).toEqual({ due: 2, purged: 2, failed: 0 });
    expect(order).toEqual([
      `paths ${A}`, "remove", `rows ${A}`,
      `paths ${B}`, "remove", `rows ${B}`,
    ]);
  });

  it("keeps going past a failure and then says so", async () => {
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_trash_due", () => [
      { kind: "message", id: A, company_id: "c" },
      { kind: "message", id: B, company_id: "c" },
    ]);
    sb.on("POST", "/rest/v1/rpc/api_trash_object_paths", (req) =>
      (req.body as { p_id: string }).p_id === A
        ? new Response(JSON.stringify({ message: "down" }), { status: 500 })
        : [],
    );
    sb.on("POST", "/rest/v1/rpc/api_purge_trash_item", () => ({
      outcome: "purged",
      company_id: "c",
    }));
    stubFetch(sb.route);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(purgeTrash(env)).rejects.toThrow(/1 item\(s\) failed/);
    // B was still erased.
    expect(sb.find("POST", "/rest/v1/rpc/api_purge_trash_item")).toHaveLength(1);
  });
});
