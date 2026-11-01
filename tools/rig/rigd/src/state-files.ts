/**
 * Small records scenario runs share with rigd and with each other, kept
 * as files under `state/rigd/` because every run is its own process.
 *
 * The fault file is armed by a scenario (S17) and taken by the daemon's
 * webhook forwarder, which answers the next call event itself. Taking is a
 * rename, so two forwards can never both take one fault.
 *
 * The hand-off file is S28's number, left for S29.
 *
 * A lane hold is a run's claim on a device while it prepares outside a lease.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LaneHolds } from "./runner.ts";
import type { HandoffApi, NumberHandoff } from "./scenarios/context.ts";

const FAULT_MAX_AGE_MS = 15 * 60 * 1000;

interface ArmedFault {
  status: number;
  armed_at: number;
}

export class FaultFile {
  readonly #path: string;
  readonly #now: () => number;

  constructor(dir: string, now: () => number = Date.now) {
    mkdirSync(dir, { recursive: true });
    this.#path = join(dir, "next-call-event.json");
    this.#now = now;
  }

  arm(status: number): void {
    if (!Number.isInteger(status) || status < 500 || status > 599) throw new Error("faults: only a 5xx can be armed");
    writeAtomic(this.#path, { status, armed_at: this.#now() } satisfies ArmedFault);
  }

  disarm(): void {
    rmSync(this.#path, { force: true });
  }

  /** The armed status, at most once; a fault no event took within a lease's length is dropped. */
  take(): number | undefined {
    const claimed = `${this.#path}.${process.pid}.taken`;
    try {
      renameSync(this.#path, claimed);
    } catch {
      return undefined;
    }
    try {
      const fault = JSON.parse(readFileSync(claimed, "utf8")) as ArmedFault;
      return this.#now() - fault.armed_at <= FAULT_MAX_AGE_MS ? fault.status : undefined;
    } catch {
      return undefined;
    } finally {
      rmSync(claimed, { force: true });
    }
  }
}

const HANDOFF_STATES: readonly NumberHandoff["state"][] = ["bought", "handed_off", "taken"];

export class HandoffFile implements HandoffApi {
  readonly #path: string;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.#path = join(dir, "number-handoff.json");
  }

  async read(): Promise<NumberHandoff | null> {
    let parsed: Partial<NumberHandoff>;
    try {
      parsed = JSON.parse(readFileSync(this.#path, "utf8")) as Partial<NumberHandoff>;
    } catch {
      return null;
    }
    const complete =
      typeof parsed.tenant === "string" &&
      typeof parsed.run_id === "string" &&
      typeof parsed.telnyx_phone_number_id === "string" &&
      typeof parsed.phone_number_id === "string" &&
      typeof parsed.bought_at === "string" &&
      HANDOFF_STATES.includes(parsed.state as NumberHandoff["state"]);
    return complete ? (parsed as NumberHandoff) : null;
  }

  async write(record: NumberHandoff): Promise<void> {
    // Telnyx ids are digits too, so the plus sign is what tells an E.164 apart.
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(record.telnyx_phone_number_id)) {
      throw new Error("handoff: the record names a Telnyx id, never a number");
    }
    writeAtomic(this.#path, record);
  }

  async clear(): Promise<void> {
    rmSync(this.#path, { force: true });
  }
}

interface LaneHold {
  scenario: string;
  run_id: string;
  until: number;
}

/** One file per held lane; a hold past its `until` is no hold. */
export class LaneHoldFile implements LaneHolds {
  readonly #dir: string;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.#dir = dir;
  }

  holder(lane: string, now: number): { scenario: string; run_id: string } | undefined {
    const hold = this.#read(lane);
    return hold && hold.until > now ? { scenario: hold.scenario, run_id: hold.run_id } : undefined;
  }

  claim(lane: string, holder: { scenario: string; run_id: string }, until: number): void {
    writeAtomic(this.#path(lane), { ...holder, until } satisfies LaneHold);
  }

  /** Only the holding run's release counts, so a late one cannot free a lane another run took since. */
  release(lane: string, runId: string): void {
    if (this.#read(lane)?.run_id === runId) rmSync(this.#path(lane), { force: true });
  }

  #read(lane: string): LaneHold | undefined {
    try {
      return JSON.parse(readFileSync(this.#path(lane), "utf8")) as LaneHold;
    } catch {
      return undefined;
    }
  }

  #path(lane: string): string {
    if (!/^[a-z]+$/.test(lane)) throw new Error("holds: a lane is a lower-case word");
    return join(this.#dir, `${lane}.json`);
  }
}

function writeAtomic(path: string, value: unknown): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value));
  renameSync(temp, path);
}
