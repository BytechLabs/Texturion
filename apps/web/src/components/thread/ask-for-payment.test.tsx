/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { formatMoney, paymentRequestSms } from "@loonext/shared";

import { makeTranslate } from "@/i18n/translate";

import { AskForPayment } from "./ask-for-payment";

const fixture = vi.hoisted(() => ({
  companyLocale: "en",
  create: vi.fn(async () => undefined),
}));

vi.mock("@/i18n/provider", () => ({
  useLocale: () => ({ locale: "en" }),
  useT: () => makeTranslate("en"),
}));

vi.mock("@/lib/company/provider", () => ({
  useActiveCompany: () => ({ role: "owner" }),
}));

vi.mock("@/lib/api/companies", () => ({
  useCompany: () => ({ data: { name: "Example Plumbing", locale: fixture.companyLocale } }),
}));

vi.mock("@/lib/api/payments", () => ({
  usePayoutAccount: () => ({ data: { readiness: "ready", currency: "cad" } }),
  useCreatePaymentRequest: () => ({ mutateAsync: fixture.create, isPending: false }),
}));

beforeEach(() => {
  fixture.companyLocale = "en";
  fixture.create.mockClear();
});
afterEach(cleanup);

function openRequest() {
  fireEvent.click(screen.getByRole("button", { name: "Ask for payment" }));
}

it("previews and sends the French recipient's default with an English seller interface", async () => {
  render(<AskForPayment conversationId="conversation-1" contactLocale="fr-CA" />);
  openRequest();
  expect(screen.getByLabelText("What for")).toHaveProperty("value", "Acompte");

  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "12.34" } });
  const preview = screen.getByText("They will receive:").nextElementSibling;
  expect(preview?.textContent).toBe(paymentRequestSms({
    businessName: "Example Plumbing",
    amountCents: 1234,
    currency: "cad",
    description: "Acompte",
    locale: "fr-CA",
    url: "https://app.loonext.com/pay/…",
  }));

  const askLabel = makeTranslate("en")("payments.askFor", {
    amount: formatMoney(1234, "cad", "cad", "en"),
  });
  fireEvent.click(screen.getByRole("button", { name: askLabel }));
  await waitFor(() => expect(fixture.create).toHaveBeenCalledExactlyOnceWith({
    amountCents: 1234,
    description: "Acompte",
    idempotencyKey: expect.any(String),
  }));
  await waitFor(() => expect(screen.queryByLabelText("What for")).toBeNull());
  openRequest();
  expect(screen.getByLabelText("What for")).toHaveProperty("value", "Acompte");
});

it.each([
  ["fr-CA", "inherit", "Acompte"],
  ["fr-CA", "en", "Deposit"],
  ["en", undefined, "Deposit"],
] as const)("resolves workspace %s and contact %s to %s", (workspaceLocale, contactLocale, description) => {
  fixture.companyLocale = workspaceLocale;
  render(<AskForPayment conversationId="conversation-1" contactLocale={contactLocale} />);
  openRequest();
  expect(screen.getByLabelText("What for")).toHaveProperty("value", description);
});

it("keeps the quote and operator description when the customer's language updates", () => {
  const prefill = { amountCents: 1234, description: "First visit" };
  const { rerender } = render(
    <AskForPayment conversationId="conversation-1" contactLocale="fr-CA" prefill={prefill} />,
  );
  expect(screen.getByLabelText("What for")).toHaveProperty("value", "First visit");

  fireEvent.change(screen.getByLabelText("What for"), { target: { value: "Inspection" } });
  rerender(<AskForPayment conversationId="conversation-1" contactLocale="en" />);
  expect(screen.getByLabelText("What for")).toHaveProperty("value", "Inspection");
});
