/**
 * #304 — one customer's history, as a document somebody hands to an adjuster.
 *
 * HX-3 is the one to read twice. #304 names an export as the easiest place in
 * the product to leak a number by accident, "because export code paths tend to
 * bypass the list-view filters". A thread on a number the requester cannot see
 * must not be in the file — and the file must SAY a thread was withheld, or it
 * is a document somebody puts in front of an adjuster believing it is whole.
 */
import { describe, expect, it } from "vitest";

import {
  HISTORY_MESSAGE_CAP,
  buildConversationHistory,
  renderHistoryDocument,
} from "./history-export";

type Row = Record<string, unknown>;

/**
 * The smallest Supabase double that answers this builder.
 *
 * Keyed by TABLE rather than by call order: the builder reads members,
 * contacts, conversations and messages, and a counter-based double breaks
 * silently the moment a read is added or reordered.
 */
function dbDouble(tables: {
  members?: Row[];
  contacts?: Row[];
  conversations?: Row[];
  messagesByConversation?: Record<string, Row[]>;
  calls?: Row[];
  levels?: Row[];
}) {
  const build = (table: string, filters: Record<string, string>) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain as never;
    // `is` records like `eq` does, and #581/C14 is the reason it has to: the member
    // read asks for an ACTIVE membership with `.is("deactivated_at", null)`, and a
    // double that silently swallowed that filter would report the builder as safe
    // whether or not it applied it.
    for (const method of ["select", "eq", "is", "gte", "lte", "order", "limit"]) {
      chain[method] = (a?: unknown, b?: unknown) => {
        if ((method === "eq" || method === "is") && typeof a === "string") {
          filters[a] = method === "is" ? `is.${String(b)}` : String(b);
        }
        return self();
      };
    }
    chain.maybeSingle = async () => ({
      // A row that exists but is DEACTIVATED is what offboarding leaves behind — the
      // membership is never deleted, because history keeps its attribution. So the
      // double answers the way the database would: a query restricted to active
      // members does not see it.
      data:
        filters.deactivated_at === "is.null"
          ? ((tables.members ?? []).find((row) => !row.deactivated_at) ?? null)
          : ((tables.members ?? [])[0] ?? null),
      error: null,
    });
    chain.range = async () => {
      if (table === "messages") {
        const id = filters.conversation_id;
        return { data: tables.messagesByConversation?.[id] ?? [], error: null };
      }
      return { data: [], error: null };
    };
    chain.then = (resolve: (value: unknown) => unknown) => {
      const data =
        table === "contacts"
          ? tables.contacts ?? []
          : table === "conversations"
            ? tables.conversations ?? []
            : table === "calls"
              ? tables.calls ?? []
              : [];
      return Promise.resolve({ data, error: null }).then(resolve);
    };
    return chain;
  };
  return {
    from: (table: string) => build(table, {}),
    rpc: async () => ({ data: tables.levels ?? [], error: null }),
  } as never;
}

function message(id: string, body: string, at: string, direction = "inbound"): Row {
  return {
    id,
    conversation_id: "conv-visible",
    direction,
    body,
    status: "delivered",
    created_at: at,
  };
}

const BASE = {
  members: [{ role: "owner" }],
  contacts: [{ id: "c1", name: "Dave Whitfield", phone_e164: "+12125559601" }],
};

async function run(tables: Parameters<typeof dbDouble>[0]) {
  const written: { path: string; body: string; type: string }[] = [];
  const result = await buildConversationHistory(
    dbDouble(tables),
    {
      exportId: "e1",
      companyId: "co1",
      requestedBy: "u1",
      filters: { contact_id: "c1" },
      prefix: "co1/e1",
      now: new Date("2026-08-03T12:00:00Z"),
    },
    async (path, body, type) => {
      written.push({ path, body, type });
    },
  );
  return { result, written };
}

describe("#304 the conversation-history export", () => {
  it("HX-1: writes a document AND a spreadsheet", async () => {
    // The document is for the adjuster, who will not read a CSV. The CSV is
    // for the bookkeeper, who will not read a document.
    const { written } = await run({
      ...BASE,
      conversations: [{ id: "conv-visible", phone_number_id: "num-1" }],
      messagesByConversation: {
        "conv-visible": [message("m1", "The boiler is out", "2026-07-02T09:00:00Z")],
      },
    });
    expect(written.map((w) => w.path)).toEqual([
      "co1/e1/history.html",
      "co1/e1/history.csv",
    ]);
    expect(written[0].type).toContain("text/html");
    expect(written[1].type).toContain("text/csv");
  });

  it("HX-2: puts the messages in the document", async () => {
    const { written } = await run({
      ...BASE,
      conversations: [{ id: "conv-visible", phone_number_id: "num-1" }],
      messagesByConversation: {
        "conv-visible": [message("m1", "The boiler is out", "2026-07-02T09:00:00Z")],
      },
    });
    expect(written[0].body).toContain("The boiler is out");
    expect(written[0].body).toContain("Dave Whitfield");
  });

  it("HX-3: leaves out a thread the requester cannot see, and SAYS so", async () => {
    // THE ONE THAT MATTERS. Silently missing is worse than absent: the file
    // gets forwarded, printed and filed as though it were the whole history.
    const { written, result } = await run({
      members: [{ role: "member" }],
      contacts: BASE.contacts,
      // `member_number_levels` says this member cannot see num-2.
      levels: [{ phone_number_id: "num-2", level: "none" }],
      conversations: [
        { id: "conv-visible", phone_number_id: "num-1" },
        { id: "conv-hidden", phone_number_id: "num-2" },
      ],
      messagesByConversation: {
        "conv-visible": [message("m1", "Visible line", "2026-07-02T09:00:00Z")],
        "conv-hidden": [message("m2", "Restricted line", "2026-07-03T09:00:00Z")],
      },
    });
    expect(written[0].body).not.toContain("Restricted line");
    expect(written[1].body).not.toContain("Restricted line");
    expect(written[0].body).toContain("cannot see");
    expect(result.partial).toBe(true);
  });

  it("HX-4: refuses when the requester has left the workspace", async () => {
    // An export somebody asked for is not a reason to hand their old
    // workspace's messages to whoever collects the link (#276).
    await expect(
      run({ members: [], contacts: BASE.contacts, conversations: [] }),
    ).rejects.toThrow(/no longer in the workspace/);
  });

  it("HX-4b [#581/C14]: refuses a requester who was REMOVED, row and all", async () => {
    /**
     * HX-4 above passes an empty member list, and offboarding never produces that:
     * removing somebody sets `deactivated_at` and leaves the row, because history keeps
     * its attribution — `team.ts` says exactly that where it does the removal. So the
     * check HX-4 covers could not fire for the case it exists for, and somebody removed
     * an hour ago still had their old role read back and a transcript of a customer's
     * conversation written for whoever collected the link.
     *
     * The row is present here. What refuses it is the query asking for an ACTIVE one.
     */
    await expect(
      run({
        members: [{ role: "admin", deactivated_at: "2026-08-01T09:00:00Z" }],
        contacts: BASE.contacts,
        conversations: [],
      }),
    ).rejects.toThrow(/no longer in the workspace/);
  });

  it("HX-5: escapes a message body, because strangers wrote it", async () => {
    const { written } = await run({
      ...BASE,
      conversations: [{ id: "conv-visible", phone_number_id: "num-1" }],
      messagesByConversation: {
        "conv-visible": [
          message("m1", "<script>alert(1)</script>", "2026-07-02T09:00:00Z"),
        ],
      },
    });
    expect(written[0].body).not.toContain("<script>");
    expect(written[0].body).toContain("&lt;script&gt;");
  });

  it("HX-6: guards the CSV against a body that is a formula", async () => {
    // The same reason the contacts export does: a body beginning "=" is a
    // formula in a spreadsheet, and these bodies are written by customers.
    const { written } = await run({
      ...BASE,
      conversations: [{ id: "conv-visible", phone_number_id: "num-1" }],
      messagesByConversation: {
        "conv-visible": [message("m1", "=cmd|'/c calc'!A1", "2026-07-02T09:00:00Z")],
      },
    });
    expect(written[1].body).not.toMatch(/(^|,)"?=cmd/);
  });
});

describe("#304 the document itself", () => {
  const base = {
    contactName: "Dave Whitfield",
    contactPhone: "+12125559601",
    from: null,
    to: null,
    generatedAt: "2026-08-03T12:00:00Z",
    entries: [],
    withheldThreads: 0,
    withheldCalls: 0,
    capped: false,
  };

  it("HD-1: says nothing about gaps when there are none", () => {
    // A document that always warns is a document nobody reads the warnings on.
    expect(renderHistoryDocument(base)).not.toContain("cannot see");
    expect(renderHistoryDocument(base)).not.toContain("longer than");
  });

  it("HD-2: says the history was truncated, IN the document", () => {
    // Not in an email beside it. The document is what gets forwarded and
    // filed; a caveat that does not travel with it is a caveat nobody reads.
    const html = renderHistoryDocument({ ...base, capped: true });
    expect(html).toContain(String(HISTORY_MESSAGE_CAP));
    expect(html).toContain("narrow the dates");
  });

  it("HD-3: needs no network to open", () => {
    // It has to render on a court clerk's machine and print the way it looks.
    // A stylesheet, a script or an image is a way for it not to.
    const html = renderHistoryDocument(base);
    expect(html).not.toMatch(/<script|<img|https?:\/\//);
  });
});

describe("#304 calls in the same document", () => {
  it("HC-1: a call sits in the chronology between the texts", async () => {
    // ONE document, not two. The reader is following a conversation with a
    // person, and handing them two files to interleave by hand is handing
    // them the work.
    const { written } = await run({
      ...BASE,
      conversations: [{ id: "conv-visible", phone_number_id: "num-1" }],
      messagesByConversation: {
        "conv-visible": [
          message("m1", "Morning text", "2026-07-02T09:00:00Z"),
          message("m2", "Evening text", "2026-07-02T17:00:00Z"),
        ],
      },
      calls: [
        {
          id: "call-1",
          conversation_id: "conv-visible",
          direction: "inbound",
          outcome: "answered",
          voicemail_transcript: null,
          started_at: "2026-07-02T14:00:00Z",
        },
      ],
    });
    const html = written[0].body;
    expect(html.indexOf("Morning text")).toBeLessThan(html.indexOf("Call"));
    expect(html.indexOf("Call")).toBeLessThan(html.indexOf("Evening text"));
  });

  it("HC-2: a voicemail carries its transcript, which IS its content", async () => {
    // Without it the row says only that somebody rang, which an adjuster
    // cannot use for anything.
    const { written } = await run({
      ...BASE,
      conversations: [{ id: "conv-visible", phone_number_id: "num-1" }],
      calls: [
        {
          id: "call-1",
          conversation_id: "conv-visible",
          direction: "inbound",
          outcome: "voicemail",
          voicemail_transcript: "The heating is off again",
          started_at: "2026-07-02T14:00:00Z",
        },
      ],
    });
    expect(written[0].body).toContain("The heating is off again");
  });

  it("HC-3: a call on a line they cannot see is left out, and SAID", async () => {
    // The same rule the messages get, and the same reason: a document whose
    // texts are all present but whose calls are quietly missing looks whole.
    const { written, result } = await run({
      members: [{ role: "member" }],
      contacts: BASE.contacts,
      levels: [{ phone_number_id: "num-2", level: "none" }],
      conversations: [
        { id: "conv-visible", phone_number_id: "num-1" },
        { id: "conv-hidden", phone_number_id: "num-2" },
      ],
      calls: [
        {
          id: "call-hidden",
          conversation_id: "conv-hidden",
          direction: "inbound",
          outcome: "answered",
          voicemail_transcript: "Restricted voicemail",
          started_at: "2026-07-02T14:00:00Z",
        },
      ],
    });
    expect(written[0].body).not.toContain("Restricted voicemail");
    expect(written[0].body).toMatch(/call .* not included/i);
    expect(result.partial).toBe(true);
  });

  it("HC-4: a call that never threaded is left out and counted too", async () => {
    // Not silently dropped: there is no thread to check it against, so there
    // is no way to know the requester may see it.
    const { written, result } = await run({
      ...BASE,
      conversations: [{ id: "conv-visible", phone_number_id: "num-1" }],
      calls: [
        {
          id: "call-orphan",
          conversation_id: null,
          direction: "inbound",
          outcome: "missed",
          voicemail_transcript: null,
          started_at: "2026-07-02T14:00:00Z",
        },
      ],
    });
    expect(written[0].body).toMatch(/call .* not included/i);
    expect(result.partial).toBe(true);
  });

  it("HC-5: says what a call was in words, not in a database value", async () => {
    // A document read by somebody outside this company should say what
    // happened the way they would say it.
    const { written } = await run({
      ...BASE,
      conversations: [{ id: "conv-visible", phone_number_id: "num-1" }],
      calls: [
        {
          id: "call-1",
          conversation_id: "conv-visible",
          direction: "inbound",
          outcome: "missed",
          voicemail_transcript: null,
          started_at: "2026-07-02T14:00:00Z",
        },
      ],
    });
    expect(written[0].body).toContain("Call — missed");
  });
});
