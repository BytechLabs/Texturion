/**
 * #575 / #545 — the one unauthenticated write on the marketing Worker.
 *
 * `POST /api/status/subscribe` has no session, no origin check and no captcha. Its
 * only obstacle was a honeypot field, which a caller skips by omitting it.
 *
 * ## What was and was not actually at risk
 *
 * The audit that found this rated it on unbounded email and unbounded rows. That
 * part was wrong and worth correcting: `lib/marketing/status-subscribe` already caps
 * the list at 200 subscribers, confirmations at 50/day and mail at 1000/month. The
 * spend was bounded before this change.
 *
 * What was NOT bounded is who spends it. One script could consume the whole day's
 * fifty confirmations and aim them at fifty addresses that never asked — and the
 * reputational cost of sending that mail lands on the domain every customer
 * notification also leaves from. That is the gap this closes, and it is a smaller
 * and more specific one than the finding claimed.
 *
 * ## Why the limited response is the success sentence
 *
 * A 429 that explains itself tells a script its rate is being measured and what to
 * slow to. The neutral sentence tells it nothing it did not already have — the same
 * reasoning the honeypot two checks above already uses.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const readWorkerBindings = vi.fn();
const buildMailer = vi.fn();
const startSubscription = vi.fn();

vi.mock("@/lib/marketing/status-mailer", () => ({
  readWorkerBindings: () => readWorkerBindings(),
  buildMailer: (bindings: unknown) => buildMailer(bindings),
}));

vi.mock("@/lib/marketing/status-subscribe", () => ({
  normalizeEmail: (value: unknown) =>
    typeof value === "string" && value.includes("@") ? value.toLowerCase() : null,
  startSubscription: (...args: unknown[]) => startSubscription(...args),
  statusSubscriptionLocale: (raw: unknown) =>
    raw === "fr-CA" ? "fr-CA" : "en",
}));

const { POST } = await import("./route");

/** A request with an IP the Cloudflare edge would have stamped. */
function post(body: unknown, ip = "203.0.113.7"): Request {
  return new Request("https://loonext.com/api/status/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify(body),
  });
}

const NEUTRAL = "Check your email for a link to confirm.";

beforeEach(() => {
  vi.clearAllMocks();
  buildMailer.mockReturnValue({ send: vi.fn() });
  startSubscription.mockResolvedValue("pending");
});

describe("#575 a single caller cannot spend the shared allowance", () => {
  it("stops at the limiter without touching the store or the mailer", async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    readWorkerBindings.mockResolvedValue({
      STATUS_FEED: {},
      STATUS_SUBSCRIBE_RATE_LIMITER: { limit },
    });

    const res = await POST(post({ email: "someone@example.com" }) as never);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: NEUTRAL });
    // The load-bearing assertion: nothing was subscribed and nothing was mailed.
    expect(startSubscription).not.toHaveBeenCalled();
  });

  it("keys the limit on the caller, not on the address", async () => {
    // Keying on the address would let one script spray a thousand addresses at
    // full speed, which is precisely the abuse worth stopping. Keying on the
    // caller bounds the sprayer.
    const limit = vi.fn().mockResolvedValue({ success: true });
    readWorkerBindings.mockResolvedValue({
      STATUS_FEED: {},
      STATUS_SUBSCRIBE_RATE_LIMITER: { limit },
    });

    await POST(post({ email: "someone@example.com" }, "198.51.100.4") as never);

    expect(limit).toHaveBeenCalledWith({ key: "status-subscribe:198.51.100.4" });
  });

  it("lets a first-time caller through", async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });
    readWorkerBindings.mockResolvedValue({
      STATUS_FEED: {},
      STATUS_SUBSCRIBE_RATE_LIMITER: { limit },
    });

    const res = await POST(post({ email: "someone@example.com" }) as never);

    expect(res.status).toBe(200);
    expect(startSubscription).toHaveBeenCalledOnce();
  });

  it("skips the gate when the binding is absent, like every other limiter here", async () => {
    // Local dev, vitest and `next build`'s prerender pass all have no Worker
    // bindings. A gate that failed closed there would make the form untestable and
    // break the build.
    readWorkerBindings.mockResolvedValue({ STATUS_FEED: {} });

    const res = await POST(post({ email: "someone@example.com" }) as never);

    expect(res.status).toBe(200);
    expect(startSubscription).toHaveBeenCalledOnce();
  });
});

describe("#575 the limiter does not weaken what was already there", () => {
  it("still swallows a honeypot submission before spending anything", async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });
    readWorkerBindings.mockResolvedValue({
      STATUS_FEED: {},
      STATUS_SUBSCRIBE_RATE_LIMITER: { limit },
    });

    const res = await POST(
      post({ email: "someone@example.com", website: "http://spam" }) as never,
    );

    expect(await res.json()).toEqual({ message: NEUTRAL });
    expect(startSubscription).not.toHaveBeenCalled();
    // And it never reached the limiter, so a bot cannot use up a real caller's
    // allowance by filling the honeypot.
    expect(limit).not.toHaveBeenCalled();
  });

  it("still rejects something that is not an address, and says so", async () => {
    // One of only two outcomes the visitor can act on, so it is NOT neutral.
    readWorkerBindings.mockResolvedValue({ STATUS_FEED: {} });

    const res = await POST(post({ email: "not-an-address" }) as never);

    expect(res.status).toBe(400);
    expect(startSubscription).not.toHaveBeenCalled();
  });

  it("answers the French status route in French without losing specificity", async () => {
    readWorkerBindings.mockResolvedValue({ STATUS_FEED: {} });

    const invalid = await POST(
      post({ email: "not-an-address", locale: "fr-CA" }) as never,
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: "Cette adresse courriel ne semble pas valide.",
    });

    const limited = vi.fn().mockResolvedValue({ success: false });
    readWorkerBindings.mockResolvedValue({
      STATUS_FEED: {},
      STATUS_SUBSCRIBE_RATE_LIMITER: { limit: limited },
    });
    const neutral = await POST(
      post({ email: "someone@example.com", locale: "fr-CA" }) as never,
    );
    expect(await neutral.json()).toEqual({
      message: "Vérifiez votre courriel pour confirmer votre abonnement.",
    });

    readWorkerBindings.mockResolvedValue({ STATUS_FEED: {} });
    await POST(
      post({ email: "marie@example.com", locale: "fr-CA" }) as never,
    );
    expect(startSubscription).toHaveBeenLastCalledWith(
      {},
      expect.anything(),
      "marie@example.com",
      "fr-CA",
      expect.any(Date),
    );
  });
});
