/**
 * #694: a mention is about the member, not about the thread, so a mute on the
 * thread never silences it, and the author is never told about their own note.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
import { notifyNoteMention } from "./mention";

const env = completeEnv();
const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";
const CONVERSATION_ID = "bbbbbbbb-0000-4000-8000-00000000000b";
const AUTHOR = "10000000-aaaa-4000-8000-000000000001";
const MUTED = "10000000-aaaa-4000-8000-000000000002";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("notifyNoteMention, #694", () => {
  it("still alerts a member who muted the thread, and never the author", async () => {
    const sb = supabaseStub(env);
    sb.on("GET", "/rest/v1/conversations", () => [
      { id: CONVERSATION_ID, phone_number_id: null },
    ]);
    sb.on("GET", "/rest/v1/company_members", () => [
      { user_id: AUTHOR, role: "owner" },
      { user_id: MUTED, role: "member" },
    ]);
    sb.on("POST", "/rest/v1/rpc/number_member_levels", () => [
      { user_id: AUTHOR, role: "owner", level: "text" },
      { user_id: MUTED, role: "member", level: "text" },
    ]);
    sb.on("GET", "/rest/v1/conversation_member_prefs", () => [
      { user_id: MUTED, muted: true, muted_until: null, followed: false },
    ]);
    sb.on("GET", "/rest/v1/push_subscriptions", () => []);
    stubFetch(sb.route);

    await notifyNoteMention(env, {
      companyId: COMPANY_ID,
      conversationId: CONVERSATION_ID,
      messageId: "dddddddd-0000-4000-8000-00000000000d",
      authorUserId: AUTHOR,
      mentionedUserIds: [AUTHOR, MUTED],
      body: "@you take a look",
    });

    const lookup = sb.find("GET", "/rest/v1/push_subscriptions")[0];
    expect(lookup?.url.searchParams.get("user_id")).toBe(`in.(${MUTED})`);
  });
});
