/**
 * The remembered sign-in method. An account can hold Google and a password at
 * once, so the login screen marks the one that worked last on this device.
 *
 * What matters here: it stores only the method name, it ignores anything it did
 * not write, and it never throws — not in private mode, not over quota, and not
 * during a server render where `window` does not exist (this suite runs in the
 * node environment, so that case is the default).
 */
import { describe, expect, it, vi } from "vitest";

import { readSignInMethod, rememberSignInMethod } from "./last-used";

const KEY = "loonext.last-sign-in";

/** A minimal localStorage, installed as `window` for one test. */
function withStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
  return store;
}

describe("remembered sign-in method", () => {
  it("round-trips each method", () => {
    withStorage();
    rememberSignInMethod("google");
    expect(readSignInMethod()).toBe("google");
    rememberSignInMethod("password");
    expect(readSignInMethod()).toBe("password");
  });

  it("stores the method name and nothing else", () => {
    const store = withStorage();
    rememberSignInMethod("password");
    expect([...store.entries()]).toEqual([[KEY, "password"]]);
  });

  it("is null before anyone has signed in", () => {
    withStorage();
    expect(readSignInMethod()).toBeNull();
  });

  it("ignores a value it did not write (stale or tampered)", () => {
    const store = withStorage();
    store.set(KEY, "apple");
    expect(readSignInMethod()).toBeNull();
  });

  it("never throws when storage is unavailable (private mode, quota)", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
    });
    expect(() => rememberSignInMethod("google")).not.toThrow();
    expect(readSignInMethod()).toBeNull();
  });

  it("never throws where there is no window at all (server render)", () => {
    expect(() => rememberSignInMethod("google")).not.toThrow();
    expect(readSignInMethod()).toBeNull();
  });
});
