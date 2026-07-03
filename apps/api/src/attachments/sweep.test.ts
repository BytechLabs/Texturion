/**
 * Attachment orphan sweeper (D19 §2): reclaims the Storage object + row for
 * attachments soft-deleted past the grace window. Idempotent, batched, and a
 * per-object failure leaves the rows retryable. Only the network edge
 * (PostgREST + Storage) is stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { ATTACHMENTS_BUCKET } from "../routes/core/attachments";
import { sweepDeletedAttachments } from "./sweep";

const env = completeEnv();

afterEach(() => vi.unstubAllGlobals());

interface Captured {
  scans: URL[];
  removes: { bucket: string; paths: string[] }[];
  deletes: URL[];
}

/**
 * PostgREST + Storage double: the `attachments` GET returns `scanRows`, the
 * Storage remove() is captured, and the DELETE is captured. `removeFails`
 * makes the object-remove return an error (rows must then survive).
 */
function stubSweepWorld(
  scanRows: { id: string; storage_path: string }[],
  opts: { removeFails?: boolean } = {},
): { route: FetchRoute; captured: Captured } {
  const captured: Captured = { scans: [], removes: [], deletes: [] };
  const removePath = `/storage/v1/object/${ATTACHMENTS_BUCKET}`;
  const route: FetchRoute = (url, request) => {
    if (url.href.startsWith(`${env.SUPABASE_URL}/rest/v1/attachments`)) {
      if (request.method === "GET") {
        captured.scans.push(url);
        return Response.json(scanRows);
      }
      if (request.method === "DELETE") {
        captured.deletes.push(url);
        return Response.json([]);
      }
    }
    // Supabase Storage remove() is a DELETE to /storage/v1/object/{bucket}.
    if (url.href.includes(removePath) && request.method === "DELETE") {
      return (async () => {
        const body = (await request.clone().json()) as { prefixes: string[] };
        captured.removes.push({ bucket: ATTACHMENTS_BUCKET, paths: body.prefixes });
        if (opts.removeFails) {
          return new Response(JSON.stringify({ error: "boom", message: "boom" }), {
            status: 500,
          });
        }
        return Response.json(body.prefixes.map((p) => ({ name: p })));
      })();
    }
    return undefined;
  };
  return { route, captured };
}

describe("sweepDeletedAttachments (D19 §2)", () => {
  it("reclaims the Storage object then hard-deletes the row for aged soft-deletes", async () => {
    const { route, captured } = stubSweepWorld([
      { id: "a1", storage_path: "co/note/o1/uuid-file.pdf" },
      { id: "a2", storage_path: "co/task/o2/uuid-photo.jpg" },
    ]);
    stubFetch(route);

    await sweepDeletedAttachments(env);

    // Scan selects only soft-deleted rows older than the grace window: two
    // deleted_at predicates (not-null AND < cutoff) go on the URL.
    const scan = captured.scans[0];
    expect(scan.searchParams.getAll("deleted_at")).toEqual([
      "not.is.null",
      expect.stringMatching(/^lt\./),
    ]);

    // Both objects removed in one batched call…
    expect(captured.removes).toHaveLength(1);
    expect(captured.removes[0].paths).toEqual([
      "co/note/o1/uuid-file.pdf",
      "co/task/o2/uuid-photo.jpg",
    ]);
    // …then the rows hard-deleted by id.
    expect(captured.deletes).toHaveLength(1);
    expect(captured.deletes[0].searchParams.get("id")).toBe("in.(a1,a2)");
  });

  it("does nothing when there is no aged soft-deleted row (no remove, no delete)", async () => {
    const { route, captured } = stubSweepWorld([]);
    stubFetch(route);

    await sweepDeletedAttachments(env);

    expect(captured.removes).toHaveLength(0);
    expect(captured.deletes).toHaveLength(0);
  });

  it("leaves the rows in place (retryable) when the Storage remove fails", async () => {
    const { route, captured } = stubSweepWorld(
      [{ id: "a1", storage_path: "co/note/o1/uuid-file.pdf" }],
      { removeFails: true },
    );
    stubFetch(route);

    await sweepDeletedAttachments(env);

    expect(captured.removes).toHaveLength(1);
    // Object removal failed → the row is NOT hard-deleted; next run retries.
    expect(captured.deletes).toHaveLength(0);
  });
});
