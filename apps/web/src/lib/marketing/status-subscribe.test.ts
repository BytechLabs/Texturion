/**
 * #477 — the status mailing list.
 *
 * The two things that must hold under test are the two that cost real money or
 * real trust: nothing gets mailed without asking for it, and nothing sends past
 * a cap. The rest of this pins the transition rule, because a list that emails
 * on a steady state is a list nobody stays on.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_CONFIRMS_PER_DAY,
  MAX_EMAILS_PER_MONTH,
  MAX_FANOUTS_PER_DAY,
  MAX_SUBSCRIBERS,
  SUBSCRIBE_KEYS,
  confirmSubscription,
  decideNotification,
  isToken,
  mintToken,
  normalizeEmail,
  notifySubscribers,
  startSubscription,
  subscriptionsOpen,
  unsubscribe,
  unsubscribeUrl,
  type Mailer,
  type SubscriberStore,
} from "./status-subscribe";

/** A KV stand-in. Deliberately ignores TTLs — nothing here tests expiry. */
function fakeStore(): SubscriberStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    async get(key) {
      return map.get(key) ?? null;
    },
    async put(key, value) {
      map.set(key, value);
    },
    async delete(key) {
      map.delete(key);
    },
    async list({ prefix }) {
      return {
        keys: [...map.keys()]
          .filter((name) => name.startsWith(prefix))
          .map((name) => ({ name })),
      };
    },
  };
}

function fakeMailer(): Mailer & { sent: { to: string; text: string }[] } {
  const sent: { to: string; text: string }[] = [];
  return {
    sent,
    async send(message) {
      sent.push({ to: message.to, text: message.text });
      return true;
    },
  };
}

const NOW = new Date("2026-07-31T12:00:00Z");

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("normalizeEmail", () => {
  it("lowercases and trims a real address", () => {
    expect(normalizeEmail("  Sam@Example.COM ")).toBe("sam@example.com");
  });

  it("rejects what is not an address", () => {
    for (const bad of [
      "",
      "sam",
      "sam@",
      "@example.com",
      "sam@example",
      "sam@exam ple.com",
      // A comma or a bracket is how one field becomes two recipients.
      "sam@example.com, victim@example.com",
      "<sam@example.com>",
      null,
      42,
    ]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });

  it("bounds the length, because this becomes a KV value", () => {
    expect(normalizeEmail(`${"a".repeat(250)}@example.com`)).toBeNull();
  });
});

describe("tokens", () => {
  it("mints something unguessable and shaped the way the checker expects", () => {
    const token = mintToken();
    expect(isToken(token)).toBe(true);
    expect(mintToken()).not.toBe(token);
  });

  it("rejects anything that did not come from mintToken", () => {
    // Tokens arrive from a URL and are concatenated into a KV key, so a value
    // carrying a prefix or a path separator must never reach the store.
    for (const bad of ["", "sub:abc", "../notified", "ZZZZ", "abc", 7, null]) {
      expect(isToken(bad)).toBe(false);
    }
  });
});

describe("double opt-in", () => {
  it("does not add an address until the link is opened", async () => {
    const store = fakeStore();
    const mailer = fakeMailer();

    expect(await startSubscription(store, mailer, "sam@example.com", NOW)).toBe(
      "sent",
    );
    // Pending, not subscribed. This is the whole anti-abuse story: anyone can
    // type anyone's address into a public form.
    expect((await store.list({ prefix: SUBSCRIBE_KEYS.subscriber })).keys)
      .toHaveLength(0);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe("sam@example.com");

    const token = [...store.map.keys()]
      .find((key) => key.startsWith(SUBSCRIBE_KEYS.pending))!
      .slice(SUBSCRIBE_KEYS.pending.length);
    expect(await confirmSubscription(store, token)).toBe(true);
    expect((await store.list({ prefix: SUBSCRIBE_KEYS.subscriber })).keys)
      .toHaveLength(1);
  });

  it("refuses a token it never issued", async () => {
    const store = fakeStore();
    expect(await confirmSubscription(store, mintToken())).toBe(false);
    expect(await confirmSubscription(store, "not-a-token")).toBe(false);
  });

  it("does not mail an address that is already on the list", async () => {
    const store = fakeStore();
    const mailer = fakeMailer();
    await store.put(`${SUBSCRIBE_KEYS.subscriber}${mintToken()}`, "sam@example.com");

    expect(await startSubscription(store, mailer, "sam@example.com", NOW)).toBe(
      "already",
    );
    expect(mailer.sent).toHaveLength(0);
  });
});

describe("unsubscribe", () => {
  it("removes the address and reports success on a second click", async () => {
    const store = fakeStore();
    const token = mintToken();
    await store.put(`${SUBSCRIBE_KEYS.subscriber}${token}`, "sam@example.com");

    expect(await unsubscribe(store, token)).toBe(true);
    expect((await store.list({ prefix: SUBSCRIBE_KEYS.subscriber })).keys)
      .toHaveLength(0);
    // A mail client that prefetched the link, or somebody clicking twice, must
    // not be told it failed. They are off the list either way.
    expect(await unsubscribe(store, token)).toBe(true);
  });
});

describe("decideNotification — transitions only", () => {
  it("says nothing on a steady state", () => {
    expect(decideNotification(null, null)).toBe("none");
    expect(decideNotification("", "")).toBe("none");
    expect(decideNotification("Texting is delayed", "Texting is delayed")).toBe(
      "none",
    );
  });

  it("announces a new incident and its resolution", () => {
    expect(decideNotification("Texting is delayed", null)).toBe("incident");
    expect(decideNotification(null, "Texting is delayed")).toBe("resolved");
  });

  it("treats a fresh namespace on a healthy day as nothing to say", () => {
    // The bug this exists to prevent: a brand-new KV namespace has no marker at
    // all, and reading that as "changed" would announce an incident that never
    // happened, to everyone, on day one.
    expect(decideNotification(null, null)).toBe("none");
  });
});

describe("notifySubscribers", () => {
  async function withSubscribers(count: number) {
    const store = fakeStore();
    for (let i = 0; i < count; i += 1) {
      await store.put(`${SUBSCRIBE_KEYS.subscriber}${mintToken()}`, `s${i}@example.com`);
    }
    return store;
  }

  it("mails the list once per transition, not once per render", async () => {
    const store = await withSubscribers(3);
    const mailer = fakeMailer();

    const first = await notifySubscribers(store, mailer, "Texting is delayed", NOW);
    expect(first).toEqual({ kind: "incident", sent: 3 });

    // The same sentence again is the same incident. A page that re-mails on
    // every render is a page nobody stays subscribed to.
    const second = await notifySubscribers(store, mailer, "Texting is delayed", NOW);
    expect(second.kind).toBe("none");
    expect(mailer.sent).toHaveLength(3);
  });

  it("marks before it sends, so a crash under-notifies", async () => {
    const store = await withSubscribers(1);
    const exploding: Mailer = {
      async send() {
        throw new Error("resend is down");
      },
    };
    await notifySubscribers(store, exploding, "Texting is delayed", NOW);
    // The marker moved even though the send blew up. Losing one announcement is
    // the right way to be wrong: the alternative ordering mails the list twice.
    expect(await store.get(SUBSCRIBE_KEYS.notified)).toBe("Texting is delayed");
  });

  it("moves the marker with nobody on the list", async () => {
    const store = fakeStore();
    const mailer = fakeMailer();
    await notifySubscribers(store, mailer, "Texting is delayed", NOW);
    // Otherwise the first person to subscribe mid-incident is mailed about it
    // as though it had just started.
    expect(await store.get(SUBSCRIBE_KEYS.notified)).toBe("Texting is delayed");
  });

  it("announces the resolution too", async () => {
    const store = await withSubscribers(2);
    const mailer = fakeMailer();
    await notifySubscribers(store, mailer, "Texting is delayed", NOW);
    const resolved = await notifySubscribers(store, mailer, null, NOW);
    expect(resolved.kind).toBe("resolved");
    expect(mailer.sent).toHaveLength(4);
  });

  it("puts an unsubscribe link in every message", async () => {
    const store = await withSubscribers(1);
    const mailer = fakeMailer();
    await notifySubscribers(store, mailer, "Texting is delayed", NOW);
    const token = [...store.map.keys()]
      .find((key) => key.startsWith(SUBSCRIBE_KEYS.subscriber))!
      .slice(SUBSCRIBE_KEYS.subscriber.length);
    expect(mailer.sent[0].text).toContain(unsubscribeUrl(token));
  });

  it("never throws, because it runs inside a page render", async () => {
    const broken: SubscriberStore = {
      async get() {
        throw new Error("KV is down");
      },
      async put() {},
      async delete() {},
      async list() {
        return { keys: [] };
      },
    };
    await expect(
      notifySubscribers(broken, fakeMailer(), "Texting is delayed", NOW),
    ).resolves.toEqual({ kind: "none", sent: 0 });
  });
});

describe("the caps, which are the part that spends money", () => {
  it("states every ceiling, and keeps the worst day small", () => {
    expect(MAX_SUBSCRIBERS).toBeGreaterThan(0);
    expect(MAX_CONFIRMS_PER_DAY).toBeGreaterThan(0);
    expect(MAX_FANOUTS_PER_DAY).toBeGreaterThan(0);
    // The number that actually binds. Everything else rolls up into it, and it
    // has to stay under the sending quota the API worker also draws on.
    expect(MAX_EMAILS_PER_MONTH).toBeLessThanOrEqual(1000);
  });

  it("stops taking addresses when the list is full", async () => {
    const store = fakeStore();
    for (let i = 0; i < MAX_SUBSCRIBERS; i += 1) {
      await store.put(`${SUBSCRIBE_KEYS.subscriber}${mintToken()}`, `s${i}@example.com`);
    }
    expect(await subscriptionsOpen(store)).toBe(false);

    const mailer = fakeMailer();
    expect(await startSubscription(store, mailer, "new@example.com", NOW)).toBe(
      "full",
    );
    expect(mailer.sent).toHaveLength(0);
  });

  it("stops minting confirmation emails once the day's cap is spent", async () => {
    const store = fakeStore();
    const mailer = fakeMailer();
    await store.put(
      `${SUBSCRIBE_KEYS.confirmDay}2026-07-31`,
      String(MAX_CONFIRMS_PER_DAY),
    );
    expect(await startSubscription(store, mailer, "sam@example.com", NOW)).toBe(
      "rate_limited",
    );
    expect(mailer.sent).toHaveLength(0);
  });

  it("stops fanning out once the day's cap is spent", async () => {
    const store = fakeStore();
    for (let i = 0; i < 3; i += 1) {
      await store.put(`${SUBSCRIBE_KEYS.subscriber}${mintToken()}`, `s${i}@example.com`);
    }
    await store.put(`${SUBSCRIBE_KEYS.fanoutDay}2026-07-31`, String(MAX_FANOUTS_PER_DAY));
    const mailer = fakeMailer();

    const result = await notifySubscribers(store, mailer, "Texting is delayed", NOW);
    expect(result.sent).toBe(0);
    expect(mailer.sent).toHaveLength(0);
    // The marker must NOT have moved: this incident still needs announcing when
    // the cap resets, and a marker that moved would swallow it forever.
    expect(await store.get(SUBSCRIBE_KEYS.notified)).toBeNull();
  });

  it("stops at the monthly ceiling rather than overspending", async () => {
    const store = fakeStore();
    for (let i = 0; i < 5; i += 1) {
      await store.put(`${SUBSCRIBE_KEYS.subscriber}${mintToken()}`, `s${i}@example.com`);
    }
    await store.put(
      `${SUBSCRIBE_KEYS.emailMonth}2026-07`,
      String(MAX_EMAILS_PER_MONTH - 2),
    );
    const mailer = fakeMailer();

    // Five subscribers, two of the month's budget left: it does not send three
    // of them and drop the rest. Partial delivery of an outage notice is worse
    // than none — it tells some customers and silently doesn't tell others.
    const result = await notifySubscribers(store, mailer, "Texting is delayed", NOW);
    expect(result.sent).toBe(0);
    expect(mailer.sent).toHaveLength(0);
    expect(await store.get(SUBSCRIBE_KEYS.notified)).toBeNull();
  });

  it("counts a confirmation email against the month as well as the day", async () => {
    const store = fakeStore();
    await store.put(
      `${SUBSCRIBE_KEYS.emailMonth}2026-07`,
      String(MAX_EMAILS_PER_MONTH),
    );
    const mailer = fakeMailer();
    expect(await startSubscription(store, mailer, "sam@example.com", NOW)).toBe(
      "rate_limited",
    );
    expect(mailer.sent).toHaveLength(0);
  });

  it("counts a day in UTC, so crossing a timezone cannot reset a cap", async () => {
    const store = fakeStore();
    const mailer = fakeMailer();
    await store.put(
      `${SUBSCRIBE_KEYS.confirmDay}2026-07-31`,
      String(MAX_CONFIRMS_PER_DAY),
    );
    // 23:30 UTC is already "tomorrow" in Auckland and still "yesterday" in Los
    // Angeles. Both must land on the same counter as noon UTC did.
    const late = new Date("2026-07-31T23:30:00Z");
    expect(await startSubscription(store, mailer, "sam@example.com", late)).toBe(
      "rate_limited",
    );
  });
});
