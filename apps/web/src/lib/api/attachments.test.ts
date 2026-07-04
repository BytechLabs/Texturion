import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildAttachmentForm,
  validateAttachment,
} from "@/lib/attachments/validate";

import { uploadFilesSequentially } from "@/lib/attachments/upload-chain";

import { createApiClient } from "./core";
import { keys } from "./keys";
import type { Attachment } from "./types";

/**
 * The upload hook (`useUploadAttachment`) is a thin React wrapper over two pure
 * pieces — `validateAttachment` (the client gate) and `buildAttachmentForm`
 * (the multipart body) — sent through the app's `createApiClient`. These tests
 * exercise exactly that composition with the HTTP edge stubbed by an injected
 * fetch (the same pattern as core.test.ts): what the multipart POST looks like
 * on the wire, that the 201 row parses, and that a rejected file never reaches
 * the network. D28: upload owners are notes-only. The staged-note-upload chain
 * (`uploadFilesSequentially`) and the delete request shape are covered the
 * same way — pure logic, injected edges, no DOM/react-query harness.
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
    noteId: string;
    file: File;
    currentCount?: number;
  },
): Promise<Attachment> {
  const check = validateAttachment(args.file, args.currentCount ?? 0);
  if (!check.ok) throw new Error(check.reason);
  return request<Attachment>("/v1/attachments", {
    method: "POST",
    companyId: "company-1",
    formData: buildAttachmentForm("note", args.noteId, args.file),
  });
}

const ROW: Attachment = {
  id: "att-1",
  owner_type: "note",
  owner_id: "note-9",
  conversation_id: "conv-3",
  file_name: "quote.pdf",
  content_type: "application/pdf",
  size_bytes: 3,
  created_at: "2026-07-03T10:00:00Z",
};

describe("attachment upload — multipart request shape", () => {
  it("POSTs multipart with owner_type='note'/owner_id/file and no JSON content-type", async () => {
    const { request, fetchSpy } = makeClient(() => jsonResponse(201, ROW));
    const file = new File([new Uint8Array([1, 2, 3])], "quote.pdf", {
      type: "application/pdf",
    });

    const row = await upload(request, {
      noteId: "note-9",
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
    expect(body.get("owner_type")).toBe("note");
    expect(body.get("owner_id")).toBe("note-9");
    expect((body.get("file") as File).name).toBe("quote.pdf");

    // The parsed 201 row is returned unchanged for the cache/render.
    expect(row).toEqual(ROW);
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
        noteId: "note-9",
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

  it("surfaces the D30 storage-budget 409 conflict verbatim", async () => {
    const { request } = makeClient(() =>
      jsonResponse(409, {
        error: {
          code: "conflict",
          message:
            "Your plan's 5 GB attachment storage is full — delete some files to free space.",
        },
      }),
    );
    await expect(
      upload(request, {
        noteId: "note-9",
        file: new File(["x"], "x.pdf", { type: "application/pdf" }),
      }),
    ).rejects.toMatchObject({
      code: "conflict",
      status: 409,
      message: /5 GB attachment storage is full/,
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
      upload(request, { noteId: "note-9", file: big }),
    ).rejects.toThrow(/25 MB/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never calls fetch for a disallowed type", async () => {
    const { request, fetchSpy } = makeClient(() => jsonResponse(201, ROW));
    const exe = new File([new Uint8Array([1])], "run.exe", {
      type: "application/x-msdownload",
    });
    await expect(
      upload(request, { noteId: "note-1", file: exe }),
    ).rejects.toThrow(/isn't allowed/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never calls fetch once the per-owner cap is reached", async () => {
    const { request, fetchSpy } = makeClient(() => jsonResponse(201, ROW));
    await expect(
      upload(request, {
        noteId: "note-9",
        file: new File([new Uint8Array([1])], "x.pdf", {
          type: "application/pdf",
        }),
        currentCount: 10,
      }),
    ).rejects.toThrow(/up to 10/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("uploadFilesSequentially (the staged-note-upload chain, D28)", () => {
  const file = (name: string) =>
    new File(["x"], name, { type: "application/pdf" });

  it("uploads every file in order and reports the count", async () => {
    const seen: string[] = [];
    const uploadOne = vi.fn(async (f: File) => {
      seen.push(f.name);
    });

    const result = await uploadFilesSequentially(uploadOne, [
      file("a.pdf"),
      file("b.pdf"),
      file("c.pdf"),
    ]);

    expect(result).toEqual({ uploaded: 3, failed: [] });
    expect(seen).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
  });

  it("runs strictly sequentially — one upload at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const uploadOne = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;
    };

    await uploadFilesSequentially(uploadOne, [file("a"), file("b"), file("c")]);
    expect(maxInFlight).toBe(1);
  });

  it("collects a partial failure without dropping the rest of the batch", async () => {
    const uploadOne = async (f: File) => {
      if (f.name === "b.pdf") {
        throw new Error("file: content does not match its declared type.");
      }
    };

    const result = await uploadFilesSequentially(uploadOne, [
      file("a.pdf"),
      file("b.pdf"),
      file("c.pdf"),
    ]);

    expect(result.uploaded).toBe(2);
    expect(result.failed).toEqual([
      {
        name: "b.pdf",
        message: "file: content does not match its declared type.",
      },
    ]);
  });

  it("never rejects — even when every upload throws non-Errors", async () => {
    const uploadOne = async () => {
      throw "boom"; // deliberately not an Error — the chain must not trust shape
    };
    const result = await uploadFilesSequentially(uploadOne, [file("a.pdf")]);
    expect(result.uploaded).toBe(0);
    expect(result.failed).toEqual([
      { name: "a.pdf", message: "That file didn't upload. Try again." },
    ]);
  });

  it("handles an empty staged list as a no-op", async () => {
    const uploadOne = vi.fn();
    const result = await uploadFilesSequentially(uploadOne, []);
    expect(result).toEqual({ uploaded: 0, failed: [] });
    expect(uploadOne).not.toHaveBeenCalled();
  });
});

describe("attachment delete — request shape (D19 soft-delete / D30 free space)", () => {
  it("DELETEs /v1/attachments/:id and resolves on 204", async () => {
    const { request, fetchSpy } = makeClient(
      () => new Response(null, { status: 204 }),
    );

    await request<void>("/v1/attachments/att-1", {
      method: "DELETE",
      companyId: "company-1",
    });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://api.jobtext.test/v1/attachments/att-1");
    expect(init?.method).toBe("DELETE");
    const headers = init?.headers as Record<string, string>;
    expect(headers["X-Company-Id"]).toBe("company-1");
  });

  it("surfaces not_found for an already-deleted or foreign row", async () => {
    const { request } = makeClient(() =>
      jsonResponse(404, {
        error: { code: "not_found", message: "No such attachment." },
      }),
    );
    await expect(
      request<void>("/v1/attachments/att-9", {
        method: "DELETE",
        companyId: "company-1",
      }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });
});

/**
 * The upload cache-invalidation contract (finding #9). Both upload hooks —
 * `useUploadAttachment.onSuccess` and `useUploadNoteFiles.onSettled` — delegate
 * to the same `invalidateAfterNoteUpload`, so testing that helper against a real
 * QueryClient proves both paths refresh the same read surfaces. The regression:
 * a note-file upload used to skip the conversation attachments gallery root
 * (only delete invalidated it), leaving the in-session gallery stale.
 */
describe("invalidateAfterNoteUpload — the note-file upload invalidation set", () => {
  const companyId = "company-1";
  const noteId = "note-9";

  // The helper lives in attachments.ts, whose import chain pulls in ./client →
  // env.ts (which validates public env at module load). Stub the three keys and
  // import a fresh copy, the same pattern as the auth-page render tests.
  async function loadHelper() {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghijkl.supabase.co");
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "sb_publishable_0123456789abcdef",
    );
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.jobtext.app");
    const mod = await import("./attachments");
    return mod.invalidateAfterNoteUpload;
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("invalidates the note's own attachment list, the tasks root, and the gallery root", async () => {
    const invalidateAfterNoteUpload = await loadHelper();
    const qc = new QueryClient();
    // Seed one live query under each root the upload must refresh, plus a
    // second company's gallery that must stay untouched (company-scoped keys).
    qc.setQueryData(keys.ownerAttachments(companyId, "note", noteId), {
      data: [],
    });
    qc.setQueryData(keys.tasks.checklist(companyId, "conv-3"), []);
    qc.setQueryData(keys.conversations.attachments(companyId, "conv-3"), {
      data: [],
    });
    qc.setQueryData(keys.conversations.attachments("other-co", "conv-3"), {
      data: [],
    });

    invalidateAfterNoteUpload(qc, companyId, noteId);

    const invalidated = (queryKey: readonly unknown[]) =>
      qc.getQueryCache().find({ queryKey })?.state.isInvalidated ?? false;

    expect(invalidated(keys.ownerAttachments(companyId, "note", noteId))).toBe(
      true,
    );
    expect(invalidated(keys.tasks.checklist(companyId, "conv-3"))).toBe(true);
    // The gallery root — the arm this bug missed — reaches every conversation's
    // gallery in this company via prefix match.
    expect(
      invalidated(keys.conversations.attachments(companyId, "conv-3")),
    ).toBe(true);
    // Another tenant's identical-shaped gallery is left alone.
    expect(
      invalidated(keys.conversations.attachments("other-co", "conv-3")),
    ).toBe(false);
  });

  it("invalidates the gallery root exactly (no conversation id — every gallery)", async () => {
    const invalidateAfterNoteUpload = await loadHelper();
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    invalidateAfterNoteUpload(qc, companyId, noteId);

    // The gallery invalidation must target the root prefix, not one
    // conversation — the same key `useDeleteAttachment` uses — so it reaches
    // whichever conversation's gallery is currently open.
    expect(spy).toHaveBeenCalledWith({
      queryKey: [companyId, "conversations", "attachments"],
    });
  });
});
