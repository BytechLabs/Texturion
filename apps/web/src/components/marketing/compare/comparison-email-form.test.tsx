/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  publicEnv: { NEXT_PUBLIC_API_URL: "https://api.test" },
}));
vi.mock("@/lib/analytics/events", () => ({
  trackComparisonRequested: vi.fn(),
}));

import { ComparisonEmailForm } from "./comparison-email-form";

afterEach(cleanup);

async function submit(locale: "en" | "fr-CA") {
  let submitted: Record<string, unknown> | null = null;
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, request?: RequestInit) => {
    submitted = JSON.parse(String(request?.body)) as Record<string, unknown>;
    return Response.json({ ok: true, sent: false });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<ComparisonEmailForm locale={locale} />);

  expect(
    screen.getByText(
      locale === "fr-CA"
        ? /Envoyez-moi cette comparaison/
        : /Email me this comparison/,
    ),
  ).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "dana@example.com" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

  expect(submitted).not.toBeNull();
  return submitted ?? {};
}

describe("comparison request locale", () => {
  it("submits fr-CA from the French comparison route", async () => {
    expect(await submit("fr-CA")).toMatchObject({
      email: "dana@example.com",
      source: "compare_page",
      locale: "fr-CA",
    });
  });

  it("keeps the English request explicit", async () => {
    expect(await submit("en")).toMatchObject({ locale: "en" });
  });
});
