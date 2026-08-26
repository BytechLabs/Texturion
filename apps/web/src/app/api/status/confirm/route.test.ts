import { beforeEach, describe, expect, it, vi } from "vitest";

const readWorkerBindings = vi.fn();
const confirmSubscription = vi.fn();

vi.mock("@/lib/marketing/status-mailer", () => ({
  readWorkerBindings: () => readWorkerBindings(),
}));

vi.mock("@/lib/marketing/status-subscribe", () => ({
  STATUS_SUBSCRIPTION_PATHS: {
    en: {
      status: "/status",
      subscribed: "/status/subscribed",
      unsubscribed: "/status/unsubscribed",
    },
    "fr-CA": {
      status: "/fr/etat-du-service",
      subscribed: "/fr/etat-du-service/abonnement-confirme",
      unsubscribed: "/fr/etat-du-service/desabonnement-confirme",
    },
  },
  confirmSubscription: (...args: unknown[]) => confirmSubscription(...args),
  statusSubscriptionLocale: (raw: unknown) =>
    raw === "fr-CA" ? "fr-CA" : "en",
}));

const { GET } = await import("./route");

const request = (url: string) => ({ nextUrl: new URL(url) }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  readWorkerBindings.mockResolvedValue({ STATUS_FEED: {} });
});

describe("status confirmation locale", () => {
  it("redirects a confirmed French subscriber to the French result route", async () => {
    confirmSubscription.mockResolvedValue("fr-CA");

    const response = await GET(
      request("https://loonext.com/api/status/confirm?token=abc"),
    );

    expect(response.headers.get("location")).toBe(
      "https://loonext.com/fr/etat-du-service/abonnement-confirme",
    );
  });

  it("keeps an expired French link on the French status route", async () => {
    confirmSubscription.mockResolvedValue(null);

    const response = await GET(
      request(
        "https://loonext.com/api/status/confirm?token=expired&locale=fr-CA",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://loonext.com/fr/etat-du-service",
    );
  });

  it("leaves the English workflow unchanged", async () => {
    confirmSubscription.mockResolvedValue("en");

    const response = await GET(
      request("https://loonext.com/api/status/confirm?token=abc"),
    );

    expect(response.headers.get("location")).toBe(
      "https://loonext.com/status/subscribed",
    );
  });
});
