/**
 * The edge sits in the production Cloudflare account, so a page a browser
 * would render, or a cookie it would keep, is a Trust and Safety risk to
 * production. Every response, whoever produced it, gets a sandbox CSP and
 * `nosniff` and loses any `set-cookie`, and a markup type relayed from the
 * guard or the rig is downgraded to opaque bytes.
 */
const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

/** Types a browser would parse as a document or run as script. */
const RENDERABLE = /html|xml|svg|javascript|ecmascript/i;

export function safeContentType(type: string | null): string {
  if (!type || RENDERABLE.test(type)) return "application/octet-stream";
  return type;
}

export function empty(status: number): Response {
  return new Response(null, { status });
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The response with the edge's headers applied, its body and socket untouched. */
export function harden(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  if (headers.has("content-type")) {
    headers.set("content-type", safeContentType(headers.get("content-type")));
  }
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  if (response.status === 101) {
    return new Response(null, { status: 101, headers, webSocket: response.webSocket });
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * True for the hosts the edge answers on: its workers.dev name, and loopback
 * for `wrangler dev`. Never loonext.com or a subdomain of it, so a route or
 * custom domain added in the dashboard by mistake serves nothing.
 */
export function servesHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "loonext.com" || host.endsWith(".loonext.com")) return false;
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return true;
  return host.endsWith(".workers.dev");
}

/** A 2xx-5xx status, or 502 for anything a peer should not have sent. */
export function relayStatus(status: unknown): number {
  return typeof status === "number" && Number.isInteger(status) && status >= 200 && status <= 599
    ? status
    : 502;
}

/** At most `limit` bytes of a request body, or null when it is larger. */
export async function boundedText(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) return null;
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > limit) return null;
  return new TextDecoder().decode(bytes);
}
