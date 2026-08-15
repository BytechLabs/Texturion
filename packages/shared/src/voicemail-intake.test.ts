/**
 * #367 — the cases Android and iOS hand-port alongside this.
 *
 * The rule with any consequence is that an absent field disappears rather than
 * printing an empty labelled row: a blank "Address:" reads as "we looked and
 * there was none", when most voicemails simply do not contain most of these.
 */
import { describe, expect, it } from "vitest";

import {
  hasVoicemailIntake,
  voicemailIntakeLines,
  VOICEMAIL_INTAKE_SOURCE_LABEL,
} from "./voicemail-intake";

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

/** #228 — the module names a key now, so the test resolves it. */
function look(table: unknown, key: string): string {
  const [section, name] = key.split(".");
  const value = (table as Record<string, Record<string, string>>)[section]?.[name];
  if (typeof value !== "string") throw new Error(`no entry for ${key}`);
  return value;
}

const empty = { problem: null, address: null, callback: null, name: null };

describe("voicemailIntakeLines", () => {
  it("draws nothing for nothing", () => {
    expect(voicemailIntakeLines(null)).toEqual([]);
    expect(voicemailIntakeLines(undefined)).toEqual([]);
    expect(voicemailIntakeLines(empty)).toEqual([]);
    expect(hasVoicemailIntake(empty)).toBe(false);
  });

  it("keeps the field order regardless of the object's", () => {
    // What a tradesperson needs first: whether to go, then where, then how to
    // reach them.
    const lines = voicemailIntakeLines({
      name: "Dave",
      callback: "555-0142",
      address: "12 Mill Road",
      problem: "water heater leaking",
    });
    expect(lines.map((line) => line.key)).toEqual([
      "problem",
      "address",
      "callback",
      "name",
    ]);
  });

  it("drops the fields the caller did not give, rather than blanking them", () => {
    const lines = voicemailIntakeLines({
      ...empty,
      problem: "no hot water",
    });
    expect(lines).toEqual([
      { key: "problem", label: "Problem", value: "no hot water" },
    ]);
    expect(hasVoicemailIntake({ ...empty, problem: "no hot water" })).toBe(true);
  });

  it("treats a whitespace-only value as absent", () => {
    expect(voicemailIntakeLines({ ...empty, address: "   " })).toEqual([]);
  });

  it("trims what it draws", () => {
    const [line] = voicemailIntakeLines({ ...empty, name: "  Dave  " });
    expect(line.value).toBe("Dave");
  });

  it("survives a field that is not a string", () => {
    // The column is jsonb and the row could predate any shape we assume. A
    // client crashing on a stored value is worse than a missing line.
    const lines = voicemailIntakeLines({
      ...empty,
      problem: 42 as unknown as string,
      address: "12 Mill Road",
    });
    expect(lines.map((line) => line.key)).toEqual(["address"]);
  });

  it("names the signal rather than the machine", () => {
    // PORTAL-UX §3.1: the mark already says Lou did it; the label says where it
    // came from, which is the half a person can check against the transcript
    // sitting underneath.
    expect(look(WEB_EN, VOICEMAIL_INTAKE_SOURCE_LABEL)).toBe("From the voicemail");
    // "Tiré du message vocal" — where it came FROM, not what made it. A
    // French label naming the machine would undo the same distinction.
    expect(look(WEB_FR, VOICEMAIL_INTAKE_SOURCE_LABEL)).toBe("Tiré du message vocal");
    expect(look(WEB_FR, VOICEMAIL_INTAKE_SOURCE_LABEL).toLowerCase()).not.toContain("lou");
  });
});
