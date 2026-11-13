/**
 * @vitest-environment happy-dom
 *
 * #459: closing the dialer's "Add contact" form drops `?new=` from the URL
 * without a router navigation, and keeps the rest of the list's params.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("@/lib/api/contacts-export-hook", () => ({
  useExportContacts: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("./import-wizard", () => ({ ImportWizard: () => null }));
vi.mock("./vcard-import-dialog", () => ({ VCardImportDialog: () => null }));
vi.mock("./phone-picker-dialog", () => ({ PhonePickerDialog: () => null }));
vi.mock("./new-contact-dialog", () => ({
  NewContactDialog: ({
    open,
    onOpenChange,
    prefillPhone,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    prefillPhone: string;
  }) =>
    open ? (
      <button type="button" onClick={() => onOpenChange(false)}>
        Close {prefillPhone}
      </button>
    ) : null,
}));

import { NewContactAction } from "./contacts-actions";

describe("NewContactAction", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/contacts?q=smith&new=6135550101");
  });

  it("drops only the dialer's param when its form closes", () => {
    const replace = vi.spyOn(window.history, "replaceState");
    render(<NewContactAction />);
    fireEvent.click(screen.getByRole("button", { name: "Close 6135550101" }));
    expect(replace).toHaveBeenCalledWith(null, "", "/contacts?q=smith");
    expect(window.location.search).toBe("?q=smith");
    expect(router.replace).not.toHaveBeenCalled();
  });
});
