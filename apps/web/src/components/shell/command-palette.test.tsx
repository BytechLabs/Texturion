import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * The "Actions on this conversation" group must never advertise an action it
 * can't perform. "Make a task" (T) and "Send template" (R) once printed
 * accelerator keys but only router.push'd to the already-open thread — a silent
 * no-op the palette can't fix from outside the composer. They were removed; this
 * guards that they stay gone and that every surviving row is a real mutation.
 */

// cmdk carries context the group relies on; swap the wrappers for plain nodes
// so the group renders standalone. data-value exposes each row's cmdk key.
vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandInput: () => null,
  CommandList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandEmpty: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandGroup: ({
    heading,
    children,
  }: {
    heading?: string;
    children: React.ReactNode;
  }) => <div data-group={heading}>{children}</div>,
  CommandItem: ({
    value,
    children,
  }: {
    value: string;
    children: React.ReactNode;
  }) => <div data-value={value}>{children}</div>,
  CommandSeparator: () => <hr />,
  CommandShortcut: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

// Stub the data hooks so the group renders without the API/query stack.
vi.mock("@/lib/api/conversations", () => ({
  useConversation: () => ({
    data: { contact: { name: "Ada Byron", phone_e164: "+14165550182" } },
  }),
  useUpdateConversation: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/lib/api/team", () => ({
  useMembers: () => ({ data: { data: [] } }),
}));
vi.mock("@/lib/api/search", () => ({
  useSearch: () => ({ data: undefined, isFetching: false }),
}));

import { ConversationActions } from "./command-palette";

function render() {
  return renderToStaticMarkup(
    <ConversationActions conversationId="conv_1" onDone={() => undefined} />,
  );
}

describe("ConversationActions — no dead rows", () => {
  it("drops the make-a-task and send-template rows entirely", () => {
    const html = render();
    expect(html).not.toContain("Make a task");
    expect(html).not.toContain("Send template");
    expect(html).not.toContain('data-value="make a task"');
    expect(html).not.toContain('data-value="send template"');
  });

  it("keeps the real mutation rows (done, unassign, status)", () => {
    const html = render();
    expect(html).toContain('data-value="mark done conversation"');
    expect(html).toContain("Mark done");
    expect(html).toContain('data-value="unassign conversation"');
    expect(html).toContain("Unassign");
    expect(html).toContain('data-value="change status closed"');
  });

  it("prints no accelerator keys — the app binds no single-letter hotkeys, so none may be advertised", () => {
    const html = render();
    const keys = html.match(/<kbd/g) ?? [];
    expect(keys).toHaveLength(0);
  });

  it("names the conversation in the context chip", () => {
    expect(render()).toContain("Ada Byron");
  });
});
