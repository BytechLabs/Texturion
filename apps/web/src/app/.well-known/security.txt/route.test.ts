import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dynamic, GET } from "./route";

/**
 * RFC 9116 guards for /.well-known/security.txt: the two REQUIRED fields
 * (Contact, Expires) plus our Canonical/Policy/Preferred-Languages, served as
 * text/plain with a 1-day cache and an Expires computed at request time.
 */

const NOW = Date.UTC(2026, 6, 7, 12, 0, 0); // 2026-07-07T12:00:00Z
const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

async function fetchSecurityTxt() {
  const res = GET();
  return { res, body: await res.text() };
}

describe("GET /.well-known/security.txt", () => {
  it("serves text/plain with a 1-day immutable cache", async () => {
    const { res } = await fetchSecurityTxt();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=86400, immutable",
    );
  });

  it("carries the required and chosen RFC 9116 fields", async () => {
    const { body } = await fetchSecurityTxt();
    expect(body).toContain("Contact: mailto:security@loonext.com");
    expect(body).toContain("Policy: https://loonext.com/security");
    expect(body).toContain(
      "Canonical: https://loonext.com/.well-known/security.txt",
    );
    expect(body).toContain("Preferred-Languages: en");
    expect(body).toMatch(/^Expires: /m);
    // Nothing we don't publish: no PGP key, no ack page, no em-dashes.
    expect(body).not.toMatch(/Encryption|Acknowledgments|—|–/);
  });

  it("computes Expires at request time as now + 180 days, in RFC 3339 format", async () => {
    const { body } = await fetchSecurityTxt();
    const line = body.split("\n").find((l) => l.startsWith("Expires: "));
    expect(line).toBeDefined();
    const stamp = (line as string).slice("Expires: ".length);
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Date.parse(stamp)).toBe(NOW + 180 * DAY_MS);

    // Not frozen at module load: a later request gets a later Expires.
    vi.setSystemTime(NOW + 30 * DAY_MS);
    const { body: later } = await fetchSecurityTxt();
    expect(later).toContain(
      `Expires: ${new Date(NOW + 210 * DAY_MS).toISOString()}`,
    );
  });

  it("opts out of build-time prerendering so Expires can never go stale", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("ends with a trailing newline (plain-text file convention)", async () => {
    const { body } = await fetchSecurityTxt();
    expect(body.endsWith("\n")).toBe(true);
  });
});
