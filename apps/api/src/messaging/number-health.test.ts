/**
 * #235 — the alerting half, and the read that must never break the app.
 *
 * The SQL decides *whether* a number is degraded (`number_reputation.test.sql`
 * pins that, including the false-alarm cases). What is asserted here is the
 * judgement about people: that a known-bad number does not mail us every
 * morning, that recovery is reported too, and that a reputation lookup can
 * never take down the numbers list — which the composer's "text from" picker
 * reads, so a failure there would stop somebody texting a customer.
 */
import { describe, expect, it, vi } from "vitest";

import type { Env } from "../env";
import { loadNumberHealth } from "./number-health-read";
import { runNumberHealthJob } from "./number-health";

const env = { OPS_ALERT_EMAIL: "ops@test.local" } as unknown as Env;

/** A db stub whose rpc answers with `data`, plus captured email sends. */
function stub(data: unknown, fail = false) {
  const rpc = vi.fn(async () =>
    fail ? { data: null, error: { message: "boom" } } : { data, error: null },
  );
  return { db: { rpc } as never, rpc };
}

const transition = (over: Record<string, unknown> = {}) => ({
  phone_number_id: "n1",
  company_id: "c1",
  number_e164: "+14165550001",
  was: "healthy",
  state: "degraded",
  delivery_rate: 0.54,
  baseline_rate: 0.97,
  detail: "delivery 54% against a baseline of 97%",
  ...over,
});

describe("runNumberHealthJob", () => {
  it("sends nothing when no number changed state", async () => {
    // The common morning. A known-bad number is not news, and mailing about it
    // daily is how the mailbox stops being read.
    const sent = vi.fn();
    vi.stubGlobal("fetch", sent);
    const { db } = stub([]);

    const rows = await runNumberHealthJob(env, new Date(0), db);

    expect(rows).toEqual([]);
    expect(sent).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("names the number, the fall, and the baseline it fell from", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      return Response.json({ id: "e1" });
    });
    const { db } = stub([transition()]);

    await runNumberHealthJob(env, new Date(0), db);

    const body = bodies.join("");
    expect(body).toContain("+14165550001");
    expect(body).toContain("54%");
    // Without the baseline, "54%" is not obviously bad — some numbers live
    // there. The comparison is the whole claim.
    expect(body).toContain("97%");
    vi.unstubAllGlobals();
  });

  it("says in the subject when a customer can see it", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      return Response.json({ id: "e1" });
    });
    const { db } = stub([transition()]);

    await runNumberHealthJob(env, new Date(0), db);

    expect(bodies.join("")).toContain("DEGRADED");
    vi.unstubAllGlobals();
  });

  it("reports a recovery, because it is the only proof a fix worked", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      return Response.json({ id: "e1" });
    });
    const { db } = stub([transition({ was: "degraded", state: "healthy" })]);

    await runNumberHealthJob(env, new Date(0), db);

    const body = bodies.join("");
    expect(body).toContain("recovered");
    // And it must not read as an alarm.
    expect(body).not.toContain("DEGRADED");
    vi.unstubAllGlobals();
  });

  it("throws when the assessment itself fails, so the cron reports broken", async () => {
    // Opposite posture to the read below: this is a job, and a job that fails
    // silently is exactly what the liveness ledger exists to catch.
    const { db } = stub(null, true);
    await expect(runNumberHealthJob(env, new Date(0), db)).rejects.toThrow(/assessment failed/);
  });
});

describe("loadNumberHealth", () => {
  it("returns only degraded numbers", async () => {
    const { db } = stub([
      { phone_number_id: "n1", state: "degraded", delivery_rate: 0.5, degraded_since: "x", detail: "d" },
      { phone_number_id: "n2", state: "healthy", delivery_rate: 0.99, degraded_since: null, detail: null },
    ]);

    const map = await loadNumberHealth(db, "c1");

    expect(map.has("n1")).toBe(true);
    // A healthy entry would be noise on the wire and one more thing three
    // clients have to ignore identically.
    expect(map.has("n2")).toBe(false);
  });

  it("returns an empty map when the lookup fails, never throwing", async () => {
    // THE property. This decorates the numbers list, which the composer's
    // "text from" picker reads — a reputation lookup has no business being
    // able to stop somebody texting a customer.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = stub(null, true);

    await expect(loadNumberHealth(db, "c1")).resolves.toEqual(new Map());

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("cannot leak the internal 'watch' state even if the RPC returned one", async () => {
    // Defence in depth: api_number_health already flattens watch to healthy.
    // If that ever regressed, this stops it reaching a customer's screen.
    const { db } = stub([
      { phone_number_id: "n1", state: "watch", delivery_rate: 0.8, degraded_since: "x", detail: "d" },
    ]);

    expect(await loadNumberHealth(db, "c1")).toEqual(new Map());
  });
});
