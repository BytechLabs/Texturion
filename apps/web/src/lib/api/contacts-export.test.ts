import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchContactsExport,
  triggerBlobDownload,
} from "./contacts-export";

const BASE = "https://api.jobtext.test";
const BOM = "﻿";

function csvResponse(body: string, filename = "contacts.csv"): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchContactsExport (GET /v1/contacts/export, D20 §3.1)", () => {
  it("sends the auth + company headers and honors the current search q", async () => {
    const fetchSpy = vi.fn(async () => csvResponse(`${BOM}name,phone\nAda,+14165550100\n`));
    const { blob, filename } = await fetchContactsExport("company-1", "  ada  ", {
      fetch: fetchSpy as unknown as typeof fetch,
      getToken: async () => "test-token",
      baseUrl: BASE,
    });

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/v1/contacts/export");
    // The live query is trimmed and passed through ("export what I'm looking at").
    expect(parsed.searchParams.get("q")).toBe("ada");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
    expect(headers["X-Company-Id"]).toBe("company-1");

    // Reading bytes (not text) keeps the leading UTF-8 BOM (EF BB BF) for
    // Excel — asserting at the byte level, since TextDecoder strips a decoded
    // U+FEFF (exactly why the download must carry raw bytes, not a string).
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(filename).toBe("contacts.csv");
  });

  it("omits q when the search is empty (exports everything)", async () => {
    const fetchSpy = vi.fn(async () => csvResponse("name,phone\n"));
    await fetchContactsExport("company-1", "   ", {
      fetch: fetchSpy as unknown as typeof fetch,
      getToken: async () => "test-token",
      baseUrl: BASE,
    });
    const url = new URL((fetchSpy.mock.calls[0] as unknown as [string])[0]);
    expect(url.searchParams.has("q")).toBe(false);
  });

  it("throws unauthorized without a session (never fetches)", async () => {
    const fetchSpy = vi.fn(async () => csvResponse("x"));
    await expect(
      fetchContactsExport("company-1", "", {
        fetch: fetchSpy as unknown as typeof fetch,
        getToken: async () => null,
        baseUrl: BASE,
      }),
    ).rejects.toMatchObject({ code: "unauthorized", status: 401 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("parses the SPEC §7 error envelope on a non-2xx", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: { code: "forbidden", message: "You can't export here." },
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ),
    );
    await expect(
      fetchContactsExport("company-1", "", {
        fetch: fetchSpy as unknown as typeof fetch,
        getToken: async () => "test-token",
        baseUrl: BASE,
      }),
    ).rejects.toMatchObject({
      name: "ApiError",
      code: "forbidden",
      status: 403,
      message: "You can't export here.",
    });
  });

  it("falls back to contacts.csv when the server omits a filename", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response("name,phone\n", {
          status: 200,
          headers: { "Content-Type": "text/csv" },
        }),
    );
    const { filename } = await fetchContactsExport("company-1", "", {
      fetch: fetchSpy as unknown as typeof fetch,
      getToken: async () => "test-token",
      baseUrl: BASE,
    });
    expect(filename).toBe("contacts.csv");
  });
});

describe("triggerBlobDownload (browser download side effect)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates an object URL and clicks a download anchor, then cleans up", () => {
    const click = vi.fn();
    const remove = vi.fn();
    const anchor: Record<string, unknown> = { click, remove };
    const appendChild = vi.fn();
    vi.stubGlobal("document", {
      createElement: vi.fn(() => anchor),
      body: { appendChild },
    });
    const createObjectURL = vi.fn(() => "blob:fake");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    const blob = new Blob([`${BOM}name,phone\n`], { type: "text/csv" });
    triggerBlobDownload(blob, "my-contacts.csv");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchor.download).toBe("my-contacts.csv");
    expect(anchor.href).toBe("blob:fake");
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
  });

  it("is a no-op outside the browser (no document)", () => {
    vi.stubGlobal("document", undefined);
    // Must not throw.
    expect(() =>
      triggerBlobDownload(new Blob(["x"]), "x.csv"),
    ).not.toThrow();
  });
});
