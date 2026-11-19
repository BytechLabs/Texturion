// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { QuotePage } from "./quote-page";

vi.mock("@/env", () => ({
  publicEnv: { NEXT_PUBLIC_API_URL: "https://api.example.test" },
}));

describe(QuotePage, () => {
  it("shows the French withdrawal and removes the option to accept", () => {
    render(<QuotePage quote={{ locale: "fr-CA", withdrawn: true, status: "withdrawn" }} />);

    expect(screen.getByRole("heading", { name: "L’entreprise a retiré ce devis" }).tagName).toBe("H1");
    expect(screen.getByRole("main").lang).toBe("fr-CA");
    expect(screen.queryByRole("button")).toBeNull();
  });

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
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
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

  it("uses the separate decline credential and focuses the result", async () => {
    const fetchQuote = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal("fetch", fetchQuote);

    render(<QuotePage quote={{
      locale: "en",
      business_name: "Martin Plumbing",
      amount_cents: 45_000,
      currency: "cad",
      description: "Replace the water heater",
      status: "viewed",
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      can_accept: true,
      accept_token: "test-accept-credential",
      decline_token: "test-decline-credential",
    }} />);
    fireEvent.click(screen.getByRole("button", { name: "Not right now" }));

    const heading = await screen.findByRole("heading", { name: "Quote declined" });
    expect(fetchQuote).toHaveBeenCalledExactlyOnceWith(
      "https://api.example.test/q/test-decline-credential/decline",
      { method: "POST" },
    );
    expect(document.activeElement).toBe(heading);
  });
});
