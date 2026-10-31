import { describe, expect, it } from "vitest";

import { robotTag } from "../src/vendors/resend";
import { harness, lease, liveMailbox, ready, ROBOT_MAILBOX, ruleOf, type Harness } from "./support";

const MAIL = { from: "Loonext <noreply@loonext.com>", subject: "Invite", html: "<p>hi</p>" };

function send(h: Harness, to: unknown, extra: Record<string, unknown> = {}) {
  return h.call("/resend/emails", { body: { ...MAIL, to, ...extra } });
}

const resendCalls = (h: Harness) => h.outbound.filter((item) => item.url === "https://api.resend.com/emails");

describe("Resend", () => {
  it("sends to Resend's test addresses with the guard's key", async () => {
    const h = harness();
    const response = await send(h, ["delivered@resend.dev", "Bounce <bounced+s34@resend.dev>"]);
    expect(response.status).toBe(200);
    const [sent] = resendCalls(h);
    expect(sent.headers.get("authorization")).toBe("Bearer test-resend-key");
    expect(JSON.parse(sent.body).to).toEqual(["delivered@resend.dev", "Bounce <bounced+s34@resend.dev>"]);
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
      expect(await ruleOf(await send(h, extra.to, extra)), JSON.stringify(extra)).toBe("resend.recipient_refused");
    }
    expect(resendCalls(h)).toEqual([]);
  });

  it("sends to the robot mailbox only under the S34 lease, while the edge reports it alive", async () => {
    const h = await ready();
    const robot = "rig-robot+invite@loonext.com";
    expect(await ruleOf(await send(h, robot))).toBe("resend.robot_needs_lease");
    await lease(h, "S34", "rig-api");
    // The edge unreachable reads as a dead mailbox.
    expect(await ruleOf(await send(h, robot))).toBe("resend.mail_heartbeat_stale");
    liveMailbox(h);
    h.advance(21 * 60 * 1000);
    await lease(h, "S34", "rig-api");
    expect(await ruleOf(await send(h, robot))).toBe("resend.mail_heartbeat_stale");
    liveMailbox(h);
    expect((await send(h, robot)).status).toBe(200);
  });

  it("halts the robot mailbox the first time a mail does not arrive within ten minutes", async () => {
    const h = await ready();
    await lease(h, "S34", "rig-api");
    liveMailbox(h);
    const sentA = h.clock.now;
    expect((await send(h, "rig-robot+a@loonext.com")).status).toBe(200);
    h.advance(60 * 1000);
    liveMailbox(h, [{ tag: "a", at: sentA + 30_000 }]);
    expect((await send(h, "rig-robot+b@loonext.com")).status).toBe(200);
    h.advance(11 * 60 * 1000);
    // b never shows up in the edge's recent mail.
    liveMailbox(h, [{ tag: "a", at: sentA + 30_000 }]);
    expect(await ruleOf(await send(h, "rig-robot+c@loonext.com"))).toBe("resend.robot_mail_halted");
    // Test addresses are unaffected; the halt is the mailbox's alone.
    expect((await send(h, "delivered@resend.dev")).status).toBe(200);
    expect((await h.call("/admin/mail/resume", { caller: "admin", method: "POST" })).status).toBe(200);
    expect((await send(h, "rig-robot+c@loonext.com")).status).toBe(200);
  });

  it("does not count an older arrival with the same tag as this send's", async () => {
    const h = await ready();
    await lease(h, "S34", "rig-api");
    liveMailbox(h, [{ tag: "invite", at: h.clock.now - 60_000 }]);
    expect((await send(h, "rig-robot+invite@loonext.com")).status).toBe(200);
    h.advance(11 * 60 * 1000);
    liveMailbox(h, [{ tag: "invite", at: h.clock.now - 12 * 60 * 1000 }]);
    expect(await ruleOf(await send(h, "rig-robot+other@loonext.com"))).toBe("resend.robot_mail_halted");
  });

  it("sends at most ten a day", async () => {
    const h = harness();
    for (let i = 0; i < 10; i++) expect((await send(h, "delivered@resend.dev")).status).toBe(200);
    expect(await ruleOf(await send(h, "delivered@resend.dev"))).toBe("budget.resend_day");
    h.advance(24 * 60 * 60 * 1000);
    expect((await send(h, "delivered@resend.dev")).status).toBe(200);
  });

  it("fails closed without its key, and on any path but /emails", async () => {
    const h = harness({ env: { RESEND_API_KEY: "" } });
    expect(await ruleOf(await send(h, "delivered@resend.dev"))).toBe("resend.key_missing");
    const keyed = harness();
    expect(await ruleOf(await keyed.call("/resend/emails/batch", { body: [] }))).toBe("resend.path_refused");
    expect(await ruleOf(await keyed.call("/resend/domains"))).toBe("resend.path_refused");
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
