import { describe, expect, it, vi } from "vitest";

import {
  buildAttachmentForm,
  validateAttachment,
} from "@/lib/attachments/validate";

import { createApiClient } from "./core";
import type { Attachment } from "./types";

/**
 * The upload hook (`useUploadAttachment`) is a thin React wrapper over two pure
 * pieces — `validateAttachment` (the client gate) and `buildAttachmentForm`
 * (the multipart body) — sent through the app's `createApiClient`. These tests
 * exercise exactly that composition with the HTTP edge stubbed by an injected
 * fetch (the same pattern as core.test.ts): what the multipart POST looks like
 * on the wire, that the 201 row parses, and that a rejected file never reaches
 * the network. This is the hook's behavior without needing a DOM/react-query
 * harness.
 */

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
    baseUrl: "https://api.jobtext.test",
    getAccessToken: async () => "test-token",
    fetch: fetchSpy as unknown as typeof fetch,
  });
  return { request, fetchSpy };
}

/** Reproduces the hook's mutationFn against the injected client. */
async function upload(
  request: ReturnType<typeof makeClient>["request"],
  args: {
    ownerType: "note" | "task";
    ownerId: string;
    file: File;
    currentCount?: number;
  },
): Promise<Attachment> {
  const check = validateAttachment(args.file, args.currentCount ?? 0);
  if (!check.ok) throw new Error(check.reason);
  return request<Attachment>("/v1/attachments", {
    method: "POST",
    companyId: "company-1",
    formData: buildAttachmentForm(args.ownerType, args.ownerId, args.file),
  });
}

const ROW: Attachment = {
  id: "att-1",
  owner_type: "task",
  owner_id: "task-9",
  conversation_id: "conv-3",
  file_name: "quote.pdf",
  content_type: "application/pdf",
  size_bytes: 3,
  created_at: "2026-07-03T10:00:00Z",
};

describe("attachment upload — multipart request shape", () => {
  it("POSTs multipart with owner_type/owner_id/file and no JSON content-type", async () => {
    const { request, fetchSpy } = makeClient(() => jsonResponse(201, ROW));
    const file = new File([new Uint8Array([1, 2, 3])], "quote.pdf", {
      type: "application/pdf",
    });

    const row = await upload(request, {
      ownerType: "task",
      ownerId: "task-9",
      file,
    });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://api.jobtext.test/v1/attachments");
    expect(init?.method).toBe("POST");

    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
    expect(headers["X-Company-Id"]).toBe("company-1");
    // The browser must set the multipart boundary — the client never forces
    // a JSON content-type for a FormData body.
    expect(headers["Content-Type"]).toBeUndefined();

    const body = init?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("owner_type")).toBe("task");
    expect(body.get("owner_id")).toBe("task-9");
    expect((body.get("file") as File).name).toBe("quote.pdf");

    // The parsed 201 row is returned unchanged for the cache/render.
    expect(row).toEqual(ROW);
  });

  it("sends owner_type='note' for a note attachment", async () => {
    const { request, fetchSpy } = makeClient(() =>
      jsonResponse(201, { ...ROW, owner_type: "note", owner_id: "note-2" }),
    );
    await upload(request, {
      ownerType: "note",
      ownerId: "note-2",
      file: new File(["hi"], "n.txt", { type: "text/plain" }),
    });
    const body = fetchSpy.mock.calls[0][1]?.body as FormData;
    expect(body.get("owner_type")).toBe("note");
    expect(body.get("owner_id")).toBe("note-2");
  });

  it("surfaces the API validation_failed message (25 MB / type) verbatim", async () => {
    const { request } = makeClient(() =>
      jsonResponse(422, {
        error: {
          code: "validation_failed",
          message: "file: exceeds the 26214400-byte limit.",
        },
      }),
    );
    await expect(
      upload(request, {
        ownerType: "task",
        ownerId: "task-9",
        file: new File([new Uint8Array([1])], "x.pdf", {
          type: "application/pdf",
        }),
      }),
    ).rejects.toMatchObject({
      code: "validation_failed",
      status: 422,
      message: "file: exceeds the 26214400-byte limit.",
    });
  });
});

describe("attachment upload — client gate short-circuits the network", () => {
  it("never calls fetch when the file is over 25 MB", async () => {
    const { request, fetchSpy } = makeClient(() => jsonResponse(201, ROW));
    // A 26 MB File without allocating 26 MB: stub the size getter.
    const big = new File([new Uint8Array([0])], "huge.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(big, "size", { value: 26 * 1024 * 1024 });

    await expect(
      upload(request, { ownerType: "task", ownerId: "task-9", file: big }),
    ).rejects.toThrow(/25 MB/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never calls fetch for a disallowed type", async () => {
    const { request, fetchSpy } = makeClient(() => jsonResponse(201, ROW));
    const exe = new File([new Uint8Array([1])], "run.exe", {
      type: "application/x-msdownload",
    });
    await expect(
      upload(request, { ownerType: "note", ownerId: "note-1", file: exe }),
    ).rejects.toThrow(/isn't allowed/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never calls fetch once the per-owner cap is reached", async () => {
    const { request, fetchSpy } = makeClient(() => jsonResponse(201, ROW));
    await expect(
      upload(request, {
        ownerType: "task",
        ownerId: "task-9",
        file: new File([new Uint8Array([1])], "x.pdf", {
          type: "application/pdf",
        }),
        currentCount: 10,
      }),
    ).rejects.toThrow(/up to 10/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
