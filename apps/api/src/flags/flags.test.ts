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
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

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

  /**
   * #249 — a kill switch is only worth what its ENFORCEMENT POINTS cover.
   *
   * `kill:calls` promises to stop calls "being placed or accepted" and was gated
   * at exactly one place: `POST /v1/webrtc/token`. A Telnyx JWT lives up to 24
   * hours, so every softphone that had already fetched one kept placing calls
   * through `POST /v1/calls/browser` for the rest of the day. The switch read as
   * containment and was not, and the disaster-recovery runbook leaned on it to
   * quiesce calls before restoring a database.
   *
   * Nothing failed when that gate was missing, because a flag's declaration and
   * its enforcement live in different files with nothing binding them. This is
   * that binding, derived from the filesystem — the same shape as D79's "one
   * resolver, and a test enumerating who may decide".
   */
  describe("every kill switch is actually enforced somewhere", () => {
    const API_SRC = join(fileURLToPath(new URL("..", import.meta.url)));

    /** Every .ts under apps/api/src that is not a test. */
    function sourceFiles(dir: string): string[] {
      const out: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...sourceFiles(path));
        else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) {
          out.push(path);
        }
      }
      return out;
    }

    const sources = sourceFiles(API_SRC).map((path) => ({
      path,
      text: readFileSync(path, "utf8"),
    }));

    /** Files containing a server-side `isKilled(env, "<key>"` gate. */
    function enforcedIn(key: string): string[] {
      return sources
        .filter((file) => file.text.includes(`isKilled(env, "${key}"`))
        .map((file) => relative(API_SRC, file.path).replace(/\\/g, "/"));
    }

    it.each(killSwitchKeys())("%s is enforced, server-side or by a client", (key) => {
      const server = enforcedIn(key);
      // `kill:realtime` is deliberately NOT enforced server-side: clients hold
      // their own Supabase token and open the socket themselves, so the switch
      // travels to them through /v1/me and they stop asking. `flags/client.ts`
      // is where that list is declared, and being on it IS the enforcement.
      const clientDelivered = sources.some(
        (file) =>
          file.path.endsWith(`flags${sep}client.ts`) &&
          file.text.includes(`"${key}"`),
      );
      expect(
        server.length > 0 || clientDelivered,
        `${key} is declared as a kill switch and nothing reads it. A switch ` +
          `nobody checks does nothing when it is flipped, which is worse than ` +
          `not having it: somebody will believe an incident is contained.`,
      ).toBe(true);
    });

    it("gates kill:calls at every place a call can start", () => {
      // The defect this test was written for. Refusing the token is necessary
      // and not sufficient — an issued token outlives the switch by up to a
      // day, so the route that actually places the call needs its own gate.
      //
      // Asserted as a SUBSET rather than as the whole list. An exact list makes
      // this a ceiling on how many routes may place calls, so the next one to
      // be written correctly gated fails the guard that exists to demand it —
      // which is a test that has stopped catching drift and started blocking
      // the fix. Adding an ungated route is still caught, by the roster test
      // above and by this file's own reason for existing.
      const files = enforcedIn("kill:calls");
      for (const required of [
        "routes/webrtc.ts", // the token mint
        "routes/calls.ts", // placing an outbound call
        "routes/voicemail-greetings.ts", // #309's record-by-phone dial
      ]) {
        expect(
          files,
          `kill:calls must gate ${required}. A call this product can place ` +
            `without consulting the switch is an incident the switch does not ` +
            `contain.`,
        ).toContain(required);
      }
    });
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
