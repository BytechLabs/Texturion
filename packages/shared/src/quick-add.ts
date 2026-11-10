/**
 * #689 A: the quick-add line.
 *
 *   "Fix furnace @rehman tomorrow 9am #urgent"
 *
 * becomes a title, one person, a due time, a priority and labels. Nothing here
 * saves anything: it returns what it understood, and each client shows that as
 * a preview the member confirms.
 *
 * ## The rules, in the order they bind
 *
 * The line is split on spaces and read one word at a time. A word is either
 * taken (and removed from the title) or left alone, and a word the parser is not
 * sure of is always left alone, so a half-understood line still reads as the
 * member typed it.
 *
 *   @me / @name   the one teammate whose name (or first name) starts with it.
 *                 Two matches, or none, leave the word in the title.
 *   #urgent #high #low #normal   the priority. The first one wins.
 *   #label        a workspace label, matched whole and ignoring case. An
 *                 unknown #word stays in the title.
 *   #T-142, #contact-1a2b3c4d, #conv-1a2b3c4d   references (see references.ts):
 *                 never labels, always left in the title.
 *   dates         today, tomorrow, tmrw, tonight, a weekday (mon .. sunday,
 *                 "this" / "next" in front), "next week", "in 3 days / 2 hours /
 *                 45 min / 1 week", 2026-11-12, "nov 12", "12 nov", "12th nov".
 *   times         9am, 9:30pm, 14:00, noon, and "at 9" (1 to 6 read as the
 *                 afternoon, 7 to 11 as the morning, 12 as noon).
 *
 * A bare weekday means the next one AFTER today. "next friday" means the Friday
 * of next week (the week starts on Monday). A date with no time is 9:00 in the
 * member's zone, or 17:00 when today's 9:00 has passed. A time with no date is
 * today, or tomorrow when it has passed. "tonight" with no time is 18:00.
 *
 * All wall-clock times are the MEMBER's zone, never the server's or the
 * customer's.
 *
 * ## Porting
 *
 * Android and iOS have ports of this file. There are no look-behinds and no
 * word-boundary escapes in it on purpose: `\b` is a backspace in a Kotlin
 * string and does not compile in Swift, so the words are split by hand and
 * matched with anchored patterns. The vectors in
 * `packages/shared/vectors/quick-add.json` are run by all three.
 */

export type QuickAddPriority = "low" | "normal" | "high" | "urgent";

export interface QuickAddMember {
  userId: string;
  name: string;
}

export interface QuickAddLabel {
  id: string;
  name: string;
}

export interface QuickAddContext {
  /** The instant the line is typed. */
  now: Date;
  /** IANA zone of the member who is typing. */
  timeZone: string;
  /** The member typing, for "@me". */
  selfUserId: string;
  members: QuickAddMember[];
  labels: QuickAddLabel[];
}

export interface QuickAddUnderstood {
  kind: "assignee" | "due" | "priority" | "label";
  /** The words as typed. */
  text: string;
}

export interface QuickAddResult {
  /** What is left once everything understood is taken out. Empty when nothing is. */
  title: string;
  assignee: QuickAddMember | null;
  /** UTC instant, ISO 8601, or null. */
  dueAt: string | null;
  /** True when the line named a time of day. */
  dueHasTime: boolean;
  priority: QuickAddPriority | null;
  labels: QuickAddLabel[];
  understood: QuickAddUnderstood[];
  /** Words that looked like a mention or a label and matched nothing; they stay in the title. */
  ignored: string[];
}

const PRIORITY_WORDS: Record<string, QuickAddPriority> = {
  urgent: "urgent",
  high: "high",
  low: "low",
  normal: "normal",
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

const DEFAULT_HOUR = 9;
const AFTERNOON_HOUR = 17;
const TONIGHT_HOUR = 18;

interface Civil {
  y: number;
  m: number;
  d: number;
}

interface Clock {
  h: number;
  mi: number;
}

/** The wall clock of an instant in a zone. */
function wallClock(instant: number, timeZone: string): Civil & Clock & { weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
  }).formatToParts(new Date(instant));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "0";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    h: Number(get("hour")) % 24,
    mi: Number(get("minute")),
    weekday,
  };
}

function offsetAt(instant: number, timeZone: string): number {
  const w = wallClock(instant, timeZone);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi) - Math.floor(instant / 60000) * 60000;
}

/** The instant at which a zone's wall clock reads this civil date and time. */
export function zonedToInstant(civil: Civil, clock: Clock, timeZone: string): number {
  const guess = Date.UTC(civil.y, civil.m - 1, civil.d, clock.h, clock.mi);
  let instant = guess - offsetAt(guess, timeZone);
  // Across a daylight-saving change the offset at the guess is not the offset
  // at the answer; one more step settles it.
  const corrected = guess - offsetAt(instant, timeZone);
  if (corrected !== instant) instant = corrected;
  return instant;
}

function addDays(civil: Civil, days: number): Civil {
  const t = new Date(Date.UTC(civil.y, civil.m - 1, civil.d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function civilKey(c: Civil): number {
  return c.y * 10000 + c.m * 100 + c.d;
}

interface Word {
  /** As typed, for the preview and for the title. */
  raw: string;
  /** Lower case with trailing sentence punctuation removed. */
  low: string;
}

function stripTail(text: string): string {
  let end = text.length;
  while (end > 0 && ",.;!?)".includes(text[end - 1])) end -= 1;
  return text.slice(0, end);
}

function toWords(line: string): Word[] {
  return line
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((raw) => ({ raw, low: stripTail(raw).toLowerCase() }));
}

/** A time of day written as one word: 9am, 9:30pm, 14:00, noon. */
function parseClockWord(low: string): Clock | null {
  if (low === "noon") return { h: 12, mi: 0 };
  let m = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/.exec(low);
  if (m) {
    const hour = Number(m[1]);
    const minute = m[2] === undefined ? 0 : Number(m[2]);
    if (hour < 1 || hour > 12 || minute > 59) return null;
    return { h: (hour % 12) + (m[3] === "pm" ? 12 : 0), mi: minute };
  }
  m = /^(\d{1,2}):(\d{2})$/.exec(low);
  if (m) {
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour > 23 || minute > 59) return null;
    return { h: hour, mi: minute };
  }
  return null;
}

/** "at 9": the hour alone, read the way a trade day is read. */
function parseBareHour(low: string): Clock | null {
  const m = /^(\d{1,2})$/.exec(low);
  if (!m) return null;
  const hour = Number(m[1]);
  if (hour < 1 || hour > 23) return null;
  if (hour >= 13) return { h: hour, mi: 0 };
  if (hour === 12) return { h: 12, mi: 0 };
  return { h: hour <= 6 ? hour + 12 : hour, mi: 0 };
}

function ordinalDay(low: string): number | null {
  const m = /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(low);
  if (!m) return null;
  const day = Number(m[1]);
  return day >= 1 && day <= 31 ? day : null;
}

type DateHit =
  | { kind: "civil"; civil: Civil; words: number }
  | { kind: "instant"; instant: number; words: number; hasClock: boolean }
  | { kind: "tonight"; civil: Civil; words: number };

/** The date phrase that starts at `i`, if any. */
function dateAt(words: Word[], i: number, today: Civil & { weekday: number }, now: number): DateHit | null {
  const w = words[i].low;
  const next = (offset: number): string | undefined => words[i + offset]?.low;

  if (w === "today") return { kind: "civil", civil: today, words: 1 };
  if (w === "tomorrow" || w === "tmrw" || w === "tmr") {
    return { kind: "civil", civil: addDays(today, 1), words: 1 };
  }
  if (w === "tonight") return { kind: "tonight", civil: today, words: 1 };

  if (w === "next" && next(1) === "week") {
    const toMonday = ((8 - today.weekday) % 7) || 7;
    return { kind: "civil", civil: addDays(today, toMonday), words: 2 };
  }
  if ((w === "next" || w === "this") && next(1) !== undefined && WEEKDAYS[next(1) as string] !== undefined) {
    const target = WEEKDAYS[next(1) as string];
    if (w === "this") {
      const ahead = ((target - today.weekday + 7) % 7) || 7;
      return { kind: "civil", civil: addDays(today, ahead), words: 2 };
    }
    const toMonday = ((8 - today.weekday) % 7) || 7;
    const fromMonday = (target + 6) % 7;
    return { kind: "civil", civil: addDays(today, toMonday + fromMonday), words: 2 };
  }
  if (WEEKDAYS[w] !== undefined) {
    const ahead = ((WEEKDAYS[w] - today.weekday + 7) % 7) || 7;
    return { kind: "civil", civil: addDays(today, ahead), words: 1 };
  }

  if (w === "in" && next(1) !== undefined && next(2) !== undefined) {
    const amount = /^(\d{1,3})$/.exec(next(1) as string);
    const unit = next(2) as string;
    if (amount) {
      const n = Number(amount[1]);
      if (n >= 1) {
        if (/^(minutes?|mins?)$/.test(unit)) {
          return { kind: "instant", instant: now + n * 60000, words: 3, hasClock: true };
        }
        if (/^(hours?|hrs?)$/.test(unit)) {
          return { kind: "instant", instant: now + n * 3600000, words: 3, hasClock: true };
        }
        if (/^(days?)$/.test(unit)) return { kind: "civil", civil: addDays(today, n), words: 3 };
        if (/^(weeks?)$/.test(unit)) return { kind: "civil", civil: addDays(today, n * 7), words: 3 };
      }
    }
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(w);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m)) {
      return { kind: "civil", civil: { y, m, d }, words: 1 };
    }
    return null;
  }

  // "nov 12" and "12 nov": the next such date on or after today.
  const monthFirst = MONTHS[w];
  const dayAfter = next(1) === undefined ? null : ordinalDay(next(1) as string);
  if (monthFirst !== undefined && dayAfter !== null) {
    const civil = nextOccurrence(monthFirst, dayAfter, today);
    return civil === null ? null : { kind: "civil", civil, words: 2 };
  }
  const dayFirst = ordinalDay(w);
  const monthAfter = next(1) === undefined ? undefined : MONTHS[next(1) as string];
  if (dayFirst !== null && monthAfter !== undefined) {
    const civil = nextOccurrence(monthAfter, dayFirst, today);
    return civil === null ? null : { kind: "civil", civil, words: 2 };
  }
  return null;
}

/** The next time this month and day come round, today included; null when no year has it. */
function nextOccurrence(month: number, day: number, today: Civil): Civil | null {
  for (let year = today.y; year <= today.y + 4; year += 1) {
    if (day > daysInMonth(year, month)) continue;
    const candidate: Civil = { y: year, m: month, d: day };
    if (civilKey(candidate) >= civilKey(today)) return candidate;
  }
  return null;
}

export function parseQuickAdd(line: string, ctx: QuickAddContext): QuickAddResult {
  const words = toWords(line);
  const now = ctx.now.getTime();
  const today = wallClock(now, ctx.timeZone);

  const kept: (string | null)[] = words.map((w) => w.raw);
  const understood: QuickAddUnderstood[] = [];
  const ignored: string[] = [];
  const labels: QuickAddLabel[] = [];
  let assignee: QuickAddMember | null = null;
  let priority: QuickAddPriority | null = null;

  let dateHit: DateHit | null = null;
  let dateText = "";
  let clock: Clock | null = null;
  let clockText = "";

  const take = (from: number, count: number): string => {
    const text = words
      .slice(from, from + count)
      .map((w) => w.raw)
      .join(" ");
    for (let k = from; k < from + count; k += 1) kept[k] = null;
    return text;
  };

  let i = 0;
  while (i < words.length) {
    const word = words[i];
    const low = word.low;

    if (low.startsWith("@") && low.length > 1) {
      const query = low.slice(1);
      const found = query === "me" ? ctx.members.find((m) => m.userId === ctx.selfUserId) ?? null : matchMember(ctx.members, query);
      if (found !== null && assignee === null) {
        assignee = found;
        understood.push({ kind: "assignee", text: take(i, 1) });
      } else if (found === null) {
        ignored.push(word.raw);
      }
      i += 1;
      continue;
    }

    if (low.startsWith("#") && low.length > 1) {
      const tag = low.slice(1);
      if (isReferenceTag(tag)) {
        i += 1;
        continue;
      }
      if (PRIORITY_WORDS[tag] !== undefined) {
        if (priority === null) {
          priority = PRIORITY_WORDS[tag];
          understood.push({ kind: "priority", text: take(i, 1) });
        }
        i += 1;
        continue;
      }
      const label = ctx.labels.find((l) => l.name.toLowerCase() === tag);
      if (label !== undefined) {
        if (!labels.some((l) => l.id === label.id)) {
          labels.push(label);
          understood.push({ kind: "label", text: take(i, 1) });
        } else {
          take(i, 1);
        }
      } else {
        ignored.push(word.raw);
      }
      i += 1;
      continue;
    }

    if (dateHit === null) {
      const hit = dateAt(words, i, today, now);
      if (hit !== null) {
        dateHit = hit;
        dateText = take(i, hit.words);
        i += hit.words;
        continue;
      }
    }

    if (clock === null) {
      let found = parseClockWord(low);
      let consumed = 1;
      if (found === null && low === "at" && words[i + 1] !== undefined) {
        found = parseClockWord(words[i + 1].low) ?? parseBareHour(words[i + 1].low);
        consumed = 2;
      }
      if (found !== null) {
        clock = found;
        clockText = take(i, consumed);
        i += consumed;
        continue;
      }
    }
    i += 1;
  }

  let dueAt: string | null = null;
  let dueHasTime = false;
  if (dateHit !== null || clock !== null) {
    let instant: number;
    if (dateHit !== null && dateHit.kind === "instant") {
      instant = dateHit.instant;
      dueHasTime = true;
      if (clock !== null) {
        const w = wallClock(instant, ctx.timeZone);
        instant = zonedToInstant(w, clock, ctx.timeZone);
      }
    } else if (dateHit !== null) {
      const civil = dateHit.civil;
      if (clock !== null) {
        instant = zonedToInstant(civil, clock, ctx.timeZone);
        dueHasTime = true;
      } else if (dateHit.kind === "tonight") {
        instant = zonedToInstant(civil, { h: TONIGHT_HOUR, mi: 0 }, ctx.timeZone);
        dueHasTime = true;
      } else {
        instant = zonedToInstant(civil, { h: DEFAULT_HOUR, mi: 0 }, ctx.timeZone);
        if (civilKey(civil) === civilKey(today) && instant <= now) {
          instant = zonedToInstant(civil, { h: AFTERNOON_HOUR, mi: 0 }, ctx.timeZone);
        }
      }
    } else {
      const at = clock as Clock;
      instant = zonedToInstant(today, at, ctx.timeZone);
      if (instant <= now) instant = zonedToInstant(addDays(today, 1), at, ctx.timeZone);
      dueHasTime = true;
    }
    dueAt = new Date(instant).toISOString();
    understood.push({
      kind: "due",
      text: [dateText, clockText].filter((t) => t.length > 0).join(" "),
    });
  }

  const title = kept.filter((w): w is string => w !== null).join(" ");
  return { title, assignee, dueAt, dueHasTime, priority, labels, understood, ignored };
}

function isReferenceTag(tag: string): boolean {
  return /^t-\d{1,9}$/.test(tag) || /^contact-[0-9a-f]{8}$/.test(tag) || /^conv-[0-9a-f]{8}$/.test(tag);
}

/** The one member the query names, or null when it names none or several. */
function matchMember(members: QuickAddMember[], query: string): QuickAddMember | null {
  const q = stripTail(query);
  if (q.length === 0) return null;
  const lowerName = (m: QuickAddMember): string => m.name.toLowerCase();
  const exactFirst = members.filter((m) => lowerName(m).split(/\s+/)[0] === q);
  if (exactFirst.length === 1) return exactFirst[0];
  const starts = members.filter((m) => lowerName(m).split(/\s+/).some((part) => part.startsWith(q)));
  if (starts.length === 1) return starts[0];
  const whole = members.filter((m) => lowerName(m).replace(/\s+/g, "").startsWith(q));
  return whole.length === 1 ? whole[0] : null;
}
