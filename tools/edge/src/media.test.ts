import { MEDIA_MAX_BYTES } from "@loonext/rig-protocol";
import { beforeEach, describe, expect, it } from "vitest";

import type { Env } from "./env";
import { signedMediaPath } from "./media";
import { ORIGIN, call, connectRig, edgeEnv, fakeGuard, resetEdge } from "./test/support";

function base64Url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A Supabase-shaped signed-URL token: the edge reads its claims, never its signature. */
function token(url: string, exp = Math.floor(Date.now() / 1000) + 300): string {
  return `${base64Url('{"alg":"HS256","typ":"JWT"}')}.${base64Url(JSON.stringify({ url, exp }))}.c2lnbmF0dXJl`;
}

function mediaUrl(object: string, claim = object, exp?: number): URL {
  return new URL(`${ORIGIN}/m/object/sign/${object}?token=${token(claim, exp)}`);
}

describe("signedMediaPath", () => {
  it("relays a live signed URL for either bucket, as the storage path", () => {
    const url = mediaUrl("mms-media/qa-w/photo.jpg");
    expect(signedMediaPath(url)).toBe(`/object/sign/mms-media/qa-w/photo.jpg${url.search}`);
    expect(signedMediaPath(mediaUrl("voicemail-greetings/g.mp3"))).not.toBeNull();
  });

  it("refuses other buckets, public objects and other storage paths", () => {
    expect(signedMediaPath(mediaUrl("avatars/a.png"))).toBeNull();
    expect(signedMediaPath(new URL(`${ORIGIN}/m/object/public/mms-media/a.jpg`))).toBeNull();
    expect(signedMediaPath(new URL(`${ORIGIN}/m/bucket/mms-media`))).toBeNull();
    expect(signedMediaPath(mediaUrl("mms-media"))).toBeNull();
  });

  it("refuses a token minted for another object, an expired one, or none", () => {
    expect(signedMediaPath(mediaUrl("mms-media/a.jpg", "mms-media/b.jpg"))).toBeNull();
    expect(signedMediaPath(mediaUrl("mms-media/a.jpg", "mms-media/a.jpg", Math.floor(Date.now() / 1000) - 1))).toBeNull();
    expect(signedMediaPath(new URL(`${ORIGIN}/m/object/sign/mms-media/a.jpg`))).toBeNull();
    expect(signedMediaPath(new URL(`${ORIGIN}/m/object/sign/mms-media/a.jpg?token=not.a-jwt`))).toBeNull();
  });

  it("refuses traversal and extra query parameters", () => {
    expect(signedMediaPath(mediaUrl("mms-media/%2e%2e/secret", "mms-media/../secret"))).toBeNull();
    expect(signedMediaPath(mediaUrl("mms-media/a%2Fb.jpg", "mms-media/a/b.jpg"))).toBeNull();
    expect(signedMediaPath(mediaUrl("mms-media/a%00b.jpg", "mms-media/a\u0000b.jpg"))).toBeNull();
    expect(signedMediaPath(mediaUrl("mms-media/a%5Cb.jpg", "mms-media/a\\b.jpg"))).toBeNull();
    const extra = mediaUrl("mms-media/a.jpg");
    extra.searchParams.set("width", "100");
    expect(signedMediaPath(extra)).toBeNull();
  });
});

describe("the media relay", () => {
  let env: Env;

  beforeEach(async () => {
    await resetEdge();
    env = await edgeEnv(fakeGuard());
  });

  it("asks the rig for the object and serves its bytes", async () => {
    const rig = await connectRig(env);
    const url = mediaUrl("mms-media/qa-w/photo.jpg");
    const pending = call(new Request(url), env);
    const frame = await rig.next((f) => f.t === "media");
    expect(frame).toMatchObject({ path: `/object/sign/mms-media/qa-w/photo.jpg${url.search}` });
    rig.send({ t: "media-result", id: frame.t === "media" ? frame.id : "", status: 200, content_type: "image/jpeg", body_b64: btoa("jpeg-bytes") });
    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe("jpeg-bytes");
    rig.close();
  });

  it("serves markup as opaque bytes", async () => {
    const rig = await connectRig(env);
    const pending = call(new Request(mediaUrl("mms-media/x.svg")), env);
    const frame = await rig.next((f) => f.t === "media");
    rig.send({ t: "media-result", id: frame.t === "media" ? frame.id : "", status: 200, content_type: "image/svg+xml", body_b64: btoa("<svg/>") });
    const response = await pending;
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
    rig.close();
  });

  it("refuses a body over the limit with 502", async () => {
    const rig = await connectRig(env);
    const pending = call(new Request(mediaUrl("mms-media/big.jpg")), env);
    const frame = await rig.next((f) => f.t === "media");
    const oversize = "A".repeat(Math.ceil((MEDIA_MAX_BYTES + 3) / 3) * 4);
    rig.send({ t: "media-result", id: frame.t === "media" ? frame.id : "", status: 200, content_type: "image/jpeg", body_b64: oversize });
    expect((await pending).status).toBe(502);
    rig.close();
  });

  it("passes the rig's 404 through empty, and answers 503 while it is offline", async () => {
    expect((await call(new Request(mediaUrl("mms-media/a.jpg")), env)).status).toBe(503);
    const rig = await connectRig(env);
    const pending = call(new Request(mediaUrl("mms-media/gone.jpg")), env);
    const frame = await rig.next((f) => f.t === "media");
    rig.send({ t: "media-result", id: frame.t === "media" ? frame.id : "", status: 404 });
    const response = await pending;
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    rig.close();
  });

  it("is an empty 404 for anything not shaped as a signed URL, without asking the rig", async () => {
    const rig = await connectRig(env);
    const response = await call(new Request(`${ORIGIN}/m/object/public/mms-media/a.jpg`), env);
    expect(response.status).toBe(404);
    await expect(rig.next((f) => f.t === "media", 150)).rejects.toThrow();
    rig.close();
  });
});
