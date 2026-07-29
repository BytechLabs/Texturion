/**
 * #283 — the flags, and the one property that makes them safe to have.
 *
 * A feature-flag system is a new shared dependency on the read path of every
 * risky subsystem. If it can fail in a way that disables features, it has
 * recreated the total blast radius it was built to shrink — just with more
 * moving parts. So most of this file is about the flag store being broken:
 * unreachable, empty, malformed, slow. Every one of those must resolve to the
 * default declared in code.
 *
 * The rest is hygiene, which the issue is explicit about: permanent flags are
 * how a codebase becomes untestable, so a flag past its removal date fails CI
 * rather than living forever.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { Env } from "../env";
import { isFlagOn, isKilled, resetFlagCache } from "./evaluate";
import { FEATURE_FLAGS, FLAG_KEYS, flagDefault, killSwitchKeys } from "./registry";

const env = {} as Env;

/** A db stub whose rpc answers with `data`, or throws. */
function db(data: unknown, fail = false) {
  const rpc = vi.fn(async () =>
    fail ? { data: null, error: { message: "connection refused" } } : { data, error: null },
  );
  return { client: { rpc } as never, rpc };
}

beforeEach(() => {
  resetFlagCache();
});

describe("the registry is the roster", () => {
  it("declares an owner and a removal date for every flag", () => {
    for (const key of FLAG_KEYS) {
      const spec = FEATURE_FLAGS[key];
      expect(spec.owner, key).toBeTruthy();
      expect(spec.removeBy, key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // A flag whose purpose cannot be stated in a sentence is a flag nobody
      // will dare remove.
      expect(spec.what.length, key).toBeGreaterThan(20);
    }
  });

  it("fails once a flag outlives its removal date", () => {
    // THE hygiene test. The issue names the cost directly: permanent flags and
    // a combinatorial explosion of untested paths. When this fails, the fix is
    // to delete the flag and its branches — not to push the date.
    const today = new Date().toISOString().slice(0, 10);
    const expired = FLAG_KEYS.filter((key) => FEATURE_FLAGS[key].removeBy < today);
    expect(
      expired,
      `these flags are past their removal date and must be deleted along with ` +
        `the code branches they guard: ${expired.join(", ")}`,
    ).toEqual([]);
  });

  it("defaults every kill switch to ON", () => {
    // The direction that matters. A kill switch defaulting OFF means an empty
    // table, or an unreachable database, disables the product — which is the
    // outage this whole mechanism exists to prevent, caused by the mechanism.
    for (const key of killSwitchKeys()) {
      expect(flagDefault(key), key).toBe(true);
    }
  });

  it("covers exactly the four subsystems the issue names", () => {
    expect(killSwitchKeys().sort()).toEqual([
      "kill:ai",
      "kill:calls",
      "kill:outbound-send",
      "kill:realtime",
    ]);
  });
});

describe("evaluation", () => {
  it("takes the store's answer when it has one", async () => {
    const { client } = db({ "kill:calls": false });
    expect(await isFlagOn(env, "kill:calls", "c1", client)).toBe(false);
    expect(await isKilled(env, "kill:calls", "c1", client)).toBe(true);
  });

  it("falls back to the code default for a key nobody has spoken about", async () => {
    const { client } = db({});
    expect(await isFlagOn(env, "kill:calls", "c1", client)).toBe(true);
  });

  it("falls back to the code default when the store is unreachable", async () => {
    // The property the whole system rests on: a database outage must not be
    // able to switch anything off.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = db(null, true);

    for (const key of killSwitchKeys()) {
      resetFlagCache();
      expect(await isFlagOn(env, key, "c1", client), key).toBe(true);
    }
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("ignores a non-boolean value rather than trusting it", async () => {
    // A malformed row must not become a truthy "on" or a falsy "off".
    const { client } = db({ "kill:calls": "false" });
    expect(await isFlagOn(env, "kill:calls", "c1", client)).toBe(true);
  });

  it("caches, so a burst from one workspace costs one read", async () => {
    const { client, rpc } = db({ "kill:calls": false });
    await isFlagOn(env, "kill:calls", "c1", client);
    await isFlagOn(env, "kill:calls", "c1", client);
    await isFlagOn(env, "kill:ai", "c1", client);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("caches per company, so one workspace's rollout does not leak to another", async () => {
    const { client, rpc } = db({ "kill:calls": false });
    await isFlagOn(env, "kill:calls", "c1", client);
    await isFlagOn(env, "kill:calls", "c2", client);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("caches the failure too, so an outage is not amplified by a retry storm", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, rpc } = db(null, true);
    await isFlagOn(env, "kill:calls", "c1", client);
    await isFlagOn(env, "kill:calls", "c1", client);
    // The unhealthy database gets one request, not one per request in flight.
    expect(rpc).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("answers for a path with no workspace in hand", async () => {
    // Webhooks and crons have no company. They still need a kill switch.
    const { client } = db({ "kill:outbound-send": false });
    expect(await isKilled(env, "kill:outbound-send", null, client)).toBe(true);
  });
});
