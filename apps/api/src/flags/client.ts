/**
 * #283 — the flags a CLIENT has to know about.
 *
 * Most flags are server-side and stay there: a kill switch works best at the
 * choke point, where it cannot be bypassed by an old build that never learned
 * about it. Three of the four are like that (AI at `runAiFeature`, calls at
 * the WebRTC token, outbound at `runPreSendGates`).
 *
 * `kill:realtime` cannot be. Clients hold their own Supabase token and open
 * their own websocket; the Worker is not in that path and has nothing to
 * refuse. So the only place that switch can be honoured is in the client, and
 * the only way it gets there is on a response the client already makes —
 * `GET /v1/me`, which every client calls on launch and on workspace switch.
 *
 * THAT MEANS AN OLD BUILD IGNORES IT, and that is an accepted limit rather
 * than a hidden one: a client that predates this field keeps subscribing.
 * Which is exactly why #339 (version reporting) is the companion to this — it
 * is how we find out how many of those are left.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "../env";
import { isFlagOn } from "./evaluate";
import type { FlagKey } from "./registry";

/**
 * The allowlist, and it is an allowlist on purpose.
 *
 * Flags name things we are worried about. Shipping the whole set to every
 * client would hand anyone with dev tools a live list of which subsystems we
 * consider fragile, and a rollout's shape besides — for no benefit, since the
 * client can only act on the ones it knows how to act on.
 */
const CLIENT_FLAGS: FlagKey[] = ["kill:realtime"];

/**
 * Evaluate the client-visible flags for one workspace.
 *
 * Never throws: `isFlagOn` already resolves every failure to the code default,
 * so the worst case here is "realtime on", which is the normal state.
 */
export async function clientFlags(
  env: Env,
  companyId: string,
  db?: SupabaseClient,
): Promise<Record<string, boolean>> {
  const entries = await Promise.all(
    CLIENT_FLAGS.map(async (key) => [key, await isFlagOn(env, key, companyId, db)] as const),
  );
  return Object.fromEntries(entries);
}
