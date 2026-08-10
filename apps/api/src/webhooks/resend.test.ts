/**
 * #386 — the Resend webhook and the suppression it drives.
 *
 * The signature is the ONLY authentication this endpoint has: it carries no
 * JWT, and a forged request could suppress any address in the product —
 * silencing a competitor's crew, or our own billing mail, with one POST. So
 * most of what follows is about rejection rather than acceptance.
 *
 * The suppression rules themselves (permanent vs transient, complaint
 * permanence) live in SQL and are covered by
 * supabase/tests/email_deliverability.test.sql.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
import {
  processResendEvent,
  resendWebhookRoute,
  verifyResendSignature,
} from "./resend";

const env = completeEnv();
/**
 * The signing secret this suite signs with. #599 triage, and then its sequel.
 *
 * ENCODED HERE RATHER THAN WRITTEN OUT. A realistic `whsec_`-then-random constant
 * matched GitHub's Stripe webhook-secret pattern and sat as an open secret-scanning
 * alert on a public repository for weeks — one of four nobody triaged, which is how a
 * real one would have gone unnoticed too.
 *
 * Rewriting it as a base64 stem did not fix that, it moved it: the scanner objects to a
 * name like this one assigned any run of ten-plus characters, and 44 characters of
 * base64 cleared its entropy floor whatever they happened to decode to. So the value is
 * built here instead. The plaintext says what it is, `btoa` hands `sign` below and the
 * verifier the base64 they both expect, and nothing quoted in this file is shaped like a
 * credential any more.
 */
const SECRET = `whsec_${btoa("resend-signing-key-for-tests")}`;
/** A different key, for the case that must be REFUSED. Same treatment. */
const WRONG_SECRET = `whsec_${btoa("a-different-key-for-tests")}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

const NOW = new Date("2026-07-28T12:00:00Z");
const TS = String(Math.floor(NOW.getTime() / 1000));

/** Sign exactly as Svix does, so the verifier is tested against real input. */
async function sign(id: string, timestamp: string, body: string): Promise<string> {
  const raw = SECRET.slice("whsec_".length);
  const keyBytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${body}`),
  );
  return `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`;
}

describe("verifyResendSignature", () => {
  const body = JSON.stringify({ type: "email.bounced" });

  it("accepts a correctly signed request", async () => {
    const signature = await sign("msg_1", TS, body);
    await expect(
      verifyResendSignature(SECRET, { id: "msg_1", timestamp: TS, signature }, body, NOW),
    ).resolves.toBe(true);
  });

  it("rejects a body that changed after signing", async () => {
    // The attack this stops: replay a real bounce notification with the
    // address swapped, and suppress somebody else's mail.
    const signature = await sign("msg_1", TS, body);
    await expect(
      verifyResendSignature(
        SECRET,
        { id: "msg_1", timestamp: TS, signature },
        JSON.stringify({ type: "email.bounced", data: { to: ["victim@example.com"] } }),
        NOW,
      ),
    ).resolves.toBe(false);
  });

  it("rejects a signature lifted from a different message id", async () => {
    const signature = await sign("msg_1", TS, body);
    await expect(
      verifyResendSignature(SECRET, { id: "msg_2", timestamp: TS, signature }, body, NOW),
    ).resolves.toBe(false);
  });

  it("rejects a replay from outside the tolerance window", async () => {
    const old = String(Math.floor(NOW.getTime() / 1000) - 3600);
    const signature = await sign("msg_1", old, body);
    await expect(
      verifyResendSignature(SECRET, { id: "msg_1", timestamp: old, signature }, body, NOW),
    ).resolves.toBe(false);
  });

  it("rejects the wrong secret", async () => {
    const signature = await sign("msg_1", TS, body);
    await expect(
      verifyResendSignature(
        WRONG_SECRET,
        { id: "msg_1", timestamp: TS, signature },
        body,
        NOW,
      ),
    ).resolves.toBe(false);
  });

  it("rejects missing headers rather than treating them as a pass", async () => {
    await expect(
      verifyResendSignature(SECRET, { id: undefined, timestamp: TS, signature: "v1,x" }, body, NOW),
    ).resolves.toBe(false);
    await expect(
      verifyResendSignature(SECRET, { id: "msg_1", timestamp: TS, signature: undefined }, body, NOW),
    ).resolves.toBe(false);
  });

  it("accepts when ONE of several offered signatures matches", async () => {
    // Svix sends both secrets during a rotation. Requiring the first to match
    // would drop every event mid-rotation — a self-inflicted outage of the
    // exact feed that tells us delivery is broken.
    const good = await sign("msg_1", TS, body);
    const signature = `v1,AAAAmismatchAAAA ${good}`;
    await expect(
      verifyResendSignature(SECRET, { id: "msg_1", timestamp: TS, signature }, body, NOW),
    ).resolves.toBe(true);
  });
});

describe("processResendEvent", () => {
  function world() {
    const sb = supabaseStub(env);
    const recorded: Record<string, unknown>[] = [];
    sb.on("POST", "/rest/v1/rpc/record_email_event", (call) => {
      recorded.push(call.body as Record<string, unknown>);
      return { suppressed: false };
    });
    return { sb, recorded };
  }

  it("records a bounce with the provider's permanence verdict", async () => {
    // The Permanent/Transient distinction is the difference between a dead
    // address and a full mailbox, and it is the provider's call, not ours.
    const w = world();
    stubFetch(w.sb.route);

    await processResendEvent(env, {
      type: "email.bounced",
      created_at: "2026-07-28T11:00:00Z",
      data: {
        email_id: "re_1",
        to: ["dead@example.com"],
        subject: "New text from Dana",
        bounce: { type: "Permanent" },
      },
    });

    expect(w.recorded).toHaveLength(1);
    expect(w.recorded[0]).toMatchObject({
      p_email: "dead@example.com",
      p_event: "bounced",
      p_bounce_type: "Permanent",
      p_resend_id: "re_1",
    });
  });

  it("records one event per recipient of a fan-out", async () => {
    // The inbound-text notification goes to the whole crew in one Resend call,
    // so one bounce event can name several addresses. Recording only the first
    // would leave the rest quietly unsuppressed.
    const w = world();
    stubFetch(w.sb.route);

    await processResendEvent(env, {
      type: "email.complained",
      data: { email_id: "re_2", to: ["a@example.com", "b@example.com"] },
    });

    expect(w.recorded.map((row) => row.p_email)).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  it("ignores the events that change no decision", async () => {
    // Resend also sends email.sent, email.opened and email.clicked. Recording
    // them would grow the table forever without changing anything we do — and
    // open tracking on transactional mail is a privacy cost with no benefit.
    const w = world();
    stubFetch(w.sb.route);

    await processResendEvent(env, {
      type: "email.opened",
      data: { email_id: "re_3", to: ["someone@example.com"] },
    });

    expect(w.recorded).toHaveLength(0);
  });
});

describe("#581/16 — an unconfigured secret is a rotation, and says so", () => {
  /**
   * Refusing outright is right: trusting an unsigned body would let anybody suppress
   * any address in the product. What was wrong is that this arm returned BEFORE the
   * rejection counter, so the most likely Resend misconfiguration — a secret cleared,
   * or never copied into an environment — recorded nothing at all.
   *
   * That is the one arrangement the `channel:webhook-signature` alarm exists to catch.
   * Every delivery is refused either way; what differs is whether anybody finds out
   * before we have spent a week not suppressing hard-bounced addresses.
   */
  it("counts the refusal, so the liveness alarm can see it", async () => {
    const sb = supabaseStub(env);
    const rejections: { p_provider: string }[] = [];
    sb.on("POST", "/rest/v1/rpc/record_webhook_rejection", (call) => {
      rejections.push(call.body as { p_provider: string });
      return null;
    });
    stubFetch(sb.route);

    const unconfigured = { ...env, RESEND_WEBHOOK_SECRET: undefined };
    const res = await resendWebhookRoute.request(
      "/",
      {
        method: "POST",
        // Resend signs with ITS key; ours is the one that is missing. The header is
        // present, which is what tells the counter this was a real delivery rather
        // than somebody poking the endpoint.
        headers: { "svix-signature": "v1,whatever", "svix-id": "msg_1" },
        body: JSON.stringify({ type: "email.bounced" }),
      },
      unconfigured,
    );

    expect(res.status).toBe(503);
    // The counter runs off the response path; let its promise settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rejections).toEqual([{ p_provider: "resend" }]);
  });
});
