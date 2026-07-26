/**
 * #264 — the sign-out push release. A Web Push subscription belongs to the
 * BROWSER, so leaving it behind at sign-out kept the previous member's
 * customer messages landing on the next person's screen. These pin the two
 * properties that make the fix trustworthy: it really deletes the server row,
 * and it ends the browser subscription EVEN when the API leg fails — a dead
 * endpoint answers the next send with 410, which the server prunes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
const ensureServiceWorkerRegistration = vi.fn();
const pushSupported = vi.fn(() => true);

vi.mock("@/lib/api/client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
vi.mock("./register", () => ({
  ensureServiceWorkerRegistration: () => ensureServiceWorkerRegistration(),
  pushSupported: () => pushSupported(),
}));

const { releasePushOnThisDevice } = await import("./release");

const COMPANY = "cccccccc-0000-4000-8000-00000000000c";

function browserSubscription() {
  return {
    toJSON: () => ({
      endpoint: "https://push.example.net/send/abc",
      keys: { p256dh: "P256DH", auth: "AUTH" },
    }),
    unsubscribe: vi.fn(() => Promise.resolve(true)),
  };
}

function withSubscription(subscription: unknown) {
  ensureServiceWorkerRegistration.mockResolvedValue({
    pushManager: { getSubscription: () => Promise.resolve(subscription) },
  });
}

beforeEach(() => {
  pushSupported.mockReturnValue(true);
  apiFetch.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("releasePushOnThisDevice", () => {
  it("deletes the server row and ends the browser subscription", async () => {
    const subscription = browserSubscription();
    withSubscription(subscription);
    apiFetch.mockResolvedValueOnce({ id: "row-1" }).mockResolvedValueOnce(undefined);

    await releasePushOnThisDevice(COMPANY);

    // The POST is an upsert on (user_id, endpoint) — how we learn the row id
    // without keeping one client-side.
    expect(apiFetch).toHaveBeenNthCalledWith(
      1,
      "/v1/push-subscriptions",
      expect.objectContaining({ method: "POST", companyId: COMPANY }),
    );
    expect(apiFetch).toHaveBeenNthCalledWith(
      2,
      "/v1/push-subscriptions/row-1",
      expect.objectContaining({ method: "DELETE", companyId: COMPANY }),
    );
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });

  it("still ends the browser subscription when the API leg fails", async () => {
    // This is what makes the fix hold: the endpoint is dead either way, so the
    // very next send 410s and the server drops the row. Nobody is ever trapped
    // in an account because the network blipped on the way out.
    const subscription = browserSubscription();
    withSubscription(subscription);
    apiFetch.mockRejectedValue(new Error("offline"));

    await expect(releasePushOnThisDevice(COMPANY)).resolves.toBeUndefined();

    expect(subscription.unsubscribe).toHaveBeenCalled();
  });

  it("ends the subscription without a workspace to name", async () => {
    // The invite screen signs you out with no active company. There is no row
    // we can address, so the browser half does the whole job.
    const subscription = browserSubscription();
    withSubscription(subscription);

    await releasePushOnThisDevice(null);

    expect(apiFetch).not.toHaveBeenCalled();
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });

  it("does nothing on a browser with no push stack", async () => {
    pushSupported.mockReturnValue(false);

    await releasePushOnThisDevice(COMPANY);

    expect(ensureServiceWorkerRegistration).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("is quiet when this browser was never subscribed", async () => {
    withSubscription(null);

    await releasePushOnThisDevice(COMPANY);

    expect(apiFetch).not.toHaveBeenCalled();
  });
});
