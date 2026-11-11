import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { makeTranslate } from "@/i18n/provider";
import type { ActivityItem } from "@/lib/api/record-activity";

import { activityLine } from "./activity-line";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/api/team", () => ({
  useMembers: () => ({ data: { data: [{ user_id: "u1", display_name: "Sam Ortiz" }] } }),
}));

const hook = vi.fn();
vi.mock("@/lib/api/record-activity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/record-activity")>()),
  useRecordActivity: (...args: unknown[]) => hook(...args),
}));

import { ActivityTimeline, groupByDay } from "./activity-timeline";

const t = makeTranslate("en");
const tFr = makeTranslate("fr-CA");

const item = (over: Partial<ActivityItem> & { kind: string }): ActivityItem => ({
  id: `id-${over.kind}-${over.occurred_at ?? "x"}`,
  category: "change",
  occurred_at: "2026-11-10T15:00:00.000Z",
  actor: { type: "member", user_id: "u1", display_name: "Sam Ortiz" },
  payload: {},
  source: null,
  ...over,
});

const ctx = {
  t,
  recordType: "contact",
  recordId: "c1",
  nameOf: (id: string | null) => (id === "u1" ? "Sam Ortiz" : null),
};

describe("activityLine (#714)", () => {
  it("says a call with its direction, outcome, talk time and why it ended", () => {
    const line = activityLine(
      item({
        kind: "call",
        category: "call",
        payload: {
          direction: "inbound",
          outcome: "missed",
          talk_seconds: 0,
          ended_reason: "no_answer_in_time",
        },
      }),
      ctx,
    );
    expect(line.text).toContain("Incoming call, not answered");
    expect(line.text.split(" · ").length).toBe(2);
  });

  it("says an edit with the field, before and after", () => {
    const line = activityLine(
      item({ kind: "edited", payload: { field: "name", from: "Jane", to: "Jane Doe" } }),
      ctx,
    );
    expect(line.text).toBe("Changed name from Jane to Jane Doe");
  });

  it("says a cleared field and a boolean", () => {
    expect(
      activityLine(item({ kind: "edited", payload: { field: "email", from: "a@b.co", to: null } }), ctx)
        .text,
    ).toBe("Cleared email (was a@b.co)");
    expect(
      activityLine(item({ kind: "edited", payload: { field: "spam", to: true } }), ctx).text,
    ).toBe("Set spam flag to yes");
  });

  it("names the teammate in an assignment and a mention, and falls back for one who left", () => {
    expect(
      activityLine(item({ kind: "assigned", payload: { to_user_id: "u1" } }), ctx).text,
    ).toBe("Assigned to Sam Ortiz");
    expect(
      activityLine(item({ kind: "mentioned", payload: { user_id: "gone" } }), ctx).text,
    ).toBe("Mentioned someone");
  });

  it("says how an opt-out happened", () => {
    expect(
      activityLine(item({ kind: "opted_out", payload: { source: "stop_keyword" } }), ctx).text,
    ).toBe("Opted out by texting STOP");
    expect(
      activityLine(item({ kind: "opted_out", payload: { source: "manual" } }), ctx).text,
    ).toBe("Opted out by a teammate");
  });

  it("links a text to its message in its thread, and a job to the job", () => {
    const text = activityLine(
      item({
        kind: "text_in",
        category: "message",
        source: { type: "message", id: "m1", conversation_id: "conv-1" },
      }),
      ctx,
    );
    expect(text.href).toBe("/inbox/conv-1?message=m1");
    const task = activityLine(
      item({
        kind: "task_created",
        payload: { title: "Fix tap" },
        source: { type: "task", id: "t1", conversation_id: null },
      }),
      ctx,
    );
    expect(task.href).toBe("/tasks?task=t1");
    expect(task.text).toBe("Job created: Fix tap");
  });

  it("does not link a job's own events back to the job", () => {
    const line = activityLine(
      item({ kind: "created", source: { type: "task", id: "t1", conversation_id: null } }),
      { ...ctx, recordType: "task", recordId: "t1" },
    );
    expect(line.href).toBeNull();
  });

  it("speaks French for every kind it knows", () => {
    const kinds = [
      "text_in", "text_out", "scheduled_queued", "scheduled_sent", "scheduled_cancelled",
      "call", "voicemail", "created", "edited", "tagged", "untagged", "merged", "unmerged",
      "deleted", "restored", "assigned", "unassigned", "mentioned", "referenced",
      "opted_out", "opted_in", "blocked", "unblocked", "task_created", "task_completed",
      "completed", "reopened",
    ];
    for (const kind of kinds) {
      const en = activityLine(item({ kind }), ctx).text;
      const fr = activityLine(item({ kind }), { ...ctx, t: tFr }).text;
      expect(fr, kind).not.toBe("");
      expect(en, kind).not.toBe(t("activity.unknownKind"));
    }
  });
});

describe("groupByDay", () => {
  it("keeps the order given and groups by local calendar day", () => {
    const groups = groupByDay(
      [
        { type: "extra", at: "2026-11-10T20:00:00", key: "a", extra: { id: "a", occurred_at: "", node: null } },
        { type: "extra", at: "2026-11-10T08:00:00", key: "b", extra: { id: "b", occurred_at: "", node: null } },
        { type: "extra", at: "2026-11-09T08:00:00", key: "c", extra: { id: "c", occurred_at: "", node: null } },
      ],
      "en",
    );
    expect(groups.map((g) => g.isoDay)).toEqual(["2026-11-10", "2026-11-09"]);
    expect(groups[0].rows).toHaveLength(2);
  });
});

describe("ActivityTimeline (#714)", () => {
  const base = {
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  };

  it("shows the filter row, the date jump, the actor and a source link", () => {
    hook.mockReturnValue({
      ...base,
      data: {
        pages: [
          {
            data: [
              item({
                kind: "text_out",
                category: "message",
                source: { type: "message", id: "m1", conversation_id: "conv-1" },
              }),
            ],
            next_cursor: null,
          },
        ],
      },
    });
    const html = renderToStaticMarkup(<ActivityTimeline recordType="contact" recordId="c1" />);
    for (const label of ["All", "Messages", "Calls", "Changes"]) expect(html).toContain(label);
    expect(html).toContain('type="date"');
    expect(html).toContain("Text sent");
    expect(html).toContain("Sam Ortiz");
    expect(html).toContain('href="/inbox/conv-1?message=m1"');
    expect(hook).toHaveBeenCalledWith("contact", "c1", null);
  });

  it("#725: names the automation behind a change instead of a person", () => {
    const automated = (origin: string | undefined) =>
      item({
        kind: "edited",
        actor: { type: "automation", user_id: null, display_name: null },
        payload: { field: "due", ...(origin ? { origin } : {}) },
      });
    for (const [origin, who] of [
      ["calendar", "Calendar sync"],
      ["repeat", "Repeat schedule"],
      [undefined, "Automation"],
    ] as const) {
      hook.mockReturnValue({
        ...base,
        data: { pages: [{ data: [automated(origin)], next_cursor: null }] },
      });
      const html = renderToStaticMarkup(<ActivityTimeline recordType="task" recordId="t1" />);
      expect(html, String(origin)).toContain(who);
      expect(html).not.toContain("Sam Ortiz");
    }
  });

  it("folds a surface's own rows in by time, oldest first when asked", () => {
    hook.mockReturnValue({
      ...base,
      data: {
        pages: [
          {
            data: [item({ kind: "created", occurred_at: "2026-11-10T10:00:00.000Z" })],
            next_cursor: null,
          },
        ],
      },
    });
    const html = renderToStaticMarkup(
      <ActivityTimeline
        recordType="task"
        recordId="t1"
        oldestFirst
        extraItems={[
          { id: "k1", occurred_at: "2026-11-10T12:00:00.000Z", node: <p>A comment</p> },
        ]}
      />,
    );
    expect(html.indexOf("Created")).toBeLessThan(html.indexOf("A comment"));
  });

  it("says so when there is nothing yet", () => {
    hook.mockReturnValue({ ...base, data: { pages: [{ data: [], next_cursor: null }] } });
    const html = renderToStaticMarkup(<ActivityTimeline recordType="call" recordId="k1" />);
    expect(html).toContain("Nothing here yet");
  });
});
