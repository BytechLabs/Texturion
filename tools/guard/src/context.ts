import type { EdgeForGuardMethods } from "@loonext/rig-protocol";

import type { GuardConfig } from "./env";
import type { Store } from "./store";
import type { TelnyxApi } from "./telnyx/client";

export interface AiRunner {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

/** What every handler gets. Built once per Durable Object instance. */
export interface Ctx {
  config: GuardConfig;
  store: Store;
  now(): number;
  /** Waits; the fake clock in tests moves on instead. */
  sleep(ms: number): Promise<void>;
  fetch: typeof fetch;
  /** Null without TELNYX_API_KEY; every Telnyx route then fails closed. */
  telnyx: TelnyxApi | null;
  ai: AiRunner | null;
  /** Null without the EDGE binding; the robot mailbox then reads as dead. */
  edge: EdgeForGuardMethods | null;
  versionId: string;
  setAlarm(at: number): Promise<void>;
  /** In-isolate caches that are fine to lose: the FCM access token. */
  memory: { fcmToken?: { token: string; expiresAt: number } };
}
