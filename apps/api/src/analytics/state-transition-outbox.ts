import { getDb } from "../db";
import type { Env } from "../env";
import { fetchWithDeadline } from "../http/deadline";
import { environmentOf } from "../observability/capture";
import { scrubProperties, scrubUrl } from "../observability/scrub";
import { POSTHOG_CAPTURE_URL } from "./posthog";

const POSTHOG_BATCH_URL = new URL("/batch/", POSTHOG_CAPTURE_URL);

interface StateTransition {
  id: string;
  company_id: string;
  machine: string;
  record_id: string;
  from_state: string | null;
  to_state: string;
  expected: boolean;
  cause: string;
  occurred_at: string;
}

export async function deliverStateTransitions(env: Env): Promise<void> {
  const environment = environmentOf(env);
  if (environment === "rig") return;

  const db = getDb(env);
  const { data, error } = await db.rpc("api_claim_state_transitions");
  if (error) throw new Error(`state transition claim failed: ${error.code}`);
  const transitions: StateTransition[] = data ?? [];
  if (transitions.length === 0) return;

  if (env.POSTHOG_API_KEY) {
    const response = await fetchWithDeadline(
      POSTHOG_BATCH_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: env.POSTHOG_API_KEY,
          batch: transitions.map((row) => ({
            event: "state_transition",
            uuid: row.id,
            timestamp: row.occurred_at,
            distinct_id: row.company_id,
            properties: {
              ...scrubProperties("state_transition", {
                machine: row.machine,
                record_id: row.record_id,
                from: row.from_state,
                to: row.to_state,
                expected: row.expected,
                cause: scrubUrl(row.cause),
              }, console.error),
              environment,
              $process_person_profile: false,
            },
          })),
        }),
      },
      3000,
    );
    if (!response.ok) throw new Error(`PostHog batch answered HTTP ${response.status}`);
  }

  const ack = await db.rpc("api_ack_state_transitions", { p_ids: transitions.map(({ id }) => id) });
  if (ack.error) throw new Error(`state transition acknowledgement failed: ${ack.error.code}`);
}
