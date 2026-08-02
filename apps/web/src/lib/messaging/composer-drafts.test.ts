/**
 * @vitest-environment happy-dom
 *
 * The flush suite at the bottom needs real `window`/`document` events; the
 * pure save/load tests above are indifferent to the environment.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearDraft,
  flushDraftOnExit,
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

describe("#299/#269 — the draft survives the way out", () => {
  /**
   * The debounce that writes one entry per idle moment cancels a pending write
   * on cleanup. Every test here is a way somebody leaves inside that window,
   * which is the one case the draft feature exists for and the one it lost.
   */
  function setup() {
    const store = fakeStorage();
    vi.stubGlobal("localStorage", store);
    let current = { conversationId: "conv-1", text: "", mentions: [] as never[] };
    const stop = flushDraftOnExit(() => current);
    return {
      store,
      stop,
      type: (text: string) => {
        current = { ...current, text };
      },
      switchTo: (conversationId: string) => {
        current = { ...current, conversationId };
      },
    };
  }

  it("saves what was typed when the tab is closed or reloaded", () => {
    // THE REPORTED CASE. The app looks broken during a drop, the user reloads,
    // and the reload lands inside the 400ms window they were still typing in.
    const s = setup();
    s.type("can you do Thursday");
    window.dispatchEvent(new Event("pagehide"));

    expect(loadDraft("conv-1")).toBe("can you do Thursday");
    s.stop();
  });

  it("saves when the app is backgrounded on a phone", () => {
    // A tab that is backgrounded and then killed never fires `pagehide` with a
    // visible page, so hiding has to count as leaving.
    const s = setup();
    s.type("on my way");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(loadDraft("conv-1")).toBe("on my way");
    s.stop();
  });

  it("saves when the composer moves to another thread", () => {
    // The third exit, and the quietest: switching threads unmounts the
    // composer, and the half-typed reply to the FIRST customer has to stay
    // with that customer.
    const s = setup();
    s.type("quote is attached");
    s.stop();

    expect(loadDraft("conv-1")).toBe("quote is attached");
  });

  it("writes to the thread that was open, not the one being opened", () => {
    // A flush that read the NEW conversation id would file the previous
    // customer's half-typed reply under the next one — worse than losing it.
    const s = setup();
    s.type("see you at nine");
    s.switchTo("conv-2");
    window.dispatchEvent(new Event("pagehide"));

    expect(loadDraft("conv-2")).toBe("see you at nine");
    expect(loadDraft("conv-1")).toBe("");
    s.stop();
  });

  it("stops listening once the composer is gone", () => {
    // Otherwise every composer ever mounted keeps writing on every page hide.
    const s = setup();
    s.stop();
    s.type("typed after teardown");
    window.dispatchEvent(new Event("pagehide"));

    expect(loadDraft("conv-1")).toBe("");
  });
});
