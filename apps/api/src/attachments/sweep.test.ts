/**
 * Attachment orphan sweeper (D19 §2; #15/#16): four passes per run — reclaim
 * soft-deleted rows' objects + rows, garbage-collect row-less bucket objects
 * (#15 orphans), hard-delete object-less live rows (#15 ghosts), and drop aged
 * egress-ledger rows (#16 retention). Idempotent, batched; a per-object
 * failure leaves the work retryable and one broken pass never starves the
 * rest. Only the network edge (PostgREST + Storage) is stubbed.
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
  orphanScans: { p_cutoff: string; p_limit: number }[];
  ghostScans: { p_cutoff: string; p_limit: number }[];
  egressDeletes: URL[];
}

interface SweepWorldOptions {
  removeFails?: boolean;
  /** api_orphan_attachment_objects result (default none). */
  orphanPaths?: string[];
  /** api_ghost_attachment_rows result (default none). */
  ghostIds?: string[];
  /** Make the orphan-scan RPC itself fail (the other passes must still run). */
  orphanScanFails?: boolean;
}

/**
 * PostgREST + Storage double: the `attachments` GET returns `scanRows`, the
 * two #15 anti-join RPCs return the configured orphans/ghosts, Storage
 * remove()s and row/ledger DELETEs are captured. `removeFails` makes every
 * object-remove return an error (rows must then survive).
 */
function stubSweepWorld(
  scanRows: { id: string; storage_path: string }[],
  opts: SweepWorldOptions = {},
): { route: FetchRoute; captured: Captured } {
  const captured: Captured = {
    scans: [],
    removes: [],
    deletes: [],
    orphanScans: [],
    ghostScans: [],
    egressDeletes: [],
  };
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
    if (
      url.href.startsWith(
        `${env.SUPABASE_URL}/rest/v1/rpc/api_orphan_attachment_objects`,
      ) &&
      request.method === "POST"
    ) {
      return (async () => {
        const body = (await request.clone().json()) as Captured["orphanScans"][0];
        captured.orphanScans.push(body);
        if (opts.orphanScanFails) {
          return new Response(JSON.stringify({ message: "boom" }), {
            status: 500,
          });
        }
        return Response.json(opts.orphanPaths ?? []);
      })();
    }
    if (
      url.href.startsWith(
        `${env.SUPABASE_URL}/rest/v1/rpc/api_ghost_attachment_rows`,
      ) &&
      request.method === "POST"
    ) {
      return (async () => {
        const body = (await request.clone().json()) as Captured["ghostScans"][0];
        captured.ghostScans.push(body);
        return Response.json(opts.ghostIds ?? []);
      })();
    }
    if (
      url.href.startsWith(`${env.SUPABASE_URL}/rest/v1/egress_events`) &&
      request.method === "DELETE"
    ) {
      captured.egressDeletes.push(url);
      return Response.json([]);
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

describe("sweepDeletedAttachments (D19 §2; #15/#16)", () => {
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

  it("removes row-less bucket objects past the grace window (#15 orphan pass)", async () => {
    const { route, captured } = stubSweepWorld([], {
      orphanPaths: ["co/note/o9/uuid-orphan.png", "co/note/o9/uuid-orphan2.pdf"],
    });
    stubFetch(route);

    await sweepDeletedAttachments(env);

    // The anti-join scan carried the grace cutoff + batch bound…
    expect(captured.orphanScans).toHaveLength(1);
    expect(captured.orphanScans[0].p_limit).toBe(100);
    expect(new Date(captured.orphanScans[0].p_cutoff).getTime()).toBeLessThan(
      Date.now(),
    );
    // …and the orphans were removed via the Storage API in one batched call.
    expect(captured.removes).toHaveLength(1);
    expect(captured.removes[0].paths).toEqual([
      "co/note/o9/uuid-orphan.png",
      "co/note/o9/uuid-orphan2.pdf",
    ]);
  });

  it("hard-deletes object-less live rows (#15 ghost pass) — no Storage call needed", async () => {
    const { route, captured } = stubSweepWorld([], {
      ghostIds: ["g1", "g2"],
    });
    stubFetch(route);

    await sweepDeletedAttachments(env);

    expect(captured.ghostScans).toHaveLength(1);
    // No object exists for a ghost, so nothing goes to Storage…
    expect(captured.removes).toHaveLength(0);
    // …the rows are simply hard-deleted (releasing the budget they held).
    expect(captured.deletes).toHaveLength(1);
    expect(captured.deletes[0].searchParams.get("id")).toBe("in.(g1,g2)");
  });

  it("drops aged egress-ledger rows every run (#16 retention)", async () => {
    const { route, captured } = stubSweepWorld([]);
    stubFetch(route);

    await sweepDeletedAttachments(env);

    expect(captured.egressDeletes).toHaveLength(1);
    const cutoff = captured.egressDeletes[0].searchParams.get("created_at");
    expect(cutoff).toMatch(/^lt\./);
    // ~62 days back (two full billing periods).
    const cutoffMs = Date.now() - new Date(cutoff!.slice(3)).getTime();
    expect(cutoffMs).toBeGreaterThan(61 * 24 * 60 * 60 * 1000);
    expect(cutoffMs).toBeLessThan(63 * 24 * 60 * 60 * 1000);
  });

  it("one failing pass never starves the others; the run still fails loudly", async () => {
    const { route, captured } = stubSweepWorld([], {
      orphanScanFails: true,
      ghostIds: ["g1"],
    });
    stubFetch(route);

    await expect(sweepDeletedAttachments(env)).rejects.toThrow(
      /failed in 1 pass/,
    );
    // The ghost + retention passes still ran despite the orphan-scan failure.
    expect(captured.deletes).toHaveLength(1);
    expect(captured.egressDeletes).toHaveLength(1);
  });
});
