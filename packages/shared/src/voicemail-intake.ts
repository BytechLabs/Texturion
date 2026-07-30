/**
 * #367 depth (1) — how the three clients render what the caller said.
 *
 * The API stores four nullable fields; every client has to turn those into the
 * same short, ordered, gap-free list. That is three chances to invent different
 * words for the same thing, which is exactly the failure #437 found sixteen
 * times over — so the order, the labels and the skip-the-empties rule live here
 * once. Web imports this module; Android and iOS hand-port it, and their tests
 * assert the same cases this one does.
 *
 * WHY A LIST AND NOT A SENTENCE. A summary paragraph reads well and scans
 * badly, and the whole point is that somebody on a roof can glance at this and
 * know whether to call back. Labelled rows also keep every value attributable:
 * "12 Mill Road" under "Address" is the caller's words in a named slot, where a
 * generated sentence would blur what was said into what we inferred.
 */

/** The stored object, mirroring `calls.voicemail_intake`. */
export interface VoicemailIntake {
  problem: string | null;
  address: string | null;
  callback: string | null;
  name: string | null;
}

/** One rendered row. */
export interface VoicemailIntakeLine {
  /** Stable key, so a client can style a row without matching on copy. */
  key: "problem" | "address" | "callback" | "name";
  label: string;
  value: string;
}

/**
 * The provenance label, per PORTAL-UX §3.1: every card names the signal that
 * placed it. Shown beside the Lou mark, which already says a machine did this —
 * so these words say WHERE it came from, which is the part a person can check.
 * The transcript is right underneath, which is what makes it checkable.
 */
export const VOICEMAIL_INTAKE_SOURCE_LABEL = "From the voicemail";

/**
 * Field order and labels. Ordered by what a tradesperson needs first: whether
 * to go, then where, then how to reach them.
 *
 * "Address" rather than "Where" because the product already says Address on the
 * task panel, and one product should have one word for one thing.
 */
const FIELDS: readonly {
  key: VoicemailIntakeLine["key"];
  label: string;
}[] = [
  { key: "problem", label: "Problem" },
  { key: "address", label: "Address" },
  { key: "callback", label: "Call back" },
  { key: "name", label: "Name" },
];

/**
 * The rows worth drawing: present fields, in order, empties dropped entirely.
 *
 * Dropping rather than blanking is the load-bearing part. A labelled empty row
 * reports an absence as a finding — "Address:" with nothing after it reads as
 * though we looked and the caller had none, when in fact most voicemails simply
 * do not contain most of these. An empty result returns an empty array, and a
 * client renders nothing at all rather than an empty titled box.
 */
export function voicemailIntakeLines(
  intake: VoicemailIntake | null | undefined,
): VoicemailIntakeLine[] {
  if (!intake) return [];
  const lines: VoicemailIntakeLine[] = [];
  for (const field of FIELDS) {
    const value = intake[field.key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed === "") continue;
    lines.push({ key: field.key, label: field.label, value: trimmed });
  }
  return lines;
}

/** Whether there is anything to draw at all. */
export function hasVoicemailIntake(
  intake: VoicemailIntake | null | undefined,
): boolean {
  return voicemailIntakeLines(intake).length > 0;
}
