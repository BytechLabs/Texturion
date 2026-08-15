/**
 * #225 — no automated text may land outside the recipient's legal send window.
 *
 * The exposure is real and it is currently BOUNDED BY A DECISION rather than by
 * a gate, which is a fragile thing to leave undocumented. Today every
 * customer-bound SMS is one of exactly two shapes:
 *
 *   HUMAN, INITIATING CONTACT — `routes/compose.ts`. Gated: a destination in
 *   its quiet window returns 409 `quiet_hours_confirmation_required`, and the
 *   person may confirm and send. #225 ask 2 is explicit that a human must be
 *   warned and never blocked, and that is what this is.
 *
 *   REPLY-EXEMPT — `messaging/auto-send.ts`, `messaging/missed-call.ts`,
 *   `routes/messages.ts`. D4's basis, stated in auto-send's own header: these
 *   fire INTO a thread the customer just started, seconds after they started
 *   it. A reply to a consumer-initiated contact is not the solicitation the
 *   quiet-hours rules are about, and SPEC §5 scopes the gate to NEW outbound
 *   conversations for exactly that reason.
 *
 * So #225's headline cases resolve differently than the issue assumes: the
 * away reply and the missed-call textback ARE reply-exempt, and "task due
 * notices go out on server time" is true but they are PUSH to the crew's own
 * phones, not texts to a customer — `tasks/due-notice.ts` and
 * `notifications/lead-chase.ts` never reach `dispatchOutbound` at all.
 *
 * WHAT IS ACTUALLY AT RISK IS THE NEXT ONE. #237 (appointment reminders) and
 * #313 (ask how the job went) are both queued, and both are automated sends
 * that are NOT replies — a text we originate on our clock, to a customer who
 * did not just contact us. That is the first one with real exposure, and
 * nothing today would make its author stop and decide.
 *
 * This is that stop. Every call site that puts a message on the wire must be
 * classified here, and a new one fails CI until somebody says which shape it
 * is. The per-state window table, hold-and-release and the company setting
 * (#225 asks 3, 4, 5) are the work that classification would then demand — but
 * they are unbuildable until there is a send that needs them, and building
 * them now would be a mechanism guarding nothing.
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { productionSources as readProductionSources } from "../test/source-tree";

const API_SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/**
 * Every place a customer-bound message reaches the carrier, and why it is
 * allowed to do so at 2am — or why it cannot.
 */
const SEND_SITES: Record<string, { shape: string; why: string }> = {
  "routes/compose.ts": {
    shape: "human-initiating",
    why:
      "a person starting a NEW conversation. Gated: 409 " +
      "quiet_hours_confirmation_required, confirmable — warned, never blocked",
  },
  "messaging/send-text.ts": {
    shape: "reply-exempt",
    why:
      "#243 — the ONE outbound text sequence, extracted so the public API " +
      "could send without a second copy of the gate order. It is a MECHANISM " +
      "rather than a site: it has no shape of its own and inherits its " +
      "caller's. " +
      "Classified reply-exempt because both callers are, on the same ground " +
      "and by the same structural fact — routes/messages.ts and " +
      "routes/public-api.ts each take a conversation id and CANNOT start a " +
      "conversation, so neither is ever the new outbound solicitation SPEC §5 " +
      "scopes the gate to. " +
      "The line to watch: this classification is only true while that stays " +
      "true. A caller that can ORIGINATE a conversation through this function " +
      "is a human-initiating send wearing a reply-exempt label, and it needs " +
      "compose's 409 rather than this entry. Adding one means re-deciding " +
      "here, not inheriting",
  },
  "routes/messages.ts": {
    shape: "reply-exempt",
    why:
      "a person replying inside a thread the customer already started. SPEC §5 " +
      "scopes the gate to NEW outbound conversations; a reply is not the " +
      "solicitation the rule is about, and #225 concedes a trade owner texting " +
      "their own customer back at 9:15pm is their call",
  },
  "messaging/scheduled-send.ts": {
    shape: "human-scheduled",
    why:
      "#233 send later. A person wrote it and chose the instant, so it is " +
      "human-initiating — but the confirmation cannot happen where the other " +
      "human-initiating send's does. At 8am on Monday there is nobody to " +
      "answer a prompt, and holding the message because of a window the " +
      "sender already thought about would be the silent disappearance " +
      "docs/DECISIONS.md rules out. So the 409 runs in " +
      "routes/scheduled-messages.ts at SCHEDULE time, evaluated against " +
      "`send_at` rather than now — resolveDestinationClock takes the instant " +
      "for exactly this reason ('callers pass the FIRE instant, never the " +
      "queue one'). Editing the time re-asks, so moving a send from 8am to " +
      "11pm meets the same gate rather than going around it. " +
      "This is why send later is the ESCAPE HATCH #225 needs rather than a " +
      "hole in it: a tech blocked at 9:40pm schedules for 8am and meets no " +
      "gate at all, because 8am is not a quiet hour",
  },
  "routes/payments.ts": {
    shape: "reply-exempt",
    why:
      "#224 text-to-pay. The same shape as routes/messages.ts, and it inherits " +
      "that classification rather than arguing a new one: this route CANNOT " +
      "start a conversation — it takes a conversation id and refuses anything " +
      "else — so it is never the new outbound solicitation SPEC §5 scopes the " +
      "gate to. A person taps a button, in a thread the customer began, to ask " +
      "for money for work under discussion in it. " +
      "Worth saying out loud, because a bill is not a reply and the exemption " +
      "should not be read as one: what makes it defensible is the same " +
      "concession #225 makes about a trade owner texting their own customer " +
      "back at 9:15pm. If payment requests ever gain a way to originate a " +
      "thread, that path is human-initiating and needs compose.ts's 409",
  },
  "messaging/missed-call.ts": {
    shape: "reply-exempt",
    why:
      "missed-call text-back: the customer CALLED us seconds ago. Contact was " +
      "consumer-initiated and this is the answer to it",
  },
  "messaging/retry-interrupted.ts": {
    shape: "inherits-the-original",
    why:
      "#411: this sends NOTHING new. It completes a send a person already " +
      "composed and already authorised, which crashed between the gate insert " +
      "and the Telnyx call — so whatever quiet-hours shape the original had, " +
      "this carries. A reply stays a reply; a human-initiating send stays one, " +
      "and its 409 confirmation was already answered before the row existed. " +
      "The bound is what keeps that honest: ONE attempt, inside about twenty " +
      "minutes of the original, so a retry cannot drift into a different day " +
      "or a different window than the one the sender was looking at",
  },
  "messaging/auto-send.ts": {
    shape: "reply-exempt",
    why:
      "the shared auto-send guard (away reply, emergency ack). D4, stated in " +
      "its own header: every send routed here fires into a thread the customer " +
      "just started, so it is reply-exempt",
  },
};

function productionSources(): string[] {
  const found: string[] = [];
  /**
   * #492: delegated to the one shared reader — `withFileTypes` instead of a
   * `statSync` per entry, memoised, one definition of "a production source
   * file" instead of ten, and an IO failure that says it is one rather than
   * surfacing as whatever this suite asserts about.
   */
  found.push(...readProductionSources(API_SRC));
  return found;
}

const repoPath = (file: string) => relative(API_SRC, file).replaceAll("\\", "/");

/** Files that actually CALL dispatchOutbound, not merely mention it. */
function sendSites(): string[] {
  return productionSources()
    .filter((file) => {
      const source = readFileSync(file, "utf8");
      // The definition itself, and the test-support helper, are not send sites.
      if (repoPath(file) === "messaging/send.ts") return false;
      if (repoPath(file).startsWith("test/")) return false;
      return /\bdispatchOutbound\s*\(/.test(source);
    })
    .map(repoPath);
}

describe("#225 — every customer-bound send is classified for quiet hours", () => {
  it("has no send site that nobody has decided about", () => {
    // The one that matters is the send that does not exist yet. #237's
    // appointment reminders and #313's post-job survey are texts we ORIGINATE,
    // on our clock, to somebody who did not just contact us — the first real
    // quiet-hours exposure this product will have. Failing here is how their
    // author is made to decide rather than inherit an exemption written for a
    // different shape of message.
    const undeclared = sendSites().filter((file) => !(file in SEND_SITES));
    expect(
      undeclared,
      `\n\nNew customer-bound send path(s): ${undeclared.join(", ")}\n` +
        `Classify each in SEND_SITES:\n` +
        `  • human-initiating → gate it like routes/compose.ts (409, confirmable)\n` +
        `  • reply-exempt     → say WHY it is a reply to contact the customer began\n` +
        `If it is neither — an automated send we originate — #225 asks 3/4/5 are\n` +
        `now due: per-state windows, hold-and-release, and the company setting.\n`,
    ).toEqual([]);
  });

  it("keeps the classification free of sites that no longer send", () => {
    // A stale entry is a slot a genuinely new send path can occupy silently.
    const live = new Set(sendSites());
    const stale = Object.keys(SEND_SITES).filter((file) => !live.has(file));
    expect(stale, `classified but no longer sends: ${stale.join(", ")}`).toEqual([]);
  });

  it("gates the one path that initiates contact", () => {
    // The classification is a claim about the code; this checks the claim.
    // compose is the only human-initiating site, and it must consult the ONE
    // resolver — a second implementation of "is it quiet there" is how the
    // paths drift apart (D49).
    const compose = readFileSync(join(API_SRC, "routes/compose.ts"), "utf8");
    expect(compose).toContain("resolveDestinationClock");
    expect(compose).toContain("quiet_hours_confirmation_required");
  });

  it("leaves the crew's own notices out of this entirely", () => {
    // #225 lists "task due notices go out on server time" as an exposure. They
    // do — and they are PUSH to the crew's phones, not texts to a customer, so
    // no quiet-hours rule reaches them. Asserting it keeps a future refactor
    // from turning a push into a text without noticing it crossed the line.
    for (const file of ["tasks/due-notice.ts", "notifications/lead-chase.ts"]) {
      const source = readFileSync(join(API_SRC, file), "utf8");
      expect(
        /\bdispatchOutbound\s*\(/.test(source),
        `${file} now sends a customer text — it used to be crew push only, and ` +
          `crossing that line makes it a #225 send site`,
      ).toBe(false);
    }
  });
});
