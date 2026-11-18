// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { MessagePhoneActions, MessagePhoneText } from "./message-phone-actions";

const placeCall = vi.fn().mockResolvedValue(undefined);
const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/api/contacts", () => ({ useContacts: () => ({ data: undefined }) }));
vi.mock("@/lib/api/numbers", () => ({ useNumbers: () => ({ data: { data: [] } }) }));
vi.mock("@/lib/softphone/provider", () => ({
  MicPermissionError: class extends Error {},
  useSoftphone: () => ({ placeCall }),
}));
vi.mock("@/i18n/provider", () => ({ useT: () => (key: string) => key }));

const body = "Call (416) 555-0182 or +44 7700 900123.";

function Thread({ linkable }: { linkable: boolean }) {
  const [number, setNumber] = useState<string | null>(null);
  return (
    <>
      <MessagePhoneText body={body} onSelect={linkable ? setNumber : undefined} />
      {number && (
        <MessagePhoneActions canContact number={number} onClose={() => setNumber(null)} />
      )}
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("keeps the text intact when links are disabled", () => {
  const { container } = render(<Thread linkable={false} />);
  expect(container.textContent).toBe(body);
  expect(container.querySelector("a,button")).toBeNull();
});

it("opens a prefilled business dialer before any call is placed", async () => {
  const { container } = render(<Thread linkable />);
  expect(container.textContent).toBe(body);
  fireEvent.click(screen.getByRole("button", { name: "(416) 555-0182" }));
  expect(screen.getByRole("link", { name: "shell.textAction" }).getAttribute("href")).toBe("/inbox/new?to=%2B14165550182");
  expect(screen.getByRole("button", { name: "thread.copyPhoneNumber" })).toBeInstanceOf(Element);
  fireEvent.click(screen.getByRole("button", { name: "thread.callWithLoonext" }));
  await expect(screen.findByRole("dialog", { name: "shell.dialANumber" })).resolves.toBeInstanceOf(Element);
  expect(screen.getByText("+14165550182")).toBeInstanceOf(Element);
  expect(document.querySelector('a[href^="tel:"]')).toBeNull();
  expect(placeCall).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "shell.call" }));
  await waitFor(() => expect(placeCall).toHaveBeenCalledWith(expect.objectContaining({ to: "+14165550182" })));
});
