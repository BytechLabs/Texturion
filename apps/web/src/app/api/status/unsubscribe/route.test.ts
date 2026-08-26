import { beforeEach, describe, expect, it, vi } from "vitest";

const readWorkerBindings = vi.fn();
const unsubscribe = vi.fn();

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
  statusSubscriptionLocale: (raw: unknown) =>
    raw === "fr-CA" ? "fr-CA" : "en",
  unsubscribe: (...args: unknown[]) => unsubscribe(...args),
}));

const { GET, POST } = await import("./route");

const request = (url: string) => ({ nextUrl: new URL(url) }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  readWorkerBindings.mockResolvedValue({ STATUS_FEED: {} });
});

describe("status unsubscribe locale", () => {
  it("redirects a French subscriber to the French result route", async () => {
    unsubscribe.mockResolvedValue("fr-CA");

    const response = await GET(
      request("https://loonext.com/api/status/unsubscribe?token=abc"),
    );

    expect(response.headers.get("location")).toBe(
      "https://loonext.com/fr/etat-du-service/desabonnement-confirme",
    );
  });

  it("keeps a prefetched French link French after its row is gone", async () => {
    unsubscribe.mockResolvedValue(null);

    const response = await GET(
      request(
        "https://loonext.com/api/status/unsubscribe?token=abc&locale=fr-CA",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://loonext.com/fr/etat-du-service/desabonnement-confirme",
    );
  });

  it("leaves the English workflow unchanged", async () => {
    unsubscribe.mockResolvedValue("en");

    const response = await GET(
      request("https://loonext.com/api/status/unsubscribe?token=abc"),
    );

    expect(response.headers.get("location")).toBe(
      "https://loonext.com/status/unsubscribed",
    );
  });

  it("keeps the mail-client one-click POST response empty", async () => {
    unsubscribe.mockResolvedValue("fr-CA");

    const response = await POST(
      request(
        "https://loonext.com/api/status/unsubscribe?token=abc&locale=fr-CA",
      ),
    );

    expect(response.status).toBe(204);
  });
});
