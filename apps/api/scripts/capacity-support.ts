/**
 * #251 -- helpers shared by the hosted fan-out and call-session drivers.
 *
 * Both drivers send signed carrier-shaped webhooks to a temporary deployed
 * Worker and time what comes back. Nothing here reaches any host by itself.
 */
import { readFileSync } from "node:fs";

/** The carrier key pair the temporary Worker trusts, generated per run. */
export interface SigningKeyFile {
  publicKeyB64: string;
  privateKeyPkcs8B64: string;
}

export interface Summary {
  count: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
}

export function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

export function summarize(values: number[]): Summary {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: Math.round(percentile(sorted, 0.5)),
    p90: Math.round(percentile(sorted, 0.9)),
    p99: Math.round(percentile(sorted, 0.99)),
    max: Math.round(sorted[sorted.length - 1] ?? 0),
  };
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export type Signer = (body: string) => Promise<Record<string, string>>;

/** Ed25519 over `${timestamp}|${body}`, the carrier's webhook contract. */
export async function loadSigner(path: string): Promise<Signer> {
  const file = JSON.parse(readFileSync(path, "utf8")) as SigningKeyFile;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    Buffer.from(file.privateKeyPkcs8B64, "base64"),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  return async (body) => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        { name: "Ed25519" },
        key,
        new TextEncoder().encode(`${timestamp}|${body}`),
      ),
    );
    return {
      "content-type": "application/json",
      "telnyx-signature-ed25519": Buffer.from(signature).toString("base64"),
      "telnyx-timestamp": timestamp,
    };
  };
}

export interface Ack {
  status: number;
  ms: number;
}

/** POST one signed event to the Worker's carrier webhook; status 0 is a network failure. */
export async function postSigned(apiOrigin: string, sign: Signer, event: unknown): Promise<Ack> {
  const body = JSON.stringify(event);
  const started = performance.now();
  try {
    const response = await fetch(`${apiOrigin}/webhooks/telnyx`, {
      method: "POST",
      headers: await sign(body),
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    await response.arrayBuffer();
    return { status: response.status, ms: Math.round(performance.now() - started) };
  } catch {
    return { status: 0, ms: Math.round(performance.now() - started) };
  }
}

export function countStatuses(acks: Ack[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const ack of acks) out[String(ack.status)] = (out[String(ack.status)] ?? 0) + 1;
  return out;
}
