import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearDraft,
  loadDraft,
  NEW_CONVERSATION_DRAFT,
  saveDraft,
} from "./composer-drafts";

/** A minimal localStorage. The suite runs in node, so there is no real one. */
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    map,
  };
}

describe("composer drafts", () => {
  let store: ReturnType<typeof fakeStorage>;

  beforeEach(() => {
    store = fakeStorage();
    vi.stubGlobal("window", { localStorage: store });
  });

  it("round-trips a draft for one conversation", () => {
    saveDraft("c1", "on my way");
    expect(loadDraft("c1")).toBe("on my way");
  });

  it("keeps conversations apart", () => {
    // The whole point: the reply you were writing to one customer must never
    // appear in the box for the next one.
    saveDraft("c1", "for Dana");
    saveDraft("c2", "for Marco");
    expect(loadDraft("c1")).toBe("for Dana");
    expect(loadDraft("c2")).toBe("for Marco");
  });

  it("an empty or whitespace draft is removed, not stored", () => {
    saveDraft("c1", "half a thought");
    saveDraft("c1", "   ");
    expect(loadDraft("c1")).toBe("");
    expect(store.map.has("loonext:composer-draft:c1")).toBe(false);
  });

  it("clearDraft removes it", () => {
    saveDraft(NEW_CONVERSATION_DRAFT, "hello");
    clearDraft(NEW_CONVERSATION_DRAFT);
    expect(loadDraft(NEW_CONVERSATION_DRAFT)).toBe("");
  });

  it("an unknown conversation reads as empty", () => {
    expect(loadDraft("never-typed")).toBe("");
  });

  it("survives storage that throws", () => {
    // Private mode and quota refusals throw on write. Losing a draft is fine;
    // taking the composer down with it is not.
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
        removeItem: () => {
          throw new Error("SecurityError");
        },
      },
    });
    expect(() => saveDraft("c1", "text")).not.toThrow();
    expect(() => clearDraft("c1")).not.toThrow();
    expect(loadDraft("c1")).toBe("");
  });

  it("reads as empty on the server, where there is no window", () => {
    vi.stubGlobal("window", undefined);
    expect(loadDraft("c1")).toBe("");
    expect(() => saveDraft("c1", "text")).not.toThrow();
  });
});
