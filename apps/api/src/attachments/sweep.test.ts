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
import { MMS_BUCKET } from "../messaging/media";
import { VOICEMAILS_BUCKET } from "../messaging/inbound-ring";
import { ATTACHMENTS_BUCKET } from "../routes/core/attachments";
import { EXPORTS_BUCKET } from "../workspace/export";
import { SWEEP_BATCH, SWEEP_GRACE_MS, sweepDeletedAttachments } from "./sweep";

const env = completeEnv();

afterEach(() => vi.unstubAllGlobals());

interface Captured {
  scans: URL[];
  removes: { bucket: string; paths: string[] }[];
  deletes: URL[];
  orphanScans: { p_cutoff: string; p_limit: number }[];
  ghostScans: { p_cutoff: string; p_limit: number }[];
  egressDeletes: URL[];
  /** #263: the mms-media anti-joins and the row deletes they drive. */
  mmsOrphanScans: { p_cutoff: string; p_limit: number }[];
  mmsGhostScans: { p_cutoff: string; p_limit: number }[];
  mmsRowDeletes: URL[];
  /** #479: the two buckets that had no reclamation at all. */
  vmOrphanScans: { p_cutoff: string; p_limit: number }[];
  vmGhostScans: { p_cutoff: string; p_limit: number }[];
  exportOrphanScans: { p_cutoff: string; p_limit: number }[];
  /** The PATCH that clears a call's voicemail pointer (never a DELETE). */
  callPatches: { url: URL; body: Record<string, unknown> }[];
  /** #240: every api_attachment_paths_in_use body the sweep sent. */
  inUseChecks: { p_paths: string[] }[];
}

interface SweepWorldOptions {
  removeFails?: boolean;
  /** api_orphan_attachment_objects result (default none). */
  orphanPaths?: string[];
  /** api_ghost_attachment_rows result (default none). */
  ghostIds?: string[];
  /** Make the orphan-scan RPC itself fail (the other passes must still run). */
  orphanScanFails?: boolean;
  /** #263: api_orphan_mms_media_objects result (default none). */
  mmsOrphanPaths?: string[];
  /** #263: api_ghost_mms_media_rows result (default none). */
  mmsGhostIds?: string[];
  /** #479: api_orphan_voicemail_objects result (default none). */
  voicemailOrphanPaths?: string[];
  /** #479: api_ghost_voicemail_calls result (default none). */
  voicemailGhostIds?: string[];
  /** #479: api_orphan_export_objects result (default none). */
  exportOrphanPaths?: string[];
  /**
   * #240: api_attachment_paths_in_use result — the object paths a LIVE row
   * still points at, which the sweep must NOT reclaim. Default none, which is
   * the world every test written before dedup was against.
   */
  pathsInUse?: string[];
  /** Make the in-use check itself fail: the pass must refuse to reclaim. */
  inUseCheckFails?: boolean;
}

/**
 * PostgREST + Storage double: the `attachments` GET returns `scanRows`, the
 * two #15 anti-join RPCs return the configured orphans/ghosts, Storage
 * remove()s and row/ledger DELETEs are captured. `removeFails` makes every
 * object-remove return an error (rows must then survive).
 */
function stubSweepWorld(
  // #240: `preview_path` optional so the pre-dedup fixtures still read as
  // the world they were written for — a row with one object.
  scanRows: { id: string; storage_path: string; preview_path?: string | null }[],
  opts: SweepWorldOptions = {},
): { route: FetchRoute; captured: Captured } {
  const captured: Captured = {
    scans: [],
    removes: [],
    deletes: [],
    orphanScans: [],
    ghostScans: [],
    egressDeletes: [],
    mmsOrphanScans: [],
    mmsGhostScans: [],
    mmsRowDeletes: [],
    vmOrphanScans: [],
    vmGhostScans: [],
    exportOrphanScans: [],
    callPatches: [],
    inUseChecks: [],
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
        `${env.SUPABASE_URL}/rest/v1/rpc/api_attachment_paths_in_use`,
      ) &&
      request.method === "POST"
    ) {
      return (async () => {
        const body = (await request.clone().json()) as { p_paths: string[] };
        captured.inUseChecks.push(body);
        if (opts.inUseCheckFails) {
          return new Response(JSON.stringify({ message: "boom" }), { status: 500 });
        }
        return Response.json(opts.pathsInUse ?? []);
      })();
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
    // #263: the mms-media pair. Separate RPC names and a separate bucket, so
    // nothing here can be satisfied by the attachments-bucket stubs above —
    // which is the whole point: those passes never touched this bucket.
    if (
      url.href.startsWith(
        `${env.SUPABASE_URL}/rest/v1/rpc/api_orphan_mms_media_objects`,
      ) &&
      request.method === "POST"
    ) {
      return (async () => {
        const body = (await request.clone().json()) as Captured["orphanScans"][0];
        captured.mmsOrphanScans.push(body);
        return Response.json(opts.mmsOrphanPaths ?? []);
      })();
    }
    if (
      url.href.startsWith(
        `${env.SUPABASE_URL}/rest/v1/rpc/api_ghost_mms_media_rows`,
      ) &&
      request.method === "POST"
    ) {
      return (async () => {
        const body = (await request.clone().json()) as Captured["ghostScans"][0];
        captured.mmsGhostScans.push(body);
        return Response.json(opts.mmsGhostIds ?? []);
      })();
    }
    if (
      url.href.startsWith(`${env.SUPABASE_URL}/rest/v1/message_attachments`) &&
      request.method === "DELETE"
    ) {
      captured.mmsRowDeletes.push(url);
      return Response.json([]);
    }
    if (
      url.href.includes(`/storage/v1/object/${MMS_BUCKET}`) &&
      request.method === "DELETE"
    ) {
      return (async () => {
        const body = (await request.clone().json()) as { prefixes: string[] };
        captured.removes.push({ bucket: MMS_BUCKET, paths: body.prefixes });
        if (opts.removeFails) {
          return new Response(JSON.stringify({ error: "boom", message: "boom" }), {
            status: 500,
          });
        }
        return Response.json(body.prefixes.map((p) => ({ name: p })));
      })();
    }
    // #479: the voicemails and exports buckets. Distinct RPC names and
    // distinct buckets, so nothing above can accidentally satisfy them — the
    // point being that neither bucket was ever swept at all.
    if (
      url.href.startsWith(
        `${env.SUPABASE_URL}/rest/v1/rpc/api_orphan_voicemail_objects`,
      ) &&
      request.method === "POST"
    ) {
      return (async () => {
        const body = (await request.clone().json()) as Captured["orphanScans"][0];
        captured.vmOrphanScans.push(body);
        return Response.json(opts.voicemailOrphanPaths ?? []);
      })();
    }
    if (
      url.href.startsWith(
        `${env.SUPABASE_URL}/rest/v1/rpc/api_ghost_voicemail_calls`,
      ) &&
      request.method === "POST"
    ) {
      return (async () => {
        const body = (await request.clone().json()) as Captured["ghostScans"][0];
        captured.vmGhostScans.push(body);
        return Response.json(opts.voicemailGhostIds ?? []);
      })();
    }
    if (
      url.href.startsWith(
        `${env.SUPABASE_URL}/rest/v1/rpc/api_orphan_export_objects`,
      ) &&
      request.method === "POST"
    ) {
      return (async () => {
        const body = (await request.clone().json()) as Captured["orphanScans"][0];
        captured.exportOrphanScans.push(body);
        return Response.json(opts.exportOrphanPaths ?? []);
      })();
    }
    if (
      url.href.startsWith(`${env.SUPABASE_URL}/rest/v1/calls`) &&
      request.method === "PATCH"
    ) {
      return (async () => {
        const body = (await request.clone().json()) as Record<string, unknown>;
        captured.callPatches.push({ url, body });
        return Response.json([]);
      })();
    }
    if (
      (url.href.includes(`/storage/v1/object/${VOICEMAILS_BUCKET}`) ||
        url.href.includes(`/storage/v1/object/${EXPORTS_BUCKET}`)) &&
      request.method === "DELETE"
    ) {
      return (async () => {
        const body = (await request.clone().json()) as { prefixes: string[] };
        const bucket = url.href.includes(VOICEMAILS_BUCKET)
          ? VOICEMAILS_BUCKET
          : EXPORTS_BUCKET;
        captured.removes.push({ bucket, paths: body.prefixes });
        if (opts.removeFails) {
          return new Response(JSON.stringify({ error: "boom", message: "boom" }), {
            status: 500,
          });
        }
        return Response.json(body.prefixes.map((p) => ({ name: p })));
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

  /**
   * #240 — a row has two objects, and an object can belong to several rows.
   *
   * This pass used to be "one row, one object, delete it". Both halves of that
   * stopped being true: previews gave a row a second object, and dedup lets one
   * object serve several rows in the same company. Getting it wrong deletes
   * somebody else's photo in another thread, and it surfaces weeks later from a
   * customer as "the app lost my picture".
   */
  describe("reclaiming an object that might not be exclusively theirs", () => {
    it("takes the preview with the original", async () => {
      const { route, captured } = stubSweepWorld([
        {
          id: "a1",
          storage_path: "co/note/o1/uuid-roof.jpg",
          preview_path: "co/note/o1/preview-uuid-roof.jpg",
        },
      ]);
      stubFetch(route);

      await sweepDeletedAttachments(env);

      expect(captured.removes[0].paths).toEqual([
        "co/note/o1/uuid-roof.jpg",
        "co/note/o1/preview-uuid-roof.jpg",
      ]);
    });

    it("spares an object a LIVE row still points at, and deletes the row anyway", async () => {
      // The dedup case: two attachments in one company share one object, and
      // one of them is deleted. The bookkeeping is not what survives — the ROW
      // is still hard-deleted — it is the bytes the other row is rendering.
      const { route, captured } = stubSweepWorld(
        [
          {
            id: "a1",
            storage_path: "co/note/o1/uuid-spec.pdf",
            preview_path: null,
          },
          {
            id: "a2",
            storage_path: "co/note/o2/uuid-other.pdf",
            preview_path: null,
          },
        ],
        { pathsInUse: ["co/note/o1/uuid-spec.pdf"] },
      );
      stubFetch(route);

      await sweepDeletedAttachments(env);

      expect(captured.removes[0].paths).toEqual(["co/note/o2/uuid-other.pdf"]);
      expect(captured.deletes[0].searchParams.get("id")).toBe("in.(a1,a2)");
    });

    it("asks about both objects on the row, not just the original", async () => {
      // A shared preview is as real as a shared original — dedup reuses the
      // pair. Asking about only one of them would reclaim the other from under
      // whoever is still using it.
      const { route, captured } = stubSweepWorld([
        {
          id: "a1",
          storage_path: "co/note/o1/uuid-roof.jpg",
          preview_path: "co/note/o1/preview-uuid-roof.jpg",
        },
      ]);
      stubFetch(route);

      await sweepDeletedAttachments(env);

      expect(captured.inUseChecks[0].p_paths).toEqual([
        "co/note/o1/uuid-roof.jpg",
        "co/note/o1/preview-uuid-roof.jpg",
      ]);
    });

    it("removes nothing at all when every object is spoken for", async () => {
      // An empty remove() is not the same as a remove([]) — Storage would
      // treat the latter as a call worth making, and a batched delete with no
      // paths is the kind of thing an SDK version bump turns into "delete all".
      const { route, captured } = stubSweepWorld(
        [{ id: "a1", storage_path: "co/note/o1/uuid-spec.pdf", preview_path: null }],
        { pathsInUse: ["co/note/o1/uuid-spec.pdf"] },
      );
      stubFetch(route);

      await sweepDeletedAttachments(env);

      expect(captured.removes).toHaveLength(0);
      // The row still goes: it is deleted, and its object simply belongs to
      // somebody else now.
      expect(captured.deletes[0].searchParams.get("id")).toBe("in.(a1)");
    });

    it("refuses to reclaim anything when it cannot find out", async () => {
      // Reclaiming on an unknown answer is the one mistake here that destroys
      // data. The pass fails, the rows stay soft-deleted, and the next run
      // tries again — which is exactly what a retryable sweep is for.
      const { route, captured } = stubSweepWorld(
        [{ id: "a1", storage_path: "co/note/o1/uuid-spec.pdf", preview_path: null }],
        { inUseCheckFails: true },
      );
      stubFetch(route);

      await expect(sweepDeletedAttachments(env)).rejects.toThrow();
      expect(captured.removes).toHaveLength(0);
      expect(captured.deletes).toHaveLength(0);
    });
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

describe("#263 — the mms-media bucket gets both anti-joins too", () => {
  // The bug was an ABSENCE: api_orphan_attachment_objects and
  // api_ghost_attachment_rows both hardcode bucket_id = 'attachments', so a
  // crashed MMS send left objects nothing could ever find. These pin that the
  // mms pair runs on every sweep, against the right bucket and table.

  it("scans both mms directions on every run, with the same grace cutoff", async () => {
    const { route, captured } = stubSweepWorld([]);
    stubFetch(route);
    await sweepDeletedAttachments(env);

    expect(captured.mmsOrphanScans).toHaveLength(1);
    expect(captured.mmsGhostScans).toHaveLength(1);
    // Same window as the attachments passes: longer than any Worker request, so
    // the gap between an upload and its row insert is never swept.
    expect(captured.mmsOrphanScans[0].p_limit).toBe(SWEEP_BATCH);
    expect(
      Date.now() - Date.parse(captured.mmsOrphanScans[0].p_cutoff),
    ).toBeGreaterThanOrEqual(SWEEP_GRACE_MS);
    expect(captured.mmsGhostScans[0].p_cutoff).toBe(
      captured.mmsOrphanScans[0].p_cutoff,
    );
  });

  it("removes row-less mms objects from the mms bucket, not the attachments one", async () => {
    // The bucket matters: removing these paths from `attachments` would delete
    // nothing and report success, which is how an absent sweep looks like a
    // working one.
    const { route, captured } = stubSweepWorld([], {
      mmsOrphanPaths: ["co/msg/0", "co/msg/1"],
    });
    stubFetch(route);
    await sweepDeletedAttachments(env);

    const mmsRemoves = captured.removes.filter((r) => r.bucket === MMS_BUCKET);
    expect(mmsRemoves).toHaveLength(1);
    expect(mmsRemoves[0].paths).toEqual(["co/msg/0", "co/msg/1"]);
  });

  it("hard-deletes object-less message_attachments rows", async () => {
    // The worse direction: these are summed into mms_bytes, so they over-report
    // the customer's storage, and a retry mints a signed URL Telnyx 404s on.
    const { route, captured } = stubSweepWorld([], {
      mmsGhostIds: ["11111111-2222-4333-8444-555555555555"],
    });
    stubFetch(route);
    await sweepDeletedAttachments(env);

    expect(captured.mmsRowDeletes).toHaveLength(1);
    expect(captured.mmsRowDeletes[0].searchParams.get("id")).toContain(
      "11111111-2222-4333-8444-555555555555",
    );
    // No object exists, so there is nothing to remove from Storage.
    expect(captured.removes.filter((r) => r.bucket === MMS_BUCKET)).toEqual([]);
  });

  it("leaves mms rows alone when there is nothing to reclaim", async () => {
    const { route, captured } = stubSweepWorld([]);
    stubFetch(route);
    await sweepDeletedAttachments(env);

    expect(captured.mmsRowDeletes).toEqual([]);
    expect(captured.removes.filter((r) => r.bucket === MMS_BUCKET)).toEqual([]);
  });

  it("still runs the mms passes when an earlier pass throws", async () => {
    // One broken arm must never starve the others — and the mms passes are LAST
    // in the array, so they are exactly what a fail-fast loop would skip.
    const { route, captured } = stubSweepWorld([], {
      orphanScanFails: true,
      mmsGhostIds: ["11111111-2222-4333-8444-555555555555"],
    });
    stubFetch(route);

    await expect(sweepDeletedAttachments(env)).rejects.toThrow();
    expect(captured.mmsOrphanScans).toHaveLength(1);
    expect(captured.mmsRowDeletes).toHaveLength(1);
  });
});


describe("#479 — the two buckets nothing ever reclaimed", () => {
  it("removes voicemail objects that no call points at", async () => {
    // A recording is pulled into our bucket and the Telnyx copy DELETED, so
    // ours is the only one. Before this pass, an object whose calls-row stamp
    // failed was unreachable by every read path and billed forever — and it is
    // a stranger's recorded voice, not just bytes.
    const { route, captured } = stubSweepWorld([], {
      voicemailOrphanPaths: ["co/vm-1.mp3", "co/vm-2.mp3"],
    });
    stubFetch(route);

    await sweepDeletedAttachments(env);

    expect(captured.vmOrphanScans).toHaveLength(1);
    expect(
      captured.removes.find((r) => r.bucket === VOICEMAILS_BUCKET)?.paths,
    ).toEqual(["co/vm-1.mp3", "co/vm-2.mp3"]);
  });

  it("CLEARS the pointer on a ghost voicemail rather than deleting the call", async () => {
    // The assertion this whole pass exists to protect. Every other ghost pass
    // hard-deletes its row, because those rows only describe an object. A
    // `calls` row is a record that somebody phoned this business, and it
    // outlives its audio — deleting it would erase the call from the customer's
    // history to tidy up a storage pointer.
    const { route, captured } = stubSweepWorld([], {
      voicemailGhostIds: ["call-1", "call-2"],
    });
    stubFetch(route);

    await sweepDeletedAttachments(env);

    expect(captured.vmGhostScans).toHaveLength(1);
    expect(captured.callPatches).toHaveLength(1);
    // BOTH fields, because the two surfaces disagree about which one means
    // "there is a voicemail": the list draws its player from voicemail_seconds
    // and the detail route derives has_voicemail from voicemail_path. Clearing
    // one leaves a play button that 404s on exactly one screen.
    expect(captured.callPatches[0].body).toEqual({
      voicemail_path: null,
      voicemail_seconds: null,
    });
    // And the transcript is NOT touched: it is the words of a customer who
    // rang, and the only remaining record of what they wanted.
    expect(captured.callPatches[0].body).not.toHaveProperty("voicemail_transcript");
  });

  it("removes export objects with no live row", async () => {
    // The worst orphan in the product: an export is a copy of every message,
    // contact and note a workspace holds, and #378's reaper is driven entirely
    // by the data_exports row. Lose the row and nothing ever looks again.
    const { route, captured } = stubSweepWorld([], {
      exportOrphanPaths: ["co/export-9/messages.csv"],
    });
    stubFetch(route);

    await sweepDeletedAttachments(env);

    expect(captured.exportOrphanScans).toHaveLength(1);
    expect(
      captured.removes.find((r) => r.bucket === EXPORTS_BUCKET)?.paths,
    ).toEqual(["co/export-9/messages.csv"]);
  });

  it("still runs the new passes when an earlier one fails", async () => {
    // One broken arm never starves the others — the rule the module already
    // followed, now covering the three passes added last.
    const { route, captured } = stubSweepWorld([], {
      orphanScanFails: true,
      voicemailOrphanPaths: ["co/vm-1.mp3"],
      exportOrphanPaths: ["co/export-9/messages.csv"],
    });
    stubFetch(route);

    await expect(sweepDeletedAttachments(env)).rejects.toThrow();

    expect(captured.vmOrphanScans).toHaveLength(1);
    expect(captured.exportOrphanScans).toHaveLength(1);
  });
});
