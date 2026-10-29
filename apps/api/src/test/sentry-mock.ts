/**
 * The one Sentry module double.
 *
 * Twenty-one suites each stubbed only the functions their own module called,
 * which holds until a SHARED helper reaches for a different one: `withScope`
 * was `undefined` in every one, and `opsAlert`'s best-effort catch turned that
 * into silence — the fingerprint never ran in a single test and nothing
 * failed. So the shape lives in one place, and it RECORDS what it was handed,
 * because "something was captured" cannot tell a grouping identity from
 * decoration.
 *
 * Needs an async factory, so the dynamic import resolves after hoisting:
 *
 *     vi.mock("@sentry/cloudflare", async () =>
 *       (await import("../test/sentry-mock")).sentryModuleMock(),
 *     );
 */
import { vi } from "vitest";

/** One capture, with whatever its surrounding scope had set. */
export interface CapturedAlert {
  message: string;
  level?: string;
  /** `["ops", key]` for anything sent through `opsAlert`/`opsEmail`. */
  fingerprint?: string[];
  tags: Record<string, string>;
  extra: Record<string, unknown>;
}

/** Everything captured through the double, in order. */
export const sentryCaptures: CapturedAlert[] = [];

/** Clear between tests — the array is shared for the whole file. */
export function resetSentryCaptures(): void {
  sentryCaptures.length = 0;
}

/** Captures whose fingerprint marks them as ops alerts, by key. */
export function opsCaptures(key?: string): CapturedAlert[] {
  return sentryCaptures.filter(
    (c) =>
      c.fingerprint?.[0] === "ops" &&
      (key === undefined || c.fingerprint?.[1] === key),
  );
}

export function sentryModuleMock() {
  // The scope the innermost open `withScope` is writing into. Nested scopes
  // restore the outer one, as the real implementation does.
  let open: CapturedAlert | null = null;

  const scope = {
    setFingerprint(fingerprint: string[]) {
      if (open) open.fingerprint = fingerprint;
      return scope;
    },
    setTag(key: string, value: string) {
      if (open) open.tags[key] = value;
      return scope;
    },
    setLevel(level: string) {
      if (open) open.level = level;
      return scope;
    },
    setExtra(key: string, value: unknown) {
      if (open) open.extra[key] = value;
      return scope;
    },
  };

  return {
    withScope: vi.fn((fn: (s: typeof scope) => unknown) => {
      const outer = open;
      open = { message: "", tags: {}, extra: {} };
      try {
        return fn(scope);
      } finally {
        open = outer;
      }
    }),
    captureMessage: vi.fn((message: string, level?: string) => {
      sentryCaptures.push(
        open
          ? { ...open, message, level: open.level ?? level }
          : { message, level, tags: {}, extra: {} },
      );
      return "test-event-id";
    }),
    captureException: vi.fn(() => "test-event-id"),
    addBreadcrumb: vi.fn(),
    getClient: vi.fn(() => undefined),
  };
}
