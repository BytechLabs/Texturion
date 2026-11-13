/**
 * @vitest-environment happy-dom
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RequestOptions } from "@/lib/api/core";
import type { AttachmentSummary, AttachmentVariant } from "@/lib/api/types";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api/client", () => ({
  apiFetch: (path: string, options?: RequestOptions) => apiFetch(path, options),
}));
vi.mock("@/lib/company/provider", () => ({ useCompanyId: () => "co-1" }));

import { AttachmentAudio } from "./attachment-audio";
import { AttachmentFileChip } from "./attachment-file";
import { AttachmentImage } from "./attachment-image";

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
          ttl_seconds: 3600,
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

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWith(ui: ReactNode, queryClient = client()) {
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  };
}

const PHOTO: AttachmentSummary = { id: "img", content_type: "image/jpeg", size_bytes: 2048 };
const PDF: AttachmentSummary = { id: "pdf", content_type: "application/pdf", size_bytes: 2048 };
const CLIP: AttachmentSummary = { id: "clip", content_type: "audio/mpeg", size_bytes: 2048 };

const tick = () => new Promise((resolve) => setTimeout(resolve, 40));

/** Whether a click got past the page's own handlers, without letting happy-dom navigate. */
function clickPassedThrough(target: Element): boolean {
  let prevented = false;
  document.addEventListener(
    "click",
    (event) => {
      prevented = event.defaultPrevented;
      event.preventDefault();
    },
    { once: true },
  );
  fireEvent.click(target);
  return !prevented;
}

describe("thread media share one batched mint", () => {
  it("mints a photo, a file and a voice note in one request", async () => {
    renderWith(
      <>
        <AttachmentImage attachment={PHOTO} alt="Site photo" />
        <AttachmentFileChip attachment={PDF} />
        <AttachmentAudio attachment={CLIP} fromLabel="Dana" />
      </>,
    );

    await waitFor(() => expect(screen.getByRole("link", { name: "Open pdf" })).toBeTruthy());
    await tick();
    expect(batches()).toEqual([
      {
        items: [
          { id: "img", variant: "preview" },
          { id: "pdf", variant: "original" },
          { id: "clip", variant: "original" },
        ],
      },
    ]);
  });
});

describe("AttachmentImage", () => {
  it("shows a remounted thumbnail at once, without the pulse and blur-in", async () => {
    const queryClient = client();
    const first = renderWith(<AttachmentImage attachment={PHOTO} alt="Site photo" />, queryClient);
    await waitFor(() => expect(first.container.querySelector("img")).not.toBeNull());
    const img = first.container.querySelector("img")!;
    expect(img.getAttribute("decoding")).toBe("async");
    expect(first.container.querySelector(".animate-pulse")).not.toBeNull();
    fireEvent.load(img);
    expect(first.container.querySelector(".animate-pulse")).toBeNull();
    first.unmount();

    const again = renderWith(<AttachmentImage attachment={PHOTO} alt="Site photo" />, queryClient);

    expect(again.container.querySelector(".animate-pulse")).toBeNull();
    expect(again.container.querySelector("img")?.className).toContain("opacity-100");
    expect(batches()).toHaveLength(1);
  });

  it("keeps a revealed thumbnail revealed while a re-minted URL loads", async () => {
    const { container, queryClient } = renderWith(
      <AttachmentImage attachment={PHOTO} alt="Site photo" />,
    );
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    const img = container.querySelector("img")!;
    fireEvent.load(img);
    const before = img.getAttribute("src");

    await act(() => queryClient.invalidateQueries());

    await waitFor(() =>
      expect(container.querySelector("img")?.getAttribute("src")).not.toBe(before),
    );
    expect(container.querySelector(".animate-pulse")).toBeNull();
    expect(container.querySelector("img")?.className).toContain("opacity-100");
  });

  it("opens the lightbox on the URL it has when the server already sent the original", async () => {
    served = () => "original";
    const { container } = renderWith(<AttachmentImage attachment={PHOTO} alt="Site photo" />);
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    fireEvent.load(container.querySelector("img")!);

    fireEvent.click(screen.getByRole("button", { name: "Open photo: Site photo" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    await tick();

    expect(batches()).toHaveLength(1);
  });

  it("asks for the original when the thumbnail was a preview", async () => {
    const { container } = renderWith(<AttachmentImage attachment={PHOTO} alt="Site photo" />);
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    fireEvent.load(container.querySelector("img")!);

    fireEvent.click(screen.getByRole("button", { name: "Open photo: Site photo" }));

    await waitFor(() => expect(batches()).toHaveLength(2));
    expect(batches()[1]).toEqual({ items: [{ id: "img", variant: "original" }] });
  });
});

describe("AttachmentFileChip", () => {
  function fakeTab() {
    return { opener: window as unknown, location: { href: "" }, close: vi.fn() };
  }

  it("opens a link with time left as it is", async () => {
    renderWith(<AttachmentFileChip attachment={PDF} />);
    const link = await screen.findByRole("link", { name: "Open pdf" });
    const open = vi.spyOn(window, "open");

    expect(clickPassedThrough(link)).toBe(true);
    expect(open).not.toHaveBeenCalledWith("", "_blank");
    expect(batches()).toHaveLength(1);
  });

  it("re-mints a link within a minute of expiring into a tab opened on the click", async () => {
    renderWith(<AttachmentFileChip attachment={PDF} />);
    const link = await screen.findByRole("link", { name: "Open pdf" });
    const stale = link.getAttribute("href");
    const tab = fakeTab();
    const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3600_000 - 50_000);

    expect(clickPassedThrough(link)).toBe(false);

    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(tab.opener).toBeNull();
    await waitFor(() => expect(tab.location.href).toMatch(/^https:\/\/storage\.test\/pdf-original-/));
    expect(tab.location.href).not.toBe(stale);
    expect(tab.close).not.toHaveBeenCalled();
  });

  it("closes the tab and shows the retry state when the re-mint is refused", async () => {
    renderWith(<AttachmentFileChip attachment={PDF} />);
    const link = await screen.findByRole("link", { name: "Open pdf" });
    const tab = fakeTab();
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3600_000 - 50_000);
    refuse.add("pdf");

    expect(clickPassedThrough(link)).toBe(false);

    await waitFor(() => expect(tab.close).toHaveBeenCalled());
    expect(tab.location.href).toBe("");
    expect(await screen.findByRole("button", { name: "Didn't load. Retry" })).toBeTruthy();
  });
});

describe("AttachmentAudio", () => {
  it("applies a refreshed URL only once the clip is paused", async () => {
    const { container, queryClient } = renderWith(
      <AttachmentAudio attachment={CLIP} fromLabel="Dana" />,
    );
    await waitFor(() => expect(container.querySelector("audio")).not.toBeNull());
    const audio = container.querySelector("audio")!;
    const first = audio.getAttribute("src");
    let paused = false;
    Object.defineProperty(audio, "paused", { configurable: true, get: () => paused });

    await act(() => queryClient.invalidateQueries());
    const download = screen.getByRole("link", { name: "Download audio message Dana" });
    await waitFor(() => expect(download.getAttribute("href")).not.toBe(first));
    expect(batches()).toHaveLength(2);
    expect(audio.getAttribute("src")).toBe(first);

    paused = true;
    fireEvent(audio, new Event("pause"));

    await waitFor(() => expect(audio.getAttribute("src")).not.toBe(first));
    expect(audio.getAttribute("src")).toMatch(/^https:\/\/storage\.test\/clip-original-/);
  });
});
