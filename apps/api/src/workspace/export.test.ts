/**
 * #227 — building a workspace's data export.
 *
 * The acceptance criterion that matters is "completes for a large workspace
 * without blowing the Worker limits; it is a queued job, not a request", so
 * what these pin is the machinery that makes that true: pages, a per-run
 * budget, resumption at the table it stopped on, and a manifest that lands
 * only when the export is whole.
 */
import * as Sentry from "@sentry/cloudflare";
import { afterEach, describe, expect, it, vi } from "vitest";

import { supabaseStub, type SupabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { buildDataExports, pruneExpiredExports } from "./export";

vi.mock("@sentry/cloudflare", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const EXPORT_ID = "77777777-1111-4222-8333-444444444444";
const USER_ID = "0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** Every table the export walks, so an unstubbed read never fails a test. */
const TABLES = [
  "contacts",
  "conversations",
  "messages",
  "tasks",
  "calls",
  "templates",
  "tags",
  "opt_outs",
  "attachments",
  "message_attachments",
];

interface WorldOptions {
  queue?: Record<string, unknown>[];
  /** Rows returned for this table, once; every other table is empty. */
  rowsFor?: { table: string; rows: Record<string, unknown>[] };
  uploadFails?: boolean;
}

function world(options: WorldOptions = {}): {
  sb: SupabaseStub;
  routes: FetchRoute[];
  uploaded: string[];
} {
  const sb = supabaseStub(env);
  sb.on("GET", "/rest/v1/data_exports", () =>
    options.queue ?? [
      {
        id: EXPORT_ID,
        company_id: COMPANY_ID,
        requested_by: USER_ID,
        storage_prefix: null,
        completed_tables: [],
        row_counts: {},
      },
    ],
  );
  sb.on("PATCH", "/rest/v1/data_exports", () => []);
  sb.on("POST", "/rest/v1/rpc/record_export_table", () => null);
  for (const table of TABLES) {
    sb.on("GET", `/rest/v1/${table}`, () =>
      options.rowsFor?.table === table ? options.rowsFor.rows : [],
    );
  }
  sb.on("GET", /^\/auth\/v1\/admin\/users\//, () => ({
    id: USER_ID,
    email: "owner@crew.example",
  }));

  const uploaded: string[] = [];
  // Storage first: the Supabase stub claims every URL on that origin.
  const storageRoute: FetchRoute = (url) => {
    if (!url.pathname.startsWith("/storage/v1/object")) return undefined;
    if (options.uploadFails) {
      return new Response(JSON.stringify({ message: "nope" }), { status: 500 });
    }
    uploaded.push(url.pathname.replace("/storage/v1/object/exports/", ""));
    return Response.json({ Key: url.pathname });
  };
  const resendRoute: FetchRoute = (url) =>
    url.hostname === "api.resend.com" ? Response.json({ id: "email-1" }) : undefined;

  return { sb, routes: [storageRoute, resendRoute, sb.route], uploaded };
}

describe("buildDataExports", () => {
  it("writes a file per table and lands the manifest last", async () => {
    const { sb, routes, uploaded } = world({
      rowsFor: { table: "messages", rows: [{ id: "m-1", body: "hi" }] },
    });
    stubFetch(...routes);

    const summary = await buildDataExports(env);

    expect(summary).toMatchObject({ exports: 1, completed: 1 });
    expect(uploaded).toContain(`${COMPANY_ID}/${EXPORT_ID}/messages-0001.jsonl`);
    // The manifest is the "this export is whole" marker, so it goes last.
    expect(uploaded[uploaded.length - 1]).toBe(
      `${COMPANY_ID}/${EXPORT_ID}/manifest.json`,
    );
    // Every table is recorded, including the empty ones — a reader has to be
    // able to tell "no contacts" from "contacts were skipped".
    expect(sb.find("POST", "/rest/v1/rpc/record_export_table")).toHaveLength(
      TABLES.length,
    );
  });

  it("skips the tables a previous run finished", async () => {
    // Resumption is the whole reason this is a job: an interrupted run must
    // pick up where it stopped rather than rewriting from the start.
    const { sb, routes } = world({
      queue: [
        {
          id: EXPORT_ID,
          company_id: COMPANY_ID,
          requested_by: USER_ID,
          storage_prefix: `${COMPANY_ID}/${EXPORT_ID}`,
          completed_tables: ["contacts", "conversations", "messages"],
          row_counts: { contacts: 4, conversations: 2, messages: 9 },
        },
      ],
    });
    stubFetch(...routes);

    await buildDataExports(env);

    expect(sb.find("GET", "/rest/v1/contacts")).toHaveLength(0);
    expect(sb.find("GET", "/rest/v1/messages")).toHaveLength(0);
    expect(sb.find("GET", "/rest/v1/tasks")).toHaveLength(1);
    // And the finished tables keep their counts in the manifest.
    expect(sb.find("POST", "/rest/v1/rpc/record_export_table")).toHaveLength(
      TABLES.length - 3,
    );
  });

  it("tells the customer when it fails instead of leaving them waiting", async () => {
    // Someone is waiting on a legal right. An export that dies silently is
    // worse than one that says it failed.
    const { sb, routes } = world({ uploadFails: true });
    stubFetch(...routes);

    const summary = await buildDataExports(env);

    expect(summary.completed).toBe(0);
    const failed = sb
      .find("PATCH", "/rest/v1/data_exports")
      .map((call) => call.body as { status?: string })
      .filter((body) => body.status === "failed");
    expect(failed).toHaveLength(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("data export failed"),
      "error",
    );
  });

  it("emails the person who asked, and a failed email does not un-finish it", async () => {
    const { sb, routes } = world();
    // Resend down: the export IS ready and visible in settings.
    const failing: FetchRoute[] = [
      routes[0],
      (url) =>
        url.hostname === "api.resend.com"
          ? new Response("nope", { status: 500 })
          : undefined,
      sb.route,
    ];
    stubFetch(...failing);

    const summary = await buildDataExports(env);

    expect(summary.completed).toBe(1);
    const ready = sb
      .find("PATCH", "/rest/v1/data_exports")
      .map((call) => call.body as { status?: string })
      .filter((body) => body.status === "ready");
    expect(ready).toHaveLength(1);
  });

  it("asks only for exports still owed work", async () => {
    const { sb, routes } = world();
    stubFetch(...routes);
    await buildDataExports(env);

    const query = sb.find("GET", "/rest/v1/data_exports")[0].url.searchParams;
    expect(query.get("status")).toBe("in.(pending,running)");
  });
});


/**
 * #378 — the export outlived the deletion.
 *
 * The completion email promises the download links are good for seven days
 * "after which the export is deleted". That was enforced only as an ACCESS
 * check: past `expires_at` the API refused to sign a URL and the object stayed
 * in the bucket forever. Every export ever built, for every workspace,
 * including workspaces that no longer existed.
 *
 * An export is a full copy of every message and contact a workspace holds, so
 * these are about the difference between invisible and gone.
 */
describe("pruneExpiredExports (#378)", () => {
  /** A storage double that records what was listed and what was removed. */
  function storageWorld(files: string[]) {
    const removed: string[][] = [];
    const route: FetchRoute = async (url, request) => {
      if (url.pathname === "/storage/v1/object/list/exports") {
        return Response.json(files.map((name) => ({ name })));
      }
      if (url.pathname === "/storage/v1/object/exports" && request.method === "DELETE") {
        const body = (await request.clone().json()) as { prefixes: string[] };
        removed.push(body.prefixes);
        return Response.json([]);
      }
      return undefined;
    };
    return { removed, route };
  }

  function world(rows: Record<string, unknown>[], files: string[]) {
    const sb = supabaseStub(env);
    const stamped: Record<string, unknown>[] = [];
    sb.on("GET", "/rest/v1/data_exports", () => rows);
    sb.on("PATCH", "/rest/v1/data_exports", (call) => {
      stamped.push(call.body as Record<string, unknown>);
      return [];
    });
    const storage = storageWorld(files);
    return { sb, stamped, removed: storage.removed, routes: [storage.route, sb.route] };
  }

  const NOW = new Date("2026-07-28T12:00:00Z");

  it("deletes the objects behind an expired export", async () => {
    const w = world(
      [{ id: EXPORT_ID, storage_prefix: `${COMPANY_ID}/${EXPORT_ID}` }],
      ["messages.csv", "contacts.csv", "manifest.json"],
    );
    stubFetch(...w.routes);

    const result = await pruneExpiredExports(env, NOW);

    expect(result).toEqual({ reaped: 1, objectsRemoved: 3 });
    expect(w.removed[0]).toEqual([
      `${COMPANY_ID}/${EXPORT_ID}/messages.csv`,
      `${COMPANY_ID}/${EXPORT_ID}/contacts.csv`,
      `${COMPANY_ID}/${EXPORT_ID}/manifest.json`,
    ]);
  });

  it("stamps the row AFTER the objects are gone, never before", async () => {
    // Stamping first would leave a row that reads as reaped while a full copy
    // of the workspace sits in the bucket — the exact shape of the bug this
    // job exists to fix, reintroduced one layer down.
    const sb = supabaseStub(env);
    const stamped: Record<string, unknown>[] = [];
    sb.on("GET", "/rest/v1/data_exports", () => [
      { id: EXPORT_ID, storage_prefix: `${COMPANY_ID}/${EXPORT_ID}` },
    ]);
    sb.on("PATCH", "/rest/v1/data_exports", (call) => {
      stamped.push(call.body as Record<string, unknown>);
      return [];
    });
    stubFetch(async (url, request) => {
      if (url.pathname === "/storage/v1/object/list/exports") {
        return Response.json([{ name: "messages.csv" }]);
      }
      if (url.pathname === "/storage/v1/object/exports" && request.method === "DELETE") {
        return new Response("storage is down", { status: 500 });
      }
      return undefined;
    }, sb.route);

    const result = await pruneExpiredExports(env, NOW);

    expect(result.reaped).toBe(0);
    expect(stamped).toHaveLength(0);
    // Loud, so a bucket that quietly stops accepting deletes is not a silent
    // retention policy.
    expect(Sentry.captureMessage).toHaveBeenCalled();
  });

  it("keeps the ROW, because a customer should see they asked for one", async () => {
    const w = world(
      [{ id: EXPORT_ID, storage_prefix: `${COMPANY_ID}/${EXPORT_ID}` }],
      ["messages.csv"],
    );
    stubFetch(...w.routes);

    await pruneExpiredExports(env, NOW);

    // reaped_at, not a delete. The row is the record of a request; the blob
    // was the data.
    expect(w.stamped[0]).toHaveProperty("reaped_at");
    expect(w.sb.find("DELETE", "/rest/v1/data_exports")).toHaveLength(0);
  });

  it("one stuck export does not stop the rest", async () => {
    const sb = supabaseStub(env);
    let listCalls = 0;
    sb.on("GET", "/rest/v1/data_exports", () => [
      { id: "11111111-1111-4111-8111-111111111111", storage_prefix: "a/1" },
      { id: "22222222-2222-4222-8222-222222222222", storage_prefix: "b/2" },
    ]);
    sb.on("PATCH", "/rest/v1/data_exports", () => []);
    stubFetch(async (url, request) => {
      if (url.pathname === "/storage/v1/object/list/exports") {
        listCalls += 1;
        // The first one is broken; the second must still be reclaimed.
        if (listCalls === 1) return new Response("nope", { status: 500 });
        return Response.json([{ name: "messages.csv" }]);
      }
      if (url.pathname === "/storage/v1/object/exports" && request.method === "DELETE") {
        return Response.json([]);
      }
      return undefined;
    }, sb.route);

    const result = await pruneExpiredExports(env, NOW);

    expect(result.reaped).toBe(1);
  });

  it("does nothing when nothing is expired", async () => {
    const w = world([], []);
    stubFetch(...w.routes);

    expect(await pruneExpiredExports(env, NOW)).toEqual({ reaped: 0, objectsRemoved: 0 });
    expect(w.removed).toHaveLength(0);
  });
});
