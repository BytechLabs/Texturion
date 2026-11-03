/**
 * tools/rig/crons.json (`loonext.rig-crons.v1`, scripts/check-rig-crons.mjs)
 * read as R00 needs it: which of the local API's exceptions the rig expects,
 * which mean its seed or setup is wrong, and, by elimination, which nobody
 * explains.
 *
 * Expected:
 *   - an `expected_events` or `follow_on_events` match;
 *   - a captured refusal: a TelnyxApiError exception whose message carries
 *     `refusal_match.message_contains` and one of that refusal's paths;
 *   - a job's failure (an exception whose `cron` tag names the cron that ran
 *     it) whose every exception but the AggregateErrors is a job-fails
 *     refusal listed for that cron.
 * Defects: a `defects` match, reported with its `means`, never suppressed.
 *
 * A `match` is the registry's short English, read clause by clause:
 * `fingerprint [...]`, `level <level>`, `tag <name>=<value>`,
 * `message starts "<text>"`, `contains "<text>"`, `<ErrorType> "<prefix>"`,
 * and `with no [codes ...]`. A match with a clause outside that list explains
 * nothing, and is listed in `unread`, so a new form shows up in R00 rather
 * than silently suppressing events.
 */
export const CRONS_SCHEMA = "loonext.rig-crons.v1";

/** What R00 keeps of one of the local API's exceptions, for the registry to explain it. */
export interface SeenEvent {
  at: number;
  level?: string;
  message?: string;
  fingerprint?: string[];
  /** The exception's `source`, `cron`, `job` and `ops_key` properties, where it has them. */
  tags?: Record<string, string>;
  /** Every exception in the event, the outermost last. */
  exceptions?: { type: string; value: string }[];
}

/** Why an API exception is no surprise, or undefined when nothing explains it. */
export type Explanation = { kind: "expected" } | { kind: "defect"; means: string };

type Clause =
  | { kind: "fingerprint"; parts: string[] }
  | { kind: "level"; level: string }
  | { kind: "tag"; name: string; value: string }
  | { kind: "message-starts"; text: string }
  | { kind: "contains"; text: string }
  | { kind: "exception"; type: string; prefix: string }
  | { kind: "no-codes" };

export type Matcher = (event: SeenEvent) => boolean;

/** One registry `match`, or undefined when it holds a clause this reader does not know. */
export function parseMatch(text: string): Matcher | undefined {
  const source = text.trim();
  if (source.startsWith("fingerprint ")) {
    try {
      const parts: unknown = JSON.parse(source.slice("fingerprint ".length));
      if (!Array.isArray(parts) || !parts.every((part) => typeof part === "string")) return undefined;
      return matcher([{ kind: "fingerprint", parts: parts as string[] }]);
    } catch {
      return undefined;
    }
  }
  const clauses: Clause[] = [];
  const patterns: [RegExp, (m: RegExpExecArray) => Clause | undefined][] = [
    [/^level (\w+)/, (m) => ({ kind: "level", level: m[1]! })],
    [/^tag ([\w.-]+)=([^\s,]+)/, (m) => ({ kind: "tag", name: m[1]!, value: m[2]! })],
    [/^message starts "([^"]*)"/, (m) => ({ kind: "message-starts", text: m[1]! })],
    [/^contains "([^"]*)"/, (m) => ({ kind: "contains", text: m[1]! })],
    [/^([A-Z]\w*Error) "([^"]*)"/, (m) => ({ kind: "exception", type: m[1]!, prefix: m[2]! })],
    [/^with no \[codes \.\.\.\]/, () => ({ kind: "no-codes" })],
    [/^(?:,|and\b)\s*/, () => undefined],
  ];
  let rest = source;
  while (rest.length) {
    const found = patterns.map(([pattern, make]) => [pattern.exec(rest), make] as const).find(([m]) => m);
    if (!found) return undefined;
    const [m, make] = found;
    const clause = make(m!);
    if (clause) clauses.push(clause);
    rest = rest.slice(m![0].length).trimStart();
  }
  return clauses.length ? matcher(clauses) : undefined;
}

function matcher(clauses: Clause[]): Matcher {
  return (event) => {
    const exceptions = event.exceptions ?? [];
    const text = event.message ?? exceptions.at(-1)?.value ?? "";
    // The clauses about an exception all describe the same one.
    const exceptionClauses = clauses.filter((c) => c.kind === "exception" || c.kind === "no-codes");
    const exceptionOk =
      exceptionClauses.length === 0 ||
      exceptions.some((exception) =>
        exceptionClauses.every((c) =>
          c.kind === "exception" ? exception.type === c.type && exception.value.startsWith(c.prefix) : !exception.value.includes("[codes"),
        ),
      );
    return (
      exceptionOk &&
      clauses.every((c) => {
        switch (c.kind) {
          case "fingerprint":
            return JSON.stringify(event.fingerprint ?? null) === JSON.stringify(c.parts);
          case "level":
            return event.level === c.level;
          case "tag":
            return event.tags?.[c.name] === c.value;
          case "message-starts":
            return text.startsWith(c.text);
          case "contains":
            return text.includes(c.text);
          default:
            return true;
        }
      })
    );
  };
}

interface Refusal {
  outcome: "job-fails" | "captured";
  paths: string[];
}

export interface CronExplainer {
  explain(event: SeenEvent): Explanation | undefined;
  /** Registry matches this reader could not read; they explain nothing. */
  unread: string[];
}

/** The explainer for a crons.json text; with no registry, nothing is explained. */
export function cronExplainer(registryText: string | undefined): CronExplainer {
  if (!registryText) return { explain: () => undefined, unread: [] };
  const registry = JSON.parse(registryText) as {
    schema?: unknown;
    refusal_match?: { message_contains?: unknown; exception_type?: unknown };
    crons?: unknown;
  };
  if (registry.schema !== CRONS_SCHEMA || !Array.isArray(registry.crons)) {
    throw new Error(`crons.json: expected a ${CRONS_SCHEMA} object with a crons list`);
  }
  const marker = typeof registry.refusal_match?.message_contains === "string" ? registry.refusal_match.message_contains : undefined;
  const refusalType = typeof registry.refusal_match?.exception_type === "string" ? registry.refusal_match.exception_type : "TelnyxApiError";
  const unread: string[] = [];
  const expected: Matcher[] = [];
  const defects: { match: Matcher; means: string }[] = [];
  const captured: string[][] = [];
  const jobFails = new Map<string, string[]>();
  const read = (text: unknown): Matcher | undefined => {
    if (typeof text !== "string") return undefined;
    const parsed = parseMatch(text);
    if (!parsed) unread.push(text);
    return parsed;
  };

  for (const raw of registry.crons as Record<string, unknown>[]) {
    const cron = typeof raw?.cron === "string" ? raw.cron : "";
    for (const event of asList(raw?.expected_events)) {
      const match = read(event.match);
      if (match) expected.push(match);
    }
    for (const defect of asList(raw?.defects)) {
      const match = read(defect.match);
      if (match) defects.push({ match, means: typeof defect.means === "string" ? defect.means : "a defect the cron registry names" });
    }
    for (const refusal of asList(raw?.refusals) as (Partial<Refusal> & Record<string, unknown>)[]) {
      const paths = Array.isArray(refusal.telnyx_paths) ? refusal.telnyx_paths.filter((p): p is string => typeof p === "string") : [];
      for (const followOn of asList(refusal.follow_on_events)) {
        const match = read(followOn.match);
        if (match) expected.push(match);
      }
      if (refusal.outcome === "captured") captured.push(paths);
      if (refusal.outcome === "job-fails") jobFails.set(cron, [...(jobFails.get(cron) ?? []), ...paths]);
    }
  }

  const isRefusal = (exception: { type: string; value: string }, paths: readonly string[]) =>
    marker !== undefined &&
    exception.type === refusalType &&
    exception.value.includes(marker) &&
    paths.some((path) => exception.value.includes(path));

  return {
    unread,
    explain(event) {
      const defect = defects.find((d) => d.match(event));
      if (defect) return { kind: "defect", means: defect.means };
      if (expected.some((match) => match(event))) return { kind: "expected" };
      const exceptions = event.exceptions ?? [];
      if (exceptions.length === 1 && captured.some((paths) => isRefusal(exceptions[0]!, paths))) return { kind: "expected" };
      const cron = event.tags?.cron;
      const paths = cron === undefined ? undefined : jobFails.get(cron);
      if (paths) {
        // An AggregateError here is a wrapper; every exception that is not one
        // is a failure the job reported.
        const leaves = exceptions.filter((exception) => exception.type !== "AggregateError");
        if (leaves.length > 0 && leaves.every((exception) => isRefusal(exception, paths))) {
          return { kind: "expected" };
        }
      }
      return undefined;
    },
  };
}

function asList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => item !== null && typeof item === "object") : [];
}
