import { EDGE_GUARD_ENTRYPOINT } from "@loonext/rig-protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Env } from "./env";
import worker, * as entry from "./index";
import { fromOurDomain, mailStatus, robotTag } from "./mailbox";
import { ROBOT_ADDRESS, connectRig, counters, edgeEnv, fakeGuard, mailboxStub, resetEdge } from "./test/support";

let env: Env;

beforeEach(async () => {
  await resetEdge();
  env = await edgeEnv(fakeGuard());
});

const RAW = "From: Loonext <noreply@loonext.com>\r\nSubject: You're invited\r\nMessage-ID: <m1@loonext.com>\r\n\r\nJoin QA-W.\r\n";

function message(overrides: Partial<{ to: string; from: string; raw: string; messageId: string }> = {}) {
  const raw = overrides.raw ?? RAW;
  const setReject = vi.fn();
  const msg = {
    to: overrides.to ?? "rig-robot+s34-invite@example.loonext.com",
    from: overrides.from ?? "bounces+abc@send.loonext.com",
    headers: new Headers({ subject: "You're invited", "message-id": overrides.messageId ?? "<m1@loonext.com>" }),
    raw: new Response(raw).body as ReadableStream<Uint8Array>,
    rawSize: raw.length,
    setReject,
    forward: vi.fn(),
    reply: vi.fn(),
  };
  return { msg: msg as unknown as ForwardableEmailMessage, setReject };
}

describe("robot addresses", () => {
  it("reads the +tag of the robot's address and nothing else", () => {
    expect(robotTag("rig-robot+s34@example.loonext.com", ROBOT_ADDRESS)).toBe("s34");
    expect(robotTag("RIG-ROBOT@example.loonext.com", ROBOT_ADDRESS)).toBe("");
    expect(robotTag("rig-robotx@example.loonext.com", ROBOT_ADDRESS)).toBeNull();
    expect(robotTag("rig-robot+@example.loonext.com", ROBOT_ADDRESS)).toBeNull();
    expect(robotTag("rig-robot+s34@elsewhere.example", ROBOT_ADDRESS)).toBeNull();
    expect(robotTag("rig-robot@example.loonext.com", undefined)).toBeNull();
  });

  it("knows our own sending domain", () => {
    expect(fromOurDomain("bounces+x@send.loonext.com")).toBe(true);
    expect(fromOurDomain("noreply@loonext.com")).toBe(true);
    expect(fromOurDomain("someone@notloonext.com")).toBe(false);
  });
});

describe("the guard's entrypoint", () => {
  it("is exported under the name the guard binds", () => {
    expect((entry as Record<string, unknown>)[EDGE_GUARD_ENTRYPOINT]).toBe(entry.EdgeForGuard);
    expect(typeof entry.EdgeForGuard.prototype.mailStatus).toBe("function");
  });
});

describe("email()", () => {
  it("stores the robot's mail, delivers it as a mail frame and reports it to the guard", async () => {
    const { msg, setReject } = message();
    await worker.email(msg, env);
    expect(setReject).not.toHaveBeenCalled();

    const rig = await connectRig(env);
    const frame = await rig.next((f) => f.t === "mail");
    expect(frame).toMatchObject({
      t: "mail",
      to: "rig-robot+s34-invite@example.loonext.com",
      from: "bounces+abc@send.loonext.com",
      subject: "You're invited",
      raw: RAW,
    });
    rig.close();

    const status = await mailStatus(env);
    expect(status).toMatchObject({ received: 1, stored: 1, store_failed: 0 });
    expect(status.recent).toEqual([{ tag: "s34-invite", received_at: expect.any(String) }]);
    expect(status.heartbeat_at).not.toBeNull();
  });

  it("never rejects, and still delivers, when the mailbox's storage fails", async () => {
    const broken = {
      idFromName: () => env.MAILBOX.idFromName("robot"),
      get: () => ({
        received: async () => {
          throw new Error("storage unavailable");
        },
        store: async () => {
          throw new Error("storage unavailable");
        },
      }),
    } as unknown as Env["MAILBOX"];
    const { msg, setReject } = message();
    await expect(worker.email(msg, { ...env, MAILBOX: broken })).resolves.toBeUndefined();
    expect(setReject).not.toHaveBeenCalled();
    const c = await counters();
    expect(c["mail.store_failed"]).toBe(1);
    expect(c["mail.count_failed"]).toBe(1);

    const rig = await connectRig(env);
    expect(await rig.next((f) => f.t === "mail")).toMatchObject({ subject: "You're invited" });
    rig.close();
  });

  it("never rejects even when every object is down", async () => {
    const down = {
      idFromName: () => {
        throw new Error("down");
      },
      get: () => {
        throw new Error("down");
      },
    } as unknown as Env["MAILBOX"];
    const { msg, setReject } = message();
    await expect(worker.email(msg, { ...env, MAILBOX: down, UPLINK: down as never })).resolves.toBeUndefined();
    expect(setReject).not.toHaveBeenCalled();
  });

  it("accepts but neither stores nor delivers mail from strangers or to other addresses", async () => {
    const stranger = message({ from: "someone@elsewhere.example", messageId: "<s1@elsewhere.example>" });
    const misaddressed = message({ to: "info@example.loonext.com", messageId: "<s2@loonext.com>" });
    await worker.email(stranger.msg, env);
    await worker.email(misaddressed.msg, env);
    expect(stranger.setReject).not.toHaveBeenCalled();
    expect(misaddressed.setReject).not.toHaveBeenCalled();

    const c = await counters();
    expect(c["mail.stranger"]).toBe(1);
    expect(c["mail.misaddressed"]).toBe(1);
    expect((await mailboxStub().status(0)).stored).toBe(0);
    const rig = await connectRig(env);
    await expect(rig.next((f) => f.t === "mail", 200)).rejects.toThrow();
    rig.close();
  });

  it("delivers a redelivered message once", async () => {
    await worker.email(message().msg, env);
    await worker.email(message().msg, env);
    const rig = await connectRig(env);
    await rig.next((f) => f.t === "mail");
    await expect(rig.next((f) => f.t === "mail", 200)).rejects.toThrow();
    rig.close();
  });
});
