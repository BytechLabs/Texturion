/**
 * @vitest-environment happy-dom
 *
 * The contacts reads: a superseded search is cancelled, a closed dialer reads
 * nothing, a row's prefetch fills the cache the page reads, the duplicates
 * self-join is trusted for 10 minutes and dropped by every write that can
 * make or resolve a pair, and saved field definitions reach cached contacts.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiFetch } = vi.hoisted(() => ({
  apiFetch: vi.fn<
    (path: string, options?: { method?: string; signal?: AbortSignal }) => Promise<unknown>
  >(),
}));

vi.mock("@/lib/company/provider", () => ({ useCompanyId: () => "c-1" }));
vi.mock("./client", () => ({
  apiFetch: (path: string, options?: { method?: string; signal?: AbortSignal }) =>
    apiFetch(path, options),
}));

import { useSaveContactFields } from "./contact-fields";
import {
  contactDetailOptions,
  useContact,
  useContacts,
  useCreateContact,
  useDeleteContact,
  useDuplicateContacts,
  useImportContacts,
  useUpdateContact,
} from "./contacts";
import { useImportVCard } from "./contacts-vcard";
import { keys } from "./keys";

const C = "c-1";
const MINUTE = 60_000;

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  });
}

function mount<T, P>(client: QueryClient, hook: (props: P) => T, initialProps?: P) {
  return renderHook(hook, {
    initialProps,
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ data: [], next_cursor: null });
});

describe("contact search", () => {
  it("CT-1: cancels the request a newer keystroke replaced", async () => {
    const signals: AbortSignal[] = [];
    apiFetch.mockImplementation((_path, options) => {
      if (options?.signal) signals.push(options.signal);
      return new Promise(() => {});
    });
    const client = makeClient();
    const { rerender } = mount(client, ({ q }: { q: string }) => useContacts(q), { q: "smi" });
    await waitFor(() => expect(signals).toHaveLength(1));
    rerender({ q: "smith" });
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it("CT-2: reads nothing while disabled, as the closed dialer is", async () => {
    const client = makeClient();
    mount(client, () => useContacts("", { t9: true, enabled: false }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(apiFetch).not.toHaveBeenCalled();
  });
});

describe("a contact row's prefetch", () => {
  it("CT-3: fills the entry the contact page reads, so the page opens without a second request", async () => {
    apiFetch.mockResolvedValue({ id: "ct-1", name: "Dana" });
    const client = makeClient();
    expect(contactDetailOptions(C, "ct-1").queryKey).toEqual(keys.contacts.detail(C, "ct-1"));
    await client.prefetchQuery(contactDetailOptions(C, "ct-1"));
    const { result } = mount(client, () => useContact("ct-1"));
    expect(result.current.data).toMatchObject({ name: "Dana" });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("the duplicates check", () => {
  async function readsAt(ageMs: number): Promise<boolean> {
    const client = makeClient();
    client.setQueryData(keys.contacts.duplicates(C), { data: [], next_cursor: null }, {
      updatedAt: Date.now() - ageMs,
    });
    mount(client, () => useDuplicateContacts());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return apiFetch.mock.calls.some(([path]) => path === "/v1/contacts/duplicates");
  }

  it("CT-4: is trusted for 10 minutes and kept for 30", async () => {
    expect(await readsAt(5 * MINUTE)).toBe(false);
    apiFetch.mockClear();
    expect(await readsAt(11 * MINUTE)).toBe(true);
    const client = makeClient();
    mount(client, () => useDuplicateContacts());
    const query = client.getQueryCache().find({ queryKey: keys.contacts.duplicates(C) });
    expect(query?.options.gcTime).toBe(30 * MINUTE);
  });

  async function invalidatedBy<T>(
    hook: () => { mutateAsync: (input: T) => Promise<unknown> },
    input: T,
  ): Promise<boolean> {
    const client = makeClient();
    client.setQueryData(keys.contacts.duplicates(C), { data: [], next_cursor: null });
    apiFetch.mockResolvedValue({ id: "ct-1", phone_e164: "+16135550100", name: "Dana" });
    const { result } = mount(client, hook);
    await act(async () => {
      await result.current.mutateAsync(input);
    });
    return client.getQueryState(keys.contacts.duplicates(C))?.isInvalidated ?? false;
  }

  const file = new Blob(["phone\n+16135550100"], { type: "text/csv" });

  it("CT-5: is dropped by a create, a rename, a delete and both imports", async () => {
    expect(await invalidatedBy(useCreateContact, { phone_e164: "+16135550100" })).toBe(true);
    expect(await invalidatedBy(() => useUpdateContact("ct-1"), { name: "Dana R" })).toBe(true);
    expect(await invalidatedBy(useDeleteContact, "ct-1")).toBe(true);
    expect(await invalidatedBy(useImportContacts, { file, consentAttested: true })).toBe(true);
    expect(await invalidatedBy(useImportVCard, { file, consentAttested: true })).toBe(true);
  });

  it("CT-6: survives an edit that cannot change a pair", async () => {
    expect(await invalidatedBy(() => useUpdateContact("ct-1"), { notes: "Gate code" })).toBe(false);
  });
});

describe("saving the field definitions", () => {
  it("CT-7: marks this workspace's cached contacts stale", async () => {
    apiFetch.mockResolvedValue({ data: [], cap: 10 });
    const client = makeClient();
    client.setQueryData(keys.contacts.detail(C, "ct-1"), { id: "ct-1" });
    const { result } = mount(client, () => useSaveContactFields());
    await act(async () => {
      await result.current.mutateAsync([]);
    });
    expect(client.getQueryState(keys.contacts.detail(C, "ct-1"))?.isInvalidated).toBe(true);
  });
});
