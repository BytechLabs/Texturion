// The emulators play guest audio through the workstation's speakers, and the
// rig's audio tests make them beep. The emulator's audio backend has to stay
// on: -no-audio breaks gRPC injectAudio, and injecting before the guest opens
// its microphone crashed the emulator. So only the Windows output is silenced,
// by muting the emulator's own audio session (ISimpleAudioVolume), which is a
// per-application mute and not a system setting. gRPC streamAudio reads the
// emulator's samples before they reach the session, so it is unaffected.
//
// emulator-audio.ps1 does the Core Audio calls; this file picks the pids and
// keeps retrying, because a session appears only once the emulator first
// opens audio, and a later one can appear after that.
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

export const AUDIO_SCRIPT = fileURLToPath(new URL("../emulator-audio.ps1", import.meta.url));
// Until a session has been muted, then once one has.
export const FAST_SWEEP_MS = 1000;
export const STEADY_SWEEP_MS = 3000;
export const TREE_TTL_MS = 10_000;
const HELPER_TIMEOUT_MS = 30_000;

/** Pids this low are the idle process and the kernel; they are never a root. */
const isRoot = (pid) => Number.isInteger(pid) && pid > 4;

/**
 * Every pid under the roots, the roots included. A table row is
 * { pid, ppid }; Windows keeps a child's ppid after its parent has gone, so
 * the emulator survives its launcher exiting.
 */
export function processTree(table, roots) {
  const found = new Set(roots.filter(isRoot));
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of table) {
      if (isRoot(row.pid) && !found.has(row.pid) && found.has(row.ppid)) {
        found.add(row.pid);
        grew = true;
      }
    }
  }
  return [...found].sort((a, b) => a - b);
}

/** One line of the helper's JSON, or an Error carrying its message. */
export function parseHelperLine(line) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error(`audio helper gave no JSON: ${String(line).trim().slice(0, 200)}`);
  }
  if (value && typeof value === "object" && !Array.isArray(value) && typeof value.error === "string") throw new Error(`audio helper: ${value.error}`);
  return value;
}

/** A one-shot run's output: the last line is the answer. */
export function parseHelperOutput({ code, stdout = "", stderr = "" }) {
  const line = stdout.trim().split(/\r?\n/).pop() ?? "";
  if (!line) throw new Error(`audio helper gave no JSON (exit ${code}): ${stderr.trim().slice(0, 200)}`);
  const value = parseHelperLine(line);
  if (code !== 0) throw new Error(`audio helper exited ${code}`);
  return value;
}

const HELPER_ARGS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"];
const OWNER = /^[a-z0-9-]{1,32}$/;
const pidList = (pids) => pids.filter(Number.isInteger).join(",");

/**
 * Runs emulator-audio.ps1 afresh for each call. Used where the answer is all
 * that is wanted, as in `hostd doctor`: nothing keeps running.
 */
export function oneShotHelper({ exec, script = AUDIO_SCRIPT }) {
  const run = async (action, extra = []) =>
    parseHelperOutput(await exec("powershell.exe", [...HELPER_ARGS, script, "-Action", action, ...extra], { timeoutMs: HELPER_TIMEOUT_MS }));
  return {
    call: (action, { pids = [] } = {}) => (action === "processes" ? run("processes") : run(action, ["-Pids", pidList(pids)])),
    release: async () => {},
    close: async () => {},
  };
}

/**
 * One emulator-audio.ps1 kept running (-Action serve), so that a session is
 * muted the moment the emulator creates it, and so that PowerShell and the
 * Core Audio types are not started again every few seconds. It is started on
 * the first call and again after it dies; it exits when hostd's pipe closes.
 */
export function persistentHelper({ spawn, script = AUDIO_SCRIPT, log = () => {}, timeoutMs = HELPER_TIMEOUT_MS }) {
  let child = null;
  let pending = null;
  let tail = Promise.resolve();

  const settle = (fn) => {
    if (!pending) return;
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    fn(current);
  };

  const start = () => {
    const proc = spawn("powershell.exe", [...HELPER_ARGS, script, "-Action", "serve"], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    child = proc;
    const gone = (why) => {
      if (child === proc) child = null;
      settle((current) => current.reject(new Error(`audio helper ${why}`)));
    };
    createInterface({ input: proc.stdout }).on("line", (line) => {
      if (!line.trim()) return;
      if (line.startsWith("event ")) return log(`audio: ${line.slice(6)}`);
      settle((current) => {
        try {
          current.resolve(parseHelperLine(line));
        } catch (cause) {
          current.reject(cause);
        }
      });
    });
    proc.stdin.on("error", () => {});
    proc.once("error", (cause) => gone(`did not start: ${cause.code ?? cause.message}`));
    proc.once("exit", (code) => gone(`exited (${code})`));
    return proc;
  };

  const send = (line) =>
    new Promise((resolve, reject) => {
      const proc = child ?? start();
      const timer = setTimeout(() => {
        pending = null;
        if (child === proc) child = null;
        proc.kill();
        reject(new Error("audio helper gave no answer"));
      }, timeoutMs);
      pending = { resolve, reject, timer };
      proc.stdin.write(`${line}\n`);
    });

  // One command at a time: the helper answers each with one line.
  const call = (line) => {
    const result = tail.then(() => send(line));
    tail = result.catch(() => {});
    return result;
  };

  return {
    call: (action, { key, pids = [] } = {}) => {
      if (action === "processes") return call("processes");
      if (action === "status") return call(`status ${pidList(pids)}`);
      if (!OWNER.test(key ?? "")) throw new Error("audio helper: a mute needs an owner key");
      return call(`mute ${key} ${pidList(pids)}`);
    },
    release: async (key) => {
      if (child && OWNER.test(key ?? "")) await call(`clear ${key}`);
    },
    close: async () => {
      const proc = child;
      child = null;
      proc?.stdin.end();
    },
  };
}

/** Only sessions whose pid is one of `pids`: nothing outside the emulator's tree is ever claimed. */
export function sessionsOf(sessions, pids) {
  const wanted = new Set(pids);
  return (Array.isArray(sessions) ? sessions : []).filter((session) => Number.isInteger(session?.pid) && wanted.has(session.pid));
}

/**
 * muted: every session is muted. waiting: the emulator has no session yet.
 * unmuted: at least one session is not muted.
 */
export function summarise(sessions) {
  const muted = sessions.filter((session) => session.muted === true).length;
  const state = sessions.length === 0 ? "waiting" : muted === sessions.length ? "muted" : "unmuted";
  return { state, sessions: sessions.length, muted };
}

export function createAudioMuter({
  exec,
  script = AUDIO_SCRIPT,
  helper = oneShotHelper({ exec, script }),
  log = () => {},
  now = () => Date.now(),
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  fastMs = FAST_SWEEP_MS,
  steadyMs = STEADY_SWEEP_MS,
  treeTtlMs = TREE_TTL_MS,
}) {
  let cached = null;
  const treeOf = async (roots) => {
    const key = roots.join(",");
    if (cached && cached.key === key && now() - cached.at < treeTtlMs) return cached.pids;
    const table = await helper.call("processes");
    if (!Array.isArray(table)) throw new Error("audio helper: no process table");
    cached = { key, at: now(), pids: processTree(table, roots) };
    return cached.pids;
  };

  /**
   * One pass over the roots' process tree: mutes its audio sessions (or, with
   * mute: false, only reads them). Muted is what the session reports after.
   */
  async function sweep(roots, { mute = true, key = "sweep" } = {}) {
    const pids = await treeOf(roots);
    const answer = await helper.call(mute ? "mute" : "status", { key, pids });
    const sessions = sessionsOf(answer?.sessions, pids);
    const summary = summarise(sessions);
    // With no session yet the emulator may still be starting children: look again next time.
    if (summary.state === "waiting") cached = null;
    return { ...summary, pids, checked_at: new Date(now()).toISOString() };
  }

  /**
   * Sweeps until `roots()` returns null (the emulator is gone). Fast while no
   * session is muted yet, then steady; a failed sweep is reported and retried.
   * `onResult` gets every result; `onEnd` runs when the loop leaves.
   */
  function watch({ key, roots, onResult = () => {}, onEnd = () => {} }) {
    let stopped = false;
    const done = (async () => {
      while (!stopped) {
        const current = roots();
        if (current === null) break;
        let result;
        if (current.filter(isRoot).length === 0) {
          result = { state: "waiting", sessions: 0, muted: 0, pids: [], checked_at: new Date(now()).toISOString() };
        } else {
          result = await sweep(current, { key }).catch((cause) => ({ state: "error", sessions: 0, muted: 0, pids: [], error: cause.message, checked_at: new Date(now()).toISOString() }));
        }
        if (stopped) break;
        try {
          onResult(result);
        } catch (cause) {
          log(`audio: ${cause.message}`);
        }
        await sleep(result.state === "muted" || result.state === "error" ? steadyMs : fastMs);
      }
      await helper.release(key).catch(() => {});
      onEnd();
    })();
    return {
      done,
      stop: () => {
        stopped = true;
        return done;
      },
    };
  }

  return { sweep, watch, close: () => helper.close() };
}
