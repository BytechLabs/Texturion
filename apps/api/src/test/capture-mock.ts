/**
 * The one double for observability/capture.ts. It records what each call was
 * handed, because "something was captured" cannot tell a notice's key from
 * decoration.
 *
 * Needs an async factory, so the dynamic import resolves after hoisting:
 *
 *     vi.mock("../observability/capture", async () =>
 *       (await import("../test/capture-mock")).captureModuleMock(),
 *     );
 */
import { vi } from "vitest";

import type { Env } from "../env";
import type { ExceptionContext, OpsNotice } from "../observability/capture";

/** Every capture also records the `env` and `waitUntil` it was handed. */
interface Delivery {
  env: Env;
  waitUntil?: (promise: Promise<unknown>) => void;
}

export type Captured = Delivery &
  (
    | { kind: "exception"; error: unknown; context: ExceptionContext }
    | { kind: "notice"; notice: OpsNotice }
    | {
        kind: "event";
        event: string;
        distinctId: string;
        properties: Record<string, unknown>;
      }
  );

type WaitUntil = Delivery["waitUntil"];

/** Everything captured through the double, in order. */
export const captured: Captured[] = [];

/** Clear between tests: the array is shared for the whole file. */
export function resetCaptures(): void {
  captured.length = 0;
}

/** Ops notices, optionally only those with one key. */
export function noticesCaptured(key?: string): OpsNotice[] {
  return captured.flatMap((entry) =>
    entry.kind === "notice" && (key === undefined || entry.notice.key === key)
      ? [entry.notice]
      : [],
  );
}

export function exceptionsCaptured(): { error: unknown; context: ExceptionContext }[] {
  return captured.flatMap((entry) =>
    entry.kind === "exception" ? [{ error: entry.error, context: entry.context }] : [],
  );
}

export function eventsCaptured(
  event?: string,
): { event: string; distinctId: string; properties: Record<string, unknown> }[] {
  return captured.flatMap((entry) =>
    entry.kind === "event" && (event === undefined || entry.event === event)
      ? [{ event: entry.event, distinctId: entry.distinctId, properties: entry.properties }]
      : [],
  );
}

export async function captureModuleMock() {
  const actual = await vi.importActual<typeof import("../observability/capture")>(
    "../observability/capture",
  );
  return {
    ...actual,
    captureException: vi.fn(
      (env: Env, error: unknown, context: ExceptionContext, waitUntil?: WaitUntil) => {
        captured.push({ kind: "exception", env, error, context, waitUntil });
        return Promise.resolve();
      },
    ),
    opsNotice: vi.fn((env: Env, notice: OpsNotice, waitUntil?: WaitUntil) => {
      captured.push({ kind: "notice", env, notice, waitUntil });
      return Promise.resolve();
    }),
    captureEvent: vi.fn(
      (
        env: Env,
        event: string,
        distinctId: string,
        properties: Record<string, unknown>,
        waitUntil?: WaitUntil,
      ) => {
        captured.push({ kind: "event", env, event, distinctId, properties, waitUntil });
        return Promise.resolve();
      },
    ),
  };
}
