/**
 * @vitest-environment happy-dom
 *
 * The contacts table keeps its view in the URL so Back restores it, types
 * without re-rendering a row, re-renders only the row whose box was ticked,
 * and starts a contact's read before its page does.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useMemo, useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import type { ContactListItem } from "@/lib/api/types";

const { router, contactsCalls, actionsRendered, listData } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn() },
  contactsCalls: [] as { q: string; options: unknown }[],
  actionsRendered: new Map<string, number>(),
  listData: { current: undefined as unknown },
}));

/** Next follows history writes; this stands in for its patched replaceState. */
const URL_CHANGED = "test:url";
function subscribe(onChange: () => void) {
  window.addEventListener(URL_CHANGED, onChange);
  return () => window.removeEventListener(URL_CHANGED, onChange);
}

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => {
    const search = useSyncExternalStore(subscribe, () => window.location.search);
    return useMemo(() => new URLSearchParams(search), [search]);
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a
      href={href}
      {...props}
      onClick={(event) => event.preventDefault()}
    >
      {children}
    </a>
  ),
}));
vi.mock("@/lib/company/provider", () => ({
  useCompanyId: () => "c-1",
  useActiveCompany: () => ({ role: "owner" }),
}));
vi.mock("@/lib/api/contacts", () => ({
  useContacts: (q: string, options: unknown) => {
    contactsCalls.push({ q, options });
    return {
      data: listData.current,
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    };
  },
  contactDetailOptions: (companyId: string, id: string) => ({
    queryKey: [companyId, "contacts", "detail", id],
    queryFn: () => new Promise(() => {}),
  }),
}));
vi.mock("@/components/contacts/contact-record-actions", () => ({
  useContactActions: ({ contact }: { contact: { id: string } }) => {
    actionsRendered.set(contact.id, (actionsRendered.get(contact.id) ?? 0) + 1);
    return { actions: [], dialogs: null };
  },
}));
vi.mock("@/components/contacts/contacts-bulk-bar", () => ({
  ContactsBulkBar: ({ selected }: { selected: unknown[] }) => <p>{selected.length} selected</p>,
}));
vi.mock("@/components/contacts/contact-filter", () => ({
  ContactListFilter: ({
    onTag,
    onField,
  }: {
    onTag: (tag: string | undefined) => void;
    onField: (field: { key: string; value: string } | undefined) => void;
  }) => (
    <>
      <button type="button" onClick={() => onTag("t-9")}>Pick tag</button>
      <button type="button" onClick={() => onField({ key: "has_dog", value: "" })}>
        Pick field
      </button>
    </>
  ),
  ContactActiveFilters: () => null,
}));

import { ContactsTable } from "./contacts-table";

function contact(id: string, name: string): ContactListItem {
  return {
    id,
    name,
    phone_e164: "+16135550100",
    opted_out: false,
    tags: [],
    last_activity_at: null,
  } as unknown as ContactListItem;
}

let client: QueryClient;
let prefetch: MockInstance<(options: { queryKey: unknown }) => Promise<void>>;

function mount() {
  return render(
    <QueryClientProvider client={client}>
      <ContactsTable />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  router.push.mockReset();
  contactsCalls.length = 0;
  actionsRendered.clear();
  listData.current = {
    pages: [{ data: [contact("ct-1", "Dana"), contact("ct-2", "Sam")], next_cursor: null }],
    pageParams: [undefined],
  };
  client = new QueryClient();
  prefetch = vi.spyOn(client, "prefetchQuery") as unknown as typeof prefetch;
  const replace = window.history.replaceState.bind(window.history);
  vi.spyOn(window.history, "replaceState").mockImplementation((data, unused, url) => {
    replace(data, unused, url);
    window.dispatchEvent(new Event(URL_CHANGED));
  });
  window.history.pushState(null, "", "/contacts");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the view lives in the URL", () => {
  it("CL-1: opens on the search, tag and field the URL names", () => {
    window.history.pushState(null, "", "/contacts?q=smith&tag=t-1&field=system_type&value=Combi");
    mount();
    expect(contactsCalls.at(-1)).toEqual({
      q: "smith",
      options: { field: { key: "system_type", value: "Combi" }, tagId: "t-1" },
    });
    expect(screen.getByRole("searchbox")).toHaveProperty("value", "smith");
  });

  it("CL-2: writes the settled search with replaceState and keeps the dialer's param", () => {
    vi.useFakeTimers();
    window.history.pushState(null, "", "/contacts?new=6135550101");
    mount();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "dana " } });
    act(() => vi.advanceTimersByTime(250));
    expect(window.location.search).toBe("?new=6135550101&q=dana");
    expect(contactsCalls.at(-1)?.q).toBe("dana");
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("CL-3: writes the tag and the field answer, an empty answer included", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Pick tag" }));
    fireEvent.click(screen.getByRole("button", { name: "Pick field" }));
    expect(window.location.search).toBe("?tag=t-9&field=has_dog&value=");
    expect(contactsCalls.at(-1)?.options).toEqual({
      field: { key: "has_dog", value: "" },
      tagId: "t-9",
    });
  });

  it("CL-11: keeps the typed text, trailing space included, when its own write comes back", () => {
    vi.useFakeTimers();
    mount();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "dana " } });
    act(() => vi.advanceTimersByTime(250));
    expect(screen.getByRole("searchbox")).toHaveProperty("value", "dana ");
  });

  it("CL-12: empties the box when a link opens plain /contacts on the same page", () => {
    window.history.pushState(null, "", "/contacts?q=smith");
    mount();
    act(() => {
      window.history.pushState(null, "", "/contacts");
      window.dispatchEvent(new Event(URL_CHANGED));
    });
    expect(screen.getByRole("searchbox")).toHaveProperty("value", "");
    expect(contactsCalls.at(-1)?.q).toBe("");
  });
});

describe("rows re-render only when they change", () => {
  it("CL-4: typing re-renders no row", () => {
    vi.useFakeTimers();
    mount();
    const before = new Map(actionsRendered);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "d" } });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "da" } });
    expect(actionsRendered).toEqual(before);
  });

  it("CL-5: ticking a box re-renders that row alone", () => {
    mount();
    const before = new Map(actionsRendered);
    fireEvent.click(screen.getByRole("checkbox", { name: /Dana/ }));
    expect(screen.getByText("1 selected")).toBeTruthy();
    expect(actionsRendered.get("ct-1")).toBe((before.get("ct-1") ?? 0) + 1);
    expect(actionsRendered.get("ct-2")).toBe(before.get("ct-2"));
  });
});

describe("a row starts its contact's read", () => {
  const detailKey = (id: string) => ["c-1", "contacts", "detail", id];
  const prefetched = () =>
    prefetch.mock.calls.map(([options]) => options.queryKey);

  function row(name: string): HTMLElement {
    return screen.getByText(name).closest("tr") as HTMLElement;
  }

  it("CL-6: after 100 ms of mouse hover, not on a pass", () => {
    vi.useFakeTimers();
    mount();
    fireEvent.pointerEnter(row("Sam"), { pointerType: "mouse" });
    fireEvent.pointerLeave(row("Sam"), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(200));
    expect(prefetch).not.toHaveBeenCalled();
    fireEvent.pointerEnter(row("Dana"), { pointerType: "mouse" });
    act(() => vi.advanceTimersByTime(100));
    expect(prefetched()).toEqual([detailKey("ct-1")]);
  });

  it("CL-7: on focus and on touch", () => {
    mount();
    fireEvent.focus(screen.getByRole("link", { name: "Dana" }));
    fireEvent.touchStart(row("Sam"));
    expect(prefetched()).toEqual([detailKey("ct-1"), detailKey("ct-2")]);
  });

  it("CL-8: on click, before the navigation", () => {
    const order: string[] = [];
    prefetch.mockImplementation(async () => {
      order.push("prefetch");
    });
    router.push.mockImplementation(() => order.push("push"));
    mount();
    fireEvent.click(row("Dana").querySelectorAll("td")[2]);
    expect(order).toEqual(["prefetch", "push"]);
    expect(router.push).toHaveBeenCalledWith("/contacts/ct-1");
  });

  it("CL-9: a click on the name link prefetches and leaves the navigation to the link", () => {
    mount();
    fireEvent.click(screen.getByRole("link", { name: "Dana" }));
    expect(prefetched()).toEqual([detailKey("ct-1")]);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("CL-10: a click on the checkbox does neither", () => {
    mount();
    fireEvent.click(screen.getByRole("checkbox", { name: /Dana/ }));
    expect(prefetch).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });
});
