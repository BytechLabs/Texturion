/**
 * @vitest-environment happy-dom
 *
 * #483 finding 5: the provider's SUBSCRIPTION LIFECYCLE, mounted.
 *
 * `provider.test.ts` covers the two pure derivations and the realtime-js premise
 * they rest on. Everything between them — which topics get joined, what happens
 * when the policy refuses one, what happens when the /v1/me read that DECIDES the
 * set fails, how `access.changed` moves the set, and when the reconnect backfill
 * fires — lived only in the effect, which could not run: this app's vitest
 * environment is `node` and there was no renderer.
 *
 * So the environment is opted into HERE, per file, rather than flipped
 * project-wide. 175 other test files are node-environment page renders and pure
 * units that gain nothing from a DOM and would pay for one.
 *
 * NOTE ON RUNNING THE SUITE: stop any `next dev` server first. A running web dev
 * server makes several unrelated apps/web vitest files fail (it holds the same
 * `.next` build outputs the transform reads), which looks like a broken test and
 * is not one.
 *
 * The Supabase client is a fake with realtime-js's ONE load-bearing behaviour
 * reproduced: `channel(topic)` hands back the channel it already holds for that
 * topic, and `removeChannel` frees the name synchronously (the premise asserted
 * against the real library in `provider.test.ts`). Without that, a rebuild in
 * this file would look fine while the real thing registered a second set of
 * handlers on a dying channel.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { keys } from "@/lib/api/keys";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const COMPANY_TOPIC = `company:${COMPANY}`;
const numberTopic = (id: string) => `${COMPANY_TOPIC}:number:${id}`;

type SubscribeStatus = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";

type FakeChannel = {
  topic: string;
  /** Every `broadcast` binding, by event name — how a test delivers an event. */
  bindings: Map<string, (message: { payload: unknown }) => void>;
  /** The provider's status callback, once `subscribe()` has been called. */
  report: ((status: SubscribeStatus) => void) | null;
  on: (
    type: string,
    filter: { event: string },
    handler: (message: { payload: unknown }) => void,
  ) => FakeChannel;
  subscribe: (callback: (status: SubscribeStatus) => void) => FakeChannel;
};

function createFakeSupabase() {
  /** Channels the client currently holds, keyed by topic — realtime-js's registry. */
  const live = new Map<string, FakeChannel>();
  const opened: string[] = [];
  const removed: string[] = [];
  let connected = true;

  const client = {
    channel(topic: string): FakeChannel {
      const existing = live.get(topic);
      if (existing) return existing;
      const channel: FakeChannel = {
        topic,
        bindings: new Map(),
        report: null,
        on(_type, filter, handler) {
          channel.bindings.set(filter.event, handler);
          return channel;
        },
        subscribe(callback) {
          channel.report = callback;
          return channel;
        },
      };
      live.set(topic, channel);
      opened.push(topic);
      return channel;
    },
    removeChannel(channel: FakeChannel) {
      // Synchronous name release, deferred CLOSED: realtime-js drops the channel
      // from its registry as the leave is sent and reports CLOSED when the leave
      // settles. Both halves matter — the first is what makes a same-tick rebuild
      // safe, the second is what feeds a CLOSED back into the status callback of
      // the channel we just gave up on.
      live.delete(channel.topic);
      removed.push(channel.topic);
      return Promise.resolve().then(() => {
        channel.report?.("CLOSED");
        return "ok" as const;
      });
    },
    realtime: {
      setAuth: () => Promise.resolve(),
      isConnected: () => connected,
    },
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
      getSession: () =>
        Promise.resolve({ data: { session: { access_token: "token" } } }),
    },
  };

  return {
    client,
    live,
    opened,
    removed,
    setConnected: (value: boolean) => {
      connected = value;
    },
  };
}

let fake = createFakeSupabase();
/** What the mocked /v1/me says this member may see; a test moves it and re-renders. */
let visibleNumbers: { id: string }[] = [];
/**
 * Whether the hydrated /v1/me read SUCCEEDED (#483). The distinction the provider
 * turns on: "failed" and an empty `visibleNumbers` derive an identical topic key
 * and want opposite treatment.
 */
let numberListRead: "ok" | "failed" = "ok";

vi.mock("@/lib/supabase/browser", () => ({
  getSupabaseBrowser: () => fake.client as unknown as SupabaseClient,
  // `lib/api/client` destructures this at import time, and the provider's module
  // graph reaches it. No test here fires an event that hits the API.
  getAccessToken: () => Promise.resolve("token"),
}));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ companyId: COMPANY }),
  useCompanyId: () => COMPANY,
}));
vi.mock("@/lib/api/me-company", () => ({
  // React Query's shape narrowed to what the provider reads. A failed read has no
  // `data` at all — including no `flags`, so the #283 kill switch reads as "no
  // statement" and the socket still opens on the company topic.
  useMeCompany: () =>
    numberListRead === "failed"
      ? { data: undefined, isError: true }
      : {
          data: {
            user_id: USER,
            flags: {},
            company: { numbers: visibleNumbers },
          },
          isError: false,
        },
}));
// The provider reads the active thread from the path and pushes on a toast
// action; neither is under test, and both throw outside a Next router.
vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useRouter: () => ({ push: () => {} }),
}));

import { RealtimeProvider } from "./provider";

/** Let the effect's `getSession` → `setAuth` → `subscribe` chain settle. */
async function flush() {
  await act(async () => {});
}

const TWO_PAGES = { pages: [{ data: [] }, { data: [] }], pageParams: [null, "c2"] };

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // The observable difference between the reconnect backfill and every other
  // invalidation in the effect: only `refetchFirstPages` trims infinite queries
  // to page 1. That trim is the user-visible cost of a false gap — a collapsed
  // scrolled-back inbox — so it is what the gap-flag tests assert on.
  queryClient.setQueryData(keys.conversations.lists(COMPANY), TWO_PAGES);
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");

  // A FRESH element per render, not one reused: React bails out of re-rendering a
  // subtree whose props object is referentially identical, and the whole point of
  // a re-render here is to let the effect re-read `visibleNumbers`.
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider>{null}</RealtimeProvider>
    </QueryClientProvider>
  );
  const view = render(tree());

  const report = (topic: string, status: SubscribeStatus) => {
    const channel = fake.live.get(topic);
    if (!channel) throw new Error(`no live channel for ${topic}`);
    if (!channel.report) throw new Error(`${topic} was never subscribed`);
    channel.report(status);
  };

  return {
    /** Re-renders with whatever `visibleNumbers` now says. */
    rerender: () => view.rerender(tree()),
    report,
    emit: (topic: string, event: string, payload: unknown) => {
      const handler = fake.live.get(topic)?.bindings.get(event);
      if (!handler) throw new Error(`${topic} has no ${event} binding`);
      handler({ payload });
    },
    loadedPages: () =>
      (queryClient.getQueryData(keys.conversations.lists(COMPANY)) as {
        pages: unknown[];
      }).pages.length,
    /**
     * `keys.me` invalidations. Two paths in the effect do this and both are
     * asserted below: the reconnect backfill (the only one that ALSO trims, so
     * `loadedPages` separates them) and `access.changed`, for which re-deriving
     * the number list IS the behaviour under test.
     */
    meInvalidations: () =>
      invalidate.mock.calls.filter(
        ([filters]) =>
          Array.isArray(filters?.queryKey) &&
          filters.queryKey.length === 1 &&
          filters.queryKey[0] === keys.me[0],
      ).length,
  };
}

beforeEach(() => {
  fake = createFakeSupabase();
  visibleNumbers = [];
  numberListRead = "ok";
});
afterEach(cleanup);

describe("the joined topic set", () => {
  it("is the company topic plus one per visible number", async () => {
    visibleNumbers = [{ id: "n1" }, { id: "n2" }];
    setup();
    await flush();

    expect([...fake.live.keys()]).toEqual([
      COMPANY_TOPIC,
      numberTopic("n1"),
      numberTopic("n2"),
    ]);
    for (const channel of fake.live.values()) {
      expect(channel.report).not.toBeNull();
    }
  });

  it("follows the number list, tearing the old set down and re-joining", async () => {
    visibleNumbers = [{ id: "n1" }, { id: "n2" }];
    const { rerender } = setup();
    await flush();

    visibleNumbers = [{ id: "n2" }, { id: "n3" }];
    rerender();
    await flush();

    expect([...fake.live.keys()]).toEqual([
      COMPANY_TOPIC,
      numberTopic("n2"),
      numberTopic("n3"),
    ]);
    // n1 is gone, and the two survivors were genuinely re-opened rather than
    // reused: `subscribe()` is a no-op on a channel that is not closed, so a
    // rebuild that recovered the old objects would leave them dead.
    expect(fake.removed).toContain(numberTopic("n1"));
    expect(fake.opened.filter((t) => t === COMPANY_TOPIC)).toHaveLength(2);
    expect(fake.opened.filter((t) => t === numberTopic("n2"))).toHaveLength(2);
    for (const channel of fake.live.values()) {
      expect(channel.report).not.toBeNull();
    }
  });

  it("does not run the backfill for a rebuild", async () => {
    // The rebuild's own cleanup reports CLOSED on every channel, which is why the
    // gap flag is not hoisted across effect runs. If it were, every /v1/me
    // resolution and every number change would collapse the user's pagination.
    visibleNumbers = [{ id: "n1" }];
    const { rerender, report, loadedPages, meInvalidations } = setup();
    await flush();
    report(COMPANY_TOPIC, "SUBSCRIBED");
    report(numberTopic("n1"), "SUBSCRIBED");

    visibleNumbers = [{ id: "n1" }, { id: "n2" }];
    rerender();
    await flush();
    report(COMPANY_TOPIC, "SUBSCRIBED");
    report(numberTopic("n1"), "SUBSCRIBED");
    report(numberTopic("n2"), "SUBSCRIBED");

    expect(meInvalidations()).toBe(0);
    expect(loadedPages()).toBe(2);
  });
});

describe("a per-number join the policy refuses", () => {
  it("is dropped, and leaves its siblings joined", async () => {
    visibleNumbers = [{ id: "n1" }, { id: "n2" }];
    const { report } = setup();
    await flush();
    report(COMPANY_TOPIC, "SUBSCRIBED");
    report(numberTopic("n2"), "SUBSCRIBED");

    report(numberTopic("n1"), "CHANNEL_ERROR");
    report(numberTopic("n1"), "CHANNEL_ERROR");
    await flush();

    expect(fake.removed).toEqual([numberTopic("n1")]);
    expect([...fake.live.keys()]).toEqual([COMPANY_TOPIC, numberTopic("n2")]);
    // Not re-opened IMMEDIATELY — that was the ~10s hot loop this closes.
    expect(fake.opened.filter((t) => t === numberTopic("n1"))).toHaveLength(1);
  });

  it("comes back a minute later, because giving up must not be permanent", async () => {
    // #483: the first version of this fix was permanent, and the comment
    // justifying it was wrong — it claimed `access.changed` would bring the
    // number back by rebuilding the set, but the effect's dependency is a sorted-id
    // STRING. When the refetched list is unchanged the string is identical and the
    // effect never re-runs, while `removeChannel` has already dropped the channel
    // from realtime-js so a reconnect does not rejoin it either.
    //
    // That is load-bearing because refusal and a transient error are
    // indistinguishable here: a laptop waking with an expired JWT can push two
    // joins with the stale token before the refresh lands, and the tab would then
    // receive nothing for that number for the rest of its life with a green socket.
    vi.useFakeTimers();
    try {
      visibleNumbers = [{ id: "n1" }, { id: "n2" }];
      const { report } = setup();
      await flush();
      report(COMPANY_TOPIC, "SUBSCRIBED");
      report(numberTopic("n2"), "SUBSCRIBED");

      report(numberTopic("n1"), "CHANNEL_ERROR");
      report(numberTopic("n1"), "CHANNEL_ERROR");
      await flush();
      expect(fake.opened.filter((t) => t === numberTopic("n1"))).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(60_000);
      await flush();

      // Re-opened once the retry window elapses. A genuinely revoked number
      // settles into one cheap refusal a minute; one lost to a token race is back
      // within one.
      expect(
        fake.opened.filter((t) => t === numberTopic("n1")).length,
      ).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not arm the reconnect gap flag", async () => {
    // The bug this closes: the refused channel re-joined every ~10s forever,
    // re-setting the flag, and the next legitimate SUBSCRIBED trimmed every
    // infinite query to page 1 for an outage that never happened.
    visibleNumbers = [{ id: "n1" }, { id: "n2" }];
    const { report, loadedPages, meInvalidations } = setup();
    await flush();
    report(COMPANY_TOPIC, "SUBSCRIBED");
    report(numberTopic("n2"), "SUBSCRIBED");

    report(numberTopic("n1"), "CHANNEL_ERROR");
    report(numberTopic("n1"), "CHANNEL_ERROR");
    await flush();
    report(numberTopic("n2"), "SUBSCRIBED");

    expect(meInvalidations()).toBe(0);
    expect(loadedPages()).toBe(2);
  });

  it("takes more than one error to give up on", async () => {
    // A heartbeat timeout errors every channel while the socket still reports
    // `open`, then tears it down — so it can produce exactly one such error and
    // never a second. One is therefore not enough to call it a refusal.
    visibleNumbers = [{ id: "n1" }];
    const { report } = setup();
    await flush();

    report(numberTopic("n1"), "CHANNEL_ERROR");
    await flush();
    expect(fake.removed).toEqual([]);

    report(numberTopic("n1"), "SUBSCRIBED");
    report(numberTopic("n1"), "CHANNEL_ERROR");
    await flush();
    expect(fake.removed).toEqual([]);

    report(numberTopic("n1"), "CHANNEL_ERROR");
    await flush();
    expect(fake.removed).toEqual([numberTopic("n1")]);
  });

  it("is not what a dropped socket looks like", async () => {
    // Same status, opposite meaning. A transport drop errors every channel with
    // the socket already gone; removing those would lose the number's events for
    // the life of the page, since nothing re-derives the set without an access
    // edit.
    visibleNumbers = [{ id: "n1" }];
    const { report, loadedPages, meInvalidations } = setup();
    await flush();
    report(COMPANY_TOPIC, "SUBSCRIBED");
    report(numberTopic("n1"), "SUBSCRIBED");

    fake.setConnected(false);
    report(COMPANY_TOPIC, "CHANNEL_ERROR");
    report(numberTopic("n1"), "CHANNEL_ERROR");
    report(numberTopic("n1"), "CHANNEL_ERROR");
    await flush();
    expect(fake.removed).toEqual([]);

    fake.setConnected(true);
    report(COMPANY_TOPIC, "SUBSCRIBED");
    report(numberTopic("n1"), "SUBSCRIBED");
    expect(meInvalidations()).toBe(1);
    expect(loadedPages()).toBe(1);
  });
});

describe("the reconnect backfill", () => {
  it("runs once for a whole-socket outage, not once per channel", async () => {
    visibleNumbers = [{ id: "n1" }, { id: "n2" }];
    const { report, loadedPages, meInvalidations } = setup();
    await flush();
    const topics = [COMPANY_TOPIC, numberTopic("n1"), numberTopic("n2")];
    for (const topic of topics) report(topic, "SUBSCRIBED");
    // A clean first join records no gap.
    expect(meInvalidations()).toBe(0);

    fake.setConnected(false);
    for (const topic of topics) report(topic, "CHANNEL_ERROR");
    fake.setConnected(true);
    for (const topic of topics) report(topic, "SUBSCRIBED");

    expect(meInvalidations()).toBe(1);
    expect(loadedPages()).toBe(1);
  });

  it("runs when a per-number join timed out unanswered", async () => {
    // The company topic joined cleanly, so it saw nothing — but this number's
    // events were being lost for the whole window, which is a gap of its own.
    // TIMED_OUT is also not the policy answering, so it must not count as a
    // refusal and must not drop the channel.
    visibleNumbers = [{ id: "n1" }];
    const { report, loadedPages, meInvalidations } = setup();
    await flush();
    report(COMPANY_TOPIC, "SUBSCRIBED");

    report(numberTopic("n1"), "TIMED_OUT");
    report(numberTopic("n1"), "SUBSCRIBED");

    expect(fake.removed).toEqual([]);
    expect(meInvalidations()).toBe(1);
    expect(loadedPages()).toBe(1);
  });

  it("runs for a first join that failed and succeeded on a retry", async () => {
    // The gap here runs from page load to the retry, and nothing else closes it:
    // mounted queries stay fresh for thirty seconds and the away-tab resync never
    // fires for someone who never left.
    visibleNumbers = [];
    const { report, loadedPages, meInvalidations } = setup();
    await flush();

    report(COMPANY_TOPIC, "TIMED_OUT");
    report(COMPANY_TOPIC, "SUBSCRIBED");

    expect(meInvalidations()).toBe(1);
    expect(loadedPages()).toBe(1);
  });
});

describe("a bootstrap number list that failed to read", () => {
  // #483 finding 4, the web half. `topicKey` is derived from the hydrated /v1/me
  // and NOTHING re-derived it: React Query gives up after its own two retries,
  // `useMeCompany` has a 60s staleTime, `refetchOnWindowFocus` is off globally,
  // and the focus resync only invalidates the `[companyId]` prefix while the list
  // lives at `["me", ...]`. So one transient 5xx at page load left that tab on the
  // company topic alone for its whole session — which after the contract step is
  // no messages, conversations, calls, tasks or read state, with a green socket
  // and a reload as the only recovery.
  it("is asked for again on a ladder, then given up on rather than polled", async () => {
    vi.useFakeTimers();
    try {
      numberListRead = "failed";
      const { meInvalidations } = setup();
      await flush();

      // Realtime still comes up. Everything company-wide reaches this member
      // while the ladder runs, and during D88's expand window that is every event
      // there is — the retry is what stops the per-number half from being lost.
      expect([...fake.live.keys()]).toEqual([COMPANY_TOPIC]);
      expect(meInvalidations()).toBe(0);

      // Waits FIRST. The read that just failed fails the same way if it is
      // repeated in the same millisecond.
      await vi.advanceTimersByTimeAsync(999);
      expect(meInvalidations()).toBe(0);

      // 1s, then 4s, then 12s — waits BETWEEN attempts, not three offsets from
      // one instant. Armed together, a slow /v1/me would have all three in flight.
      await vi.advanceTimersByTimeAsync(1);
      expect(meInvalidations()).toBe(1);
      await vi.advanceTimersByTimeAsync(4_000);
      expect(meInvalidations()).toBe(2);
      await vi.advanceTimersByTimeAsync(12_000);
      expect(meInvalidations()).toBe(3);

      // Bounded. A /v1/me still down after seventeen seconds is an outage, and
      // the reconnect backfill already invalidates `keys.me` when it ends; polling
      // for the life of the page would buy nothing and cost every tab a request a
      // minute through it.
      await vi.advanceTimersByTimeAsync(600_000);
      expect(meInvalidations()).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops at the first read that works, and joins what it returns", async () => {
    vi.useFakeTimers();
    try {
      numberListRead = "failed";
      const { rerender, meInvalidations } = setup();
      await flush();

      await vi.advanceTimersByTimeAsync(1_000);
      expect(meInvalidations()).toBe(1);

      // The retry landed. The remaining rungs must not fire at a server that has
      // already answered.
      numberListRead = "ok";
      visibleNumbers = [{ id: "n1" }];
      rerender();
      await flush();

      await vi.advanceTimersByTimeAsync(600_000);
      expect(meInvalidations()).toBe(1);
      // And the per-number topic is joined with no reload, which is the whole
      // point of the ladder.
      expect([...fake.live.keys()]).toEqual([COMPANY_TOPIC, numberTopic("n1")]);
      for (const channel of fake.live.values()) {
        expect(channel.report).not.toBeNull();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("is not the same thing as a member who may see no numbers", async () => {
    // THE non-conflation test. This member derives the identical empty topic key
    // and wants the opposite treatment: the server answered, the answer is "none
    // of them", and re-asking every few seconds would be a retry loop against a
    // settled state for every restricted member on every page load.
    visibleNumbers = [];
    vi.useFakeTimers();
    try {
      const { meInvalidations } = setup();
      await flush();

      expect([...fake.live.keys()]).toEqual([COMPANY_TOPIC]);
      await vi.advanceTimersByTimeAsync(600_000);
      expect(meInvalidations()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("access.changed", () => {
  it("re-derives the number list and drops the topic that was taken away", async () => {
    visibleNumbers = [{ id: "n1" }, { id: "n2" }];
    const { report, emit, rerender, meInvalidations } = setup();
    await flush();
    for (const topic of [COMPANY_TOPIC, numberTopic("n1"), numberTopic("n2")]) {
      report(topic, "SUBSCRIBED");
    }

    // The event names nothing but the company (naming the number would broadcast
    // the shape of the restriction), so the client just asks again. Invalidating
    // `keys.me` is the whole mechanism: it lives outside the `[companyId]` prefix
    // and it is what re-derives the topic set.
    emit(COMPANY_TOPIC, "access.changed", { company_id: COMPANY });
    expect(meInvalidations()).toBe(1);

    visibleNumbers = [{ id: "n2" }];
    rerender();
    await flush();

    expect([...fake.live.keys()]).toEqual([COMPANY_TOPIC, numberTopic("n2")]);
    expect(fake.opened.filter((t) => t === numberTopic("n1"))).toHaveLength(1);
    for (const channel of fake.live.values()) {
      expect(channel.report).not.toBeNull();
    }
  });

  it("is subscribed on the company topic, which every member may join", async () => {
    // A member denied every number joins exactly one topic and keeps working —
    // including receiving the signal that their access changed again.
    visibleNumbers = [];
    const { emit, meInvalidations } = setup();
    await flush();

    expect([...fake.live.keys()]).toEqual([COMPANY_TOPIC]);
    emit(COMPANY_TOPIC, "access.changed", { company_id: COMPANY });
    expect(meInvalidations()).toBe(1);
  });
});
