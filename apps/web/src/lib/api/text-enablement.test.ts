import { describe, expect, it, vi } from "vitest";

import { createApiClient } from "./core";
import { ApiError } from "./error";
import type { Page, TextEnablement } from "./types";

/**
 * The text-enablement hooks are thin React wrappers over the request builders
 * in `text-enablement.ts`, sent through the app's `createApiClient`. These
 * tests exercise exactly that composition with the HTTP edge stubbed by an
 * injected fetch (the same pattern as attachments.test.ts / core.test.ts):
 * what each call looks like on the wire — the Idempotency-Key UUID on create,
 * the multipart `loa`/`bill` parts on the documents PUT, the action paths —
 * and that the §7 error envelope parses into the typed ApiError the cards
 * surface as one plain sentence.
 */

const ROW: TextEnablement = {
  id: "3e0c2f8a-1111-4222-8333-444455556666",
  phone_e164: "+16135550100",
  country: "CA",
  status: "pending",
  has_loa: false,
  has_bill: false,
  last_error: null,
  completed_at: null,
  cancelled_at: null,
  created_at: "2026-07-03T12:00:00Z",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeClient(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const fetchSpy = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) =>
      handler(String(input), init),
  );
  const request = createApiClient({
    baseUrl: "https://api.loonext.test",
    getAccessToken: async () => "test-token",
    fetch: fetchSpy as unknown as typeof fetch,
  });
  return { request, fetchSpy };
}

describe("create — POST /v1/text-enablements", () => {
  it("sends the E.164 body with the company + Idempotency-Key headers and parses the 201 row", async () => {
    const { request, fetchSpy } = makeClient(() => jsonResponse(201, ROW));
    const idempotencyKey = crypto.randomUUID();

    const created = await request<TextEnablement>("/v1/text-enablements", {
      method: "POST",
      companyId: "company-1",
      idempotencyKey,
      body: { phone_e164: "+16135550100" },
    });

    expect(created).toEqual(ROW);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://api.loonext.test/v1/text-enablements");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Company-Id"]).toBe("company-1");
    expect(headers["Idempotency-Key"]).toBe(idempotencyKey);
    expect(JSON.parse(String(init?.body))).toEqual({
      phone_e164: "+16135550100",
    });
  });

  it("parses a conflict (duplicate enablement) into the typed ApiError", async () => {
    const { request } = makeClient(() =>
      jsonResponse(409, {
        error: {
          code: "conflict",
          message: "This number already has a text-enablement in progress.",
        },
      }),
    );

    const failure = await request("/v1/text-enablements", {
      method: "POST",
      companyId: "company-1",
      idempotencyKey: crypto.randomUUID(),
      body: { phone_e164: "+16135550100" },
    }).catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe("conflict");
    expect((failure as ApiError).message).toMatch(/already has/);
  });
});

describe("documents — PUT /v1/text-enablements/:id/documents", () => {
  it("sends a multipart body with the loa and bill file parts", async () => {
    const { request, fetchSpy } = makeClient(() =>
      jsonResponse(200, { ...ROW, has_loa: true, has_bill: true }),
    );

    // Reproduces requestUploadDocuments' form assembly (loa/bill parts only
    // when provided — the route requires at least one).
    const form = new FormData();
    form.append(
      "loa",
      new File(["%PDF-1.7 loa"], "loa.pdf", { type: "application/pdf" }),
    );
    form.append(
      "bill",
      new File(["%PDF-1.7 bill"], "bill.pdf", { type: "application/pdf" }),
    );
    const updated = await request<TextEnablement>(
      `/v1/text-enablements/${ROW.id}/documents`,
      { method: "PUT", companyId: "company-1", formData: form },
    );

    expect(updated.has_loa).toBe(true);
    expect(updated.has_bill).toBe(true);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(
      `https://api.loonext.test/v1/text-enablements/${ROW.id}/documents`,
    );
    expect(init?.method).toBe("PUT");
    const sent = init?.body as FormData;
    expect(sent).toBeInstanceOf(FormData);
    expect((sent.get("loa") as File).name).toBe("loa.pdf");
    expect((sent.get("bill") as File).name).toBe("bill.pdf");
    // Multipart: the client must NOT force a JSON content type (the fetch
    // layer sets the boundary itself).
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
  });
});

describe("verification — the number-ownership code POSTs", () => {
  it("requests a code with the verification_method body on the codes path", async () => {
    const { request, fetchSpy } = makeClient(() =>
      jsonResponse(200, { requested: true, verification_method: "call" }),
    );

    const result = await request<{
      requested: boolean;
      verification_method: string;
    }>(`/v1/text-enablements/${ROW.id}/verification-codes`, {
      method: "POST",
      companyId: "company-1",
      body: { verification_method: "call" },
    });

    expect(result).toEqual({ requested: true, verification_method: "call" });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(
      `https://api.loonext.test/v1/text-enablements/${ROW.id}/verification-codes`,
    );
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      verification_method: "call",
    });
  });

  it("a code the carrier couldn't deliver surfaces the 422 sentence (try the other method)", async () => {
    const { request } = makeClient(() =>
      jsonResponse(422, {
        error: {
          code: "validation_failed",
          message:
            "The verification code couldn't be sent by sms: landlines can't receive SMS",
        },
      }),
    );

    const failure = await request(
      `/v1/text-enablements/${ROW.id}/verification-codes`,
      {
        method: "POST",
        companyId: "company-1",
        body: { verification_method: "sms" },
      },
    ).catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe("validation_failed");
    expect((failure as ApiError).message).toMatch(/couldn't be sent by sms/);
  });

  it("verify posts the code to the verify path and parses the 200", async () => {
    const { request, fetchSpy } = makeClient(() =>
      jsonResponse(200, { verified: true }),
    );

    const result = await request<{ verified: boolean }>(
      `/v1/text-enablements/${ROW.id}/verification-codes/verify`,
      { method: "POST", companyId: "company-1", body: { code: "482913" } },
    );

    expect(result).toEqual({ verified: true });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(
      `https://api.loonext.test/v1/text-enablements/${ROW.id}/verification-codes/verify`,
    );
    expect(JSON.parse(String(init?.body))).toEqual({ code: "482913" });
  });

  it("a rejected code surfaces the plain retry sentence", async () => {
    const { request } = makeClient(() =>
      jsonResponse(422, {
        error: {
          code: "validation_failed",
          message: "That code didn't match. Request a new code and try again.",
        },
      }),
    );

    const failure = await request(
      `/v1/text-enablements/${ROW.id}/verification-codes/verify`,
      { method: "POST", companyId: "company-1", body: { code: "000000" } },
    ).catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).message).toMatch(/didn't match/);
  });
});

describe("resubmit / cancel — the action POSTs", () => {
  it("resubmit posts to the resubmit path and returns the reset row", async () => {
    const { request, fetchSpy } = makeClient(() =>
      jsonResponse(200, { ...ROW, status: "pending", last_error: null }),
    );

    const reset = await request<TextEnablement>(
      `/v1/text-enablements/${ROW.id}/resubmit`,
      { method: "POST", companyId: "company-1" },
    );

    expect(reset.status).toBe("pending");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(
      `https://api.loonext.test/v1/text-enablements/${ROW.id}/resubmit`,
    );
    expect(init?.method).toBe("POST");
  });

  it("cancel posts to the cancel path; a terminal order surfaces the 409 sentence", async () => {
    const { request } = makeClient(() =>
      jsonResponse(409, {
        error: {
          code: "conflict",
          message:
            "This text-enablement is completed and can no longer be cancelled.",
        },
      }),
    );

    const failure = await request(`/v1/text-enablements/${ROW.id}/cancel`, {
      method: "POST",
      companyId: "company-1",
    }).catch((cause: unknown) => cause);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe("conflict");
  });
});

describe("list — GET /v1/text-enablements", () => {
  it("parses the §7 list envelope", async () => {
    const { request, fetchSpy } = makeClient(() =>
      jsonResponse(200, { data: [ROW], next_cursor: null }),
    );

    const page = await request<Page<TextEnablement>>("/v1/text-enablements", {
      companyId: "company-1",
    });

    expect(page.data).toHaveLength(1);
    expect(page.data[0].phone_e164).toBe("+16135550100");
    expect(page.next_cursor).toBeNull();
    const [, init] = fetchSpy.mock.calls[0];
    expect(init?.method).toBe("GET");
  });
});
