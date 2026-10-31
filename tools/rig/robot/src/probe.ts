/**
 * Where Telnyx fetches the robot's code from when it plays it into a call.
 *
 * The rig is not on the internet, so the code WAV sits in the rig's local
 * storage and Telnyx reaches it through the edge's media relay (`/m/`), the
 * same way it fetches a greeting. Storage signs the URL (an HMAC token with an
 * expiry), the relay serves only signed URLs in MEDIA_BUCKETS, and the code is
 * a few hundred kilobytes, well under MEDIA_MAX_BYTES.
 *
 * `InlineProbe` sends the WAV in the command itself (`playback_content`) for
 * when storage or the relay is down; it needs no URL at all.
 */
import { EDGE_PATHS, MEDIA_BUCKETS, MEDIA_MAX_BYTES } from "@loonext/rig-protocol";
import { codeWav } from "./audio/generate.ts";
import type { Surface } from "./audio/surfaces.ts";
import type { PlaybackCommand } from "./telnyx.ts";

export interface ProbeSource {
  playback(surface: Surface): Promise<PlaybackCommand>;
}

/** 16 cycles, about 31 s, at 8 kHz: one pass covers the judging window, and the loop covers the rest. */
const PROBE_CYCLES = 16;
const BUCKET: (typeof MEDIA_BUCKETS)[number] = "voicemail-greetings";
const PREFIX = "rig-robot/codes";
const SIGNED_FOR_S = 60 * 60;
/** Re-sign this long before expiry, so a long call never plays a dead URL. */
const RESIGN_MARGIN_MS = 10 * 60 * 1000;

export interface StorageProbeOptions {
  /** Local Supabase, e.g. http://127.0.0.1:54321. */
  supabaseUrl: string;
  serviceRoleKey: string;
  edgeOrigin: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export class StorageProbe implements ProbeSource {
  readonly #options: StorageProbeOptions;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #uploaded = new Set<Surface>();
  readonly #signed = new Map<Surface, { url: string; expiresAt: number }>();

  constructor(options: StorageProbeOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
  }

  async playback(surface: Surface): Promise<PlaybackCommand> {
    return { audio_url: await this.url(surface), audio_type: "wav", loop: "infinity", target_legs: "self" };
  }

  async url(surface: Surface): Promise<string> {
    const cached = this.#signed.get(surface);
    if (cached && cached.expiresAt - RESIGN_MARGIN_MS > this.#now()) return cached.url;
    if (!this.#uploaded.has(surface)) await this.#upload(surface);
    const storage = `${this.#options.supabaseUrl.replace(/\/+$/, "")}/storage/v1`;
    const response = await this.#fetch(`${storage}/object/sign/${BUCKET}/${PREFIX}/${surface}.wav`, {
      method: "POST",
      headers: this.#headers({ "content-type": "application/json" }),
      body: JSON.stringify({ expiresIn: SIGNED_FOR_S }),
    });
    if (!response.ok) throw new Error(`probe: signing ${surface}.wav failed with ${response.status}`);
    const { signedURL } = (await response.json()) as { signedURL?: string };
    if (typeof signedURL !== "string" || !signedURL.startsWith("/object/sign/")) {
      throw new Error("probe: storage returned no signed URL");
    }
    // The app maps storage URLs to the relay the same way (telnyxMediaUrl).
    const url = `${this.#options.edgeOrigin.replace(/\/+$/, "")}${EDGE_PATHS.mediaPrefix}${signedURL.slice(1)}`;
    this.#signed.set(surface, { url, expiresAt: this.#now() + SIGNED_FOR_S * 1000 });
    return url;
  }

  async #upload(surface: Surface): Promise<void> {
    const wav = codeWav(surface, { sampleRate: 8_000, cycles: PROBE_CYCLES });
    if (wav.byteLength > MEDIA_MAX_BYTES) throw new Error("probe: the code is larger than the relay serves");
    const storage = `${this.#options.supabaseUrl.replace(/\/+$/, "")}/storage/v1`;
    const response = await this.#fetch(`${storage}/object/${BUCKET}/${PREFIX}/${surface}.wav`, {
      method: "POST",
      headers: this.#headers({ "content-type": "audio/wav", "x-upsert": "true" }),
      body: wav,
    });
    if (!response.ok) throw new Error(`probe: uploading ${surface}.wav failed with ${response.status}`);
    this.#uploaded.add(surface);
  }

  #headers(extra: Record<string, string>): Record<string, string> {
    const key = this.#options.serviceRoleKey;
    return { authorization: `Bearer ${key}`, apikey: key, ...extra };
  }
}

/** The code inside the command. Four cycles keeps the body near 160 kB. */
export class InlineProbe implements ProbeSource {
  readonly #cache = new Map<Surface, string>();

  async playback(surface: Surface): Promise<PlaybackCommand> {
    let content = this.#cache.get(surface);
    if (!content) {
      content = Buffer.from(codeWav(surface, { sampleRate: 8_000, cycles: 4 })).toString("base64");
      this.#cache.set(surface, content);
    }
    return { playback_content: content, audio_type: "wav", loop: "infinity", target_legs: "self" };
  }
}
