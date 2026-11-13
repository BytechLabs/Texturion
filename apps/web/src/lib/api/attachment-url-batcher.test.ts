import { describe, expect, it, vi } from "vitest";

import { createAttachmentUrlBatcher } from "./attachment-url-batcher";
import type { RequestOptions } from "./core";
import { ApiError } from "./error";
import type { AttachmentVariant } from "./types";

interface Call {
  path: string;
  options: RequestOptions;
}

type Item = { id: string; variant: AttachmentVariant };

function minted({ id, variant }: Item) {
  return {
    id,
    requested_variant: variant,
    variant: "original" as const,
    url: `https://storage.test/${id}-${variant}`,
    expires_at: "2026-11-13T12:00:00.000Z",
    ttl_seconds: 3600,
  };
}

/** A request stub that answers the batch route with `answer` and records every call. */
function stubRequest(
  answer: (items: Item[], call: Call) => unknown = (items) => ({
    data: items.map(minted),
    errors: [],
  }),
) {
  const calls: Call[] = [];
  const request = vi.fn(async (path: string, options: RequestOptions = {}) => {
    const call = { path, options };
    calls.push(call);
    const items = (options.body as { items?: Item[] } | undefined)?.items ?? [];
    const result = answer(items, call);
    if (result instanceof Error) throw result;
    return result;
  });
  return { request: request as never, calls };
}

describe("createAttachmentUrlBatcher", () => {
  it("sends one POST per company for the mints asked for together", async () => {
    const { request, calls } = stubRequest();
    const load = createAttachmentUrlBatcher(request);

    const urls = await Promise.all([
      load("co-1", "a", "preview"),
      load("co-1", "b", "original"),
      load("co-1", "c", "preview"),
      load("co-2", "d", "preview"),
    ]);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      path: "/v1/attachments/urls",
      options: {
        method: "POST",
        companyId: "co-1",
        body: {
          items: [
            { id: "a", variant: "preview" },
            { id: "b", variant: "original" },
            { id: "c", variant: "preview" },
          ],
        },
      },
    });
    expect(calls[1].options.companyId).toBe("co-2");
    expect(urls[0]).toEqual({
      url: "https://storage.test/a-preview",
      expires_at: "2026-11-13T12:00:00.000Z",
      ttl_seconds: 3600,
      variant: "original",
    });
    expect(urls[3].url).toBe("https://storage.test/d-preview");
  });

  it("splits more than 25 mints into chunks of 25", async () => {
    const { request, calls } = stubRequest();
    const load = createAttachmentUrlBatcher(request);

    await Promise.all(
      Array.from({ length: 30 }, (_, index) => load("co-1", `id-${index}`, "preview")),
    );

    expect(calls.map((call) => (call.options.body as { items: Item[] }).items.length)).toEqual([
      25, 5,
    ]);
  });

  it("asks once for an object two callers want", async () => {
    const { request, calls } = stubRequest();
    const load = createAttachmentUrlBatcher(request);

    const [first, second] = await Promise.all([
      load("co-1", "a", "preview"),
      load("co-1", "a", "preview"),
    ]);

    expect((calls[0].options.body as { items: Item[] }).items).toEqual([
      { id: "a", variant: "preview" },
    ]);
    expect(first).toEqual(second);
  });

  it("refuses each item with its own code and keeps the rest", async () => {
    const { request } = stubRequest((items) => ({
      data: items.filter((item) => item.id === "ok").map(minted),
      errors: [
        {
          id: "held",
          requested_variant: "preview",
          code: "forbidden",
          message: "This file was reported and is on hold.",
        },
        {
          id: "gone",
          requested_variant: "preview",
          code: "not_found",
          message: "No such attachment.",
        },
      ],
    }));
    const load = createAttachmentUrlBatcher(request);

    const [ok, held, gone, missing] = await Promise.allSettled([
      load("co-1", "ok", "preview"),
      load("co-1", "held", "preview"),
      load("co-1", "gone", "preview"),
      load("co-1", "missing", "preview"),
    ]);

    expect(ok).toMatchObject({ status: "fulfilled" });
    expect(held).toMatchObject({ status: "rejected" });
    const heldError = (held as PromiseRejectedResult).reason;
    expect(heldError).toBeInstanceOf(ApiError);
    expect(heldError).toMatchObject({
      code: "forbidden",
      status: 403,
      message: "This file was reported and is on hold.",
    });
    expect((gone as PromiseRejectedResult).reason).toMatchObject({
      code: "not_found",
      status: 404,
    });
    // An item the answer left out is a failure, never a hang.
    expect((missing as PromiseRejectedResult).reason).toMatchObject({
      code: "internal_error",
    });
  });

  it("falls back to one GET per object when the Worker has no batch route", async () => {
    const { request, calls } = stubRequest((items, call) => {
      if (call.path === "/v1/attachments/urls") {
        return new ApiError("not_found", "Not found.", 404);
      }
      return { url: `https://storage.test${call.path}`, expires_at: "2026-11-13T12:00:00.000Z" };
    });
    const load = createAttachmentUrlBatcher(request);

    const [preview, original] = await Promise.all([
      load("co-1", "a", "preview"),
      load("co-1", "b", "original"),
    ]);

    expect(calls.map((call) => call.path)).toEqual([
      "/v1/attachments/urls",
      "/v1/attachments/a/url",
      "/v1/attachments/b/url?variant=original",
    ]);
    expect(calls[1].options).toEqual({ companyId: "co-1" });
    expect(preview.url).toBe("https://storage.test/v1/attachments/a/url");
    expect(original.url).toBe("https://storage.test/v1/attachments/b/url?variant=original");
  });

  it("fails every item of a batch the Worker refused as a whole", async () => {
    const limited = new ApiError("rate_limited", "Slow down.", 429);
    const { request, calls } = stubRequest(() => limited);
    const load = createAttachmentUrlBatcher(request);

    const results = await Promise.allSettled([
      load("co-1", "a", "preview"),
      load("co-1", "b", "preview"),
    ]);

    expect(calls).toHaveLength(1);
    expect(results).toEqual([
      { status: "rejected", reason: limited },
      { status: "rejected", reason: limited },
    ]);
  });
});
