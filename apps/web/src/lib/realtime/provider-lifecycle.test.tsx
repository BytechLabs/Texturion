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
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { eventSentence } from "@/components/thread/system-line";
import { keys } from "@/lib/api/keys";
import type { ConversationEvent } from "@/lib/api/types";

import { PAYMENT_EVENT_TYPES, REALTIME_EVENTS } from "./events";
import { REORDER_WINDOW_MS } from "./sequence";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const CONVERSATION = "33333333-3333-3333-3333-333333333333";
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
let numberListRead: "ok" | "failed" | "pending" = "ok";

/** Every API read a handler makes; each test answers it as it needs. */
const api = vi.hoisted(() => ({
  fetch: vi.fn<(path: string, options?: unknown) => Promise<unknown>>(),
}));

vi.mock("@/lib/supabase/browser", () => ({
  getSupabaseBrowser: () => fake.client as unknown as SupabaseClient,
  // `lib/api/client` destructures this at import time, and the provider's module
  // graph reaches it.
  getAccessToken: () => Promise.resolve("token"),
}));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  apiFetch: api.fetch,
}));
vi.mock("sonner", () => ({ toast: () => {} }));
vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ companyId: COMPANY }),
  useCompanyId: () => COMPANY,
}));
vi.mock("@/lib/api/me-company", () => ({
  // React Query's shape narrowed to what the provider reads. A failed read has no
  // `data` at all — including no `flags`, so the #283 kill switch reads as "no
  // statement" and the socket still opens on the company topic.
  useMeCompany: () =>
    numberListRead === "pending"
      ? { data: undefined, isPending: true, isError: false }
      : numberListRead === "failed"
        ? { data: undefined, isPending: false, isError: true }
        : {
            data: {
              user_id: USER,
              flags: {},
              company: { numbers: visibleNumbers },
            },
            isPending: false,
            isError: false,
          },
}));
// The provider reads the active thread from the path and pushes on a toast
// action; neither is under test, and both throw outside a Next router.
vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useRouter: () => ({ push: () => {} }),
}));

import { useForYouNotificationsRealtime } from "./for-you-notifications";
import { RealtimeProvider } from "./provider";

/** Let the effect's `getSession` → `setAuth` → `subscribe` chain settle. */
async function flush() {
  await act(async () => {});
}

const TWO_PAGES = { pages: [{ data: [] }, { data: [] }], pageParams: [null, "c2"] };

/** The app shell's For you and bell listener, mounted beside the provider. */
function ForYouListener() {
  useForYouNotificationsRealtime();
  return null;
}

function setup({ listener = false }: { listener?: boolean } = {}) {
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
      <RealtimeProvider>{listener ? <ForYouListener /> : null}</RealtimeProvider>
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
    /**
     * #607 A6: the client itself, for the two tests that assert a COST rather
     * than a call. `refetchType: "active"` is only observable as the absence of
     * a request, which a spy on `invalidateQueries` cannot see.
     */
    queryClient,
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
    /**
     * EVERY key invalidated so far, in order.
     *
     * `meInvalidations` counts one key; this one exists for the opposite
     * question — what a handler invalidates AND what it does not. An assertion
     * that only checks the wanted key passes just as happily when a handler
     * also refetches three other things.
     */
    invalidatedKeys: () =>
      invalidate.mock.calls.map(([filters]) => filters?.queryKey),
    /** Company-wide refetches: a focus resync, a rejoin backfill or a sequence gap. */
    resyncWaves: () =>
      invalidate.mock.calls.filter(
        ([filters]) =>
          filters?.predicate !== undefined ||
          (filters?.queryKey?.length === 1 && filters.queryKey[0] === COMPANY),
      ).length,
  };
}

/**
 * A mounted query with a counting fetcher, already settled, so each later
 * invalidation that reaches it is exactly one more call.
 */
async function watch(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  data: unknown,
) {
  const fetcher = vi.fn().mockResolvedValue(data);
  const observer = new QueryObserver(queryClient, {
    queryKey: [...queryKey],
    queryFn: fetcher,
    staleTime: Infinity,
  });
  const unsubscribe = observer.subscribe(() => {});
  await vi.waitFor(() =>
    expect(observer.getCurrentResult().isSuccess).toBe(true),
  );
  fetcher.mockClear();
  return { fetcher, unsubscribe };
}

const MESSAGE_ID = "55555555-5555-5555-5555-555555555555";

function listRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CONVERSATION,
    company_id: COMPANY,
    contact_id: "66666666-6666-6666-6666-666666666666",
    phone_number_id: "n1",
    status: "open",
    is_spam: false,
    assigned_user_id: null,
    pinned_at: null,
    pinned_by_user_id: null,
    last_message_at: "2026-11-13T09:00:00.000Z",
    closed_at: null,
    emergency_at: null,
    contact: { id: "66666666-6666-6666-6666-666666666666", name: "Dana", phone_e164: "+14165550100" },
    tags: [],
    unread: false,
    last_message: null,
    ...overrides,
  };
}

const listOf = (...rows: unknown[]) => ({
  pages: [{ data: rows, next_cursor: null }],
  pageParams: [null],
});

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: MESSAGE_ID,
    conversation_id: CONVERSATION,
    direction: "outbound",
    body: "On my way",
    status: "sent",
    created_at: "2026-11-13T09:00:00.000Z",
    done_at: null,
    done_by_user_id: null,
    pinned_at: null,
    pinned_by_user_id: null,
    attachments: [],
    ...overrides,
  };
}

const threadOf = (...messages: unknown[]) => ({
  pages: [{ data: messages, next_cursor: null }],
  pageParams: [undefined],
});

/** The API reads one handler made, by path. */
const apiCalls = (path: string) =>
  api.fetch.mock.calls.filter(([called]) => called === path);

beforeEach(() => {
  fake = createFakeSupabase();
  visibleNumbers = [];
  numberListRead = "ok";
  api.fetch.mockReset();
  api.fetch.mockImplementation(() => Promise.reject(new Error("no answer")));
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
      // Drained more than once, deliberately. The retry is a timer that starts
      // an async chain (getSession -> setAuth -> subscribe), and `flush` is a
      // single `act` drain — enough when the machine is idle, not always enough
      // when it is not. This failed in CI at 85s for the suite against ~22s
      // locally, on the one assertion whose subject is scheduled rather than
      // immediate.
      //
      // It cannot mask a real regression: if the number were never re-opened,
      // no number of drains would make it appear.
      for (let i = 0; i < 5; i += 1) await flush();

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
      // while the ladder runs — `access.changed` and `number_set.changed` above
      // all — but since the contract step that is ALL this tab would ever get.
      // The retry is what stops the per-number half from being lost.
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

describe("a hole in the topic sequence", () => {
  const sequenced = (
    emit: (topic: string, event: string, payload: unknown) => void,
    topic: string,
    seq: number,
  ) => emit(topic, "*", { seq });

  it("resyncs like a connection gap once the reorder window has passed", async () => {
    vi.useFakeTimers();
    try {
      visibleNumbers = [{ id: "n1" }];
      const { emit, report, loadedPages, meInvalidations } = setup();
      await flush();
      report(COMPANY_TOPIC, "SUBSCRIBED");
      report(numberTopic("n1"), "SUBSCRIBED");
      const topic = numberTopic("n1");

      sequenced(emit, topic, 7);
      sequenced(emit, topic, 8);
      sequenced(emit, topic, 10);
      expect(meInvalidations()).toBe(0);

      await vi.advanceTimersByTimeAsync(REORDER_WINDOW_MS);
      expect(meInvalidations()).toBe(1);
      expect(loadedPages()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing when the late event arrives inside the window", async () => {
    vi.useFakeTimers();
    try {
      visibleNumbers = [{ id: "n1" }];
      const { emit, report, meInvalidations } = setup();
      await flush();
      report(COMPANY_TOPIC, "SUBSCRIBED");
      report(numberTopic("n1"), "SUBSCRIBED");
      const topic = numberTopic("n1");

      sequenced(emit, topic, 1);
      sequenced(emit, topic, 3);
      await vi.advanceTimersByTimeAsync(REORDER_WINDOW_MS - 1);
      sequenced(emit, topic, 2);
      await vi.advanceTimersByTimeAsync(REORDER_WINDOW_MS * 2);
      expect(meInvalidations()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts over after a rejoin, which the connection backfill already covers", async () => {
    vi.useFakeTimers();
    try {
      visibleNumbers = [{ id: "n1" }];
      const { emit, report, meInvalidations } = setup();
      await flush();
      report(COMPANY_TOPIC, "SUBSCRIBED");
      report(numberTopic("n1"), "SUBSCRIBED");
      const topic = numberTopic("n1");

      sequenced(emit, topic, 5);
      report(topic, "SUBSCRIBED");
      sequenced(emit, topic, 900);
      await vi.advanceTimersByTimeAsync(REORDER_WINDOW_MS * 2);
      expect(meInvalidations()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the subscribed event set", () => {
  it("is exactly REALTIME_EVENTS, in both directions, on every topic", async () => {
    // REALTIME_EVENTS was documentation with no consumer and it had drifted:
    // `call.updated` and `access.changed` were both being received and neither
    // was in the list. Set equality BOTH ways is the point — a listed event with
    // no binding is an event this client silently never receives, and a binding
    // with no entry is how the list rotted in the first place.
    //
    // Per channel, because #480 registers the SAME handler set on the company
    // topic and every per-number topic, and that uniformity is what lets the
    // server move an event between topics without a client edit.
    visibleNumbers = [{ id: "n1" }, { id: "n2" }];
    setup();
    await flush();

    expect(fake.live.size).toBe(3);
    for (const channel of fake.live.values()) {
      // "*" is the sequence listener (D151), not an event.
      const events = [...channel.bindings.keys()].filter((e) => e !== "*");
      expect(new Set(events)).toEqual(new Set(REALTIME_EVENTS));
    }
  });
});

describe("payment.updated", () => {
  it("refetches that thread's payment requests, and only those", async () => {
    // #607. The deposit clearing is the one broadcast somebody is actively
    // waiting on, and until this handler existed it arrived on the next fetch.
    visibleNumbers = [{ id: "n1" }];
    const { emit, report, invalidatedKeys } = setup();
    await flush();
    report(COMPANY_TOPIC, "SUBSCRIBED");
    report(numberTopic("n1"), "SUBSCRIBED");
    const before = invalidatedKeys().length;

    emit(numberTopic("n1"), "payment.updated", {
      conversation_id: CONVERSATION,
      payment_request_id: "44444444-4444-4444-4444-444444444444",
      // The shipped constant, not the string retyped — the three labels are the
      // `conversation_event_type` values the trigger publishes verbatim.
      type: PAYMENT_EVENT_TYPES[0],
    });

    // EXACTLY two invalidations, in order. `toEqual` on the whole slice rather
    // than a `toContainEqual`, so an extra refetch nobody asked for fails here.
    // The timeline is the second (#607 A3): the same insert is an audit row and
    // every client now narrates it, so refreshing the strip alone would leave
    // "Paid" above a transcript with no line saying so.
    expect(invalidatedKeys().slice(before)).toEqual([
      keys.payments.requests(COMPANY, CONVERSATION),
      keys.conversations.events(COMPANY, CONVERSATION),
    ]);
  });

  it("reaches the same handler for a refund and a dispute", async () => {
    // The handler deliberately does not branch on `type` — the strip renders all
    // three outcomes and re-reads the whole row for each. This pins that the
    // OTHER two are handled at all, which a single happy-path test would not:
    // a future `if (type === 'payment_paid')` would leave a refund silently on
    // screen as Paid, which is the worst of the three to be wrong about.
    visibleNumbers = [{ id: "n1" }];
    const { emit, report, invalidatedKeys } = setup();
    await flush();
    report(numberTopic("n1"), "SUBSCRIBED");

    for (const type of PAYMENT_EVENT_TYPES) {
      const before = invalidatedKeys().length;
      emit(numberTopic("n1"), "payment.updated", {
        conversation_id: CONVERSATION,
        payment_request_id: null,
        type,
      });
      expect(invalidatedKeys().slice(before)).toEqual([
        keys.payments.requests(COMPANY, CONVERSATION),
        keys.conversations.events(COMPANY, CONVERSATION),
      ]);
    }
  });

  it("refreshes the timeline because there is now a line to refresh", () => {
    // THE PREMISE behind the second invalidation, asserted rather than trusted —
    // a comment about another module's switch statement is exactly the kind that
    // outlives its fact, and this one did. Round one omitted the events refetch
    // and argued the omission at length: web narrated no payment line, because
    // the five labels were missing from `ConversationEventType` and
    // `eventSentence` fell off the end of its switch. That was true and is not
    // now (#607 A3), which is why this test is the INVERSE of the one it
    // replaces rather than a deletion.
    //
    // Every BROADCAST type must narrate: those are the three that arrive without
    // a fetch, so a type that rendered nothing would have the handler buying a
    // page of history per payment for a blank row.
    for (const type of PAYMENT_EVENT_TYPES) {
      const event: ConversationEvent = {
        id: "e1",
        conversation_id: CONVERSATION,
        actor_user_id: null,
        type,
        payload: { amount_cents: 25_000, currency: "usd" },
        created_at: "2026-08-11T10:00:00Z",
      };
      expect(eventSentence(event, () => null), type).toBeTruthy();
    }
  });

  it("costs no request for a thread nobody has open", async () => {
    // #607 A6 — `refetchType: "active"` is a COST CLAIM ("a payment on a thread
    // nobody has open costs a cache mark and no request") and nothing asserted
    // it. Widening it to "all" refetches EVERY cached thread's payment list on
    // every payment in the workspace — verified by making that edit, which
    // fails here with two calls where the claim allows one.
    //
    // Proved as an ABSENCE OF A FETCH rather than by retyping the option: the
    // spy on `invalidateQueries` sees the call either way, so it cannot tell
    // the two apart. ("active" is also React Query's default, so a test that
    // watched for the word would pass on a handler that omitted it and fail on
    // one that stated it — the opposite of what is worth knowing.)
    visibleNumbers = [{ id: "n1" }];
    const { emit, report, queryClient } = setup();
    await flush();
    report(numberTopic("n1"), "SUBSCRIBED");

    // A real query with a real fetcher, cached and then left unobserved — which
    // is every thread the reader is not currently looking at.
    const fetcher = vi.fn().mockResolvedValue({ payment_requests: [] });
    await act(async () => {
      await queryClient.fetchQuery({
        queryKey: keys.payments.requests(COMPANY, CONVERSATION),
        queryFn: fetcher,
      });
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    emit(numberTopic("n1"), "payment.updated", {
      conversation_id: CONVERSATION,
      payment_request_id: null,
      type: PAYMENT_EVENT_TYPES[0],
    });
    await flush();
    await flush();

    expect(fetcher).toHaveBeenCalledTimes(1);
    // …and the MARK is there, so the strip is right the moment that thread is
    // opened. Without this half, the test would pass just as happily on a
    // handler that did nothing at all.
    expect(
      queryClient
        .getQueryCache()
        .find({ queryKey: keys.payments.requests(COMPANY, CONVERSATION) })
        ?.isStale(),
    ).toBe(true);
  });

  it("does refetch the thread somebody is looking at", async () => {
    // The other side of the same claim, and the reason the option is "active"
    // rather than "none": the whole point of #607 is the strip changing under
    // the reader while they watch it.
    visibleNumbers = [{ id: "n1" }];
    const { emit, report, queryClient } = setup();
    await flush();
    report(numberTopic("n1"), "SUBSCRIBED");

    const fetcher = vi.fn().mockResolvedValue({ payment_requests: [] });
    const observer = new QueryObserver(queryClient, {
      queryKey: keys.payments.requests(COMPANY, CONVERSATION),
      queryFn: fetcher,
    });
    // A subscribed observer is what "active" MEANS to React Query — the same
    // state a mounted `usePaymentRequests` puts the query in.
    const unsubscribe = observer.subscribe(() => {});
    // WAIT FOR THE FIRST FETCH TO SETTLE, not merely to start. A query still in
    // flight with no data yet DEDUPES the next fetch onto the promise it
    // already has, so invalidating a millisecond too early counts one call and
    // looks exactly like the bug this test is for.
    await vi.waitFor(() =>
      expect(observer.getCurrentResult().isSuccess).toBe(true),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);

    emit(numberTopic("n1"), "payment.updated", {
      conversation_id: CONVERSATION,
      payment_request_id: null,
      type: PAYMENT_EVENT_TYPES[0],
    });

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    unsubscribe();
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

describe("what a read costs", () => {
  it("is For you alone for a conversation read, and the bell alone for a bell read", async () => {
    // The bell has no conversation_reads arm, so a conversation read never
    // moves it. This tab cleared the row when it posted the read, so the echo
    // also has no list to ask again: the unread list drops the row locally.
    vi.useFakeTimers();
    try {
      visibleNumbers = [{ id: "n1" }];
      const { queryClient, emit, report } = setup({ listener: true });
      await flush();
      report(COMPANY_TOPIC, "SUBSCRIBED");
      const unreadKey = keys.conversations.list(COMPANY, { unread: true });
      const inbox = await watch(queryClient, keys.conversations.list(COMPANY, {}), listOf(listRow()));
      const unreadOnly = await watch(queryClient, unreadKey, listOf(listRow()));
      const forYou = await watch(queryClient, keys.forYou(COMPANY), { sections: [] });
      const badge = await watch(queryClient, keys.notifications.unreadCount(COMPANY), { count: 0 });
      const feed = await watch(queryClient, keys.notifications.feed(COMPANY), { data: [] });

      emit(COMPANY_TOPIC, "read.conversation", { user_id: USER, conversation_id: CONVERSATION });
      await vi.advanceTimersByTimeAsync(1_000);

      expect(badge.fetcher).not.toHaveBeenCalled();
      expect(feed.fetcher).not.toHaveBeenCalled();
      expect(inbox.fetcher).not.toHaveBeenCalled();
      expect(unreadOnly.fetcher).not.toHaveBeenCalled();
      expect(forYou.fetcher).toHaveBeenCalledTimes(1);
      expect(
        (queryClient.getQueryData(unreadKey) as { pages: { data: unknown[] }[] }).pages[0].data,
      ).toEqual([]);

      emit(COMPANY_TOPIC, "read.notifications", { user_id: USER });
      await vi.advanceTimersByTimeAsync(1_000);

      expect(badge.fetcher).toHaveBeenCalledTimes(1);
      expect(feed.fetcher).toHaveBeenCalledTimes(1);
      expect(forYou.fetcher).toHaveBeenCalledTimes(1);
      expect(inbox.fetcher).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("still clears the dot another device read", async () => {
    vi.useFakeTimers();
    try {
      visibleNumbers = [{ id: "n1" }];
      const { queryClient, emit, report } = setup();
      await flush();
      report(COMPANY_TOPIC, "SUBSCRIBED");
      const inboxKey = keys.conversations.list(COMPANY, {});
      await watch(queryClient, inboxKey, listOf(listRow({ unread: true })));

      emit(COMPANY_TOPIC, "read.conversation", { user_id: USER, conversation_id: CONVERSATION });

      const rows = (queryClient.getQueryData(inboxKey) as { pages: { data: { unread: boolean }[] }[] })
        .pages[0].data;
      expect(rows.map((row) => row.unread)).toEqual([false]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("what a delivery receipt costs", () => {
  it("is no For you and no timeline for a status tick, and one of each after a done change", async () => {
    vi.useFakeTimers();
    try {
      visibleNumbers = [{ id: "n1" }];
      const { queryClient, emit, report } = setup({ listener: true });
      await flush();
      report(numberTopic("n1"), "SUBSCRIBED");
      const threadKey = keys.thread(COMPANY, CONVERSATION);
      queryClient.setQueryData(threadKey, threadOf(message()));
      const forYou = await watch(queryClient, keys.forYou(COMPANY), { sections: [] });
      const badge = await watch(queryClient, keys.notifications.unreadCount(COMPANY), { count: 0 });
      const timeline = await watch(
        queryClient,
        keys.conversations.events(COMPANY, CONVERSATION),
        { pages: [], pageParams: [] },
      );
      const receipt = {
        message_id: MESSAGE_ID,
        status: "delivered",
        done_at: null,
        done_by_user_id: null,
        pinned_at: null,
        pinned_by_user_id: null,
      };

      emit(numberTopic("n1"), "message.status", receipt);
      await vi.advanceTimersByTimeAsync(1_000);

      const cached = () =>
        (queryClient.getQueryData(threadKey) as { pages: { data: { status: string; done_at: string | null }[] }[] })
          .pages[0].data[0];
      expect(cached().status).toBe("delivered");
      expect(forYou.fetcher).not.toHaveBeenCalled();
      expect(badge.fetcher).not.toHaveBeenCalled();
      expect(timeline.fetcher).not.toHaveBeenCalled();

      emit(numberTopic("n1"), "message.status", {
        ...receipt,
        done_at: "2026-11-13T10:00:00.000Z",
        done_by_user_id: USER,
      });
      expect(cached().done_at).toBe("2026-11-13T10:00:00.000Z");
      await vi.advanceTimersByTimeAsync(399);
      expect(forYou.fetcher).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(forYou.fetcher).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(forYou.fetcher).toHaveBeenCalledTimes(1);
      expect(timeline.fetcher).toHaveBeenCalledTimes(1);
      expect(badge.fetcher).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("conversation.updated", () => {
  it("fetches nothing for a conversation this tab holds nothing of, and still moves the queue and the bell", async () => {
    // An assignment to me must reach For you and the bell even when no list,
    // detail or thread of that conversation is loaded here.
    vi.useFakeTimers();
    try {
      visibleNumbers = [{ id: "n1" }];
      const { queryClient, emit, report } = setup();
      await flush();
      report(numberTopic("n1"), "SUBSCRIBED");
      const forYou = await watch(queryClient, keys.forYou(COMPANY), { sections: [] });
      const badge = await watch(queryClient, keys.notifications.unreadCount(COMPANY), { count: 0 });

      emit(numberTopic("n1"), "conversation.updated", { conversation_id: CONVERSATION });
      await vi.advanceTimersByTimeAsync(2_000);

      expect(apiCalls(`/v1/conversations/${CONVERSATION}`)).toHaveLength(0);
      expect(forYou.fetcher).toHaveBeenCalledTimes(1);
      expect(badge.fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves the timeline alone when nothing it narrates moved", async () => {
    vi.useFakeTimers();
    try {
      visibleNumbers = [{ id: "n1" }];
      const { queryClient, emit, report } = setup();
      await flush();
      report(numberTopic("n1"), "SUBSCRIBED");
      const detail = {
        ...listRow(),
        contact: { ...listRow().contact },
        messages: { data: [], next_cursor: null },
      };
      queryClient.setQueryData(keys.conversations.detail(COMPANY, CONVERSATION), detail);
      const timeline = await watch(
        queryClient,
        keys.conversations.events(COMPANY, CONVERSATION),
        { pages: [], pageParams: [] },
      );
      api.fetch.mockImplementation((path) =>
        path === `/v1/conversations/${CONVERSATION}`
          ? Promise.resolve(detail)
          : Promise.reject(new Error("no answer")),
      );

      emit(numberTopic("n1"), "conversation.updated", { conversation_id: CONVERSATION });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(apiCalls(`/v1/conversations/${CONVERSATION}`)).toHaveLength(1);
      expect(timeline.fetcher).not.toHaveBeenCalled();

      api.fetch.mockImplementation((path) =>
        path === `/v1/conversations/${CONVERSATION}`
          ? Promise.resolve({ ...detail, assigned_user_id: USER })
          : Promise.reject(new Error("no answer")),
      );
      emit(numberTopic("n1"), "conversation.updated", { conversation_id: CONVERSATION });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(timeline.fetcher).toHaveBeenCalledTimes(1);
      // A thread that was never opened is not created by an update.
      expect(queryClient.getQueryData(keys.thread(COMPANY, CONVERSATION))).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("refreshes the pinned supplement when a teammate edits a pin past the loaded pages", async () => {
    vi.useFakeTimers();
    try {
      visibleNumbers = [{ id: "n1" }];
      const { queryClient, emit, report } = setup();
      await flush();
      report(numberTopic("n1"), "SUBSCRIBED");
      const pinnedRow = listRow({ pinned_at: "2026-11-12T08:00:00.000Z", pinned_by_user_id: USER });
      const pinned = await watch(queryClient, keys.conversations.pinned(COMPANY, {}), {
        data: [pinnedRow],
        next_cursor: null,
      });
      const detail = {
        ...pinnedRow,
        contact: { ...pinnedRow.contact },
        messages: { data: [], next_cursor: null },
      };
      const answer = (body: unknown) =>
        api.fetch.mockImplementation((path) =>
          path === `/v1/conversations/${CONVERSATION}`
            ? Promise.resolve(body)
            : Promise.reject(new Error("no answer")),
        );

      answer(detail);
      emit(numberTopic("n1"), "conversation.updated", { conversation_id: CONVERSATION });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(apiCalls(`/v1/conversations/${CONVERSATION}`)).toHaveLength(1);
      expect(pinned.fetcher).not.toHaveBeenCalled();

      answer({ ...detail, assigned_user_id: USER });
      emit(numberTopic("n1"), "conversation.updated", { conversation_id: CONVERSATION });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(pinned.fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("message.created", () => {
  const messagesPath = `/v1/conversations/${CONVERSATION}/messages`;
  const limits = () =>
    apiCalls(messagesPath).map(
      ([, options]) => (options as { searchParams?: { limit?: number } }).searchParams?.limit,
    );

  async function arrive(thread?: unknown) {
    visibleNumbers = [{ id: "n1" }];
    const { queryClient, emit, report } = setup();
    await flush();
    report(numberTopic("n1"), "SUBSCRIBED");
    queryClient.setQueryData(keys.conversations.list(COMPANY, {}), listOf(listRow()));
    if (thread) queryClient.setQueryData(keys.thread(COMPANY, CONVERSATION), thread);
    const inbound = message({ direction: "inbound", status: "received" });
    api.fetch.mockImplementation((path) =>
      path === messagesPath
        ? Promise.resolve({ data: [inbound], next_cursor: null })
        : Promise.reject(new Error("no answer")),
    );
    emit(numberTopic("n1"), "message.created", {
      conversation_id: CONVERSATION,
      message_id: MESSAGE_ID,
      direction: "inbound",
    });
    await flush();
    await flush();
    return queryClient;
  }

  it("asks for one message when the thread was never opened", async () => {
    const queryClient = await arrive();
    expect(limits()).toEqual([1]);
    const row = (queryClient.getQueryData(keys.conversations.list(COMPANY, {})) as {
      pages: { data: { unread: boolean; last_message: { id: string } | null }[] }[];
    }).pages[0].data[0];
    expect(row.unread).toBe(true);
    expect(row.last_message?.id).toBe(MESSAGE_ID);
  });

  it("asks for a page when an open thread lacks the message", async () => {
    await arrive(threadOf());
    expect(limits()).toEqual([25]);
  });

  it("asks for nothing when the thread already holds it", async () => {
    await arrive(threadOf(message({ direction: "inbound", status: "received" })));
    expect(limits()).toEqual([]);
  });
});

describe("port.updated", () => {
  it("refreshes the transfers, the company and the numbers, once per burst", async () => {
    vi.useFakeTimers();
    try {
      visibleNumbers = [{ id: "n1" }];
      const { emit, report, invalidatedKeys } = setup();
      await flush();
      report(numberTopic("n1"), "SUBSCRIBED");
      const before = invalidatedKeys().length;

      emit(numberTopic("n1"), "port.updated", { port_request_id: "p1", status: "submitted" });
      emit(numberTopic("n1"), "port.updated", { port_request_id: "p1", status: "submitted" });
      await vi.advanceTimersByTimeAsync(400);

      expect(invalidatedKeys().slice(before)).toEqual([
        keys.portRequests.all(COMPANY),
        keys.company(COMPANY),
        keys.numbers(COMPANY),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the away-tab resync", () => {
  const away = async (ms: number) => {
    window.dispatchEvent(new Event("blur"));
    await vi.advanceTimersByTimeAsync(ms);
  };
  const focus = () => window.dispatchEvent(new Event("focus"));
  const invalidated = (queryClient: QueryClient, key: readonly unknown[]) =>
    queryClient.getQueryCache().find({ queryKey: [...key], exact: true })?.state.isInvalidated;

  it("skips fresh keys no broadcast feeds, and every signed URL", async () => {
    vi.useFakeTimers();
    try {
      const { queryClient, report } = setup();
      await flush();
      report(COMPANY_TOPIC, "SUBSCRIBED");
      // Held past the default five-minute collection, as a mounted query is.
      queryClient.setQueryDefaults([COMPANY], { gcTime: Infinity });
      const signedUrl = keys.attachmentUrl(COMPANY, "a1");
      const oldTemplates = keys.templatesSorted(COMPANY, "use");
      queryClient.setQueryData(signedUrl, { url: "https://cdn.example/a1" });
      queryClient.setQueryData(oldTemplates, []);
      await vi.advanceTimersByTimeAsync(6 * 60_000);
      const freshTemplates = keys.templates(COMPANY);
      const inbox = keys.conversations.list(COMPANY, {});
      queryClient.setQueryData(freshTemplates, []);
      queryClient.setQueryData(inbox, listOf(listRow()));

      await away(31_000);
      focus();
      await vi.advanceTimersByTimeAsync(3_000);

      expect(invalidated(queryClient, inbox)).toBe(true);
      expect(invalidated(queryClient, oldTemplates)).toBe(true);
      expect(invalidated(queryClient, freshTemplates)).toBe(false);
      expect(invalidated(queryClient, signedUrl)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is one wave for a rejoin followed by a focus", async () => {
    vi.useFakeTimers();
    try {
      const { report, resyncWaves } = setup();
      await flush();
      report(COMPANY_TOPIC, "SUBSCRIBED");

      window.dispatchEvent(new Event("blur"));
      fake.setConnected(false);
      report(COMPANY_TOPIC, "CHANNEL_ERROR");
      await vi.advanceTimersByTimeAsync(40_000);
      fake.setConnected(true);
      report(COMPANY_TOPIC, "SUBSCRIBED");
      focus();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(resyncWaves()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is one wave for a focus followed by a rejoin", async () => {
    // Back from the background, the socket can still look connected for the
    // moment it takes the heartbeat to fail. The rejoin's backfill covers both.
    vi.useFakeTimers();
    try {
      const { report, resyncWaves } = setup();
      await flush();
      report(COMPANY_TOPIC, "SUBSCRIBED");

      await away(40_000);
      focus();
      await vi.advanceTimersByTimeAsync(1_000);
      fake.setConnected(false);
      report(COMPANY_TOPIC, "CHANNEL_ERROR");
      fake.setConnected(true);
      report(COMPANY_TOPIC, "SUBSCRIBED");
      await vi.advanceTimersByTimeAsync(5_000);

      expect(resyncWaves()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for the rejoin when the socket is down at focus", async () => {
    vi.useFakeTimers();
    try {
      const { report, resyncWaves } = setup();
      await flush();
      report(COMPANY_TOPIC, "SUBSCRIBED");

      await away(40_000);
      fake.setConnected(false);
      focus();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(resyncWaves()).toBe(0);

      fake.setConnected(true);
      report(COMPANY_TOPIC, "SUBSCRIBED");
      expect(resyncWaves()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the API when the socket never comes back", async () => {
    // A network that blocks websockets: the company topic errors, nothing
    // rejoins, and the focus resync is the only net left.
    vi.useFakeTimers();
    try {
      const { report, resyncWaves } = setup();
      await flush();
      report(COMPANY_TOPIC, "SUBSCRIBED");
      fake.setConnected(false);
      report(COMPANY_TOPIC, "CHANNEL_ERROR");

      await away(40_000);
      focus();
      await vi.advanceTimersByTimeAsync(9_999);
      expect(resyncWaves()).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(resyncWaves()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still runs when no rejoin comes", async () => {
    // A frame lost at the very end of a burst has no other way back.
    vi.useFakeTimers();
    try {
      const { report, resyncWaves } = setup();
      await flush();
      report(COMPANY_TOPIC, "SUBSCRIBED");

      await away(40_000);
      focus();
      await vi.advanceTimersByTimeAsync(2_999);
      expect(resyncWaves()).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(resyncWaves()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the first socket", () => {
  it("is not built until /v1/me has answered, so it already has the number topics", async () => {
    numberListRead = "pending";
    const { rerender } = setup();
    await flush();
    expect(fake.opened).toEqual([]);

    numberListRead = "ok";
    visibleNumbers = [{ id: "n1" }];
    rerender();
    await flush();
    expect(fake.opened).toEqual([COMPANY_TOPIC, numberTopic("n1")]);
  });
});
