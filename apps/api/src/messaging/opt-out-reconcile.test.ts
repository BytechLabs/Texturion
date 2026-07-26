/**
 * #331 — the nightly comparison between our opt-out list and the carrier's.
 *
 * The two lists diverge in both directions by design, and only one direction
 * is a problem. What these pin is that the job knows which is which: a number
 * the carrier blocks and we do not know about is a STOP we dropped, and gets
 * recorded; a number only we hold is app-side enforcement working, and is left
 * exactly alone.
 */
import * as Sentry from "@sentry/cloudflare";
import { afterEach, describe, expect, it, vi } from "vitest";

import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { reconcileOptOuts } from "./opt-out-reconcile";

vi.mock("@sentry/cloudflare", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const PROFILE_ID = "profile-1";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

interface WorldOptions {
  companies?: Record<string, unknown>[];
  /** What Telnyx says it is blocking. */
  carrier?: Record<string, unknown>[];
  /** What we hold. */
  ours?: string[];
  carrierFails?: boolean;
  /** Pages of exactly 250 make the reader ask for another. */
  carrierPages?: Record<string, unknown>[][];
}

function world(options: WorldOptions = {}) {
  const sb = supabaseStub(env);
  sb.on("GET", "/rest/v1/companies", () =>
    options.companies ?? [
      { id: COMPANY_ID, name: "Acme Plumbing", telnyx_messaging_profile_id: PROFILE_ID },
    ],
  );
  sb.on("GET", "/rest/v1/opt_outs", () =>
    (options.ours ?? []).map((phone) => ({ phone_e164: phone })),
  );
  sb.on("PATCH", "/rest/v1/opt_outs", () => []);
  sb.on("POST", "/rest/v1/opt_outs", () => [{ id: "recorded" }]);
  sb.on("POST", "/rest/v1/conversation_events", () => []);
  sb.on("POST", "/rest/v1/audit_log", () => []);

  const carrierQueries: URL[] = [];
  const telnyxRoute: FetchRoute = (url) => {
    if (url.hostname !== "api.telnyx.com") return undefined;
    if (options.carrierFails) return new Response("nope", { status: 503 });
    carrierQueries.push(url);
    const page = Number(url.searchParams.get("page[number]") ?? "1");
    const data = options.carrierPages
      ? (options.carrierPages[page - 1] ?? [])
      : page === 1
        ? (options.carrier ?? [])
        : [];
    return Response.json({ data });
  };

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
    return Response.json({ id: "email_1" });
  };

  return {
    sb,
    routes: [telnyxRoute, resendRoute, sb.route],
    carrierQueries,
    emails,
  };
}

/** One carrier record: `from` is the CUSTOMER, `to` is our number. */
function carrierBlock(customer: string) {
  return {
    from: customer,
    to: "+16135550100",
    keyword: "STOP",
    created_at: "2026-07-20T10:00:00Z",
  };
}

describe("reconcileOptOuts (#331)", () => {
  it("records a number the carrier blocks that we had no record of", async () => {
    // The failure this exists for: an inbound STOP whose webhook we missed.
    // The thread looks live, the composer is open, and every send comes back
    // 40300 until somebody works out why.
    const { sb, routes } = world({
      carrier: [carrierBlock("+16135551000")],
      ours: [],
    });
    stubFetch(...routes);

    const summary = await reconcileOptOuts(env);

    expect(summary).toMatchObject({ companies: 1, recorded: 1, failed: 0 });
    expect(sb.find("POST", "/rest/v1/opt_outs")[0].body).toMatchObject({
      company_id: COMPANY_ID,
      phone_e164: "+16135551000",
      source: "carrier",
    });
    expect(
      sb.find("POST", "/rest/v1/conversation_events")[0].body,
    ).toMatchObject({
      type: "opted_out",
      conversation_id: null, // the inbound that carried the STOP is the one we never saw
      payload: { source: "carrier", signal: "reconciliation" },
    });
  });

  it("reads the CUSTOMER's number from the record, not our own", async () => {
    // An opt-out record describes the message that carried the STOP: from the
    // customer, to us. Reading it backwards would opt out the business's own
    // number and silence the whole workspace.
    const { sb, routes } = world({
      carrier: [carrierBlock("+16135551000")],
      ours: [],
    });
    stubFetch(...routes);
    await reconcileOptOuts(env);

    const recorded = sb.find("POST", "/rest/v1/opt_outs")[0].body as {
      phone_e164: string;
    };
    expect(recorded.phone_e164).toBe("+16135551000");
    expect(recorded.phone_e164).not.toBe("+16135550100");
  });

  it("never touches an opt-out only we hold", async () => {
    // Manual and imported opt-outs live app-side by design — Telnyx has no
    // write API. Deleting ours because theirs has no match would erase every
    // manual opt-out on every run.
    const { sb, routes, emails } = world({
      carrier: [],
      ours: ["+16135551000", "+16135551001"],
    });
    stubFetch(...routes);

    const summary = await reconcileOptOuts(env);

    expect(summary).toMatchObject({ recorded: 0, appSideOnly: 2 });
    expect(sb.find("POST", "/rest/v1/opt_outs")).toHaveLength(0);
    expect(sb.find("PATCH", "/rest/v1/opt_outs")).toHaveLength(0);
    // And a run where nothing is wrong sends nothing. A nightly "0" email is
    // one nobody reads by week three, including the one that says 47.
    expect(emails).toEqual([]);
  });

  it("says nothing about numbers both lists already agree on", async () => {
    const { sb, routes } = world({
      carrier: [carrierBlock("+16135551000")],
      ours: ["+16135551000"],
    });
    stubFetch(...routes);

    const summary = await reconcileOptOuts(env);
    expect(summary).toMatchObject({ recorded: 0, appSideOnly: 0 });
    expect(sb.find("POST", "/rest/v1/opt_outs")).toHaveLength(0);
  });

  it("emails ops, naming it as a webhook problem rather than a customer trend", async () => {
    const { routes, emails } = world({
      carrier: [carrierBlock("+16135551000"), carrierBlock("+16135551001")],
      ours: [],
    });
    stubFetch(...routes);

    await reconcileOptOuts(env);

    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toContain("2 missed by our webhook");
    expect(emails[0].text).toContain("Acme Plumbing");
    expect(emails[0].text).toContain("webhook-delivery problem");
  });

  it("keeps going when one workspace's carrier list cannot be read", async () => {
    const other = "9b1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
    const { routes } = world({
      companies: [
        { id: COMPANY_ID, name: "Acme", telnyx_messaging_profile_id: PROFILE_ID },
        { id: other, name: "Other", telnyx_messaging_profile_id: "profile-2" },
      ],
      carrierFails: true,
    });
    stubFetch(...routes);

    const summary = await reconcileOptOuts(env);

    expect(summary).toMatchObject({ companies: 2, failed: 2, recorded: 0 });
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("opt-out reconcile failed"),
      "error",
    );
  });

  it("pages, and reports a list too long to finish rather than pretending it read it all", async () => {
    // Silently stopping at the page limit would report "all clear" for a
    // workspace whose list was never fully read.
    const full = Array.from({ length: 250 }, (_, index) =>
      carrierBlock(`+1613555${String(index).padStart(4, "0")}`),
    );
    const { routes, carrierQueries, emails } = world({
      carrierPages: Array.from({ length: 25 }, () => full),
      ours: [],
    });
    stubFetch(...routes);

    const summary = await reconcileOptOuts(env);

    // Stops at the page ceiling rather than walking a vendor endpoint forever.
    expect(carrierQueries).toHaveLength(20);
    expect(summary.divergences[0].truncated).toBe(true);
    expect(emails[0].text).toContain("TRUNCATED");
  });

  it("asks only for live workspaces that have a messaging profile", async () => {
    const { sb, routes } = world();
    stubFetch(...routes);
    await reconcileOptOuts(env);

    const query = sb.find("GET", "/rest/v1/companies")[0].url.searchParams;
    expect(query.get("telnyx_messaging_profile_id")).toBe("not.is.null");
    expect(query.get("deleted_at")).toBe("is.null");
  });
});
