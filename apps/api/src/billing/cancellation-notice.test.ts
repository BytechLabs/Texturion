/**
 * #421 — the owner learns a person chose to cancel.
 *
 * A portal cancellation starts an irreversible clock: `grace.ts` releases the
 * number 30 days later, and a released number goes back to the carrier and is
 * given to another business (#413). Until now that happened with no notice to
 * the person who owns the number.
 *
 * The two things that decide whether this channel is worth having: it fires on
 * the MOMENT of cancellation and not on the twenty updates that repeat it, and
 * it can never take the subscription mirror down with it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch, type FetchRoute } from "../test/support";
import { isNewCancellation, noticeCancellation } from "./cancellation-notice";

const env = completeEnv();
const COMPANY_ID = "8a1b3c5d-7e9f-4a2b-8c4d-6e8f0a2b4c6d";
const OWNER_ID = "1f2e3d4c-5b6a-4798-8a9b-0c1d2e3f4a5b";

afterEach(() => {
  vi.unstubAllGlobals();
});

const subscription = {
  id: "sub_1",
  cancel_at_period_end: true,
  items: { data: [{ current_period_end: Math.floor(Date.parse("2026-08-30T00:00:00Z") / 1000) }] },
} as never;

function priorState(row: Record<string, unknown> | null) {
  const sb = supabaseStub(env);
  sb.on("GET", "/rest/v1/companies", () => (row ? [row] : []));
  // #252: the notice now also pushes, which reads the owner/admin audience.
  sb.on("GET", "/rest/v1/company_members", () => []);
  return sb;
}

describe("is this the moment, or a restatement of it?", () => {
  it("fires when we did not previously hold a cancellation", async () => {
    const sb = priorState({ cancel_at_period_end: false });
    stubFetch(sb.route);

    await expect(
      isNewCancellation(getDb(env), "sub_1", subscription, "active"),
    ).resolves.toBe(true);
  });

  it("stays quiet when we already knew", async () => {
    // Stripe re-sends customer.subscription.updated for many reasons and each
    // one carries the same flag. Without this the owner gets an identical
    // email every time the card is touched, and learns to ignore the one that
    // mattered.
    const sb = priorState({ cancel_at_period_end: true });
    stubFetch(sb.route);

    await expect(
      isNewCancellation(getDb(env), "sub_1", subscription, "active"),
    ).resolves.toBe(false);
  });

  it("stays quiet on a subscription that is already dead", async () => {
    // A canceled subscription is #21's backstop territory, not a fresh choice.
    const sb = priorState({ cancel_at_period_end: false });
    stubFetch(sb.route);

    await expect(
      isNewCancellation(getDb(env), "sub_1", subscription, "canceled"),
    ).resolves.toBe(false);
  });

  it("stays quiet when nothing is being cancelled at all", async () => {
    const sb = priorState({ cancel_at_period_end: false });
    stubFetch(sb.route);

    await expect(
      isNewCancellation(
        getDb(env),
        "sub_1",
        { ...(subscription as object), cancel_at_period_end: false } as never,
        "active",
      ),
    ).resolves.toBe(false);
  });
});

describe("the notice itself", () => {
  function world(options: { audienceFails?: boolean } = {}) {
    const sb = supabaseStub(env);
    // #252: the audience read the push does. Recorded HERE rather than
    // overridden per test — the harness is first-match-wins, so a second
    // handler for this path registered later never runs.
    const audiences: URL[] = [];
    sb.on("GET", "/rest/v1/company_members", (call) => {
      audiences.push(call.url);
      return options.audienceFails
        ? new Response(JSON.stringify({ message: "boom" }), { status: 500 })
        : [];
    });
    const audits: Record<string, unknown>[] = [];
    sb.on("POST", "/rest/v1/audit_log", (call) => {
      audits.push(call.body as Record<string, unknown>);
      return [];
    });
    sb.on("GET", /^\/auth\/v1\/admin\/users\//, () => ({
      id: OWNER_ID,
      email: "owner@acme.test",
    }));
    const emails: Record<string, unknown>[] = [];
    const resend: FetchRoute = async (url, request) => {
      if (url.href !== "https://api.resend.com/emails") return undefined;
      emails.push((await request.clone().json()) as Record<string, unknown>);
      return Response.json({ id: "email_1" });
    };
    return { sb, audits, audiences, emails, routes: [sb.route, resend] };
  }

  const company = { id: COMPANY_ID, name: "Acme Plumbing", owner_user_id: OWNER_ID };

  /**
   * #252 — belt and braces on the notice with the most runway left.
   *
   * CP-2 is the one to read twice. The push runs AFTER the email and swallows
   * its own failure, because the email has already gone: throwing would tell
   * the caller a delivered warning was undelivered, and on the ledgered grace
   * paths it would refuse to resend on the next sweep too.
   */
  it("CP-1: it pushes to the people who can act on it", async () => {
    const w = world();
    stubFetch(...w.routes);

    await noticeCancellation(env, getDb(env), company, subscription);

    expect(w.audiences).toHaveLength(1);
    // Owners and admins only. A member cannot undo a cancellation, and waking
    // somebody at a job about a deadline they cannot resolve is how a crew
    // learns to swipe our notifications away.
    expect(w.audiences[0].search).toContain("role=in.%28owner%2Cadmin%29");
    expect(w.audiences[0].search).toContain("deactivated_at=is.null");
  });

  it("CP-2: a push failure never claims the email did not go", async () => {
    const w = world({ audienceFails: true });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch(...w.routes);

    await expect(
      noticeCancellation(env, getDb(env), company, subscription),
    ).resolves.not.toThrow();
    // And the email still went, which is the claim the resolve is standing in
    // for — a silently swallowed email would also "not throw".
    expect(w.emails).toHaveLength(1);

    // SWALLOWED IS NOT SILENT. Found by breaking it: deleting the audience
    // read's error check left `data` empty, so the push simply never happened
    // and nothing said so. A push that stops working for every workspace, with
    // no log, is indistinguishable from one nobody has needed yet.
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toMatch(/consequential push failed/);
    logged.mockRestore();
  });

  it("tells the owner what release actually means", async () => {
    // #413: "your subscription ends" does not convey that the number goes to
    // somebody else. The number is the asset the business put on its vans.
    const w = world();
    stubFetch(...w.routes);

    await noticeCancellation(env, getDb(env), company, subscription);

    expect(w.emails).toHaveLength(1);
    const email = w.emails[0] as { to: string[]; subject: string; text: string };
    expect(email.to).toEqual(["owner@acme.test"]);
    expect(email.text).toContain("given to another business");
    // And that it is undoable, which is the only actionable thing in it.
    expect(email.text).toContain("undo");
    // And why they got it, since it may not have been them.
    expect(email.text).toContain("Admins can manage");
  });

  it("records it in the log that cannot be rewritten", async () => {
    const w = world();
    stubFetch(...w.routes);

    await noticeCancellation(env, getDb(env), company, subscription);

    expect(w.audits).toHaveLength(1);
    expect(w.audits[0]).toMatchObject({
      action: "billing.cancellation_scheduled",
      // Stripe's hosted portal does not tell us which member clicked, and
      // naming the owner would accuse somebody who may not have done it.
      actor_user_id: null,
    });
  });

  it("never lets a failed email break the subscription mirror", async () => {
    // The mirror is the truth of the account. This is a courtesy on top of it,
    // and a courtesy that can take the truth down is not worth having.
    stubFetch(async () => new Response("everything is down", { status: 500 }));

    await expect(
      noticeCancellation(env, getDb(env), company, subscription),
    ).resolves.toBeUndefined();
  });
});
