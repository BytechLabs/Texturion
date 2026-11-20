import { describe, expect, it } from "vitest";

import { robotTag } from "../src/vendors/resend";
import { harness, lease, liveMailbox, ready, ROBOT_MAILBOX, ruleOf } from './support';
import type { Harness } from './support';

const MAIL = { from: "Loonext <noreply@loonext.com>", subject: "Invite", html: "<p>hi</p>" };

function send(h: Harness, to: unknown, extra: Record<string, unknown> = {}) {
  return h.call("/resend/emails", { body: { ...MAIL, to, ...extra } });
}

const resendCalls = (h: Harness) => h.outbound.filter((item) => item.url === "https://api.resend.com/emails");

describe("Resend", () => {
  it("sends to Resend's test addresses with the guard's key, exactly the addresses it checked", async () => {
    const h = harness();
    const response = await send(h, ["delivered@resend.dev", "Bounce <Bounced+s34@resend.dev>"], { cc: "Test <delivered@resend.dev>" });
    expect(response.status).toBe(200);
    const [sent] = resendCalls(h);
    expect(sent.headers.get("authorization")).toBe("Bearer test-resend-key");
    expect(JSON.parse(sent.body)).toMatchObject({
      to: ["delivered@resend.dev", "bounced+s34@resend.dev"],
      cc: ["delivered@resend.dev"],
      subject: "Invite",
    });
  });

  it("refuses a recipient string that could be read as more than one address", async () => {
    const h = harness();
    for (const to of [
      "customer@example.com, Test <delivered@resend.dev>",
      "customer@example.com <delivered@resend.dev>",
      ["customer@example.com, <delivered@resend.dev>"],
      "customer@example.com; delivered@resend.dev",
      "<customer@example.com> <delivered@resend.dev>",
      "delivered@resend.dev <customer@example.com>",
      "Test <delivered@resend.dev> trailing",
      // One address, but a list separator Resend could split on.
      "Doe, Jane <delivered@resend.dev>",
      "delivered@resend.dev,",
    ]) {
      await expect(ruleOf(await send(h, to))).resolves.toBe("resend.recipient_refused");
      await expect(ruleOf(await send(h, "delivered@resend.dev", { bcc: to }))).resolves.toBe(
        "resend.recipient_refused",
      );
    }
    expect(resendCalls(h)).toEqual([]);
  });

  it("refuses any other recipient, in to, cc or bcc", async () => {
    const h = harness();
    for (const extra of [
      { to: "someone@example.com" },
      { to: "delivered@resend.dev", cc: "customer@example.com" },
      { to: "delivered@resend.dev", bcc: ["ops@loonext.com"] },
      { to: "delivered@resend.dev.example.com" },
      { to: "x@resend.dev@example.com" },
      { to: "rig-robot+bad tag@loonext.com" },
      { to: [] },
      { to: [42] },
    ]) {
      await expect(ruleOf(await send(h, extra.to, extra))).resolves.toBe("resend.recipient_refused");
    }
    expect(resendCalls(h)).toEqual([]);
  });

  it("sends to the robot mailbox only under the S34 lease, while the edge reports it alive", async () => {
    const h = await ready();
    const robot = "rig-robot+invite@loonext.com";
    await expect(ruleOf(await send(h, robot))).resolves.toBe("resend.robot_needs_lease");
    await lease(h, "S34", "rig-api");
    // The edge unreachable reads as a dead mailbox.
    await expect(ruleOf(await send(h, robot))).resolves.toBe("resend.mail_heartbeat_stale");
    liveMailbox(h);
    h.advance(21 * 60 * 1000);
    await lease(h, "S34", "rig-api");
    await expect(ruleOf(await send(h, robot))).resolves.toBe("resend.mail_heartbeat_stale");
    liveMailbox(h);
    expect((await send(h, robot)).status).toBe(200);
  });

  it("still sends to a healthy mailbox after a late delivery", async () => {
    const h = await ready();
    await lease(h, "S34", "rig-api");
    liveMailbox(h);
    expect((await send(h, "rig-robot+a@loonext.com")).status).toBe(200);
    h.advance(11 * 60 * 1000);
    liveMailbox(h);
    expect((await send(h, "rig-robot+b@loonext.com")).status).toBe(200);
  });

  it("forwards mail beyond the old daily cap", async () => {
    const h = await ready();
    for (let count = 0; count < 11; count++) {
      const response = await h.call("/resend/emails", { body: { to: "delivered@resend.dev" } });
      expect(response.status).toBe(200);
    }
    expect(h.outbound.filter(({ url }) => url === "https://api.resend.com/emails")).toHaveLength(11);
  });

  it("fails closed without its key, and on any path but /emails", async () => {
    const h = harness({ env: { RESEND_API_KEY: "" } });
    await expect(ruleOf(await send(h, "delivered@resend.dev"))).resolves.toBe("resend.key_missing");
    const keyed = harness();
    await expect(ruleOf(await keyed.call("/resend/emails/batch", { body: [] }))).resolves.toBe("resend.path_refused");
    await expect(ruleOf(await keyed.call("/resend/domains"))).resolves.toBe("resend.path_refused");
  });

  it("reads the robot address's tag, and only the robot's", () => {
    expect(robotTag("rig-robot@loonext.com", ROBOT_MAILBOX)).toBeNull();
    expect(robotTag("rig-robot+s34-invite@loonext.com", ROBOT_MAILBOX)).toBe("s34-invite");
    expect(robotTag("rig-robotx@loonext.com", ROBOT_MAILBOX)).toBeUndefined();
    expect(robotTag("rig-robot@loonext.com.example", ROBOT_MAILBOX)).toBeUndefined();
    expect(robotTag("support@loonext.com", ROBOT_MAILBOX)).toBeUndefined();
    expect(robotTag("rig-robot+@loonext.com", ROBOT_MAILBOX)).toBeUndefined();
    expect(robotTag("rig-robot@loonext.com", null)).toBeUndefined();
  });
});
