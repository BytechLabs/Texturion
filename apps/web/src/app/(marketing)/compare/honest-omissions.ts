/**
 * #334 — what Loonext deliberately does not do, and the decision each refusal
 * rests on.
 *
 * # Why this is data rather than three objects inline on the page
 *
 * The posture is a real commercial asset: conceding where a competitor genuinely
 * wins is why `/compare` reads as credible. It is also a hostage to scope
 * decisions made elsewhere, and #334 names the asymmetry that makes it worth
 * managing — a page that UNDERSTATES us loses a deal quietly and nobody finds
 * out; a page that OVERSTATES us produces a refund request and a bad story.
 *
 * The drift is not hypothetical. `docs/marketing/COPY.md` still described an
 * $8/mo voice add-on that forwards calls to a phone you answer, months after
 * calls shipped as a browser softphone included on every plan. The live page had
 * been corrected by somebody noticing; the copy source had not.
 *
 * # The `decision` field is not shown to anybody
 *
 * "(D32)" on a marketing page is internal shorthand and would be terrible copy.
 * The citation exists so a decision change has a discoverable list of pages to
 * update — the marketing instance of what #323 asks for generally — and
 * `honest-omissions.test.ts` fails when a claim cites a decision the
 * "Do not build" table does not carry.
 *
 * That is the whole mechanism, and it is deliberately attached to an event that
 * already happens (recording a scope decision) rather than being a standing
 * review nobody owns. #334's devil's advocate is explicit that process for a
 * solo operator decays.
 */

export interface HonestOmission {
  title: string;
  body: string;
  /**
   * The decision this refusal rests on, as it appears in `docs/DECISIONS.md`.
   * Never rendered. A claim with no decision behind it is an opinion, and the
   * day somebody overrules it this page becomes wrong in the expensive
   * direction.
   */
  decision: string;
  /**
   * The phrase in the "Do not build" table this claim corresponds to, lowercased.
   * The guard matches on it, so a refusal dropped from that table surfaces the
   * page still claiming it.
   */
  refusal: string;
}

export const HONEST_OMISSIONS: HonestOmission[] = [
  {
    title: "No mass text blasts.",
    body:
      "Loonext is for conversations with your customers, not campaigns at them. " +
      "If you need list broadcasts, Heymarket and the marketing-texting tools do that.",
    decision: "D4",
    refusal: "mass texting",
  },
  {
    title: "No review management.",
    body:
      "We don't chase Google reviews. That's Podium's home turf, and if reviews " +
      "are load-bearing for you, it's the better buy.",
    decision: "D32",
    refusal: "review requests",
  },
  {
    title: "No full dialer.",
    body:
      "Loonext answers calls as well as texts, on every plan: they ring your whole " +
      "crew right in the app, unanswered ones take a voicemail we write down, you " +
      "call customers back on your business number, and the ones you miss get an " +
      "automatic text back. What it is not is a call center, so a business that " +
      "lives on phone menus, queues and all-day inbound volume belongs on Quo.",
    // D36-D43 shipped calling as a shared line. What is still refused is the PBX
    // half, which is why this body concedes the positioning while stating
    // plainly what IS included — the shape #334 asks corrections to preserve.
    decision: "D36",
    refusal: "an ivr",
  },
];
