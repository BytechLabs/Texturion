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

describe("parsePlanIntent (whitelist validation of the /pricing builder URL)", () => {
  it("parses the builder's canonical output", () => {
    expect(parsePlanIntent("?plan=pro&modules=voice")).toEqual({
      plan: "pro",
      modules: ["voice"],
    });
    expect(parsePlanIntent("plan=starter")).toEqual({
      plan: "starter",
      modules: [],
    });
  });

  it("accepts URLSearchParams input", () => {
    expect(
      parsePlanIntent(new URLSearchParams({ plan: "pro", modules: "voice" })),
    ).toEqual({ plan: "pro", modules: ["voice"] });
  });

  it("rejects unknown plans outright", () => {
    expect(parsePlanIntent("?plan=enterprise&modules=voice")).toBeNull();
    expect(parsePlanIntent("?plan=&modules=voice")).toBeNull();
    expect(parsePlanIntent("?modules=voice")).toBeNull();
    expect(parsePlanIntent("")).toBeNull();
    expect(parsePlanIntent(null)).toBeNull();
    expect(parsePlanIntent(undefined)).toBeNull();
  });

  it("keeps only sellable modules: regions_ca, retired mms, and junk are dropped, not fatal", () => {
    // The hostile case from the brief: ?modules=regions_ca,voice keeps voice.
    expect(parsePlanIntent("?plan=starter&modules=regions_ca,voice")).toEqual({
      plan: "starter",
      modules: ["voice"],
    });
    expect(
      parsePlanIntent(
        "?plan=pro&modules=<script>,__proto__,regions_ca,mms,mms,voice",
      ),
    ).toEqual({ plan: "pro", modules: ["voice"] });
    // #97/#103 + #121: an OLD stashed/emailed link carrying a retired add-on
    // (mms, extra_storage) must still check out cleanly — retired ids are
    // dropped like any unknown value, never forwarded to the API (whose
    // schema would 422 them).
    expect(parsePlanIntent("?plan=pro&modules=mms,extra_storage,voice")).toEqual({
      plan: "pro",
      modules: ["voice"],
    });
  });

  it("dedupes repeated modules", () => {
    expect(parsePlanIntent("?plan=pro&modules=voice,voice,voice")).toEqual({
      plan: "pro",
      modules: ["voice"],
    });
  });
});

describe("planIntentSearch (canonical serialization)", () => {
  it("round-trips through parsePlanIntent", () => {
    const intent = {
      plan: "pro" as const,
      modules: ["voice" as const],
    };
    const search = planIntentSearch(intent);
    expect(search).toBe("plan=pro&modules=voice");
    expect(parsePlanIntent(search)).toEqual(intent);
  });

  it("omits modules when none are selected", () => {
    expect(planIntentSearch({ plan: "starter", modules: [] })).toBe(
      "plan=starter",
    );
  });

  it("stays safeNextPath-compatible (no spaces, backslashes, or control chars)", () => {
    const search = planIntentSearch({
      plan: "pro",
      modules: ["voice"],
    });
    expect(search).not.toMatch(/[\s\\]/);
  });
});

describe("stash round trip (sessionStorage, loonext.plan_intent)", () => {
  it("stashes and reads back a validated intent", () => {
    stashPlanIntent({ plan: "pro", modules: ["voice"] });
    expect(store.getItem(PLAN_INTENT_STORAGE_KEY)).toBe(
      JSON.stringify({ plan: "pro", modules: ["voice"] }),
    );
    expect(readPlanIntentStash()).toEqual({ plan: "pro", modules: ["voice"] });
  });

  it("re-validates the stash: tampered plans read as null, tampered modules are filtered", () => {
    store.setItem(
      PLAN_INTENT_STORAGE_KEY,
      JSON.stringify({ plan: "free_forever", modules: ["voice"] }),
    );
    expect(readPlanIntentStash()).toBeNull();

    store.setItem(
      PLAN_INTENT_STORAGE_KEY,
      // "mms" is a stale pre-#103 stash — dropped like the other junk.
      JSON.stringify({ plan: "pro", modules: ["regions_ca", "mms", "voice", 42] }),
    );
    expect(readPlanIntentStash()).toEqual({ plan: "pro", modules: ["voice"] });
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
  it("stashes a URL intent and returns it", () => {
    const intent = stashPlanIntentFromSearch("?plan=pro&modules=voice");
    expect(intent).toEqual({ plan: "pro", modules: ["voice"] });
    expect(readPlanIntentStash()).toEqual({ plan: "pro", modules: ["voice"] });
  });

  it("falls back to (and preserves) an existing stash when the URL has none", () => {
    stashPlanIntent({ plan: "starter", modules: ["voice"] });
    expect(stashPlanIntentFromSearch("")).toEqual({
      plan: "starter",
      modules: ["voice"],
    });
    // Not cleared — only the plan step consumes.
    expect(readPlanIntentStash()).toEqual({
      plan: "starter",
      modules: ["voice"],
    });
  });

  it("a hostile URL never overwrites the stash with garbage", () => {
    stashPlanIntent({ plan: "pro", modules: ["voice"] });
    expect(stashPlanIntentFromSearch("?plan=evil&modules=regions_ca")).toEqual({
      plan: "pro",
      modules: ["voice"],
    });
  });
});

describe("consumePlanIntent (plan step hydration)", () => {
  it("URL wins over the stash, and the stash is cleared", () => {
    stashPlanIntent({ plan: "starter", modules: [] });
    expect(consumePlanIntent("?plan=pro&modules=voice")).toEqual({
      plan: "pro",
      modules: ["voice"],
    });
    expect(readPlanIntentStash()).toBeNull();
  });

  it("falls back to the stash and clears it (consumed exactly once)", () => {
    stashPlanIntent({ plan: "pro", modules: ["voice"] });
    expect(consumePlanIntent("")).toEqual({
      plan: "pro",
      modules: ["voice"],
    });
    expect(consumePlanIntent("")).toBeNull();
  });

  it("returns null when neither URL nor stash carries an intent", () => {
    expect(consumePlanIntent("?checkout=canceled")).toBeNull();
  });
});
