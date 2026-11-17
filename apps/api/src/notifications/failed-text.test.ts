import { afterEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
import { deliverPush } from "./deliver";
import { notifyFailedText } from "./failed-text";

vi.mock("./deliver", () => ({ deliverPush: vi.fn() }));

const env = completeEnv();
const message = {
  id: "message-id",
  company_id: "company-id",
  conversation_id: "thread-id",
  sent_by_user_id: "sender",
  automated: false,
};

function setup(opts: { creator?: string; muted?: boolean; hidden?: boolean } = {}) {
  const sb = supabaseStub(env);
  const recipient = opts.creator ?? message.sent_by_user_id;
  sb.on("GET", "/rest/v1/scheduled_messages", () =>
    opts.creator ? [{ created_by: opts.creator }] : []);
  sb.on("GET", "/rest/v1/conversations", () => [{ phone_number_id: "line-id" }]);
  sb.on("GET", "/rest/v1/conversation_member_prefs", () =>
    opts.muted ? [{ user_id: recipient, muted: true, muted_until: null }] : []);
  sb.on("GET", "/rest/v1/company_members", () => [
    { user_id: recipient, role: "member" },
  ]);
  sb.on("POST", "/rest/v1/rpc/number_member_levels", () => [
    { user_id: recipient, role: "member", level: opts.hidden ? "none" : "text" },
  ]);
  stubFetch(sb.route);
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe(notifyFailedText, () => {
  it("alerts the sender once under the delivery-failure preference", async () => {
    setup();
    const db = getDb(env);
    await notifyFailedText(env, db, message);

    expect(deliverPush).toHaveBeenCalledExactlyOnceWith(env, db, expect.objectContaining({
      category: "send_failures",
      collapseKey: "send-failed:thread-id",
      userIds: ["sender"],
    }));
  });

  it("alerts the member who queued a scheduled text", async () => {
    setup({ creator: "scheduler" });
    const db = getDb(env);
    await notifyFailedText(env, db, message);

    expect(deliverPush).toHaveBeenCalledExactlyOnceWith(env, db, expect.objectContaining({
      category: "scheduled_texts",
      userIds: ["scheduler"],
    }));
  });

  it.each([{ muted: true }, { hidden: true }])("skips a muted or hidden thread (%j)", async (opts) => {
    setup(opts);
    await notifyFailedText(env, getDb(env), message);

    expect(deliverPush).not.toHaveBeenCalled();
  });

  it("does not notify for an automated text", async () => {
    await notifyFailedText(env, getDb(env), { ...message, automated: true });

    expect(deliverPush).not.toHaveBeenCalled();
  });
});
