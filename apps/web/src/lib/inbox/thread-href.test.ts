import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { sourceEntries } from "@/test/source-tree";

import { inboxHref, mergeInboxListParams, threadHref } from "./thread-href";

const LIST_QUERY = "status=open&assignee=none&line=line-id&tag=tag-id&unread=true&spam=1&snoozed=true&awaiting=1&q=garage+door";
const RAW_INBOX_LINK = /\/inbox\/\$\{|href\s*=\s*["']\/inbox["']/;

describe("#718 threadHref, the one way to open a thread at something", () => {
  it("is the plain thread with no target", () => {
    expect(threadHref("c1")).toBe("/inbox/c1");
    expect(threadHref("c1", { messageId: null, taskId: null })).toBe("/inbox/c1");
  });

  it("anchors to a message, a call, and opens a task beside either", () => {
    expect(threadHref("c1", { messageId: "m1" })).toBe("/inbox/c1?message=m1");
    expect(threadHref("c1", { callSessionId: "s1" })).toBe("/inbox/c1?call=s1");
    expect(threadHref("c1", { messageId: "m1", taskId: "t1" })).toBe(
      "/inbox/c1?message=m1&task=t1",
    );
    expect(threadHref("c1", { taskId: "t1" })).toBe("/inbox/c1?task=t1");
  });

  it("a message wins when both a message and a call are given", () => {
    expect(threadHref("c1", { messageId: "m1", callSessionId: "s1" })).toBe(
      "/inbox/c1?message=m1",
    );
  });
});

describe(inboxHref, () => {
  it("keeps every list key and replaces anchors when opening a different thread", () => {
    const href = inboxHref({
      conversationId: "next",
      listQuery: `${LIST_QUERY}&thread=notes&call=old&task=old&find=stale&unknown=1`,
      target: { messageId: "found", findQuery: "  door & rail  " },
    });

    expect(href).toBe(`/inbox/next?${LIST_QUERY}&message=found&find=door+%26+rail`);
  });

  it("keeps the list on the way into compose and back from a thread", () => {
    expect(inboxHref({ conversationId: "new", contactId: "contact-id", listQuery: LIST_QUERY })).toBe(
      `/inbox/new?${LIST_QUERY}&contact=contact-id`,
    );
    expect(inboxHref({ listQuery: `${LIST_QUERY}&message=found` })).toBe(`/inbox?${LIST_QUERY}`);
  });

  it("replaces list filters without removing the open thread's params", () => {
    const current = "status=open&line=old-line&q=old&task=t1&message=m1&call=c1&thread=notes&find=door";
    const params = mergeInboxListParams(current, "?status=closed&tag=tag-id");

    expect(Object.fromEntries(params)).toEqual({
      status: "closed",
      tag: "tag-id",
      task: "t1",
      message: "m1",
      call: "c1",
      thread: "notes",
      find: "door",
    });
  });

  it("keeps navigation inside inbox and thread components on the shared builders", () => {
    const roots = [
      fileURLToPath(new URL("../../components/inbox", import.meta.url)),
      fileURLToPath(new URL("../../components/thread", import.meta.url)),
    ];
    const bareLinks = roots.flatMap((root) => sourceEntries(root, [".tsx"]))
      .filter(([file, source]) => !file.endsWith(".test.tsx") && RAW_INBOX_LINK.test(source))
      .map(([file]) => file);

    expect(bareLinks, "Use inboxHref for this inbox navigation").toEqual([]);
  });
});
