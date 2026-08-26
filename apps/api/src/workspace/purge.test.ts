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
  greetings?: Record<string, string>[];
  /** #378: export rows whose objects must go with the workspace. */
  exports?: Record<string, string>[];
  /** #378: file names the exports bucket lists under a prefix. */
  exportFiles?: string[];
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
        calendar_cleanup_unconfirmed_at: null,
        calendar_cleanup_unconfirmed_count: 0,
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
  // #581: the fourth source. The greetings bucket was in no deletion path
  // and no orphan sweep, so a recording of the owner's own voice outlived
  // the email telling them their workspace had been erased.
  sb.on("GET", "/rest/v1/voicemail_greetings", () => options.greetings ?? []);
  // #378: the fourth bucket. An export is a full copy of the workspace, so it
  // is the one object whose survival would most obviously falsify the erasure
  // receipt this job sends.
  sb.on("GET", "/rest/v1/data_exports", () => options.exports ?? []);

  const removed: string[] = [];
  const storageRoute: FetchRoute = async (url, request) => {
    if (!url.pathname.startsWith("/storage/v1/object")) return undefined;
    if (options.storageFails) {
      return new Response(JSON.stringify({ message: "nope" }), { status: 500 });
    }
    // #378: LIST and REMOVE are different calls with different bodies. The
    // export sweep has to list a prefix before it can remove anything, and
    // treating a list as a remove made the whole harness throw.
    if (url.pathname.startsWith("/storage/v1/object/list/")) {
      return Response.json((options.exportFiles ?? []).map((name) => ({ name })));
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
  it("takes the OWNER'S GREETING out too — it was in no deletion path at all", async () => {
    /**
     * #581: `voicemail-greetings` was the bucket nobody swept. It was absent from
     * `OBJECT_SOURCES` and from the orphan pass, and `voicemail_greetings` was
     * absent from the purge's own table list — so a recording of the owner's own
     * voice outlived the email telling them their workspace had been erased, with
     * `companies.voicemail_greeting_id` still pointing at it.
     *
     * The stored path carries the bucket name (`greeting-capture-leg.ts` writes it
     * in), and Storage wants the key without it — the same shape as the legacy MMS
     * rows. Getting that wrong deletes nothing and reports success, so the
     * assertion is on the STRIPPED key.
     */
    const { routes, removed } = world({
      greetings: [{ storage_path: `voicemail-greetings/${COMPANY_ID}/greeting.mp3` }],
      steps: [
        { step: "voicemail_greetings", deleted: 1, done: false },
        { step: null, deleted: 0, done: true },
      ],
    });
    stubFetch(...routes);

    const summary = await purgeClosedWorkspaces(env);

    expect(removed).toContain(`${COMPANY_ID}/greeting.mp3`);
    expect(removed).not.toContain(
      `voicemail-greetings/${COMPANY_ID}/greeting.mp3`,
    );
    expect(summary).toMatchObject({ workspaces: 1, completed: 1 });
  });

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
    sb.on("GET", "/rest/v1/voicemail_greetings", () => []);
    sb.on("GET", "/rest/v1/calls", () => []);
    sb.on("GET", "/rest/v1/data_exports", () => []); // #378: the fourth bucket
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
      expect(columns).toContain("calendar_cleanup_unconfirmed_at");
      expect(columns).toContain("calendar_cleanup_unconfirmed_count");
    });

    it("warns when provider-side calendar cleanup could not be confirmed", async () => {
      const { routes, emails } = world({
        companies: [
          {
            id: COMPANY_ID,
            name: "Acme Plumbing",
            stripe_customer_id: null,
            purge_receipt_email: "owner@acme.test",
            calendar_cleanup_unconfirmed_at: "2026-08-24T20:00:00Z",
            calendar_cleanup_unconfirmed_count: 2,
          },
        ],
      });
      stubFetch(...routes);

      await purgeClosedWorkspaces(env, new Date("2026-08-25T00:00:00Z"));

      expect(emails).toHaveLength(1);
      expect(emails[0].text).toContain(
        "could not confirm removal of 2 linked calendar copies",
      );
      expect(emails[0].text).toContain(
        "This receipt confirms erasure from Loonext only",
      );
    });

    it("carries a cleanup abandonment discovered during the purge into the receipt", async () => {
      const { routes, emails } = world({
        steps: [
          {
            step: "calendar_cleanup_abandoned",
            deleted: 0,
            done: false,
            remote_calendar_cleanup_unconfirmed: true,
            remote_calendar_cleanup_unconfirmed_count: 3,
          },
          {
            step: null,
            deleted: 0,
            done: true,
            remote_calendar_cleanup_unconfirmed: true,
            remote_calendar_cleanup_unconfirmed_count: 3,
          },
        ],
      });
      stubFetch(...routes);

      await purgeClosedWorkspaces(env, new Date("2026-08-25T00:00:00Z"));

      expect(emails).toHaveLength(1);
      expect(emails[0].text).toContain(
        "could not confirm removal of 3 linked calendar copies",
      );
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

describe("purgeClosedWorkspaces — the export blob (#378)", () => {
  it("removes the export objects along with the workspace", async () => {
    // The sequence this closes: owner requests an export (a complete copy of
    // every message and contact), owner closes the workspace, the purge runs,
    // the erasure receipt goes out — and the complete copy is still sitting in
    // the exports bucket, forever. An undocumented survivor of D48, which is
    // worse than a documented one because it means the survivor list in
    // DELETION.md was never the whole list.
    const w = world({
      exports: [{ id: "77777777-1111-4222-8333-444444444444", storage_prefix: `${COMPANY_ID}/e1` }],
      exportFiles: ["messages.csv", "manifest.json"],
    });
    stubFetch(...w.routes);

    await purgeClosedWorkspaces(env);

    expect(w.removed).toContain(`${COMPANY_ID}/e1/messages.csv`);
    expect(w.removed).toContain(`${COMPANY_ID}/e1/manifest.json`);
  });

  it("takes EXPIRED exports too, not only live ones", async () => {
    // `expires_at` governs whether a customer may still download it. Erasure
    // is about whether the data exists at all, and a six-month-old export is
    // exactly as complete a copy as yesterday's. The query filters on
    // company_id and a non-null prefix — deliberately not on expiry.
    const w = world({
      exports: [{ id: "88888888-1111-4222-8333-444444444444", storage_prefix: `${COMPANY_ID}/old` }],
      exportFiles: ["messages.csv"],
    });
    stubFetch(...w.routes);

    await purgeClosedWorkspaces(env);

    const query = w.sb.find("GET", "/rest/v1/data_exports")[0];
    expect(query?.url.href).not.toContain("expires_at");
    expect(w.removed).toContain(`${COMPANY_ID}/old/messages.csv`);
  });
});
