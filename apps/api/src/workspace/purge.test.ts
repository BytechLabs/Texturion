/**
 * #341 / D48 — the daily erasure sweep, phase 2.
 *
 * The teardown order itself is asserted in SQL (supabase/tests/purge_workspace.test.sql).
 * What these pin is the part the Worker owns: that a workspace's files leave
 * before the rows that point at them, that one stuck tenant cannot stop the
 * others, and that running out of budget resumes rather than half-finishing.
 */
import * as Sentry from "@sentry/cloudflare";
import { afterEach, describe, expect, it, vi } from "vitest";

import { supabaseStub, type SupabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { purgeClosedWorkspaces } from "./purge";

vi.mock("@sentry/cloudflare", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

interface WorldOptions {
  companies?: Record<string, unknown>[];
  /** Steps returned in order; the last repeats. */
  steps?: Record<string, unknown>[];
  attachments?: Record<string, string>[];
  storageFails?: boolean;
  /** #371: make the erasure receipt's send fail. */
  mailFails?: boolean;
}

function world(options: WorldOptions = {}): {
  sb: SupabaseStub;
  routes: FetchRoute[];
  removed: string[];
  emails: { to: string[]; subject: string; text: string }[];
} {
  const sb = supabaseStub(env);
  sb.on("GET", "/rest/v1/companies", () =>
    options.companies ?? [
      {
        id: COMPANY_ID,
        name: "Acme Plumbing",
        stripe_customer_id: "cus_1",
        purge_receipt_email: "owner@acme.test",
      },
    ],
  );
  const steps = options.steps ?? [{ step: null, deleted: 0, done: true }];
  let index = 0;
  sb.on("POST", "/rest/v1/rpc/purge_workspace_step", () => {
    const step = steps[Math.min(index, steps.length - 1)];
    index += 1;
    return step;
  });
  sb.on("POST", "/rest/v1/rpc/anonymize_purged_workspace", () => ({
    outcome: "anonymized",
  }));
  // Object sources: only `attachments` has anything unless told otherwise.
  sb.on("GET", "/rest/v1/message_attachments", () => []);
  sb.on("GET", "/rest/v1/attachments", () => options.attachments ?? []);
  sb.on("GET", "/rest/v1/calls", () => []);

  const removed: string[] = [];
  const storageRoute: FetchRoute = async (url, request) => {
    if (!url.pathname.startsWith("/storage/v1/object")) return undefined;
    if (options.storageFails) {
      return new Response(JSON.stringify({ message: "nope" }), { status: 500 });
    }
    const body = (await request.clone().json()) as { prefixes: string[] };
    removed.push(...body.prefixes);
    return Response.json(body.prefixes.map((name) => ({ name })));
  };
  const stripeRoute: FetchRoute = (url) =>
    url.hostname === "api.stripe.com"
      ? Response.json({ deleted: true })
      : undefined;

  const emails: { to: string[]; subject: string; text: string }[] = [];
  const resendRoute: FetchRoute = async (url, request) => {
    if (url.href !== "https://api.resend.com/emails") return undefined;
    emails.push(
      (await request.clone().json()) as {
        to: string[];
        subject: string;
        text: string;
      },
    );
    return options.mailFails
      ? new Response(JSON.stringify({ message: "boom" }), { status: 500 })
      : Response.json({ id: "email_1" });
  };

  // Storage first: the Supabase stub claims every URL on that origin,
  // /storage included, so it must not get the first look.
  return {
    sb,
    routes: [storageRoute, stripeRoute, resendRoute, sb.route],
    removed,
    emails,
  };
}

describe("purgeClosedWorkspaces", () => {
  it("takes the files out before the rows that point at them", async () => {
    // A teardown that deletes `attachments` first leaves a customer's photos in
    // a bucket with nothing pointing at them: unreachable, and undeleted.
    const { sb, routes, removed } = world({
      attachments: [{ storage_path: `${COMPANY_ID}/note/n1/photo.png` }],
      steps: [
        { step: "attachments", deleted: 1, done: false },
        { step: null, deleted: 0, done: true },
      ],
    });
    stubFetch(...routes);

    const summary = await purgeClosedWorkspaces(env);

    expect(removed).toContain(`${COMPANY_ID}/note/n1/photo.png`);
    expect(summary).toMatchObject({ workspaces: 1, completed: 1 });
    // The order is the point: the object left before the step that deletes it.
    const order = sb.calls.map((call) => call.path);
    const rowStep = order.indexOf("/rest/v1/rpc/purge_workspace_step");
    const pathRead = order.indexOf("/rest/v1/attachments");
    expect(pathRead).toBeGreaterThanOrEqual(0);
    expect(pathRead).toBeLessThan(rowStep);
  });

  it("stops rather than orphaning objects when Storage refuses", async () => {
    // Deleting the rows now would strand the files permanently. Leave both and
    // let tomorrow retry.
    const { sb, routes } = world({
      attachments: [{ storage_path: `${COMPANY_ID}/note/n1/photo.png` }],
      storageFails: true,
    });
    stubFetch(...routes);

    const summary = await purgeClosedWorkspaces(env);

    expect(summary).toMatchObject({ workspaces: 1, completed: 0 });
    expect(sb.find("POST", "/rest/v1/rpc/purge_workspace_step")).toHaveLength(0);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("workspace purge failed"),
      "error",
    );
  });

  it("anonymises the row once the rows are gone, and deletes the Stripe customer", async () => {
    const { sb, routes } = world();
    stubFetch(...routes);

    const summary = await purgeClosedWorkspaces(env);

    expect(summary.completed).toBe(1);
    expect(
      sb.find("POST", "/rest/v1/rpc/anonymize_purged_workspace")[0].body,
    ).toEqual({ p_company_id: COMPANY_ID });
  });

  it("keeps going when one workspace fails", async () => {
    // A stuck tenant must not stop the others, and every step is safely
    // repeatable tomorrow.
    const other = "9b1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
    const sb = supabaseStub(env);
    sb.on("GET", "/rest/v1/companies", () => [
      { id: COMPANY_ID, stripe_customer_id: null, purge_receipt_email: null },
      { id: other, stripe_customer_id: null, purge_receipt_email: null },
    ]);
    sb.on("GET", "/rest/v1/message_attachments", () => []);
    sb.on("GET", "/rest/v1/attachments", () => []);
    sb.on("GET", "/rest/v1/calls", () => []);
    sb.on("POST", "/rest/v1/rpc/purge_workspace_step", (call) =>
      (call.body as { p_company_id: string }).p_company_id === COMPANY_ID
        ? new Response(JSON.stringify({ message: "boom" }), { status: 500 })
        : { step: null, deleted: 0, done: true },
    );
    sb.on("POST", "/rest/v1/rpc/anonymize_purged_workspace", () => ({
      outcome: "anonymized",
    }));
    stubFetch(sb.route);

    const summary = await purgeClosedWorkspaces(env);

    expect(summary).toMatchObject({ workspaces: 2, completed: 1 });
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining(COMPANY_ID),
      "error",
    );
  });

  describe("the erasure receipt (#371)", () => {
    it("emails the confirmation once the workspace is actually erased", async () => {
      // The artefact a regulator asks for: proof the deletion was carried out,
      // and the date it finished.
      const { routes, emails } = world();
      stubFetch(...routes);

      const summary = await purgeClosedWorkspaces(
        env,
        new Date("2026-08-25T00:00:00Z"),
      );

      expect(summary).toMatchObject({ completed: 1, receiptsSent: 1 });
      expect(emails).toHaveLength(1);
      expect(emails[0].to).toEqual(["owner@acme.test"]);
      expect(emails[0].subject).toBe("Your Loonext data has been erased");
      expect(emails[0].text).toContain("Acme Plumbing");
      expect(emails[0].text).toContain("August 25, 2026");
      // Same two survivors as every other deletion surface.
      expect(emails[0].text).toContain("do-not-text list");
      expect(emails[0].text).toContain("three years");
    });

    it("reads the name and the address before the anonymise clears them", async () => {
      // The purge deletes `company_members` on its way through, and the
      // anonymise wipes the name and the address. Both have to be in hand
      // before either happens, which means reading them at the top of the run.
      const { sb, routes } = world();
      stubFetch(...routes);
      await purgeClosedWorkspaces(env);

      const columns = sb
        .find("GET", "/rest/v1/companies")[0]
        .url.searchParams.get("select");
      expect(columns).toContain("name");
      expect(columns).toContain("purge_receipt_email");
    });

    it("does not send twice, or before the erasure has finished", async () => {
      const { routes, emails } = world({
        steps: [{ step: "messages", deleted: 500, done: false }],
      });
      stubFetch(...routes);

      const summary = await purgeClosedWorkspaces(env);

      // Out of budget, not out of work: tomorrow resumes, and the customer is
      // told when it is actually done rather than when it started.
      expect(summary).toMatchObject({ completed: 0, receiptsSent: 0 });
      expect(emails).toEqual([]);
    });

    it("counts the erasure as complete even when the receipt cannot be sent", async () => {
      // The data is gone. A mail failure is ours to chase — re-running the
      // purge would not un-erase anything, and must not look like a failure.
      const { routes, emails } = world({ mailFails: true });
      stubFetch(...routes);

      const summary = await purgeClosedWorkspaces(env);

      expect(summary).toMatchObject({ completed: 1, receiptsSent: 0 });
      expect(emails).toHaveLength(1);
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining("deletion receipt not sent"),
        "error",
      );
    });
  });

  it("asks only for workspaces past their window that are not already erased", async () => {
    const { sb, routes } = world();
    stubFetch(...routes);
    await purgeClosedWorkspaces(env, new Date("2026-08-25T00:00:00Z"));

    const query = sb.find("GET", "/rest/v1/companies")[0].url.searchParams;
    expect(query.getAll("purge_after")).toContain("lte.2026-08-25T00:00:00.000Z");
    expect(query.get("purged_at")).toBe("is.null");
  });
});
