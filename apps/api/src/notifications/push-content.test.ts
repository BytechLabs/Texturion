/**
 * #430 — a workspace can stop a customer's words reaching a lock screen.
 *
 * The default is unchanged and that is half of what these assertions protect:
 * #388 argues the five-minute window decides the job, and triage-without-
 * unlocking is what makes it possible. A regression that quietly stripped
 * every snippet would be as bad a bug as the one this feature fixes.
 *
 * The other half is that when a workspace DOES turn it off, the content is
 * gone from the payload rather than merely hidden by a client — because the
 * whole argument for this control over the OS one is that no phone setting
 * can reveal what was never transmitted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deliverPush } from "./deliver";
import type { PushContent } from "./deliver";
import type { Env } from "../env";

const sent: Array<Record<string, unknown>> = [];

vi.mock("./webpush", () => ({
  sendWebPush: vi.fn(async (_env: unknown, _sub: unknown, payload: string) => {
    sent.push(JSON.parse(payload) as Record<string, unknown>);
    return { gone: false };
  }),
}));
vi.mock("./fcm", () => ({
  isFcmConfigured: () => false,
  sendFcm: vi.fn(async () => ({ gone: false })),
}));

const ALERT = { title: "Maria Alvarez", body: "basement flooding, 42 Elm", url: "/inbox/1" };

/** A db double: one web subscription, no native tokens, one company row. */
function fakeDb(includeContent: boolean | "error") {
  return {
    from: (table: string) => {
      if (table === "companies") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                includeContent === "error"
                  ? { data: null, error: { message: "boom" } }
                  : { data: { push_include_content: includeContent }, error: null },
            }),
          }),
        };
      }
      if (table === "push_subscriptions") {
        return {
          select: () => ({
            in: () => ({
              order: () => ({
                limit: async () => ({
                  data: [
                    { id: "s1", user_id: "u1", endpoint: "https://push/1", p256dh: "k", auth: "a" },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      // device_push_tokens and anything else: empty.
      return {
        select: () => ({
          in: () => ({
            order: () => ({ limit: async () => ({ data: [], error: null }) }),
          }),
        }),
      };
    },
  } as never;
}

const env = { VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "k" } as unknown as Env;

async function push(content: PushContent, include: boolean | "error") {
  await deliverPush(env, fakeDb(include), {
    userIds: ["u1"],
    content,
    web: ALERT,
    collapseKey: "conversation:1",
    failures: [],
  });
  return sent.at(-1)!;
}

const PEOPLE: PushContent = {
  written: "people",
  companyId: "c1",
  withheld: { body: "Sent you a message" },
};

describe("push content setting (#430)", () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it("sends the snippet by default, which is the behaviour #388 depends on", async () => {
    expect((await push(PEOPLE, true)).body).toBe("basement flooding, 42 Elm");
  });

  it("withholds the customer's words when the workspace turned it off", async () => {
    const payload = await push(PEOPLE, false);
    expect(payload.body).toBe("Sent you a message");
    // The address must not survive anywhere in the serialized payload — the
    // point of doing this server-side is that it is never transmitted.
    expect(JSON.stringify(payload)).not.toContain("42 Elm");
  });

  it("keeps the contact's name, because knowing WHO is most of the triage", async () => {
    expect((await push(PEOPLE, false)).title).toBe("Maria Alvarez");
  });

  it("leaves our own copy alone even when the setting is off", async () => {
    // "Carrier approval came through" is ours. Withholding it would protect
    // nobody and cost the owner an alert they waited days for.
    const payload = await push({ written: "us" }, false);
    expect(payload.body).toBe("basement flooding, 42 Elm");
  });

  it("withholds when the setting cannot be read", async () => {
    // The one place in this codebase that fails CLOSED. Everywhere else a
    // lookup failure falls back to the permissive default because the
    // alternative is a dead product; here the permissive default publishes a
    // third party's words, and the alert still arrives carrying the name.
    const payload = await push(PEOPLE, "error");
    expect(payload.body).toBe("Sent you a message");
    expect(payload.title).toBe("Maria Alvarez");
  });

  it("withholds the TITLE where the title is the authored part", async () => {
    // A task title is member-written and per the personal-data inventory
    // routinely holds a job address — "Alvarez, 42 Elm, gate code 4417". So
    // the task push withholds the title and keeps the body, which is our own
    // "Due in 2 hours": the reminder still says WHEN without telling the room
    // WHERE.
    const payload = await push(
      { written: "people", companyId: "c1", withheld: { title: "A task is due" } },
      false,
    );
    expect(payload.title).toBe("A task is due");
    expect(payload.body).toBe("basement flooding, 42 Elm");
  });

  it("carries the collapse key through the swap", async () => {
    // The withheld payload is rebuilt, so the coalescing identity is the
    // easiest thing to drop on the floor — and losing it would let two
    // different customers' alerts replace each other.
    expect((await push(PEOPLE, false)).tag).toBe("conversation:1");
  });
});
