/**
 * #284 — what the enforcement job must never get wrong.
 *
 * The eligibility rules live in SQL and are pinned by
 * supabase/tests/retention_enforce.test.sql, deliberately: a bug in this file
 * must not be able to route around legal hold or the notice precondition. What
 * is left for this suite is the part the Worker owns and SQL cannot enforce —
 * the ORDER of operations, which is the difference between deleted data and a
 * bucket full of files nobody can reach.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
import { runRetentionEnforceJob } from "./retention-enforce";

vi.mock("@sentry/cloudflare", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const env = completeEnv();
const COMPANY = "cccccccc-0000-4000-8000-00000000000c";
const OLD_MESSAGE = "11111111-0000-4000-8000-000000000011";

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A workspace with one overdue message carrying one MMS attachment, and an
 * ordered log of everything the job did to storage and to rows.
 */
function world(options: { removeFails?: boolean } = {}) {
  const sb = supabaseStub(env);
  const order: string[] = [];
  let batches = 0;

  sb.on("POST", "/rest/v1/rpc/api_retention_overdue_companies", () => [
    { company_id: COMPANY, window_days: 90, message_count: 1, oldest_at: "2026-01-01T00:00:00Z" },
  ]);
  sb.on("POST", "/rest/v1/rpc/api_retention_overdue_messages", () => {
    // The rows are gone after the first pass, so the second read is empty —
    // which is how the job knows to stop, and what makes it resumable.
    batches += 1;
    order.push(`batch:${batches}`);
    return batches === 1 ? [{ message_id: OLD_MESSAGE }] : [];
  });
  sb.on("GET", "/rest/v1/message_attachments", () => [
    { storage_path: "mms-media/co/msg/photo.jpg" },
  ]);
  sb.on("GET", "/rest/v1/attachments", () => []);
  sb.on("POST", "/rest/v1/rpc/api_voicemail_audio_overdue", () => []);
  sb.on("POST", "/rest/v1/rpc/api_retention_overdue_calls", () => []);
  sb.on("DELETE", "/rest/v1/messages", () => {
    order.push("delete:messages");
    return [];
  });

  const storage = async (url: URL) => {
    if (!url.pathname.includes("/storage/v1/object/")) return undefined;
    order.push("remove:objects");
    return options.removeFails
      ? Response.json({ message: "bucket unavailable" }, { status: 500 })
      : Response.json([{ name: "photo.jpg" }]);
  };

  return { sb, order, routes: [storage, sb.route] };
}

describe("retention enforcement", () => {
  it("clears the storage objects BEFORE the rows that point at them", async () => {
    // The rows carry the paths. Deleting them first strands a customer's
    // photos in a bucket: unreachable, unbilled to anyone, and undeleted —
    // the #378 bug, except on a schedule and against live customers.
    const w = world();
    stubFetch(...w.routes);

    const summary = await runRetentionEnforceJob(env, new Date(), undefined);

    expect(w.order.indexOf("remove:objects")).toBeLessThan(
      w.order.indexOf("delete:messages"),
    );
    expect(summary.messagesDeleted).toBe(1);
    expect(summary.objectsRemoved).toBe(1);
  });

  it("strips the legacy bucket prefix before asking Storage to remove", async () => {
    // Older MMS rows store `mms-media/<key>` (SPEC §6) while Storage wants the
    // key alone. Sending the prefixed path removes nothing and reports success.
    const w = world();
    let removed: unknown = null;
    stubFetch(async (url, request) => {
      if (!url.pathname.includes("/storage/v1/object/")) return undefined;
      removed = await request.clone().json();
      return Response.json([]);
    }, w.sb.route);

    await runRetentionEnforceJob(env, new Date(), undefined);

    expect(removed).toEqual({ prefixes: ["co/msg/photo.jpg"] });
  });

  it("keeps the rows when Storage refuses, so the next run can retry", async () => {
    // The rows are the only remaining pointer to those objects. Deleting them
    // after a failed remove strands the files permanently, so the job fails
    // loudly and leaves both in place instead.
    const w = world({ removeFails: true });
    stubFetch(...w.routes);

    await expect(
      runRetentionEnforceJob(env, new Date(), undefined),
    ).rejects.toThrow(/workspace\(s\) failed/);

    expect(w.order).not.toContain("delete:messages");
  });

  it("stops when the batch comes back empty rather than looping its ceiling", async () => {
    // Resumability rests on the database state being the cursor: each pass
    // re-reads, and an empty read is the end. A job that kept asking would
    // spend its whole per-run budget on a workspace with nothing left.
    const w = world();
    stubFetch(...w.routes);

    await runRetentionEnforceJob(env, new Date(), undefined);

    expect(w.order.filter((step) => step.startsWith("batch:"))).toEqual([
      "batch:1",
      "batch:2",
    ]);
  });

  it("does nothing at all when no workspace is eligible", async () => {
    // The ordinary day, and the one that must stay cheap: every guard lives in
    // the RPC, so an empty answer means no reads and no deletes.
    const sb = supabaseStub(env);
    sb.on("POST", "/rest/v1/rpc/api_retention_overdue_companies", () => []);
    sb.on("POST", "/rest/v1/rpc/api_voicemail_audio_overdue", () => []);
    sb.on("POST", "/rest/v1/rpc/api_retention_overdue_calls", () => []);
    stubFetch(sb.route);

    const summary = await runRetentionEnforceJob(env, new Date(), undefined);

    expect(summary).toEqual({
      companies: 0,
      messagesDeleted: 0,
      objectsRemoved: 0,
      voicemailsCleared: 0,
      callsDeleted: 0,
    });
  });
});

describe("voicemail audio retention", () => {
  /**
   * The one-year window legal/privacy publishes for recordings, which nothing
   * enforced. It runs on its OWN clock — independent of the workspace's message
   * window — because the promise is to the caller who left the message.
   */
  function voicemailWorld(options: { removeFails?: boolean } = {}) {
    const sb = supabaseStub(env);
    const order: string[] = [];
    let scans = 0;

    sb.on("POST", "/rest/v1/rpc/api_retention_overdue_calls", () => []);
    sb.on("POST", "/rest/v1/rpc/api_retention_overdue_companies", () => []);
    sb.on("POST", "/rest/v1/rpc/api_voicemail_audio_overdue", () => {
      scans += 1;
      return scans === 1
        ? [{ call_id: "call-1", company_id: COMPANY, voicemail_path: "vm/old.mp3" }]
        : [];
    });
    sb.on("PATCH", "/rest/v1/calls", (call) => {
      order.push(`clear:${JSON.stringify(call.body)}`);
      return [];
    });

    const storage = async (url: URL) => {
      if (!url.pathname.includes("/storage/v1/object/")) return undefined;
      order.push("remove:audio");
      return options.removeFails
        ? Response.json({ message: "gone" }, { status: 500 })
        : Response.json([{ name: "old.mp3" }]);
    };
    return { sb, order, routes: [storage, sb.route] };
  }

  it("removes the audio and then nulls BOTH columns that pointed at it", async () => {
    // Leaving the path set would leave a player aimed at a file that is gone —
    // which reads as a bug rather than a policy — and would make every later
    // run try to remove it again.
    //
    // BOTH columns, because the two surfaces disagree about which one means "there
    // is a voicemail": the calls LIST draws its player from `voicemail_seconds`, and
    // the detail route derives `has_voicemail` from `voicemail_path`. This cleared
    // only the path, so the list kept a play button — on web and on Android — for
    // audio deleted a moment earlier. The other sweep already clears both and its
    // docblock says why; one rule written twice, and this was the copy that was
    // wrong. It would first have gone off around July 2027.
    //
    // The old version of this test asserted `toContain('"voicemail_path":null')`,
    // which is true of the broken behaviour as well — a substring check on the field
    // that WAS being cleared can never see the field that was not.
    const w = voicemailWorld();
    stubFetch(...w.routes);

    const summary = await runRetentionEnforceJob(env, new Date(), undefined);

    expect(summary.voicemailsCleared).toBe(1);
    expect(w.order[0]).toBe("remove:audio");
    const clear = w.order[1] ?? "";
    expect(clear.startsWith("clear:")).toBe(true);
    expect(JSON.parse(clear.slice("clear:".length))).toEqual({
      voicemail_path: null,
      voicemail_seconds: null,
    });
  });

  it("keeps the path when Storage refuses, so the audio is never stranded", async () => {
    const w = voicemailWorld({ removeFails: true });
    stubFetch(...w.routes);

    await expect(
      runRetentionEnforceJob(env, new Date(), undefined),
    ).rejects.toThrow(/failed/);

    expect(w.order.some((step) => step.startsWith("clear:"))).toBe(false);
  });

  it("ages audio out even when no workspace has overdue messages", async () => {
    // The two clocks are independent: a workspace inside its seven-year message
    // window still has recordings past their year. Sharing one eligibility
    // query would have silently tied the published promise to the configurable
    // one.
    const w = voicemailWorld();
    stubFetch(...w.routes);

    const summary = await runRetentionEnforceJob(env, new Date(), undefined);

    expect(summary.companies).toBe(0);
    expect(summary.messagesDeleted).toBe(0);
    expect(summary.voicemailsCleared).toBe(1);
  });
});

describe("the two voicemail pointers are cleared together, everywhere", () => {
  it("no sweep clears one field and leaves the other", () => {
    /**
     * The shape, not the instance. Two independent jobs age voicemail audio out — this
     * one on the published one-year promise, and `attachments/sweep.ts` on rows whose
     * object has already gone — and each writes the same clear. One of them cleared
     * only `voicemail_path`, so the calls LIST kept a play button (it reads
     * `voicemail_seconds`) for audio that had just been deleted.
     *
     * A third job, or a fourth, will be written the same way. This is what makes the
     * pairing structural instead of remembered: any update that nulls one must null the
     * other, wherever it lives.
     */
    const apiSrc = join(import.meta.dirname, "..").replaceAll("\\", "/");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry).replaceAll("\\", "/");
        if (statSync(full).isDirectory()) return walk(full);
        return /\.ts$/.test(full) && !/\.test\.ts$/.test(full) ? [full] : [];
      });

    const offenders: string[] = [];
    let clears = 0;
    for (const file of walk(apiSrc)) {
      const body = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
      // Every `.update({ … })` object that mentions nulling either pointer.
      for (const match of body.matchAll(/\.update\(\{[^}]*voicemail_(?:path|seconds)[^}]*\}/g)) {
        const object = match[0];
        if (!/voicemail_path:\s*null/.test(object)) continue;
        clears += 1;
        if (!/voicemail_seconds:\s*null/.test(object)) {
          offenders.push(`${file}: ${object.replace(/\s+/g, " ").slice(0, 90)}`);
        }
      }
    }

    // Loud rather than vacuous: if the shape of these writes changes, this stops
    // matching anything and would pass forever.
    expect(clears, "found no voicemail pointer clears at all — this check is inert").toBeGreaterThanOrEqual(2);
    expect(
      offenders,
      "these null `voicemail_path` without `voicemail_seconds`. The calls list draws " +
        "its player from seconds and the detail route derives has_voicemail from the " +
        "path, so clearing one leaves a play button that 404s on exactly one screen.",
    ).toEqual([]);
  });
});

describe("call record retention", () => {
  /**
   * Calls follow the WORKSPACE window — they are the business's own record of
   * its own work — while the recording keeps its fixed year. Same table, two
   * clocks, which is the thing most likely to get collapsed by a later
   * refactor.
   */
  function callWorld(voicemailPath: string | null = null) {
    const sb = supabaseStub(env);
    const order: string[] = [];
    let scans = 0;

    sb.on("POST", "/rest/v1/rpc/api_retention_overdue_companies", () => [
      { company_id: COMPANY, window_days: 2555, message_count: 1, oldest_at: "2019-01-01T00:00:00Z" },
    ]);
    sb.on("POST", "/rest/v1/rpc/api_retention_overdue_messages", () => []);
    sb.on("POST", "/rest/v1/rpc/api_voicemail_audio_overdue", () => []);
    sb.on("POST", "/rest/v1/rpc/api_retention_overdue_calls", () => {
      scans += 1;
      return scans === 1
        ? [{ call_id: "call-1", call_session_id: "sess-1", voicemail_path: voicemailPath }]
        : [];
    });
    for (const table of [
      "call_records",
      "call_member_legs",
      "outbound_call_authorizations",
      "calls",
    ]) {
      sb.on("DELETE", `/rest/v1/${table}`, () => {
        order.push(table);
        return [];
      });
    }
    return { sb, order };
  }

  it("deletes every sibling row before the call they hang off", async () => {
    // Nothing carries a foreign key to `calls`, so nothing cascades. Taking the
    // parent first would leave a customer's call legs behind forever — present,
    // unreachable, and counted by no retention policy.
    const w = callWorld();
    stubFetch(w.sb.route);

    const summary = await runRetentionEnforceJob(env, new Date(), undefined);

    expect(summary.callsDeleted).toBe(1);
    expect(w.order).toEqual([
      "call_records",
      "call_member_legs",
      "outbound_call_authorizations",
      "calls",
    ]);
  });

  it("takes a recording the one-year sweep never managed to clear", async () => {
    // Normally already null — seven years is well past one — so this only
    // fires when that sweep has been failing. Leaving it would strand the most
    // sensitive object in the product with its row gone.
    // Passed in rather than re-registered: the stub harness is first-match-
    // wins, so a second `on()` for a path already registered never runs.
    const w = callWorld("vm/stuck.mp3");
    let removed: unknown = null;
    stubFetch(async (url, request) => {
      if (!url.pathname.includes("/storage/v1/object/")) return undefined;
      removed = await request.clone().json();
      return Response.json([]);
    }, w.sb.route);

    await runRetentionEnforceJob(env, new Date(), undefined);

    expect(removed).toEqual({ prefixes: ["vm/stuck.mp3"] });
  });
});
