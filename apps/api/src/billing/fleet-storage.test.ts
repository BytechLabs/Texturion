import { afterEach, describe, expect, it, vi } from "vitest";

import { completeEnv, stubFetch } from "../test/support";
import {
  SUPABASE_INCLUDED_STORAGE_GB,
  checkFleetStorage,
  fleetStoredBytes,
} from "./fleet-storage";

/**
 * #240 item 2 — the tripwire that stands in for a tiering implementation.
 *
 * Supabase Storage supports neither lifecycle rules nor storage classes
 * (checked 2026-08-04), and production held 2 MB across 3 workspaces the same
 * day, so tiering would have meant onboarding a second storage vendor to move
 * nothing. What got built instead is the number that says when that answer
 * expires — and the thing worth testing about a tripwire is that it is silent
 * until it should not be.
 */
const env = completeEnv();
const GIB = 1024 ** 3;

function world(options: {
  fleetBytes?: number;
  readFails?: boolean;
}): { emails: { to: string[]; subject: string }[] } {
  const emails: { to: string[]; subject: string }[] = [];
  stubFetch(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/api_fleet_stored_bytes") {
      if (options.readFails) {
        return new Response(JSON.stringify({ message: "boom" }), { status: 500 });
      }
      return Response.json(options.fleetBytes ?? 0);
    }
    if (url.pathname === "/rest/v1/email_suppressions") {
      // #386: every send checks the address is reachable first. Nothing is
      // suppressed here — this test is about the tripwire, not deliverability.
      return Response.json([]);
    }
    if (url.host === "api.resend.com") {
      const body = (await request.clone().json()) as {
        to: string[];
        subject: string;
      };
      emails.push({ to: body.to, subject: body.subject });
      return Response.json({ id: "email-1" });
    }
    throw new Error(`Unstubbed fetch in test: ${url.href}`);
  });
  return { emails };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the fleet storage tripwire", () => {
  it("says nothing at all below the included allowance", () => {
    // The state this ships in, and the state it should stay in for a long
    // time: production measured 0.0009 GB on 2026-08-04. An ops alert that
    // fires when nothing is wrong is one nobody reads when something is.
    const { emails } = world({ fleetBytes: 2 * 1024 * 1024 });
    return checkFleetStorage(env).then(() => {
      expect(emails).toHaveLength(0);
    });
  });

  it("stays quiet right up to the line", async () => {
    // One byte under is under. The threshold is the point where a stored byte
    // starts costing money, not a safety margin around it.
    const { emails } = world({
      fleetBytes: SUPABASE_INCLUDED_STORAGE_GB * GIB - 1,
    });
    await checkFleetStorage(env);
    expect(emails).toHaveLength(0);
  });

  it("emails ops once the fleet is past what Supabase includes", async () => {
    const { emails } = world({
      fleetBytes: SUPABASE_INCLUDED_STORAGE_GB * GIB + 1,
    });
    await checkFleetStorage(env);
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toEqual(["support@loonext.com"]);
    expect(emails[0].subject).toContain("Fleet storage");
  });

  it("goes to ops and nobody else", async () => {
    // D34 made storage free to the CUSTOMER on purpose. This is our cost, and
    // telling a workspace owner about it would read as a bill they are about
    // to get — which is exactly the thing D34 took off the table.
    const { emails } = world({ fleetBytes: 500 * GIB });
    await checkFleetStorage(env);
    expect(emails.every((mail) => mail.to.length === 1)).toBe(true);
    expect(emails[0].to[0]).toBe("support@loonext.com");
  });

  it("throws rather than reporting zero when it cannot read", async () => {
    // A tripwire that answers "0 GB" on a failed read is worse than no
    // tripwire: it is a number somebody would trust.
    world({ readFails: true });
    await expect(fleetStoredBytes(env)).rejects.toThrow(/fleet storage read/);
  });
});
