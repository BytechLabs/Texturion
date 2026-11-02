/**
 * `rig stack wait`: what the API and web units run before they start. They
 * start after the stack unit and only once it is up. The stack unit retries a
 * failed start by itself, so a stack that is "activating" is waited for, and
 * one that gave up is a clear failure rather than a dependency job that
 * failed once and never started the services.
 */
import { systemctlUser } from "./exec.mjs";

export const STACK_UNIT = "loonext-rig-stack.service";

/** The stack unit gets five starts in an hour; a unit that waits this long is restarted by its own Restart= and waits again. */
export const STACK_UNIT_WAIT_MS = 35 * 60_000;

/** systemd's ActiveState for the stack unit: active, activating, inactive, failed. */
export function stackUnitState(systemctl = systemctlUser) {
  return systemctl(["show", "--property=ActiveState", "--value", STACK_UNIT], { allowFailure: true }).stdout.trim();
}

/**
 * @returns {Promise<void>} when the stack unit is active
 * @throws when it failed or was never started, or is still not up after `timeoutMs`
 */
export async function waitForStackUnit({
  state = stackUnitState,
  timeoutMs = STACK_UNIT_WAIT_MS,
  intervalMs = 3_000,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  log = () => {},
} = {}) {
  const deadline = now() + timeoutMs;
  let announced = false;
  for (;;) {
    const current = state();
    if (current === "active") return;
    if (current !== "activating" && current !== "reloading") {
      throw new Error(
        `rig stack wait: ${STACK_UNIT} is ${current || "unknown"}, not up. ` +
          `Look at \`journalctl --user -u ${STACK_UNIT}\`, then \`systemctl --user restart ${STACK_UNIT}\`.`,
      );
    }
    if (now() >= deadline) {
      throw new Error(`rig stack wait: ${STACK_UNIT} was still starting after ${Math.round(timeoutMs / 60_000)} min; see \`journalctl --user -u ${STACK_UNIT}\`.`);
    }
    if (!announced) {
      log(`stack: waiting for ${STACK_UNIT}`);
      announced = true;
    }
    await sleep(intervalMs);
  }
}
