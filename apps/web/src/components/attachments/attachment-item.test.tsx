/**
 * @vitest-environment happy-dom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RequestOptions } from "@/lib/api/core";
import type { AttachmentVariant } from "@/lib/api/types";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api/client", () => ({
  apiFetch: (path: string, options?: RequestOptions) => apiFetch(path, options),
}));
vi.mock("@/lib/company/provider", () => ({ useCompanyId: () => "co-1" }));

import { AttachmentItem, type AttachmentLike } from "./attachment-item";

// This app's vitest does not set `globals`, so testing-library's automatic
// cleanup never registers and renders stack across tests.
afterEach(cleanup);

type Item = { id: string; variant: AttachmentVariant };

// Never reset: the loaded-thumbnail memory outlives a test, so every URL is new.
let serial = 0;
let served: (requested: AttachmentVariant) => AttachmentVariant;
let refuse: Set<string>;

beforeEach(() => {
  served = (requested) => requested;
  refuse = new Set();
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string, options: RequestOptions = {}) => {
    if (path !== "/v1/attachments/urls") throw new Error(`unexpected ${path}`);
    const items = (options.body as { items: Item[] }).items;
    return {
      data: items
        .filter((item) => !refuse.has(item.id))
        .map((item) => ({
          id: item.id,
          requested_variant: item.variant,
          variant: served(item.variant),
          url: `https://storage.test/${item.id}-${item.variant}-${++serial}`,
          expires_at: "2026-11-13T12:00:00.000Z",
          ttl_seconds: 300,
        })),
      errors: items
        .filter((item) => refuse.has(item.id))
        .map((item) => ({
          id: item.id,
          requested_variant: item.variant,
          code: "forbidden",
          message: "This file was reported and is on hold.",
        })),
    };
  });
});

const batches = () =>
  apiFetch.mock.calls.map(([, options]) => (options as RequestOptions).body);

function renderWith(ui: ReactNode, queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})) {
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  };
}

const PHOTO: AttachmentLike = {
  id: "photo",
  file_name: "site.jpg",
  content_type: "image/jpeg",
  size_bytes: 2048,
  created_at: "2026-11-13T09:00:00Z",
};
const QUOTE: AttachmentLike = {
  id: "quote",
  file_name: "quote.pdf",
  content_type: "application/pdf",
  size_bytes: 2048,
  created_at: "2026-11-13T09:00:00Z",
};

describe("AttachmentItem image row", () => {
  it("shows a remounted chip at once, without the pulse", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const first = renderWith(<AttachmentItem attachment={PHOTO} />, queryClient);
    await waitFor(() => expect(first.container.querySelector("img")).not.toBeNull());
    const img = first.container.querySelector("img")!;
    expect(img.getAttribute("decoding")).toBe("async");
    fireEvent.load(img);
    first.unmount();

    const again = renderWith(<AttachmentItem attachment={PHOTO} />, queryClient);

    expect(again.container.querySelector(".animate-pulse")).toBeNull();
    expect(again.container.querySelector("img")?.className).toContain("opacity-100");
  });

  it("opens the lightbox without a second mint when the chip already has the original", async () => {
    served = () => "original";
    const { container } = renderWith(<AttachmentItem attachment={PHOTO} />);
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    fireEvent.load(container.querySelector("img")!);

    fireEvent.click(screen.getByRole("button", { name: "Open site.jpg" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(batches()).toHaveLength(1);
  });

  it("asks for the original when the chip was a preview", async () => {
    const { container } = renderWith(<AttachmentItem attachment={PHOTO} />);
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    fireEvent.load(container.querySelector("img")!);

    fireEvent.click(screen.getByRole("button", { name: "Open site.jpg" }));

    await waitFor(() => expect(batches()).toHaveLength(2));
    expect(batches()[1]).toEqual({ items: [{ id: "photo", variant: "original" }] });
  });
});

describe("AttachmentItem file row", () => {
  it("turns held when a link near expiry is refused on the click", async () => {
    renderWith(<AttachmentItem attachment={QUOTE} />);
    const link = await screen.findByRole("link", { name: "Download quote.pdf" });
    const tab = { opener: window as unknown, location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 300_000 - 45_000);
    refuse.add("quote");

    let prevented = false;
    document.addEventListener(
      "click",
      (event) => {
        prevented = event.defaultPrevented;
        event.preventDefault();
      },
      { once: true },
    );
    fireEvent.click(link);

    expect(prevented).toBe(true);
    await waitFor(() => expect(tab.close).toHaveBeenCalled());
    expect(await screen.findByText("This file was reported and is on hold.")).toBeTruthy();
    expect(batches()).toEqual([
      { items: [{ id: "quote", variant: "original" }] },
      { items: [{ id: "quote", variant: "original" }] },
    ]);
  });
});
