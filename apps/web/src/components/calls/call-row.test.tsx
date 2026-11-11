/**
 * #566 — a call row that does not change shape because of somebody's name.
 *
 * The founder: *"Call entries in the call page have the 'scam likely' but it's
 * bad placement/size. It sometimes goes to next line, or breaks into multiple
 * lines etc depending on name of who answered."*
 *
 * Literally the name of who ANSWERED, not who called. `callOutcomeLabel` renders
 * "Answered by <display_name> · 4m 32s" and `display_name` is capped at 80
 * characters (apps/api/src/routes/me.ts), so the second line of a row could carry
 * ~100 characters with nothing constraining it. It wrapped to three lines, and the
 * "Spam likely" chip beside it — with no `shrink-0` — was squeezed past its own
 * minimum and broke into a two-line pill.
 *
 * ## What these tests pin, and why it is the classes
 *
 * The rule that prevents reflow IS the class list: exactly one child of the meta
 * line may yield, and it must be the outcome label. Rendered markup is the only
 * place that is observable without a browser — jsdom does no layout, so a test
 * that "renders a long name and checks the height" would measure nothing. So
 * these assert the mechanism, and the screenshots in the issue carry the pixels.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CallRow } from "./call-row";

import type { Call } from "@/lib/api/types";

const LONG_NAME = "Jonathan Fitzgerald-Vandenberghe Whitfield III Esq and Partners";

const base: Call = {
  id: "call-1",
  call_session_id: "sess-1",
  caller_e164: "+14165550133",
  caller_name: null,
  contact_id: null,
  contact_name: "Maria Alvarez",
  conversation_id: "conv-1",
  direction: "inbound",
  outcome: "answered",
  screening_result: null,
  started_at: "2026-08-08T18:00:00.000Z",
  ended_at: null,
  forward_seconds: 272,
  answered_by_user_id: "u-1",
  answered_by_name: LONG_NAME,
  voicemail_seconds: null,
  voicemail_transcript: null,
  voicemail_transcript_attempted_at: null,
  voicemail_intake: null,
  stir_attestation: null,
  unattended: false,
} as unknown as Call;

/** The meta line — the second line of the row, where all four things compete. */
function metaLine(html: string): string {
  const start = html.indexOf('class="mt-0.5 flex min-w-0 items-center gap-2"');
  expect(start, "the meta line's class list has changed — reread this file").not.toBe(-1);
  return html.slice(start, start + 1400);
}

// #691: the delete menu is its own surface (call-actions.test.tsx); these tests
// are about the row, so a member who cannot delete keeps the row as it was.
vi.mock("@/lib/api/trash", () => ({
  useDeleteCall: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteVoicemail: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/hooks/use-records-delete", () => ({
  useCanDeleteRecords: () => false,
  useDeletedToast: () => () => undefined,
}));
describe("#566 the meta line cannot be reflowed by a name", () => {
  it("lets the outcome label — and only it — yield", () => {
    // The label is the one element that can be long, so it is the one that
    // truncates. `min-w-0` is load-bearing: without it a flex item's automatic
    // minimum is its own min-content and `truncate` can never take effect.
    const html = renderToStaticMarkup(<CallRow call={base} />);
    const meta = metaLine(html);
    expect(meta).toContain("min-w-0 truncate");
    // Reachable after it ellipsizes.
    expect(meta).toContain(`title="Answered by ${LONG_NAME}`);
  });

  it("holds the screening chip at its own size", () => {
    // This is the defect the founder saw: squeezed past its minimum, "Spam
    // likely" broke at the space into a two-line rounded rect.
    const html = renderToStaticMarkup(
      <CallRow call={{ ...base, screening_result: "spam_likely" }} />,
    );
    const meta = metaLine(html);
    expect(meta).toContain("Spam likely");
    const chip = meta.slice(meta.indexOf("rounded-full bg-app-inset") - 120);
    expect(chip).toContain("shrink-0");
    expect(chip).toContain("whitespace-nowrap");
  });

  it("puts the caller's verdict before what the call did", () => {
    // A judgement about the CALLER, not about the outcome — so it reads first,
    // and its position never depends on the length of anything beside it.
    const html = renderToStaticMarkup(
      <CallRow call={{ ...base, screening_result: "spam_likely" }} />,
    );
    const meta = metaLine(html);
    expect(meta.indexOf("Spam likely")).toBeLessThan(meta.indexOf("Answered by"));
  });

  it("keeps a missed pill whole rather than letting it shrink", () => {
    // "Missed" is fixed and short; a pill that shrinks breaks its own text.
    const html = renderToStaticMarkup(
      <CallRow call={{ ...base, outcome: "missed", answered_by_name: null }} />,
    );
    const meta = metaLine(html);
    const pill = meta.slice(meta.indexOf("bg-warning/10") - 120);
    expect(pill).toContain("shrink-0");
    expect(pill).toContain("whitespace-nowrap");
  });
});

/** The opening tag that carries a given attribute, whatever order they print in. */
function tagWith(markup: string, attr: string): string {
  const at = markup.indexOf(attr);
  expect(at, `no element with ${attr}`).not.toBe(-1);
  return markup.slice(markup.lastIndexOf("<", at), markup.indexOf(">", at) + 1);
}

const html = (c: Call) => renderToStaticMarkup(<CallRow call={c} />);

describe("#734 a quiet row with one primary action", () => {
  it.each([
    ["answered", { outcome: "answered" }, "Message Maria Alvarez"],
    ["outbound", { direction: "outbound", outcome: "answered" }, "Message Maria Alvarez"],
    ["an outbound no-answer", { direction: "outbound", outcome: "missed" }, "Message Maria Alvarez"],
    ["missed", { outcome: "missed" }, "Call back Maria Alvarez"],
    ["voicemail", { outcome: "voicemail" }, "Call back Maria Alvarez"],
  ])("a %s call gets exactly its one primary action", (_l, patch, name) => {
    const out = html({ ...base, ...patch } as Call);
    expect(out).toContain(`aria-label="${name}"`);
    // The other primary is not drawn, and no labelled secondary buttons are.
    const other = name.startsWith("Message") ? "Call back " : "Message ";
    expect(out).not.toContain(`aria-label="${other}`);
    for (const word of [">Task<", ">Details<", ">Contact<", ">Add contact<"]) {
      expect(out).not.toContain(word);
    }
  });

  it("the primary action is a full-size touch target", () => {
    expect(tagWith(html(base), 'aria-label="Message Maria Alvarez"')).toContain("tap-target");
  });

  it("Message opens the call's conversation; with none it texts the number", () => {
    expect(html(base)).toContain('href="/inbox/conv-1"');
    const bare = html({ ...base, conversation_id: null, contact_id: null });
    expect(bare).toContain('href="/inbox/new?to=%2B14165550133"');
  });

  it("tapping the row opens the call's details, not the conversation", () => {
    const out = html(base);
    // The one stretched link is the details page.
    expect(tagWith(out, 'href="/calls/sess-1"')).toContain("after:inset-0");
    expect(tagWith(out, 'href="/inbox/conv-1"')).not.toContain("after:inset-0");
  });

  it("a caller we cannot reach gets no primary action", () => {
    const out = html({ ...base, conversation_id: null, contact_id: null, caller_e164: null });
    expect(out).not.toContain('aria-label="Message');
    expect(out).not.toContain('aria-label="Call back');
  });
});
