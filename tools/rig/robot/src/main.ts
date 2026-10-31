/**
 * robotd: `node tools/rig/robot/src/main.ts`, a user unit on the rig
 * (loonext-rig-robotd.service), reading $RIG_HOME as the `rig` CLI lays it out.
 *
 * It reads the live partition from the guard before it serves, takes the
 * robot's Call Control app from it, and refuses to start if any robot line is
 * not an owned number: a robot that could dial from a number outside the
 * partition is the one thing it must never be.
 *
 * From the store: edge-origin, guard-token-robot, standing-numbers.json and
 * robot-local-token (made on first use). The code's probe URL is signed by
 * local storage, found with `supabase status`.
 */
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EDGE_PATHS, GUARD_ROUTES, PARTITION_CACHE_MS, type Partition } from "@loonext/rig-protocol";
import { loadMargins, saveMargins } from "./audio/calibrate.ts";
import type { Margins } from "./audio/detect.ts";
import { Inbox, WebhookSink } from "./inbox.ts";
import { standingBook } from "./numbers.ts";
import { InlineProbe, StorageProbe, type ProbeSource } from "./probe.ts";
import { localSupabase, rigHome, robotLocalToken, SecretFiles } from "./rig-home.ts";
import { ROBOT_ROLES, Robot } from "./robot.ts";
import { robotServer } from "./server.ts";
import { GuardedTelnyx } from "./telnyx.ts";

const MAX_RECORDING_BYTES = 50 * 1024 * 1024;

export async function fetchPartition(edgeOrigin: string, token: string): Promise<Partition> {
  const url = `${edgeOrigin.replace(/\/+$/, "")}${EDGE_PATHS.guardPrefix}${GUARD_ROUTES.partition}`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`robotd: the guard's partition read returned ${response.status}`);
  return (await response.json()) as Partition;
}

/** Fetches a recording into memory, never to disk, refusing anything implausibly large. */
export async function downloadRecording(url: string): Promise<Uint8Array> {
  if (!url.startsWith("https://")) throw new Error("download: recording URLs must be https");
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000), redirect: "follow" });
  if (!response.ok) throw new Error(`download: ${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_RECORDING_BYTES) throw new Error("download: recording too large");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RECORDING_BYTES) throw new Error("download: recording too large");
  return bytes;
}

async function main(): Promise<void> {
  const home = rigHome();
  const store = new SecretFiles(home.secrets);
  const edgeOrigin = store.read("edge-origin").replace(/\/+$/, "");
  const guardToken = store.read("guard-token-robot");
  const partition = await fetchPartition(edgeOrigin, guardToken);
  const numbers = standingBook(partition.standing ?? store.readJson<unknown>("standing-numbers.json"), partition.owned_e164);
  for (const role of ROBOT_ROLES) {
    if (!numbers.number(role)) throw new Error(`robotd: ${role} is not an owned number in the partition; refusing to start`);
  }

  const telnyx = new GuardedTelnyx({ edgeOrigin, token: guardToken });
  let probe: ProbeSource;
  if (process.env.ROBOT_PROBE === "inline") probe = new InlineProbe();
  else {
    const supabase = localSupabase(home);
    probe = new StorageProbe({ supabaseUrl: supabase.apiUrl, serviceRoleKey: supabase.secretKey, edgeOrigin });
  }
  const marginsFile = join(home.state, "rigd", "margins.json");
  let margins: Margins = loadMargins(marginsFile);
  let connectionId = partition.connection_ids.robot;
  const refresh = setInterval(() => {
    fetchPartition(edgeOrigin, guardToken)
      .then((next) => {
        connectionId = next.connection_ids.robot;
        margins = loadMargins(marginsFile);
      })
      .catch((error: unknown) => console.error(`robotd: partition refresh failed: ${error instanceof Error ? error.message : "error"}`));
  }, PARTITION_CACHE_MS);
  refresh.unref();

  const robot = new Robot({
    telnyx,
    numbers,
    probe,
    connectionId: () => connectionId,
    download: downloadRecording,
    margins: () => margins,
    onCalibration: (calibration) => {
      console.log(`robotd: calibration for ${calibration.surface}: ${calibration.ok ? `margin ${calibration.marginDb} dB` : calibration.reason}`);
      margins = saveMargins(marginsFile, margins, [calibration]);
    },
    recordMode: process.env.ROBOT_RECORD_MODE === "dual" ? "dual" : "inbound",
  });
  const server = robotServer({
    robot,
    inbox: new Inbox(numbers),
    sink: new WebhookSink(),
    telnyx,
    numbers,
    token: robotLocalToken(store),
  });
  const port = Number(process.env.ROBOT_PORT ?? 7311);
  server.listen(port, "127.0.0.1", () => console.log(`robotd: listening on 127.0.0.1:${port}`));
  const stop = () => {
    server.close();
    void robot.idle().then(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
