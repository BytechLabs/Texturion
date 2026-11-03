import { describe, expect, it } from "vitest";

import { buildCapture, POSTHOG_CAPTURE_URL, sendProductionEvent } from "../src/posthog";
import { harness } from "./support";

describe("production ops notices", () => {
  it("post to PostHog's capture endpoint with the public project key only", async () => {
    const h = harness();
    expect(await sendProductionEvent(h.ctx, { key: "telnyx-key-inventory", summary: "x" })).toBe(true);
    const [sent] = h.outbound;
    expect(sent.url).toBe(POSTHOG_CAPTURE_URL);
    expect(sent.headers.get("content-type")).toBe("application/json");
    expect(sent.headers.get("authorization")).toBeNull();
    expect(JSON.parse(sent.body)).toMatchObject({ api_key: "phc_guard_test_key", event: "$exception" });
  });

  it("group by the same ops:<key> fingerprint production's own notices use", () => {
    const body = JSON.parse(
      buildCapture("phc_k", { key: "telnyx-account-signal", summary: "s", detail: "d", level: "error" }, 0),
    ) as { distinct_id: string; timestamp: string; properties: Record<string, unknown> };
    expect(body.distinct_id).toBe("loonext-telnyx-guard");
    expect(body.timestamp).toBe("1970-01-01T00:00:00.000Z");
    expect(body.properties).toMatchObject({
      $exception_fingerprint: "ops:telnyx-account-signal",
      $exception_level: "error",
      $exception_list: [{ type: "OpsNotice", value: "s" }],
      $process_person_profile: false,
      ops_key: "telnyx-account-signal",
      environment: "production",
      detail: "d",
    });
  });

  it("send no phone number or email address in the summary or the detail", () => {
    const body = buildCapture(
      "phc_k",
      { key: "k", summary: "dial to +16135551234 refused", detail: "owner a@b.co, 16135551234" },
      0,
    );
    expect(body).not.toContain("6135551234");
    expect(body).not.toContain("a@b.co");
    expect(JSON.parse(body).properties.detail).toBe("owner [email redacted], [phone redacted]");
  });

  it("never throw: no key, a refusing PostHog or a network failure is a logged false", async () => {
    expect(await sendProductionEvent(harness({ env: { POSTHOG_PROJECT_KEY: "" } }).ctx, { key: "k", summary: "s" })).toBe(false);
    const refusing = harness();
    refusing.ctx.fetch = (async () => new Response("no", { status: 400 })) as typeof fetch;
    expect(await sendProductionEvent(refusing.ctx, { key: "k", summary: "s" })).toBe(false);
    const offline = harness();
    offline.ctx.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    expect(await sendProductionEvent(offline.ctx, { key: "k", summary: "s" })).toBe(false);
  });
});
