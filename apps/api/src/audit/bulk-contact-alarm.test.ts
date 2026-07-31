/**
 * #345 / #231 — the one proactive signal in the audit system.
 *
 * #231's reason for it: *"A contact export or mass delete is the
 * departing-employee signature."* Everything else in the audit log waits to be
 * read by somebody who already suspects something; this is the only thing that
 * goes and tells them.
 *
 * Which makes its two suppression rules the whole feature, not details:
 *
 *   - **The owner's own export is silent.** They just did it. An alarm that
 *     mostly reports the owner to themselves is one they filter, and then it is
 *     not there for the export that matters.
 *   - **Small reads are silent.** #231 asks that it not be "so chatty that a
 *     legitimate migration buries the one that matters", and a member exporting
 *     a handful of rows is somebody looking something up.
 *
 * And one rule that is about a different risk: this is the email in the product
 * most likely to be forwarded outside the workspace, so it says how many rows
 * moved and never which customers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import {
  alarmOnBulkContactAccess,
  BULK_CONTACT_ALARM_MIN_ROWS,
} from "./bulk-contact-alarm";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const OWNER_ID = "1f2e3d4c-5b6a-4798-8a9b-0c1d2e3f4a5b";
const MEMBER_ID = "2a3b4c5d-6e7f-4809-9a1b-2c3d4e5f6a7b";

afterEach(() => vi.unstubAllGlobals());

function world(ownerId = OWNER_ID) {
  const sb = supabaseStub(env);
  sb.on("GET", "/rest/v1/companies", () => [
    { id: COMPANY_ID, name: "Acme Plumbing", owner_user_id: ownerId },
  ]);
  sb.on("GET", /^\/auth\/v1\/admin\/users\//, (call) => ({
    id: call.url.pathname.split("/").pop(),
    email: call.url.pathname.endsWith(OWNER_ID)
      ? "owner@acme.test"
      : "tech@acme.test",
  }));
  const emails: Record<string, unknown>[] = [];
  const resend: FetchRoute = async (url, request) => {
    if (url.href !== "https://api.resend.com/emails") return undefined;
    emails.push((await request.clone().json()) as Record<string, unknown>);
    return Response.json({ id: "email_1" });
  };
  return { sb, emails, routes: [sb.route, resend] };
}

/** The route passes a Hono context; only `waitUntil` is reached for. */
function ctx(): {
  executionCtx: { waitUntil: (p: Promise<unknown>) => void };
  settled: () => Promise<void>;
} {
  const pending: Promise<unknown>[] = [];
  return {
    executionCtx: { waitUntil: (p) => void pending.push(p) },
    settled: async () => {
      await Promise.all(pending);
    },
  };
}

describe("who gets told", () => {
  it("emails the owner when somebody else takes the list", async () => {
    const w = world();
    stubFetch(...w.routes);
    const c = ctx();

    alarmOnBulkContactAccess(c, env, getDb(env), {
      companyId: COMPANY_ID,
      actorUserId: MEMBER_ID,
      event: "exported",
      count: 400,
    });
    await c.settled();

    expect(w.emails).toHaveLength(1);
    const email = w.emails[0] as { to: string[]; subject: string; text: string };
    expect(email.to).toEqual(["owner@acme.test"]);
    // The actor is named by EMAIL, not by display name: a display name is
    // editable by the person it describes, and this is the one message where
    // that matters.
    expect(email.text).toContain("tech@acme.test");
    expect(email.subject).toContain("400");
    // Where to look, not just that something happened.
    expect(email.text).toContain("/settings/history");
  });

  it("says nothing when the owner exports their own contacts", async () => {
    // The rule that keeps this channel worth reading. Fire on the owner's own
    // routine export and they will filter the alert within a month.
    const w = world();
    stubFetch(...w.routes);
    const c = ctx();

    alarmOnBulkContactAccess(c, env, getDb(env), {
      companyId: COMPANY_ID,
      actorUserId: OWNER_ID,
      event: "exported",
      count: 400,
    });
    await c.settled();

    expect(w.emails).toHaveLength(0);
  });

  it("says nothing about a handful of rows", async () => {
    const w = world();
    stubFetch(...w.routes);
    const c = ctx();

    alarmOnBulkContactAccess(c, env, getDb(env), {
      companyId: COMPANY_ID,
      actorUserId: MEMBER_ID,
      event: "exported",
      count: BULK_CONTACT_ALARM_MIN_ROWS - 1,
    });
    await c.settled();

    expect(w.emails).toHaveLength(0);
  });

  it("fires exactly at the threshold", async () => {
    const w = world();
    stubFetch(...w.routes);
    const c = ctx();

    alarmOnBulkContactAccess(c, env, getDb(env), {
      companyId: COMPANY_ID,
      actorUserId: MEMBER_ID,
      event: "exported",
      count: BULK_CONTACT_ALARM_MIN_ROWS,
    });
    await c.settled();

    expect(w.emails).toHaveLength(1);
  });

  it("#497: a full workspace export always tells the owner, count or not", async () => {
    // The louder of the two export paths had only the quiet half: a member
    // downloading a filtered CSV emailed the owner, while an admin requesting
    // EVERYTHING the business holds wrote a log row and nothing else.
    //
    // count: 0 on purpose — the export is built asynchronously and has no row
    // count at request time. The threshold is about telling a lookup from a
    // theft, and a workspace export is never a lookup.
    const w = world();
    stubFetch(...w.routes);
    const c = ctx();

    alarmOnBulkContactAccess(c, env, getDb(env), {
      companyId: COMPANY_ID,
      actorUserId: MEMBER_ID,
      event: "workspace_exported",
      count: 0,
    });
    await c.settled();

    expect(w.emails).toHaveLength(1);
    const mail = w.emails[0] as { subject: string; text: string };
    expect(mail.subject).toContain("full export");
    // Says what happened, never how much or which customers.
    expect(mail.text).toContain("full export of this workspace");
    expect(mail.text).not.toContain("0 contacts");
  });

  it("#497: still says nothing when the owner exports the workspace themselves", async () => {
    // The discipline that keeps the alarm worth reading: an alert that mostly
    // reports the owner to themselves is one they filter.
    const w = world();
    stubFetch(...w.routes);
    const c = ctx();

    alarmOnBulkContactAccess(c, env, getDb(env), {
      companyId: COMPANY_ID,
      actorUserId: OWNER_ID,
      event: "workspace_exported",
      count: 0,
    });
    await c.settled();

    expect(w.emails).toHaveLength(0);
  });

  it("names a bulk delete as a delete", async () => {
    // Deleting the list and downloading it are different events with the same
    // signature, and an owner reading the subject line needs to know which.
    const w = world();
    stubFetch(...w.routes);
    const c = ctx();

    alarmOnBulkContactAccess(c, env, getDb(env), {
      companyId: COMPANY_ID,
      actorUserId: MEMBER_ID,
      event: "bulk_deleted",
      count: 90,
    });
    await c.settled();

    const email = w.emails[0] as { subject: string; text: string };
    expect(email.subject).toContain("deleted");
    expect(email.text).toContain("deleted 90 contacts");
  });
});

describe("it cannot take the action down with it", () => {
  it("swallows a mail failure", async () => {
    // The export already happened and already has its audit row. A Resend
    // outage must not turn a successful download into an error.
    const w = world();
    const failing: FetchRoute = (url) =>
      url.href === "https://api.resend.com/emails"
        ? new Response("nope", { status: 500 })
        : undefined;
    stubFetch(w.sb.route, failing);
    const c = ctx();

    alarmOnBulkContactAccess(c, env, getDb(env), {
      companyId: COMPANY_ID,
      actorUserId: MEMBER_ID,
      event: "exported",
      count: 400,
    });

    await expect(c.settled()).resolves.toBeUndefined();
  });

  it("returns without waiting, so an export is never slower for it", () => {
    // The reason this is `waitUntil` and not `await`: a company read, two auth
    // lookups and a Resend call in front of the first byte of a CSV somebody is
    // waiting on.
    const w = world();
    stubFetch(...w.routes);
    const c = ctx();

    const result = alarmOnBulkContactAccess(c, env, getDb(env), {
      companyId: COMPANY_ID,
      actorUserId: MEMBER_ID,
      event: "exported",
      count: 400,
    });

    expect(result).toBeUndefined();
  });
});
