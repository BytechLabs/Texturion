/**
 * #304 — the bookkeeper's document.
 *
 * UE-4 and UE-5 are the pair that carry this feature. Everything else here is
 * arithmetic; those two are the reason the document can be handed to somebody
 * who reconciles for a living.
 *
 * The issue asked for an export "that reconciles to the Stripe invoice". It
 * cannot: no Stripe invoice line is persisted anywhere in this product, and no
 * plan history is either. A document that implied otherwise would be worse
 * than none, because a bookkeeper ties out to it and then acts on the result.
 * So the document reports counts, states what it is not, and names the gap
 * that most often explains a disagreement — segments we have metered and not
 * yet told Stripe about.
 */
import { describe, expect, it, vi } from "vitest";

import {
  buildUsageExport,
  NOT_ON_THIS_DOCUMENT,
  renderUsageDocument,
  usageLines,
} from "./usage-export";
import { endpoint, makeHarness } from "../test/billing-support";
import { completeEnv, exportPartText, stubFetch } from "../test/support";
import { getDb } from "../db";

const COMPANY_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const NOW = new Date("2026-07-02T09:00:00.000Z");

const WINDOW_ROW = {
  outbound_segments: 620,
  inbound_segments: 200,
  forward_seconds: 3660,
  reported_segments: 500,
  unreported_segments: 120,
};

const STORAGE_ROW = {
  attachments_bytes: 1000,
  mms_bytes: 500,
  total_bytes: 1500,
};

function harness(window = WINDOW_ROW) {
  return makeHarness([
    endpoint("POST", /\/rpc\/api_usage_window/, () => [window]),
    endpoint("POST", /\/rpc\/api_storage_usage/, () => STORAGE_ROW),
  ]);
}

/** Run a build, capturing what would have been written to the bucket. */
async function build(filters: { from?: string; to?: string }, window = WINDOW_ROW) {
  const h = harness(window);
  stubFetch(h.route);
  const written = new Map<string, string>();
  // #587: the same bytes, undecoded, so the byte-order mark can be asserted.
  const writtenRaw = new Map<string, string | Uint8Array>();
  const result = await buildUsageExport(
    getDb(completeEnv()),
    { exportId: "e1", companyId: COMPANY_ID, filters, prefix: "c/e1", now: NOW },
    async (path, body) => {
      written.set(path, exportPartText(body));
      writtenRaw.set(path, body);
    },
  );
  return { result, written, writtenRaw, harness: h };
}

describe("#304 the usage export", () => {
  it("UE-1: writes a document and a spreadsheet", async () => {
    // Two files for two readers: the HTML is what somebody reads, the CSV is
    // what somebody pastes into their own workings.
    const { written } = await build({ from: "2026-06-01T00:00:00.000Z" });
    expect([...written.keys()].sort()).toEqual(["c/e1/usage.csv", "c/e1/usage.html"]);
  });

  it("UE-2: asks for exactly the window it was given", async () => {
    const { harness: h } = await build({
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-06-30T23:59:59.999Z",
    });
    const sent = h.callsTo("POST", /\/rpc\/api_usage_window/)[0];
    expect(sent.json()).toEqual({
      p_company_id: COMPANY_ID,
      p_from: "2026-06-01T00:00:00.000Z",
      p_to: "2026-06-30T23:59:59.999Z",
    });
  });

  it("UE-3: refuses a period with no start", async () => {
    // "Since the beginning of time" is a different document, and one nobody
    // asked for. Silently defaulting to it would hand a bookkeeper every
    // segment the workspace has ever sent under their month's heading.
    await expect(build({ to: "2026-06-30T23:59:59.999Z" })).rejects.toThrow(
      /period start/,
    );
  });

  it("UE-4: names the segments Stripe has not been told about", async () => {
    // The one thing this document knows that neither the product nor the
    // invoice will tell anybody. 120 of 620 metered segments are on no invoice
    // yet, and that gap is the usual explanation for a total that disagrees.
    const { written } = await build({ from: "2026-06-01T00:00:00.000Z" });
    const html = written.get("c/e1/usage.html")!;

    expect(html).toContain("not yet reported");
    expect(html).toContain("120");
    expect(html).toMatch(/on no invoice yet/i);
  });

  it("UE-5: says plainly that it is not the invoice, and prices nothing", async () => {
    // No plan history exists, so a closed period cannot be priced with today's
    // rates without inventing a number that looks authoritative. The document
    // has to say so, and it has to list what Stripe's invoice carries that it
    // does not — a reader comparing two totals looks for their own mistake
    // first, and these are the legitimate differences.
    const { written } = await build({ from: "2026-06-01T00:00:00.000Z" });
    const html = written.get("c/e1/usage.html")!;

    expect(html).toMatch(/not a copy of the Stripe\s+invoice/);
    expect(html).toContain("What is not on this document");
    for (const item of NOT_ON_THIS_DOCUMENT) {
      // Every named difference actually reaches the page. A list that existed
      // only in the module would read as thoroughness and deliver nothing.
      expect(html).toContain(item.slice(0, 30));
    }
    // Nothing priced: no currency anywhere in the document.
    expect(html).not.toMatch(/\$\d|\d+\s*(?:cents|¢)/);
  });

  it("UE-6: labels received texts as never billed", async () => {
    // Inbound volume beside outbound invites the reading that both are
    // charged. It is on the page because the volume is useful, and it says so.
    const lines = usageLines({
      outboundSegments: 1,
      reportedSegments: 1,
      unreportedSegments: 0,
      inboundSegments: 200,
      voiceSeconds: 0,
      storageBytes: 0,
    });
    const inbound = lines.find((l) => l.label === "Text segments received")!;
    expect(inbound.note).toMatch(/never billed/i);
  });

  it("UE-7: labels storage as a running total, not the window's", async () => {
    // api_storage_usage is point-in-time. Sitting in a table headed by a date
    // range, an unlabelled stock reads as a flow — and it would be the one
    // figure on the page that cannot be checked against anything.
    const { written } = await build({
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-06-30T23:59:59.999Z",
    });
    const html = written.get("c/e1/usage.html")!;
    expect(html).toContain("as of now");
    expect(html).toMatch(/not a figure for this window/);
  });

  it("UE-8: a running period says so rather than inventing an end", async () => {
    const { written } = await build({ from: "2026-06-01T00:00:00.000Z" });
    expect(written.get("c/e1/usage.html")!).toContain("has not finished yet");
  });

  it("UE-9: the receipt records that the figures are not final", async () => {
    // `partial` on the export row answers "was this whole?" without reopening
    // the file. Unreported segments mean the invoice they land on is unwritten.
    const withGap = await build({ from: "2026-06-01T00:00:00.000Z" });
    expect(withGap.result).toEqual({ segments: 620, partial: true });

    const settled = await build({ from: "2026-06-01T00:00:00.000Z" }, {
      ...WINDOW_ROW,
      reported_segments: 620,
      unreported_segments: 0,
    });
    expect(settled.result).toEqual({ segments: 620, partial: false });
  });

  it("UE-10: the CSV carries the caveat beside every figure", async () => {
    // A spreadsheet of bare numbers is the artifact most likely to be pasted
    // into somebody's workings and lose its context on the way.
    const { written } = await build({ from: "2026-06-01T00:00:00.000Z" });
    const csv = written.get("c/e1/usage.csv")!;
    const [header] = csv.split("\n");
    expect(header).toContain("what it does not mean");
    expect(csv).toMatch(/never billed/i);
  });

  it("UE-11: minutes are whole, and rounded down", async () => {
    // 3661s is 61 minutes and a second. The extra second is deliberate: a
    // fixture on an exact minute boundary makes floor and ceil agree, so the
    // assertion passes either way and proves nothing. (It was written that way
    // first, and the break sweep caught it.)
    //
    // Down, not up, because the meter bills to the second — rounding a partial
    // minute up would overstate what the workspace used.
    const lines = usageLines({
      outboundSegments: 0,
      reportedSegments: 0,
      unreportedSegments: 0,
      inboundSegments: 0,
      voiceSeconds: 3661,
      storageBytes: 0,
    });
    expect(lines.find((l) => l.label === "Call minutes")!.value).toBe("61");
  });

  it("UE-12: a settled window does not claim a gap it does not have", async () => {
    // The mirror of UE-4. Copy that always warns is copy nobody reads.
    const html = renderUsageDocument({
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-06-30T23:59:59.999Z",
      lines: usageLines({
        outboundSegments: 10,
        reportedSegments: 10,
        unreportedSegments: 0,
        inboundSegments: 0,
        voiceSeconds: 0,
        storageBytes: 0,
      }),
      generatedAt: NOW.toISOString(),
    });
    expect(html).toContain("Everything in this window has been reported");
    expect(html).not.toMatch(/on no invoice yet/i);
  });

  it("UE-13: a storage read failure fails loudly", async () => {
    // Silently reporting zero stored bytes would be a figure somebody could
    // act on. The export row goes to failed and the requester is told.
    const h = makeHarness([
      endpoint("POST", /\/rpc\/api_usage_window/, () => [WINDOW_ROW]),
      endpoint(
        "POST",
        /\/rpc\/api_storage_usage/,
        () => new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
      ),
    ]);
    stubFetch(h.route);
    await expect(
      buildUsageExport(
        getDb(completeEnv()),
        {
          exportId: "e1",
          companyId: COMPANY_ID,
          filters: { from: "2026-06-01T00:00:00.000Z" },
          prefix: "c/e1",
          now: NOW,
        },
        vi.fn(),
      ),
    ).rejects.toThrow(/storage read failed/);
  });
});
