import { describe, expect, it, vi } from "vitest";

import { createApiClient } from "./core";
import { ApiError, parseErrorBody } from "./error";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeClient(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  token: string | null = "test-token",
) {
  const fetchSpy = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) =>
      handler(String(input), init),
  );
  const request = createApiClient({
    baseUrl: "https://api.jobtext.test",
    getAccessToken: async () => token,
    fetch: fetchSpy as unknown as typeof fetch,
  });
  return { request, fetchSpy };
}

describe("ApiError envelope parsing (SPEC §7)", () => {
  it("maps every stable code from the envelope", () => {
    const error = parseErrorBody(403, {
      error: { code: "registration_pending", message: "US texting pending." },
    });
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("registration_pending");
    expect(error.message).toBe("US texting pending.");
    expect(error.status).toBe(403);
  });

  it("keeps the message but flags unknown codes as internal_error", () => {
    const error = parseErrorBody(418, {
      error: { code: "teapot", message: "I'm a teapot." },
    });
    expect(error.code).toBe("internal_error");
    expect(error.message).toBe("I'm a teapot.");
  });

  it("falls back to internal_error for non-envelope bodies", () => {
    const error = parseErrorBody(502, "<html>Bad Gateway</html>");
    expect(error.code).toBe("internal_error");
    expect(error.status).toBe(502);
    expect(error.message).toMatch(/try again/i);
  });

  it("marks deterministic failures as non-retryable and 429/500 as retryable", () => {
    expect(
      parseErrorBody(409, { error: { code: "conflict", message: "x" } })
        .retryable,
    ).toBe(false);
    expect(
      parseErrorBody(429, { error: { code: "rate_limited", message: "x" } })
        .retryable,
    ).toBe(true);
    expect(parseErrorBody(500, null).retryable).toBe(true);
  });

  it("throws the parsed ApiError from the client on a non-2xx response", async () => {
    const { request } = makeClient(() =>
      jsonResponse(402, {
        error: {
          code: "usage_cap_reached",
          message: "You hit your usage cap.",
        },
      }),
    );
    await expect(request("/v1/messages/send")).rejects.toMatchObject({
      name: "ApiError",
      code: "usage_cap_reached",
      status: 402,
      message: "You hit your usage cap.",
    });
  });
});

describe("api client request building (G12)", () => {
  it("injects Authorization, X-Company-Id, and Idempotency-Key headers", async () => {
    const { request, fetchSpy } = makeClient(() => jsonResponse(200, {}));
    await request("/v1/messages/send", {
      method: "POST",
      companyId: "company-1",
      idempotencyKey: "key-123",
      body: { conversation_id: "c1", body: "hi" },
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://api.jobtext.test/v1/messages/send");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
    expect(headers["X-Company-Id"]).toBe("company-1");
    expect(headers["Idempotency-Key"]).toBe("key-123");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(
      JSON.stringify({ conversation_id: "c1", body: "hi" }),
    );
  });

  it("serializes searchParams and drops undefined values", async () => {
    const { request, fetchSpy } = makeClient(() =>
      jsonResponse(200, { data: [], next_cursor: null }),
    );
    await request("/v1/conversations", {
      companyId: "company-1",
      searchParams: { status: "open", q: undefined, unread: true },
    });
    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.searchParams.get("status")).toBe("open");
    expect(url.searchParams.get("unread")).toBe("true");
    expect(url.searchParams.has("q")).toBe(false);
  });

  it("returns undefined for 204 responses", async () => {
    const { request } = makeClient(() => new Response(null, { status: 204 }));
    await expect(
      request("/v1/tags/t1", { method: "DELETE", companyId: "c" }),
    ).resolves.toBeUndefined();
  });

  it("fails fast with unauthorized when there is no session", async () => {
    const { request, fetchSpy } = makeClient(
      () => jsonResponse(200, {}),
      null,
    );
    await expect(request("/v1/me")).rejects.toMatchObject({
      code: "unauthorized",
      status: 401,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not set a JSON content type for FormData bodies", async () => {
    const { request, fetchSpy } = makeClient(() =>
      jsonResponse(200, { imported: 0, updated: 0, skipped: 0, errors: [] }),
    );
    const formData = new FormData();
    formData.append("file", "phone\n+14165550100");
    await request("/v1/contacts/import", {
      method: "POST",
      companyId: "company-1",
      formData,
    });
    const init = fetchSpy.mock.calls[0][1];
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
    expect(init?.body).toBe(formData);
  });
});
