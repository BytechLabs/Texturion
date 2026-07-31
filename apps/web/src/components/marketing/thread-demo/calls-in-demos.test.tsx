/**
 * #491: the demos must show the product, and half the product is calling.
 *
 * Calling has shipped on every plan since D36 to D43, and every scripted
 * thread on the marketing site was made of texts, which is most of why the
 * site read as a texting tool. These guards are written to FAIL when that
 * regresses, and they are derived rather than listed, because #491's own
 * post-mortem found five guards that had pinned a literal and become the
 * thing blocking the correction:
 *
 * - The demo sentences are compared against the APP'S OWN `eventSentence`,
 *   not against strings copied out of it. Change the product's wording and
 *   these fail until the marketing copy follows.
 * - The "every thread depicts a call" check enumerates the script modules'
 *   exports, so a NEW script that forgets calls fails on arrival.
 * - The deep-dive caption count is derived from the script's own step
 *   numbers, so inserting a step without writing its caption fails.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ConversationEvent } from "@/lib/api/types";

// SystemLine pulls in the voicemail player, whose data hook chains to the
// env-validated API client. Mocked out so this stays a pure-sentence test
// (same treatment as thread/system-line.test.tsx).
vi.mock("@/components/calls/voicemail-player", () => ({
  VoicemailPlayer: () => null,
}));

// next/font/local needs the Next build plugin; in vitest we only need the
// stable variable/class contract (AppSurface mounts --font-golos).
vi.mock("next/font/local", () => ({
  default: () => ({ variable: "font-golos-mock", className: "font-golos-mock" }),
}));

import { eventSentence } from "@/components/thread/system-line";

import * as tradeScriptModule from "../trades/scripts";
import { TradeThread } from "../trades/trade-thread";
import type { TradeCallBeat, TradeScript } from "../trades/scripts";
import * as demoScriptModule from "./script";
import type { CallBeat, ThreadScript } from "./script";
import { StaticThread } from "./static-thread";
import { DEEP_DIVE_CAPTIONS } from "./thread-deep-dive-static";
import { callSentence, MISSED_CALL_TEXT_BACK_LINE } from "./thread-primitives";

/* -------------------------------------------------------------------------- */
/* Collect every script the site ships, from the modules themselves.           */
/* -------------------------------------------------------------------------- */

type AnyScript = ThreadScript | TradeScript;
type AnyCallBeat = CallBeat | TradeCallBeat;

function scriptsIn(mod: Record<string, unknown>): [string, AnyScript][] {
  return Object.entries(mod).filter(
    (entry): entry is [string, AnyScript] =>
      typeof entry[1] === "object" &&
      entry[1] !== null &&
      Array.isArray((entry[1] as { beats?: unknown }).beats),
  );
}

const DEMO_SCRIPTS = scriptsIn(demoScriptModule as Record<string, unknown>);
const TRADE_SCRIPTS = scriptsIn(tradeScriptModule as Record<string, unknown>);
const ALL_SCRIPTS = [...DEMO_SCRIPTS, ...TRADE_SCRIPTS];

function callsIn(script: AnyScript): AnyCallBeat[] {
  return script.beats.filter((b): b is AnyCallBeat => b.kind === "call");
}

/** The conversation event the product would have written for this beat. */
function eventFor(beat: AnyCallBeat): ConversationEvent {
  const payload: Record<string, unknown> = { direction: beat.direction };
  if (beat.voicemail) {
    payload.kind = "voicemail";
    payload.voicemail_seconds = beat.voicemail.seconds;
  } else {
    payload.outcome = beat.outcome;
    payload.forward_seconds = beat.seconds ?? 0;
  }
  return {
    id: `e-${beat.id}`,
    conversation_id: "c-1",
    actor_user_id: null,
    type: "call_completed" as ConversationEvent["type"],
    payload,
    created_at: "2026-07-31T15:00:00Z",
  };
}

/* -------------------------------------------------------------------------- */

describe("the demos speak the product's own call language", () => {
  it("every scripted call renders the sentence the app would print", () => {
    const seen: string[] = [];
    for (const [name, script] of ALL_SCRIPTS) {
      for (const beat of callsIn(script)) {
        const mine = callSentence(beat as CallBeat);
        const theirs = eventSentence(eventFor(beat), () => null);
        expect(mine, `${name}/${beat.id} drifted from the product`).toBe(
          theirs,
        );
        seen.push(mine);
      }
    }
    // Guard the guard: if the mapping above ever stops finding calls, the
    // loop passes vacuously. It must have actually compared something.
    expect(seen.length).toBeGreaterThanOrEqual(ALL_SCRIPTS.length);
  });

  it("the text-back line is the app's missed_call sentence, verbatim", () => {
    expect(MISSED_CALL_TEXT_BACK_LINE).toBe(
      eventSentence(
        {
          id: "e-1",
          conversation_id: "c-1",
          actor_user_id: null,
          type: "missed_call" as ConversationEvent["type"],
          payload: {},
          created_at: "2026-07-31T15:00:00Z",
        },
        () => null,
      ),
    );
  });
});

describe("every thread demo on the site shows calls, not just texts", () => {
  it("finds the scripts (the enumeration itself still works)", () => {
    expect(DEMO_SCRIPTS.length).toBeGreaterThanOrEqual(2);
    expect(TRADE_SCRIPTS.length).toBeGreaterThanOrEqual(6);
  });

  it.each(ALL_SCRIPTS)("%s depicts at least one call", (_name, script) => {
    expect(callsIn(script).length).toBeGreaterThanOrEqual(1);
  });

  it("the trade pages between them cover the whole calling surface", () => {
    const shapes = new Set(
      TRADE_SCRIPTS.flatMap(([, s]) =>
        callsIn(s).map((b) =>
          [b.direction, b.voicemail ? "voicemail" : b.outcome].join(":"),
        ),
      ),
    );
    // A reader who lands on two trade pages must learn two true things, not
    // the same one twice: the customer reaching us and us reaching them, each
    // both answered and not.
    expect(shapes).toContain("inbound:voicemail");
    expect(shapes).toContain("inbound:missed");
    expect(shapes).toContain("inbound:answered");
    expect(shapes).toContain("outbound:missed");
    expect(shapes).toContain("outbound:answered");
  });

  it("a voicemail always carries its words (#367), never a bare player", () => {
    for (const [name, script] of ALL_SCRIPTS) {
      for (const beat of callsIn(script)) {
        if (!beat.voicemail) continue;
        expect(
          beat.voicemail.transcript.trim(),
          `${name}/${beat.id} has a player with nothing to read`,
        ).not.toBe("");
        expect(beat.voicemail.seconds).toBeGreaterThan(0);
      }
    }
  });
});

describe("the home deep-dive walks the call, and its captions keep up", () => {
  const script = demoScriptModule.WATER_HEATER_SCRIPT;

  it("opens on the call, before any text", () => {
    const firstBeat = script.beats[0];
    expect(firstBeat.kind).toBe("call");
    expect(DEEP_DIVE_CAPTIONS[0].toLowerCase()).toContain("call");
  });

  it("has exactly one caption per numbered step (derived, not counted)", () => {
    const steps = script.beats
      .map((b) => b.step)
      .filter((s): s is number => typeof s === "number");
    expect(new Set(steps).size).toBe(DEEP_DIVE_CAPTIONS.length);
    expect(Math.max(...steps)).toBe(DEEP_DIVE_CAPTIONS.length);
  });

  it("marks the assignment beat instead of trusting a step number", () => {
    // The header's assignee used to appear at `step >= 3`, which pointed at
    // the wrong beat as soon as one was inserted ahead of it.
    const flagged = script.beats.filter(
      (b) => b.kind === "event" && b.revealsAssignee,
    );
    expect(flagged).toHaveLength(1);
    expect(script.assignee).toBeTruthy();
  });
});

describe("the call depiction obeys the demo laws", () => {
  it("adds no tab stops, even with a voicemail player on screen", () => {
    for (const [name, script] of TRADE_SCRIPTS) {
      const html = renderToStaticMarkup(
        <TradeThread script={script as TradeScript} />,
      );
      expect(html, `${name} added an interactive control`).not.toMatch(
        /<(button|input|textarea|select|a) /,
      );
    }
    const demo = renderToStaticMarkup(
      <StaticThread script={demoScriptModule.WATER_HEATER_SCRIPT} />,
    );
    expect(demo).not.toMatch(/<(button|input|textarea|select|a) /);
  });

  it("keeps marketing cobalt out of the product frame (Law 2)", () => {
    const demo = renderToStaticMarkup(
      <StaticThread script={demoScriptModule.WATER_HEATER_SCRIPT} />,
    );
    expect(demo).not.toContain("--fr-");
    expect(demo).not.toContain("2740DE");
  });

  it("writes no em- or en-dashes into any script string (Law 6)", () => {
    for (const [name, script] of ALL_SCRIPTS) {
      const text = JSON.stringify(script);
      expect(text, `${name} contains a dash`).not.toContain("—");
      expect(text, `${name} contains a dash`).not.toContain("–");
    }
  });
});
