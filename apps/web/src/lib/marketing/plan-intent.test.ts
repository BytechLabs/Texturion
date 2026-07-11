import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PLAN_INTENT_STORAGE_KEY,
  clearPlanIntentStash,
  consumePlanIntent,
  parsePlanIntent,
  planIntentSearch,
  readPlanIntentStash,
  stashPlanIntent,
  stashPlanIntentFromSearch,
} from "./plan-intent";

/** Minimal in-memory Storage double (the test env is node, no DOM). */
function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

let store: Storage;

beforeEach(() => {
  store = makeStorage();
  vi.stubGlobal("window", { sessionStorage: store });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// #134/D42: with voice retired (calling is included on every plan) and
// regions_ca still unsellable, the sellable set is EMPTY — every carried
// module is dropped by the whitelist and only the plan survives. The tests
// below pin exactly that: old ads and bookmarks carrying modules=voice must
// still check out cleanly.
describe("parsePlanIntent (whitelist validation of the /pricing builder URL)", () => {
  it("parses the builder's canonical output", () => {
    expect(parsePlanIntent("?plan=pro")).toEqual({
      plan: "pro",
      modules: [],
    });
    expect(parsePlanIntent("plan=starter")).toEqual({
      plan: "starter",
      modules: [],
    });
  });

  it("accepts URLSearchParams input", () => {
    expect(
      parsePlanIntent(new URLSearchParams({ plan: "pro" })),
    ).toEqual({ plan: "pro", modules: [] });
  });

  it("rejects unknown plans outright", () => {
    expect(parsePlanIntent("?plan=enterprise&modules=voice")).toBeNull();
    expect(parsePlanIntent("?plan=&modules=voice")).toBeNull();
    expect(parsePlanIntent("?modules=voice")).toBeNull();
    expect(parsePlanIntent("")).toBeNull();
    expect(parsePlanIntent(null)).toBeNull();
    expect(parsePlanIntent(undefined)).toBeNull();
  });

  it("keeps only sellable modules: unsellable, retired, and junk ids are dropped, not fatal", () => {
    // regions_ca is unsellable; the plan still parses.
    expect(parsePlanIntent("?plan=starter&modules=regions_ca")).toEqual({
      plan: "starter",
      modules: [],
    });
    expect(
      parsePlanIntent("?plan=pro&modules=<script>,__proto__,regions_ca,mms"),
    ).toEqual({ plan: "pro", modules: [] });
    // #97/#103 + #121 + #134: an OLD stashed/emailed link carrying a retired
    // add-on (mms, extra_storage, voice — the Calling module retired into
    // every plan by D42) must still check out cleanly — retired ids are
    // dropped like any unknown value, never forwarded to the API (whose
    // schema would 422 them).
    expect(
      parsePlanIntent("?plan=pro&modules=mms,extra_storage,voice"),
    ).toEqual({
      plan: "pro",
      modules: [],
    });
  });
});

describe("planIntentSearch (canonical serialization)", () => {
  it("round-trips through parsePlanIntent", () => {
    // The builder can only emit sellable modules, and nothing is sellable
    // today (#134/D42) — the canonical output is plan-only.
    const intent = { plan: "pro" as const, modules: [] };
    const search = planIntentSearch(intent);
    expect(search).toBe("plan=pro");
    expect(parsePlanIntent(search)).toEqual(intent);
  });

  it("omits modules when none are selected", () => {
    expect(planIntentSearch({ plan: "starter", modules: [] })).toBe(
      "plan=starter",
    );
  });

  it("serializes any carried module, and the parse side drops the unsellable", () => {
    // Serialization is dumb on purpose; the WHITELIST lives in parsing.
    const search = planIntentSearch({ plan: "pro", modules: ["regions_ca"] });
    expect(search).toBe("plan=pro&modules=regions_ca");
    expect(parsePlanIntent(search)).toEqual({ plan: "pro", modules: [] });
  });

  it("stays safeNextPath-compatible (no spaces, backslashes, or control chars)", () => {
    const search = planIntentSearch({
      plan: "pro",
      modules: ["regions_ca"],
    });
    expect(search).not.toMatch(/[\s\\]/);
  });
});

describe("stash round trip (sessionStorage, loonext.plan_intent)", () => {
  it("stashes and reads back a validated intent", () => {
    stashPlanIntent({ plan: "pro", modules: [] });
    expect(store.getItem(PLAN_INTENT_STORAGE_KEY)).toBe(
      JSON.stringify({ plan: "pro", modules: [] }),
    );
    expect(readPlanIntentStash()).toEqual({ plan: "pro", modules: [] });
  });

  it("re-validates the stash: tampered plans read as null, tampered modules are filtered", () => {
    store.setItem(
      PLAN_INTENT_STORAGE_KEY,
      JSON.stringify({ plan: "free_forever", modules: ["voice"] }),
    );
    expect(readPlanIntentStash()).toBeNull();

    store.setItem(
      PLAN_INTENT_STORAGE_KEY,
      // "mms" and "voice" are stale pre-retirement stashes — dropped like
      // the other junk (#103/#134).
      JSON.stringify({ plan: "pro", modules: ["regions_ca", "mms", "voice", 42] }),
    );
    expect(readPlanIntentStash()).toEqual({ plan: "pro", modules: [] });
  });

  it("reads malformed JSON and non-objects as null", () => {
    store.setItem(PLAN_INTENT_STORAGE_KEY, "{not json");
    expect(readPlanIntentStash()).toBeNull();
    store.setItem(PLAN_INTENT_STORAGE_KEY, '"a string"');
    expect(readPlanIntentStash()).toBeNull();
  });

  it("clearPlanIntentStash drops the entry", () => {
    stashPlanIntent({ plan: "starter", modules: [] });
    clearPlanIntentStash();
    expect(readPlanIntentStash()).toBeNull();
  });

  it("is a silent no-op without a window (SSR) or with a throwing storage", () => {
    vi.unstubAllGlobals();
    expect(() => stashPlanIntent({ plan: "pro", modules: [] })).not.toThrow();
    expect(readPlanIntentStash()).toBeNull();
    expect(() => clearPlanIntentStash()).not.toThrow();

    vi.stubGlobal("window", {
      get sessionStorage(): Storage {
        throw new Error("blocked");
      },
    });
    expect(() => stashPlanIntent({ plan: "pro", modules: [] })).not.toThrow();
    expect(readPlanIntentStash()).toBeNull();
  });
});

describe("stashPlanIntentFromSearch (signup / onboarding landing)", () => {
  it("stashes a URL intent and returns it (stale modules already dropped)", () => {
    const intent = stashPlanIntentFromSearch("?plan=pro&modules=voice");
    expect(intent).toEqual({ plan: "pro", modules: [] });
    expect(readPlanIntentStash()).toEqual({ plan: "pro", modules: [] });
  });

  it("falls back to (and preserves) an existing stash when the URL has none", () => {
    stashPlanIntent({ plan: "starter", modules: [] });
    expect(stashPlanIntentFromSearch("")).toEqual({
      plan: "starter",
      modules: [],
    });
    // Not cleared — only the plan step consumes.
    expect(readPlanIntentStash()).toEqual({
      plan: "starter",
      modules: [],
    });
  });

  it("a hostile URL never overwrites the stash with garbage", () => {
    stashPlanIntent({ plan: "pro", modules: [] });
    expect(stashPlanIntentFromSearch("?plan=evil&modules=regions_ca")).toEqual({
      plan: "pro",
      modules: [],
    });
  });
});

describe("consumePlanIntent (plan step hydration)", () => {
  it("URL wins over the stash, and the stash is cleared", () => {
    stashPlanIntent({ plan: "starter", modules: [] });
    expect(consumePlanIntent("?plan=pro")).toEqual({
      plan: "pro",
      modules: [],
    });
    expect(readPlanIntentStash()).toBeNull();
  });

  it("falls back to the stash and clears it (consumed exactly once)", () => {
    stashPlanIntent({ plan: "pro", modules: [] });
    expect(consumePlanIntent("")).toEqual({
      plan: "pro",
      modules: [],
    });
    expect(consumePlanIntent("")).toBeNull();
  });

  it("returns null when neither URL nor stash carries an intent", () => {
    expect(consumePlanIntent("?checkout=canceled")).toBeNull();
  });
});
