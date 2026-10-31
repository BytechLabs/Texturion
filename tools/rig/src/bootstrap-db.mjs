/**
 * `rig bootstrap-db`, run after every database reset.
 *
 * The SQL destination gate is on only where `loonext.deploy_env` is `rig`, and
 * the setting fails open: `supabase db reset` forgets ALTER DATABASE settings,
 * and a pooled connection opened before they were set never sees them. So the
 * settings are written, every pooled connection is dropped by restarting the
 * services that hold them, and the answer is read back through PostgREST, the
 * same path the API reads it through
 * (apps/api/src/environments/database.ts).
 */
import { run } from "./exec.mjs";
import { containerName, psql } from "./supabase.mjs";

const E164 = /^\+[1-9][0-9]{7,14}$/;

/** The two ALTER DATABASE statements. Only E.164 reaches the SQL text. */
export function bootstrapSql(endpoints) {
  if (endpoints.length === 0) throw new Error("rig bootstrap-db: no endpoints; the gate would refuse every destination");
  for (const entry of endpoints) {
    if (!E164.test(entry)) throw new Error("rig bootstrap-db: an endpoint is not E.164");
  }
  return [
    "alter database postgres set loonext.deploy_env = 'rig';",
    `alter database postgres set loonext.rig_endpoints = '${endpoints.join(",")}';`,
  ].join("\n");
}

/** Pass when PostgREST's connections report rig with every endpoint. */
export function judgePosture(postures, expectedEndpoints) {
  for (const posture of postures) {
    if (posture?.deploy_env !== "rig") {
      return `a pooled connection reports deploy_env "${posture?.deploy_env ?? ""}", not rig`;
    }
    if (posture.endpoints !== expectedEndpoints) {
      return `a pooled connection reports ${posture.endpoints} endpoint(s), not ${expectedEndpoints}`;
    }
  }
  return null;
}

export class PostureMissing extends Error {}

async function readPosture(apiUrl, secretKey) {
  const response = await fetch(`${apiUrl}/rest/v1/rpc/rig_database_posture`, {
    method: "POST",
    headers: {
      apikey: secretKey,
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/json",
    },
    body: "{}",
  });
  if (response.status === 404) throw new PostureMissing("this schema has no rig_database_posture()");
  if (!response.ok) throw new Error(`rig_database_posture answered ${response.status}`);
  return response.json();
}

async function waitForPostgrest(apiUrl, secretKey, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`${apiUrl}/rest/v1/`, { headers: { apikey: secretKey } });
      if (response.status < 500) return;
    } catch {
      // still starting
    }
    if (Date.now() > deadline) throw new Error("rig bootstrap-db: PostgREST did not come back");
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

function containerExists(name) {
  return run("docker", ["container", "inspect", name], { allowFailure: true }).status === 0;
}

/**
 * @param {{ projectId: string, status: { apiUrl: string, secretKey: string }, endpoints: string[], preSeam?: boolean, log: (line: string) => void }} args
 *   preSeam: the ref predates the SQL gate, so there is no posture to read and
 *   only the guard stands in front of Telnyx.
 */
export async function bootstrapDb({ projectId, status, endpoints, preSeam = false, log }) {
  // `postgres` owns the database but is not a superuser in Supabase's image,
  // and setting an unregistered parameter on a database needs one.
  psql(projectId, bootstrapSql(endpoints), { user: "supabase_admin" });
  log(`database settings written: deploy_env=rig, ${endpoints.length} endpoint(s)`);

  // PostgREST holds the API's connections. The pooler is off in the committed
  // config, but a ref that turns it on gets it restarted too.
  const restarted = [];
  for (const service of ["rest", "pooler"]) {
    const name = containerName(projectId, service);
    if (!containerExists(name)) continue;
    run("docker", ["restart", name]);
    restarted.push(service);
  }
  log(`restarted: ${restarted.join(", ") || "nothing"}`);
  await waitForPostgrest(status.apiUrl, status.secretKey);

  // Several reads at once, so more than one of PostgREST's connections answers.
  let postures;
  try {
    postures = await Promise.all(Array.from({ length: 8 }, () => readPosture(status.apiUrl, status.secretKey)));
  } catch (error) {
    if (!(error instanceof PostureMissing) || !preSeam) throw error;
    log("pre-seam ref: no rig_database_posture() to read; the database has no destination gate, the guard is the only one");
    return;
  }
  const refusal = judgePosture(postures, endpoints.length);
  if (refusal !== null) throw new Error(`rig bootstrap-db: ${refusal}`);
  log(`rig_database_posture(): deploy_env=rig, endpoints=${endpoints.length}, on ${postures.length} reads`);
}
