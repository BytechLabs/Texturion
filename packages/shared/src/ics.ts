/**
 * #245 — RFC 5545 serialisation, which is fussier than it looks.
 *
 * A calendar feed is parsed by software nobody controls — Google, Apple,
 * Outlook, Thunderbird, whatever the bookkeeper's spouse uses — and each of
 * them is stricter than the last about a different thing. The failure mode is
 * not an error message: it is a subscription that silently shows nothing, or
 * worse, shows half the week.
 *
 * So the three rules that actually bite are implemented here rather than at the
 * call site, and each has a test.
 */

/** The one line ending the format allows. A bare \n is the commonest defect. */
const CRLF = "\r\n";

/**
 * Escape a text value (§3.3.11).
 *
 * The order matters: backslash first, or the escapes we add get escaped again.
 * Commas and semicolons are structural in this format — a job titled
 * "Replace heater, check pressure" splits into two values without this, and the
 * calendar shows a truncated title with no hint that anything was lost.
 */
export function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Fold a content line to 75 octets (§3.1).
 *
 * OCTETS, not characters, which is the part that is usually wrong. A job
 * address in Montréal or a customer named Müller pushes a line past the limit
 * sooner than its length suggests, and folding mid-codepoint produces bytes no
 * parser can decode — so this measures the UTF-8 encoding and never splits
 * inside a character.
 *
 * Continuation lines begin with one space, which the parser strips.
 */
export function icsFold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const out: string[] = [];
  let current = "";
  let currentBytes = 0;
  // The first line takes 75; continuations take 74, because the leading space
  // counts toward the octet budget.
  let budget = 75;

  for (const char of line) {
    const size = encoder.encode(char).length;
    if (currentBytes + size > budget) {
      out.push(current);
      current = "";
      currentBytes = 0;
      budget = 74;
    }
    current += char;
    currentBytes += size;
  }
  if (current.length > 0) out.push(current);

  return out.join(`${CRLF} `);
}

/** UTC, basic format, no punctuation — the only form every parser accepts. */
export function icsDate(value: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return (
    `${value.getUTCFullYear()}${pad(value.getUTCMonth() + 1)}${pad(value.getUTCDate())}` +
    `T${pad(value.getUTCHours())}${pad(value.getUTCMinutes())}${pad(value.getUTCSeconds())}Z`
  );
}

export interface IcsEvent {
  /**
   * Stable across every fetch for the same job, and unique across the internet.
   *
   * This is what makes a feed an UPDATE rather than a pile of duplicates: a
   * calendar matches on UID, so a job whose time moved must keep its id or the
   * subscriber ends up with both the old slot and the new one and no way to
   * tell which is real.
   */
  uid: string;
  start: Date;
  end: Date;
  /** When this version was written, so a client knows which of two is newer. */
  stamp: Date;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
}

export interface IcsCalendar {
  /** Shown as the calendar's name in most clients. */
  name: string;
  events: IcsEvent[];
}

/**
 * The whole document.
 *
 * `X-WR-CALNAME` is not in the RFC and is honoured by every major client
 * anyway; without it a subscription shows up called "Untitled", which is the
 * difference between a feature somebody keeps and one they delete.
 *
 * `PUBLISH` rather than `REQUEST`: this is a read-only feed, and `REQUEST` asks
 * the recipient to RSVP to work they are already assigned.
 */
export function buildIcs(calendar: IcsCalendar): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Loonext//Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(calendar.name)}`,
  ];

  for (const event of calendar.events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uid}`,
      `DTSTAMP:${icsDate(event.stamp)}`,
      `DTSTART:${icsDate(event.start)}`,
      `DTEND:${icsDate(event.end)}`,
      `SUMMARY:${icsEscape(event.summary)}`,
    );
    if (event.description) {
      lines.push(`DESCRIPTION:${icsEscape(event.description)}`);
    }
    if (event.location) lines.push(`LOCATION:${icsEscape(event.location)}`);
    if (event.url) lines.push(`URL:${event.url}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  // Folded last, so escaping cannot push a line past the limit after the fact.
  return lines.map(icsFold).join(CRLF) + CRLF;
}
