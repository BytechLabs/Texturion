import { describe, expect, it } from "vitest";

import { ApiError } from "./errors";
import { buildPage, decodeCursor, encodeCursor } from "./pagination";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const ID_C = "33333333-3333-4333-8333-333333333333";

function base64url(text: string): string {
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

describe("cursor encode/decode (SPEC §7: opaque base64url over (timestamptz, id))", () => {
  it("round-trips a sort key", () => {
    const cursor = { ts: "2026-07-01T12:34:56.789+00:00", id: ID_A };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("round-trips PostgREST microsecond timestamps and Z offsets", () => {
    const micro = { ts: "2026-07-01T18:22:33.123456+00:00", id: ID_B };
    expect(decodeCursor(encodeCursor(micro))).toEqual(micro);
    const zulu = { ts: "2026-07-01T18:22:33.123Z", id: ID_B };
    expect(decodeCursor(encodeCursor(zulu))).toEqual(zulu);
  });

  it("emits URL-safe base64 (no +, /, or padding)", () => {
    const encoded = encodeCursor({ ts: "2026-07-01T00:00:00Z", id: ID_A });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejects a tampered cursor with 422 validation_failed", () => {
    const encoded = encodeCursor({ ts: "2026-07-01T00:00:00Z", id: ID_A });
    const tampered =
      encoded.slice(0, -1) + (encoded.endsWith("A") ? "B" : "A");
    expect(() => decodeCursor(tampered)).toThrowError(ApiError);
    try {
      decodeCursor(tampered);
    } catch (error) {
      expect((error as ApiError).code).toBe("validation_failed");
    }
  });

  it("rejects non-base64 garbage", () => {
    expect(() => decodeCursor("!!!not-base64!!!")).toThrowError(ApiError);
  });

  it("rejects valid base64 of non-JSON", () => {
    expect(() => decodeCursor(base64url("hello world"))).toThrowError(ApiError);
  });

  it("rejects a wrong-shape payload (bad timestamp)", () => {
    expect(() =>
      decodeCursor(base64url(JSON.stringify({ ts: "yesterday", id: ID_A }))),
    ).toThrowError(ApiError);
  });

  it("rejects a wrong-shape payload (bad uuid)", () => {
    expect(() =>
      decodeCursor(
        base64url(JSON.stringify({ ts: "2026-07-01T00:00:00Z", id: "123" })),
      ),
    ).toThrowError(ApiError);
  });
});

describe("buildPage (SPEC §7: { data, next_cursor } from limit+1 rows)", () => {
  const rows = [
    { id: ID_A, created_at: "2026-07-01T12:00:03+00:00", body: "three" },
    { id: ID_B, created_at: "2026-07-01T12:00:02+00:00", body: "two" },
    { id: ID_C, created_at: "2026-07-01T12:00:01+00:00", body: "one" },
  ];

  it("trims to limit and points the cursor at the last returned row", () => {
    const page = buildPage(rows, 2, "created_at");
    expect(page.data).toEqual(rows.slice(0, 2));
    expect(page.next_cursor).not.toBeNull();
    expect(decodeCursor(page.next_cursor!)).toEqual({
      ts: rows[1].created_at,
      id: ID_B,
    });
  });

  it("returns next_cursor null when the page is not full past the limit", () => {
    expect(buildPage(rows, 3, "created_at")).toEqual({ data: rows, next_cursor: null });
    expect(buildPage(rows.slice(0, 1), 3, "created_at")).toEqual({
      data: rows.slice(0, 1),
      next_cursor: null,
    });
    expect(buildPage([], 3, "created_at")).toEqual({ data: [], next_cursor: null });
  });

  it("supports the conversations sort key (last_message_at)", () => {
    const conversations = [
      { id: ID_A, last_message_at: "2026-07-01T12:00:02+00:00" },
      { id: ID_B, last_message_at: "2026-07-01T12:00:01+00:00" },
    ];
    const page = buildPage(conversations, 1, "last_message_at");
    expect(page.data).toEqual([conversations[0]]);
    expect(decodeCursor(page.next_cursor!)).toEqual({
      ts: conversations[0].last_message_at,
      id: ID_A,
    });
  });

  it("rejects a non-positive limit with 422 validation_failed", () => {
    expect(() => buildPage(rows, 0, "created_at")).toThrowError(ApiError);
    expect(() => buildPage(rows, -1, "created_at")).toThrowError(ApiError);
    expect(() => buildPage(rows, 2.5, "created_at")).toThrowError(ApiError);
  });
});
