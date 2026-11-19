// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { QuotePage } from "./quote-page";

vi.mock("@/env", () => ({
  publicEnv: { NEXT_PUBLIC_API_URL: "https://api.example.test" },
}));

describe(QuotePage, () => {
  it("sends the name from the French form and focuses the acceptance heading", async () => {
    const fetchQuote = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal("fetch", fetchQuote);

    render(<QuotePage quote={{
      locale: "fr-CA",
      business_name: "Plomberie Martin",
      amount_cents: 45_000,
      currency: "cad",
      description: "Remplacer le chauffe-eau",
      status: "viewed",
      expires_at: "2030-08-25T12:00:00.000Z",
      can_accept: true,
      accept_token: "test-accept-credential",
    }} />);

    const submit = screen.getByRole("button", { name: "Accepter ce devis" });
    expect(submit).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByRole("textbox", { name: "Votre nom" }), {
      target: { value: "  Camille Martin  " },
    });
    fireEvent.click(submit);

    const heading = await screen.findByRole("heading", { name: "Accepté. Plomberie Martin en a été informé." });
    expect(fetchQuote).toHaveBeenCalledExactlyOnceWith(
      "https://api.example.test/q/test-accept-credential/accept",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Camille Martin" }),
      },
    );
    expect(document.activeElement).toBe(heading);
  });
});
