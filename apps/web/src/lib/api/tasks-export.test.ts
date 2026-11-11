import { describe, expect, it, vi } from "vitest";

import { fetchTasksExport } from "./tasks-export";

function deps(response: Response) {
  const fetchSpy = vi.fn(async () => response);
  return {
    fetchSpy,
    deps: {
      fetch: fetchSpy as unknown as typeof fetch,
      getToken: async () => "tok",
      baseUrl: "https://api.example.com/",
    },
  };
}

describe("fetchTasksExport (#745)", () => {
  it("asks the direct CSV route with the view's filters, never /v1/exports", async () => {
    const { fetchSpy, deps: d } = deps(
      new Response("a,b", { headers: { "Content-Disposition": 'attachment; filename="tasks.csv"' } }),
    );
    const out = await fetchTasksExport(
      "co-1",
      { status: "open", assigned_user_id: "me", has_location: true, sort: "due" },
      d,
    );
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/v1/tasks/export.csv");
    expect(parsed.pathname).not.toContain("/v1/exports");
    expect(parsed.searchParams.get("status")).toBe("open");
    expect(parsed.searchParams.get("assigned_user_id")).toBe("me");
    expect(parsed.searchParams.has("has_location")).toBe(false);
    expect(parsed.searchParams.has("cursor")).toBe(false);
    expect((init.headers as Record<string, string>)["X-Company-Id"]).toBe("co-1");
    expect(out.filename).toBe("tasks.csv");
  });

  it("throws the server's error on a refusal", async () => {
    const { deps: d } = deps(
      new Response(JSON.stringify({ error: { code: "forbidden", message: "No." } }), {
        status: 403,
      }),
    );
    await expect(fetchTasksExport("co-1", {}, d)).rejects.toMatchObject({ status: 403 });
  });
});
