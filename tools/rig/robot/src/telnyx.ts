/**
 * Telnyx Call Control and Messaging for the robot, always through the guard:
 * the base is the edge's `/g/telnyx`, and the bearer is the robot's caller
 * token, never a Telnyx key. Command bodies follow the v2 API
 * (developers.telnyx.com, the spec in telnyx-spec3.json): dial is
 * `POST /v2/calls`, every leg command `POST /v2/calls/<id>/actions/<name>`.
 */
import { EDGE_PATHS, GUARD_ROUTES, HEADER, type GuardRefusal } from "@loonext/rig-protocol";

export interface CallIds {
  call_control_id: string;
  call_leg_id: string;
  call_session_id: string;
}

export interface DialCommand {
  connection_id: string;
  from: string;
  to: string;
  timeout_secs?: number;
  time_limit_secs?: number;
  answering_machine_detection?: "detect_beep" | "disabled";
  client_state?: string;
  command_id?: string;
}

export interface PlaybackCommand {
  audio_url?: string;
  /** Base64 WAV, when no URL is served. */
  playback_content?: string;
  audio_type?: "wav" | "mp3";
  loop?: number | "infinity";
  target_legs?: "self" | "opposite" | "both";
}

export interface RecordCommand {
  format: "wav" | "mp3";
  channels: "single" | "dual";
  recording_track?: "both" | "inbound" | "outbound";
  max_length?: number;
}

export interface GatherCommand {
  minimum_digits?: number;
  maximum_digits?: number;
  timeout_millis?: number;
  inter_digit_timeout_millis?: number;
  terminating_digit?: string;
  valid_digits?: string;
  gather_id?: string;
}

export interface SpeakCommand {
  payload: string;
  voice: string;
  language?: string;
  payload_type?: "text";
}

/** Context every request carries to the guard: the run lease and the scenario. */
export interface RequestContext {
  lease?: string;
  scenario?: string;
}

export interface CallControlApi {
  dial(command: DialCommand, context: RequestContext): Promise<CallIds>;
  answer(id: string, body: { client_state?: string; command_id?: string }, context: RequestContext): Promise<void>;
  reject(id: string, cause: "CALL_REJECTED" | "USER_BUSY", context: RequestContext): Promise<void>;
  playbackStart(id: string, command: PlaybackCommand, context: RequestContext): Promise<void>;
  playbackStop(id: string, context: RequestContext): Promise<void>;
  recordStart(id: string, command: RecordCommand, context: RequestContext): Promise<void>;
  gather(id: string, command: GatherCommand, context: RequestContext): Promise<void>;
  speak(id: string, command: SpeakCommand, context: RequestContext): Promise<void>;
  sendDtmf(id: string, digits: string, context: RequestContext): Promise<void>;
  hangup(id: string, context: RequestContext): Promise<void>;
  listRecordings(filter: { call_leg_id: string }, context: RequestContext): Promise<{ id: string }[]>;
  deleteRecording(id: string, context: RequestContext): Promise<void>;
  sendMessage(
    message: { from: string; to: string; text: string; media_urls?: string[] },
    context: RequestContext,
  ): Promise<{ id: string }>;
}

/** The guard said no: a policy rule, not a Telnyx error. */
export class GuardRefusedError extends Error {
  readonly status: number;
  readonly rule: string;
  constructor(status: number, rule: string) {
    super(`guard refused (${status}): ${rule}`);
    this.name = "GuardRefusedError";
    this.status = status;
    this.rule = rule;
  }
}

export class TelnyxApiError extends Error {
  readonly status: number;
  /** Telnyx's error codes, never its detail text, which can quote a number back. */
  readonly codes: string[];
  constructor(status: number, path: string, codes: string[]) {
    super(`Telnyx ${status} on ${path}${codes.length ? ` (${codes.join(", ")})` : ""}`);
    this.name = "TelnyxApiError";
    this.status = status;
    this.codes = codes;
  }
}

export interface GuardedTelnyxOptions {
  edgeOrigin: string;
  /** The robot's guard caller token. */
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function telnyxBase(edgeOrigin: string): string {
  return `${edgeOrigin.replace(/\/+$/, "")}${EDGE_PATHS.guardPrefix}${GUARD_ROUTES.telnyx}`;
}

export class GuardedTelnyx implements CallControlApi {
  readonly #base: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(options: GuardedTelnyxOptions) {
    this.#base = telnyxBase(options.edgeOrigin);
    this.#token = options.token;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
  }

  async dial(command: DialCommand, context: RequestContext): Promise<CallIds> {
    const data = (await this.#request("POST", "/v2/calls", command, context)) as Partial<CallIds>;
    if (!data.call_control_id || !data.call_leg_id || !data.call_session_id) {
      throw new Error("dial: Telnyx returned no call ids");
    }
    return {
      call_control_id: data.call_control_id,
      call_leg_id: data.call_leg_id,
      call_session_id: data.call_session_id,
    };
  }

  async answer(id: string, body: { client_state?: string; command_id?: string }, context: RequestContext) {
    await this.#action(id, "answer", body, context);
  }

  async reject(id: string, cause: "CALL_REJECTED" | "USER_BUSY", context: RequestContext) {
    await this.#action(id, "reject", { cause }, context);
  }

  async playbackStart(id: string, command: PlaybackCommand, context: RequestContext) {
    await this.#action(id, "playback_start", command, context);
  }

  async playbackStop(id: string, context: RequestContext) {
    await this.#action(id, "playback_stop", { stop: "all" }, context);
  }

  async recordStart(id: string, command: RecordCommand, context: RequestContext) {
    await this.#action(id, "record_start", command, context);
  }

  async gather(id: string, command: GatherCommand, context: RequestContext) {
    await this.#action(id, "gather", command, context);
  }

  async speak(id: string, command: SpeakCommand, context: RequestContext) {
    await this.#action(id, "speak", command, context);
  }

  async sendDtmf(id: string, digits: string, context: RequestContext) {
    await this.#action(id, "send_dtmf", { digits }, context);
  }

  async hangup(id: string, context: RequestContext) {
    await this.#action(id, "hangup", {}, context);
  }

  async listRecordings(filter: { call_leg_id: string }, context: RequestContext) {
    const query = `filter[call_leg_id]=${encodeURIComponent(filter.call_leg_id)}`;
    const data = await this.#request("GET", `/v2/recordings?${query}`, undefined, context);
    return Array.isArray(data) ? data.filter(hasId) : [];
  }

  async deleteRecording(id: string, context: RequestContext) {
    await this.#request("DELETE", `/v2/recordings/${encodeURIComponent(id)}`, undefined, context);
  }

  async sendMessage(message: { from: string; to: string; text: string; media_urls?: string[] }, context: RequestContext) {
    const data = await this.#request("POST", "/v2/messages", message, context);
    if (!hasId(data)) throw new Error("sendMessage: Telnyx returned no message id");
    return { id: data.id };
  }

  async #action(id: string, name: string, body: object, context: RequestContext) {
    await this.#request("POST", `/v2/calls/${encodeURIComponent(id)}/actions/${name}`, body, context);
  }

  async #request(method: string, path: string, body: unknown, context: RequestContext): Promise<unknown> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.#token}` };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (context.lease) headers[HEADER.lease] = context.lease;
    if (context.scenario) headers[HEADER.scenario] = context.scenario;
    const response = await this.#fetch(`${this.#base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    const text = await response.text();
    const json = text ? safeJson(text) : undefined;
    if (response.headers.get(HEADER.refusedBy)) {
      const rule = (json as Partial<GuardRefusal> | undefined)?.rule ?? "unknown";
      throw new GuardRefusedError(response.status, rule);
    }
    if (!response.ok) {
      const errors = (json as { errors?: { code?: unknown }[] } | undefined)?.errors ?? [];
      throw new TelnyxApiError(response.status, path.split("?")[0]!, errors.map((e) => String(e.code ?? "")).filter(Boolean));
    }
    return (json as { data?: unknown } | undefined)?.data;
  }
}

function hasId(value: unknown): value is { id: string } {
  return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string";
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
