/**
 * The run lease: one paid scenario at a time across the
 * whole system, held at the guard, acquired with POST /g/lease and released
 * with DELETE /g/lease/<id>.
 *
 * A scenario registers an undo for every change it makes to shared state (an
 * audience it widened, a flag it set, a STOP it sent), and releasing runs them,
 * newest first. Scenario runs are their own processes, so the undos are named
 * actions written to a journal file per lease rather than closures: if a run
 * dies or hangs, rigd's watchdog finds the lease still open after
 * LEASE_MAX_MS, takes it over and runs the same undos itself.
 *
 * Taking over is a rename. The owner releasing and the watchdog reaping each
 * claim the journal by renaming it first, and only one rename can win.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EDGE_PATHS, GUARD_ROUTES, LEASE_MAX_MS, type GuardRefusal, type LeaseGrant } from "@loonext/rig-protocol";
import { GuardRefusedError, systemClock, type Clock } from "@loonext/rig-robot";

export interface UndoAction {
  /** A handler name, e.g. `robot.sms`. */
  kind: string;
  params: Record<string, unknown>;
}

export type UndoHandlers = Record<string, (params: Record<string, unknown>) => Promise<void>>;

const LOCAL_PREFIX = "local-";

export interface JournalEntry {
  lease_id: string;
  scenario: string;
  acquired_at: number;
  expires_at: string;
  pid: number;
  undo: UndoAction[];
}

export interface ReleaseResult {
  lease_id: string;
  /** The watchdog took the lease first; this run's undos already ran or are running. */
  reaped: boolean;
  undone: number;
  failed: { kind: string; error: string }[];
}

/** Another paid scenario holds the lease. */
export class LeaseBusyError extends Error {
  constructor() {
    super("the run lease is held by another scenario");
    this.name = "LeaseBusyError";
  }
}

/** The watchdog reaped this lease; the run must stop changing anything. */
export class LeaseReapedError extends Error {
  constructor(id: string) {
    super(`lease ${id} was reaped after ${LEASE_MAX_MS / 60_000} minutes`);
    this.name = "LeaseReapedError";
  }
}

export interface LeaseClientOptions {
  edgeOrigin: string;
  /** A guard caller token. */
  token: string;
  stateDir: string;
  handlers: UndoHandlers;
  fetch?: typeof fetch;
  clock?: Clock;
}

export class LeaseClient {
  readonly #o: LeaseClientOptions;
  readonly #fetch: typeof fetch;
  readonly #clock: Clock;
  readonly #dir: string;

  constructor(options: LeaseClientOptions) {
    this.#o = options;
    this.#fetch = options.fetch ?? fetch;
    this.#clock = options.clock ?? systemClock;
    this.#dir = join(options.stateDir, "leases");
    mkdirSync(this.#dir, { recursive: true });
  }

  get dir(): string {
    return this.#dir;
  }

  async acquire(scenario: string): Promise<Lease> {
    const response = await this.#fetch(this.#url(), {
      method: "POST",
      headers: { authorization: `Bearer ${this.#o.token}`, "content-type": "application/json" },
      body: JSON.stringify({ scenario }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 409) throw new LeaseBusyError();
    const body = (await response.json().catch(() => undefined)) as Partial<LeaseGrant & GuardRefusal> | undefined;
    if (!response.ok) throw new GuardRefusedError(response.status, body?.rule ?? `lease_${response.status}`);
    if (!body?.lease_id || !body.expires_at) throw new Error("lease: the guard returned no lease id");
    const entry: JournalEntry = {
      lease_id: body.lease_id,
      scenario,
      acquired_at: this.#clock.now(),
      expires_at: body.expires_at,
      pid: process.pid,
      undo: [],
    };
    writeAtomic(this.#path(entry.lease_id), entry);
    return new Lease(this, entry);
  }

  /**
   * A lease for a run that dials nothing: the same undo journal and watchdog,
   * no guard. Texts need no lease at the guard, but their state changes still
   * need undoing.
   */
  acquireLocal(scenario: string): Lease {
    const entry: JournalEntry = {
      lease_id: `${LOCAL_PREFIX}${randomBytes(8).toString("hex")}`,
      scenario,
      acquired_at: this.#clock.now(),
      expires_at: new Date(this.#clock.now() + LEASE_MAX_MS).toISOString(),
      pid: process.pid,
      undo: [],
    };
    writeAtomic(this.#path(entry.lease_id), entry);
    return new Lease(this, entry);
  }

  /** DELETE at the guard. A lease the guard already expired is released. */
  async deleteAtGuard(leaseId: string): Promise<void> {
    if (leaseId.startsWith(LOCAL_PREFIX)) return;
    const response = await this.#fetch(this.#url(leaseId), {
      method: "DELETE",
      headers: { authorization: `Bearer ${this.#o.token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok && response.status !== 404) throw new Error(`lease: release returned ${response.status}`);
  }

  /** Runs a journal's undos newest first; one failing does not stop the rest. */
  async runUndo(entry: JournalEntry): Promise<Omit<ReleaseResult, "reaped" | "lease_id">> {
    const failed: ReleaseResult["failed"] = [];
    let undone = 0;
    for (const action of [...entry.undo].reverse()) {
      const handler = this.#o.handlers[action.kind];
      try {
        if (!handler) throw new Error("no handler for this undo");
        await handler(action.params);
        undone++;
      } catch (error) {
        failed.push({ kind: action.kind, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { undone, failed };
  }

  /** Claims, undoes, releases and forgets a journal; `suffix` says who claimed it. */
  async finish(leaseId: string, from: string, suffix: "releasing" | "reaping"): Promise<ReleaseResult | undefined> {
    const claimed = this.#path(leaseId, suffix);
    try {
      renameSync(from, claimed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    const entry = JSON.parse(readFileSync(claimed, "utf8")) as JournalEntry;
    const result = await this.runUndo(entry);
    await this.deleteAtGuard(leaseId);
    rmSync(claimed, { force: true });
    return { lease_id: leaseId, reaped: suffix === "reaping", ...result };
  }

  path(leaseId: string, suffix?: string): string {
    return this.#path(leaseId, suffix);
  }

  #path(leaseId: string, suffix?: string): string {
    const safe = leaseId.replace(/[^A-Za-z0-9_-]/g, "_");
    return join(this.#dir, suffix ? `${safe}.${suffix}.json` : `${safe}.json`);
  }

  #url(leaseId?: string): string {
    const base = `${this.#o.edgeOrigin.replace(/\/+$/, "")}${EDGE_PATHS.guardPrefix}${GUARD_ROUTES.lease}`;
    return leaseId ? `${base}/${encodeURIComponent(leaseId)}` : base;
  }
}

export class Lease {
  readonly #client: LeaseClient;
  readonly #entry: JournalEntry;
  #released = false;

  constructor(client: LeaseClient, entry: JournalEntry) {
    this.#client = client;
    this.#entry = entry;
  }

  get id(): string {
    return this.#entry.lease_id;
  }

  get scenario(): string {
    return this.#entry.scenario;
  }

  /** Records an undo before the change it reverses, so a crash between the two still undoes. */
  registerUndo(action: UndoAction): void {
    if (this.#released) throw new Error(`lease ${this.id} is already released`);
    const path = this.#client.path(this.id);
    let current: JournalEntry;
    try {
      current = JSON.parse(readFileSync(path, "utf8")) as JournalEntry;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new LeaseReapedError(this.id);
      throw error;
    }
    current.undo.push({ kind: action.kind, params: action.params });
    writeAtomic(path, current);
    this.#entry.undo = current.undo;
  }

  async release(): Promise<ReleaseResult> {
    if (this.#released) throw new Error(`lease ${this.id} is already released`);
    this.#released = true;
    const finished = await this.#client.finish(this.id, this.#client.path(this.id), "releasing");
    return finished ?? { lease_id: this.id, reaped: true, undone: 0, failed: [] };
  }
}

export interface WatchdogOptions {
  client: LeaseClient;
  clock?: Clock;
  /** Called for each lease reaped, so it can be reported. */
  onReap?: (result: ReleaseResult, entry: JournalEntry) => void;
  log?: (line: string) => void;
}

/**
 * rigd's half of the lease: any journal still open after LEASE_MAX_MS is
 * reaped. A claimed journal left behind by a process that died mid-release is
 * finished too, once it is older than a lease could ever be.
 */
export class LeaseWatchdog {
  readonly #o: WatchdogOptions;
  readonly #clock: Clock;
  #cancel: (() => void) | undefined;

  constructor(options: WatchdogOptions) {
    this.#o = options;
    this.#clock = options.clock ?? systemClock;
  }

  async sweep(): Promise<ReleaseResult[]> {
    const { client } = this.#o;
    const now = this.#clock.now();
    const reaped: ReleaseResult[] = [];
    for (const name of readdirSync(client.dir)) {
      if (!name.endsWith(".json")) continue;
      const from = join(client.dir, name);
      const parts = name.slice(0, -".json".length).split(".");
      const leaseId = parts[0]!;
      let entry: JournalEntry;
      try {
        entry = JSON.parse(readFileSync(from, "utf8")) as JournalEntry;
      } catch {
        continue;
      }
      const open = parts.length === 1;
      const age = now - entry.acquired_at;
      const stale = open ? age > LEASE_MAX_MS : now - statSync(from).mtimeMs > 2 * LEASE_MAX_MS;
      if (!stale) continue;
      try {
        const result = await client.finish(leaseId, from, "reaping");
        if (!result) continue;
        this.#o.log?.(`lease ${leaseId} (${entry.scenario}) reaped: ${result.undone} undone, ${result.failed.length} failed`);
        this.#o.onReap?.(result, entry);
        reaped.push(result);
      } catch (error) {
        this.#o.log?.(`lease ${leaseId}: reaping failed (${error instanceof Error ? error.message : "error"}); next sweep retries`);
      }
    }
    return reaped;
  }

  start(intervalMs = 30_000): void {
    const tick = () => {
      void this.sweep().finally(() => {
        this.#cancel = this.#clock.after(intervalMs, tick);
      });
    };
    tick();
  }

  stop(): void {
    this.#cancel?.();
  }
}

function writeAtomic(path: string, value: unknown): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value));
  renameSync(temp, path);
}
