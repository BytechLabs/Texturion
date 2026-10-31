import { MEDIA_MAX_BYTES } from "@loonext/rig-protocol";
import { describe, expect, it } from "vitest";
import { mediaRelay, storageUrlFor } from "./media.ts";
import { fakeFetch } from "./test-support.ts";

const SUPABASE = "http://127.0.0.1:54321";
const SIGNED = "/m/object/sign/mms-media/company-a/photo.jpg?token=signed.jwt.value";

describe("storageUrlFor", () => {
  it("maps a signed media path to the same signed URL on local storage", () => {
    expect(storageUrlFor(SUPABASE, SIGNED)).toEqual({
      url: `${SUPABASE}/storage/v1/object/sign/mms-media/company-a/photo.jpg?token=signed.jwt.value`,
    });
    expect(storageUrlFor(SUPABASE, "object/sign/voicemail-greetings/c/g.mp3?token=t")).toEqual({
      url: `${SUPABASE}/storage/v1/object/sign/voicemail-greetings/c/g.mp3?token=t`,
    });
  });

  it("takes the path as the edge sends it: relative to /storage/v1, with storage's own download flag", () => {
    expect(storageUrlFor(SUPABASE, "/object/sign/mms-media/c/p.jpg?token=t&download=p.jpg")).toEqual({
      url: `${SUPABASE}/storage/v1/object/sign/mms-media/c/p.jpg?token=t&download=p.jpg`,
    });
  });

  it.each([
    ["another bucket", "/m/object/sign/voicemails/c/v.wav?token=t", 404],
    ["a public object path", "/m/object/public/mms-media/c/p.jpg", 404],
    ["an authenticated path", "/m/object/authenticated/mms-media/c/p.jpg?token=t", 404],
    ["no token", "/m/object/sign/mms-media/c/p.jpg", 403],
    ["an extra parameter", "/m/object/sign/mms-media/c/p.jpg?token=t&cache=1", 403],
    ["two tokens", "/object/sign/mms-media/c/p.jpg?token=t&token=u", 403],
    ["a climb out of the bucket", "/m/object/sign/mms-media/../voicemails/v.wav?token=t", 400],
    ["an encoded climb", "/m/object/sign/mms-media/c/%2e%2e/x?token=t", 400],
    ["a bad escape", "/m/object/sign/mms-media/c/%E0%A4%A?token=t", 400],
  ])("refuses %s", (_name, path, status) => {
    expect(storageUrlFor(SUPABASE, path)).toEqual({ status });
  });
});

describe("mediaRelay", () => {
  it("relays the object as base64 with its content type", async () => {
    const { fetch, requests } = fakeFetch({
      [`GET ${SUPABASE}/storage/v1/object/sign/`]: () =>
        new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg", "content-length": "3" } }),
    });
    const result = await mediaRelay({ supabaseUrl: SUPABASE, fetch })({ t: "media", id: "m1", path: SIGNED });
    expect(result).toEqual({ status: 200, content_type: "image/jpeg", body_b64: "AQID" });
    expect(requests).toHaveLength(1);
  });

  it("refuses an object over the size cap, by header or by counting", async () => {
    const big = new Uint8Array(MEDIA_MAX_BYTES + 1);
    const declared = fakeFetch({ GET: () => new Response(big, { headers: { "content-length": String(big.length) } }) });
    expect(await mediaRelay({ supabaseUrl: SUPABASE, fetch: declared.fetch })({ t: "media", id: "m", path: SIGNED })).toEqual({ status: 413 });
    const streamed = fakeFetch({
      GET: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(big);
              controller.close();
            },
          }),
        ),
    });
    expect(await mediaRelay({ supabaseUrl: SUPABASE, fetch: streamed.fetch })({ t: "media", id: "m", path: SIGNED })).toEqual({ status: 413 });
  });

  it("passes storage's refusal on, and never fetches a path it refused", async () => {
    const expired = fakeFetch({ GET: () => new Response("bad token", { status: 400 }) });
    expect(await mediaRelay({ supabaseUrl: SUPABASE, fetch: expired.fetch })({ t: "media", id: "m", path: SIGNED })).toEqual({ status: 403 });
    const never = fakeFetch({});
    expect(await mediaRelay({ supabaseUrl: SUPABASE, fetch: never.fetch })({ t: "media", id: "m", path: "/m/object/public/mms-media/x" })).toEqual({ status: 404 });
    expect(never.requests).toEqual([]);
  });
});
