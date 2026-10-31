/**
 * The dial window the guard admits dials in. The guard measures production's
 * quietest hours monthly and publishes the first one on its /health
 * (`paid_dials.window_start_hour_utc`), refusing a dial outside them with
 * `admission.outside_window`. rigd times and admits paid runs by the same
 * window: the guard's when it answers, the last one it gave when it does not,
 * and the registry's until it ever has. `RIG_DIAL_WINDOW` overrides all three.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { EDGE_PATHS, GUARD_ROUTES } from "@loonext/rig-protocol";
import type { DialWindow } from "./budget.ts";

export interface WindowSourceOptions {
  edgeOrigin: string;
  /** A guard caller token allowed /health. */
  token: string;
  /** state/rigd/guard-window.json */
  stateFile: string;
  /** The registry's window; its length is the guard's too. */
  registry: DialWindow;
  override?: DialWindow;
  fetch?: typeof fetch;
  now?: () => number;
}

interface Cached {
  start_hour: number;
  at: string;
}

export class WindowSource {
  readonly #o: WindowSourceOptions;
  readonly #fetch: typeof fetch;

  constructor(options: WindowSourceOptions) {
    this.#o = options;
    this.#fetch = options.fetch ?? fetch;
  }

  /** The window now, asking the guard first. */
  async current(): Promise<DialWindow> {
    if (this.#o.override) return this.#o.override;
    const start = await this.#ask().catch(() => undefined);
    if (start !== undefined) {
      if (this.#cached()?.start_hour !== start) {
        const cached: Cached = { start_hour: start, at: new Date((this.#o.now ?? Date.now)()).toISOString() };
        writeFileSync(this.#o.stateFile, JSON.stringify(cached));
      }
      return { startHour: start, hours: this.#o.registry.hours };
    }
    return this.known();
  }

  /** The window without asking: the override, the guard's last answer, else the registry's. */
  known(): DialWindow {
    if (this.#o.override) return this.#o.override;
    const cached = this.#cached();
    return cached ? { startHour: cached.start_hour, hours: this.#o.registry.hours } : this.#o.registry;
  }

  async #ask(): Promise<number | undefined> {
    const url = `${this.#o.edgeOrigin.replace(/\/+$/, "")}${EDGE_PATHS.guardPrefix}${GUARD_ROUTES.health}`;
    const response = await this.#fetch(url, {
      headers: { authorization: `Bearer ${this.#o.token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { paid_dials?: { window_start_hour_utc?: unknown } };
    const start = body?.paid_dials?.window_start_hour_utc;
    return typeof start === "number" && Number.isInteger(start) && start >= 0 && start <= 23 ? start : undefined;
  }

  #cached(): Cached | undefined {
    try {
      const cached = JSON.parse(readFileSync(this.#o.stateFile, "utf8")) as Partial<Cached>;
      return typeof cached.start_hour === "number" ? (cached as Cached) : undefined;
    } catch {
      return undefined;
    }
  }
}
