/**
 * Telnyx's fetches of MMS media and greetings, served from the rig's local
 * storage through the uplink: signed URLs only, MEDIA_BUCKETS only, at most
 * MEDIA_MAX_BYTES.
 *
 * The app hands Telnyx `<edge>/m/object/sign/<bucket>/<path>?token=...`, its
 * storage URL with the storage prefix swapped for the edge's media path
 * (apps/api/src/telnyx/client.ts, telnyxMediaUrl). The edge checks the token's
 * readable claims and sends the path relative to `/storage/v1`, query string
 * included. The relay passes on only that shape, and storage itself checks the
 * token's signature, so a path without a valid one reads nothing.
 */
import { EDGE_PATHS, MEDIA_BUCKETS, MEDIA_MAX_BYTES } from "@loonext/rig-protocol";
import type { MediaFrame, MediaResult } from "./uplink.ts";

export interface MediaRelayOptions {
  /** Local Supabase, e.g. http://127.0.0.1:54321; a function when it is found at fetch time. */
  supabaseUrl: string | (() => string);
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const SIGNED = /^object\/sign\/([a-z0-9-]+)\/(.+)$/;

/** The storage URL a media path stands for, or a refusal status. */
export function storageUrlFor(supabaseUrl: string, framePath: string): { url: string } | { status: number } {
  let path = framePath;
  if (path.startsWith(EDGE_PATHS.mediaPrefix)) path = path.slice(EDGE_PATHS.mediaPrefix.length);
  else if (path.startsWith("/")) path = path.slice(1);
  let parsed: URL;
  try {
    parsed = new URL(path, "http://relay.invalid/");
  } catch {
    return { status: 400 };
  }
  // Parsing folds `..` and `.` away; a path that changed under parsing tried to climb.
  if (parsed.pathname !== `/${path.split("?")[0]}`) return { status: 400 };
  const relative = parsed.pathname.slice(1);
  const match = SIGNED.exec(relative);
  if (!match) return { status: 404 };
  const [, bucket, object] = match;
  if (!(MEDIA_BUCKETS as readonly string[]).includes(bucket!)) return { status: 404 };
  let decoded: string;
  try {
    decoded = decodeURIComponent(object!);
  } catch {
    return { status: 400 };
  }
  if (/(^|\/)\.\.?(\/|$)/.test(decoded)) return { status: 400 };
  // The edge passes `token` and storage's own `download`; nothing else.
  const token = parsed.searchParams.get("token");
  const keys = [...parsed.searchParams.keys()];
  if (!token || parsed.searchParams.getAll("token").length !== 1 || keys.some((key) => key !== "token" && key !== "download")) {
    return { status: 403 };
  }
  const download = parsed.searchParams.get("download");
  const base = supabaseUrl.replace(/\/+$/, "");
  const query = `token=${encodeURIComponent(token)}${download === null ? "" : `&download=${encodeURIComponent(download)}`}`;
  return { url: `${base}/storage/v1/object/sign/${bucket}/${object}?${query}` };
}

export function mediaRelay(options: MediaRelayOptions) {
  const doFetch = options.fetch ?? fetch;
  return async (frame: MediaFrame): Promise<MediaResult> => {
    let base: string;
    try {
      base = typeof options.supabaseUrl === "function" ? options.supabaseUrl() : options.supabaseUrl;
    } catch {
      return { status: 503 };
    }
    const target = storageUrlFor(base, frame.path);
    if ("status" in target) return { status: target.status };
    let response: Response;
    try {
      response = await doFetch(target.url, {
        redirect: "error",
        signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
      });
    } catch {
      return { status: 502 };
    }
    if (!response.ok) {
      await response.body?.cancel();
      return { status: response.status === 400 ? 403 : response.status };
    }
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MEDIA_MAX_BYTES) {
      await response.body?.cancel();
      return { status: 413 };
    }
    const body = await readCapped(response, MEDIA_MAX_BYTES);
    if (!body) return { status: 413 };
    return {
      status: 200,
      content_type: response.headers.get("content-type") ?? "application/octet-stream",
      body_b64: Buffer.from(body).toString("base64"),
    };
  };
}

/** The body, or undefined as soon as it passes `max` bytes. */
async function readCapped(response: Response, max: number): Promise<Uint8Array | undefined> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
