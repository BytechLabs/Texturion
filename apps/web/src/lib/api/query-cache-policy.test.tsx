/**
 * @vitest-environment happy-dom
 *
 * How long each read is trusted before it is asked again.
 *
 * The app default stays 30 s. Reference data that a mutation or a broadcast
 * already invalidates is trusted for five minutes, report windows and the
 * Stripe-backed payout account for ten. Each case seeds a cached answer of a
 * given age, mounts the real hook, and counts what reached the API.
 */
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({
  apiFetch: vi.fn<(path: string, options?: { method?: string }) => Promise<unknown>>(),
}));

vi.mock("@/lib/company/provider", () => ({ useCompanyId: () => "c-1" }));
vi.mock("./client", () => ({
  apiFetch: (path: string, options?: { method?: string }) => apiFetch(path, options),
}));
vi.mock("@/components/notifications/service-worker-registrar", () => ({
  ServiceWorkerRegistrar: () => null,
}));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));

import { AppProviders } from "@/app/app-providers";

import { useReferralMoment } from "./billing";
import { useBlockedSenders } from "./blocked-senders";
import { useDataExports } from "./exports";
import { keys } from "./keys";
import { useLeadSources } from "./lead-sources";
import { useNumbers } from "./numbers";
import { useOwnership } from "./ownership";
import { usePayoutAccount } from "./payments";
import { useOutstandingQuotes } from "./quotes";
import {
  useLeadSourceReport,
  usePipelineReport,
  useResponseTime,
  useSatisfaction,
} from "./reports";
import { useSavedViews } from "./saved-views";
import { scheduledKeys, useScheduledMessages, useScheduleMessage } from "./scheduled-messages";
import { useTags } from "./tags";
import { useTemplates } from "./templates";
import { useMembers } from "./team";
import { useUsage } from "./usage";

const MINUTE = 60_000;
const C = "c-1";

/** The app's own default, so a hook without its own staleTime is stale at 30 s. */
function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  });
}

function mount<T>(client: QueryClient, hook: () => T) {
  return renderHook(hook, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

/** Seeds an answer `ageMs` old, mounts the hook, and says whether it re-read. */
async function refetchesAt(
  hook: () => unknown,
  queryKey: readonly unknown[],
  ageMs: number,
): Promise<boolean> {
  const client = makeClient();
  client.setQueryData(queryKey, { data: [] }, { updatedAt: Date.now() - ageMs });
  mount(client, hook);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return apiFetch.mock.calls.length > 0;
}

afterEach(cleanup);

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ data: [] });
});

describe("app defaults", () => {
  it("QC-1: unused data stays 30 minutes and a reconnect leaves freshness to realtime", () => {
    let defaults: ReturnType<QueryClient["getDefaultOptions"]>["queries"] = undefined;
    function Probe() {
      defaults = useQueryClient().getDefaultOptions().queries;
      return null;
    }
    render(
      <AppProviders>
        <Probe />
      </AppProviders>,
    );

    expect(defaults).toMatchObject({
      staleTime: 30_000,
      gcTime: 30 * MINUTE,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    });
  });
});

const fiveMinutes: [string, () => unknown, readonly unknown[]][] = [
  ["useMembers", () => useMembers(), keys.members(C)],
  ["useTags", () => useTags(), keys.tags(C)],
  ["useTemplates", () => useTemplates(), keys.templatesSorted(C, "name")],
  ["useBlockedSenders", () => useBlockedSenders(), keys.blockedSenders(C)],
  ["useSavedViews", () => useSavedViews("conversations"), keys.savedViews(C, "conversations")],
  ["useLeadSources", () => useLeadSources(), ["lead-sources", C]],
  ["useOwnership", () => useOwnership(), keys.ownership(C)],
  ["useNumbers", () => useNumbers(), keys.numbers(C)],
  ["useOutstandingQuotes", () => useOutstandingQuotes(), keys.quotes.outstanding(C)],
];

describe("reference data is trusted for five minutes", () => {
  it.each(fiveMinutes)("QC-2 %s: a two-minute-old answer is not asked again", async (_name, hook, key) => {
    expect(await refetchesAt(hook, key, 2 * MINUTE)).toBe(false);
  });

  it.each(fiveMinutes)("QC-3 %s: a six-minute-old answer is", async (_name, hook, key) => {
    expect(await refetchesAt(hook, key, 6 * MINUTE)).toBe(true);
  });
});

const tenMinutes: [string, () => unknown, readonly unknown[]][] = [
  ["usePayoutAccount", () => usePayoutAccount(), keys.payments.account(C)],
  ["useReferralMoment", () => useReferralMoment(true), [C, "referral-moment"]],
  ["useDataExports", () => useDataExports(), [C, "exports"]],
  ["useResponseTime", () => useResponseTime(30), keys.responseTime(C, 30)],
  ["useLeadSourceReport", () => useLeadSourceReport(30), [...keys.pipeline(C, 30), "lead-sources"]],
  ["usePipelineReport", () => usePipelineReport(30), keys.pipeline(C, 30)],
  ["useSatisfaction", () => useSatisfaction(30), keys.satisfaction(C, 30)],
];

describe("reports, exports and the payout account are trusted for ten minutes", () => {
  it.each(tenMinutes)("QC-4 %s: a seven-minute-old answer is not asked again", async (_name, hook, key) => {
    expect(await refetchesAt(hook, key, 7 * MINUTE)).toBe(false);
  });

  it.each(tenMinutes)("QC-5 %s: an eleven-minute-old answer is", async (_name, hook, key) => {
    expect(await refetchesAt(hook, key, 11 * MINUTE)).toBe(true);
  });

  it("QC-6: a report stays in memory for an hour after its card closes", () => {
    const client = makeClient();
    const { unmount } = mount(client, () => useResponseTime(30));
    unmount();
    const query = client.getQueryCache().find({ queryKey: keys.responseTime(C, 30), exact: true });
    expect(query?.gcTime).toBe(60 * MINUTE);
  });

  it("QC-7: the settings card reads the payout account fresh every time it opens", async () => {
    expect(
      await refetchesAt(
        () => usePayoutAccount(true, { refetchOnMount: "always" }),
        keys.payments.account(C),
        MINUTE,
      ),
    ).toBe(true);
  });
});

describe("reads nobody is looking at are not made", () => {
  it("QC-8: a closed template picker reads no templates", async () => {
    const client = makeClient();
    mount(client, () => useTemplates("use", { enabled: false }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("QC-9: a caller that cannot use the meter does not read usage", async () => {
    const client = makeClient();
    mount(client, () => useUsage({ enabled: false }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe("scheduling a text re-reads the thread's queue once", () => {
  it("QC-10: one invalidation, one request, not a started-and-restarted pair", async () => {
    const threadPath = "/v1/scheduled-messages?conversation_id=conv-1";
    apiFetch.mockImplementation(async (path, options) => {
      if (options?.method === "POST") {
        return { scheduled_message: { id: "s-1", conversation_id: "conv-1" } };
      }
      return { scheduled_messages: [] };
    });
    const client = makeClient();
    client.setQueryData(scheduledKeys.thread(C, "conv-1"), { scheduled_messages: [] });
    const { result } = mount(client, () => ({
      list: useScheduledMessages("conv-1"),
      schedule: useScheduleMessage(),
    }));

    await act(async () => {
      await result.current.schedule.mutateAsync({
        conversationId: "conv-1",
        body: "See you at nine",
        sendAt: new Date(Date.now() + 24 * 60 * MINUTE).toISOString(),
      });
    });
    await waitFor(() => expect(client.isFetching()).toBe(0));

    const reads = apiFetch.mock.calls.filter(([path]) => path === threadPath);
    expect(reads).toHaveLength(1);
  });
});
