/**
 * D142: RESEND_API_BASE. Production keeps Resend's own host; the rig sends
 * through its guard, which holds the only key, under a path on its edge.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getEnv } from "../env";
import { rigEnv } from "../test/rig-env";
import { completeEnv, stubFetch } from "../test/support";
import { sendEmail } from "./resend";

function recordSends(): string[] {
  const sent: string[] = [];
  stubFetch((url, request) => {
    if (request.method !== "POST" || !url.pathname.endsWith("/emails")) return undefined;
    sent.push(url.href);
    return Response.json({ id: "em_1" });
  });
  return sent;
}

const message = { to: "delivered@resend.dev", subject: "s", html: "<p>h</p>", text: "h" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RESEND_API_BASE", () => {
  it("is Resend itself when unset", async () => {
    const sent = recordSends();
    await sendEmail(getEnv(completeEnv()), message);
    expect(sent).toEqual(["https://api.resend.com/emails"]);
  });

  it("keeps the base path the rig's edge routes on", async () => {
    const sent = recordSends();
    await sendEmail(getEnv(rigEnv()), message);
    expect(sent).toEqual(["https://edge.rig.internal/g/resend/emails"]);
  });
});
