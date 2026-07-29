/**
 * #339 — the app-version header, which is attacker-controlled and feeds a
 * column with a CHECK constraint.
 *
 * The property that matters is not "parses versions correctly". It is that
 * NOTHING a caller can put in this header changes the outcome of their request.
 * A value that reached the database unvalidated would let anyone take down
 * their own authenticated requests with a string — and a value that parsed too
 * generously would let a client claim a version it does not have and exempt
 * itself from every floor.
 */
import type { Context } from "hono";
import { describe, expect, it } from "vitest";

import type { AppEnv } from "../context";
import { requestAppVersion, requestClient } from "./request-origin";

/** The slice of Context this reads: one header lookup. */
function ctx(headers: Record<string, string>): Context<AppEnv> {
  return {
    req: {
      header: (name: string) => headers[name] ?? headers[name.toLowerCase()],
    },
  } as unknown as Context<AppEnv>;
}

describe("requestAppVersion", () => {
  it("takes a well-formed version", () => {
    expect(requestAppVersion(ctx({ "X-App-Version": "1.4.0" }))).toBe("1.4.0");
    expect(requestAppVersion(ctx({ "X-App-Version": "2" }))).toBe("2");
    expect(requestAppVersion(ctx({ "X-App-Version": "1.2.3.4" }))).toBe("1.2.3.4");
  });

  it("trims, because a stray space is a client bug and not a lie", () => {
    expect(requestAppVersion(ctx({ "X-App-Version": " 1.4.0 " }))).toBe("1.4.0");
  });

  it("is null for a build that predates the header", () => {
    // Day one, this is nearly everybody — and that population is the number
    // the whole feature exists to watch fall, so it is a bucket, not an error.
    expect(requestAppVersion(ctx({}))).toBeNull();
    expect(requestAppVersion(ctx({ "X-App-Version": "" }))).toBeNull();
    expect(requestAppVersion(ctx({ "X-App-Version": "   " }))).toBeNull();
  });

  it("refuses anything the database column would refuse", () => {
    // Each of these would raise a check_violation inside api_authorize_request
    // and turn one person's header into one person's outage.
    for (const bad of [
      "1.4.0-beta",
      "v1.4.0",
      "1.4.0; drop table users",
      "99999",           // segment too long
      "1.2.3.4.5",       // too many segments
      "latest",
      "1..2",
      "-1.0.0",
    ]) {
      expect(requestAppVersion(ctx({ "X-App-Version": bad })), bad).toBeNull();
    }
  });

  it("does not read the version from anywhere a caller does not control", () => {
    // Sanity: it is exactly one header, not a user-agent inference. A guessed
    // version would be worse than none — it would look like data.
    expect(
      requestAppVersion(ctx({ "User-Agent": "Loonext/1.4.0 okhttp/4.12" })),
    ).toBeNull();
  });
});

describe("requestClient still answers alongside it", () => {
  it("prefers the declared client and falls back to the user agent", () => {
    expect(requestClient(ctx({ "X-Client": "ios" }))).toBe("ios");
    expect(requestClient(ctx({ "User-Agent": "okhttp/4.12" }))).toBe("android");
  });
});
