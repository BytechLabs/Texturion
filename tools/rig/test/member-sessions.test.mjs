import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { clearMemberSessions, MemberSessions, memberSessionsFile } from "../src/member-sessions.mjs";

const MEMBER = { key: "qa-w-owner", email: "owner@rig.invalid", password: "pw" };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** An Auth service that numbers its sessions and refuses a refresh token it never issued. */
function fakeAuth() {
  const grants = [];
  const issued = new Set();
  let sessions = 0;
  const grant = (session, rotation) => {
    const refresh = `refresh:${session}:${rotation}`;
    issued.add(refresh);
    return { access_token: `access:${session}:${rotation}`, refresh_token: refresh, expires_in: 3600 };
  };
  const fetch = async (url, init) => {
    const kind = new URL(url).searchParams.get("grant_type");
    const body = JSON.parse(init.body);
    grants.push(kind);
    if (kind === "password") {
      sessions += 1;
      return json(grant(sessions, 0));
    }
    if (!issued.has(body.refresh_token)) return json({ error: "invalid_grant" }, 400);
    const [, session, rotation] = body.refresh_token.split(":");
    return json(grant(Number(session), Number(rotation) + 1));
  };
  return { fetch, grants, forgetAll: () => issued.clear() };
}

function withDir(body) {
  const dir = mkdtempSync(join(tmpdir(), "rig-sessions-"));
  return Promise.resolve(body(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

const open = (dir, auth, clock) =>
  new MemberSessions({ authUrl: "http://auth.invalid/auth/v1", apiKey: "k", file: memberSessionsFile(dir), fetch: auth.fetch, now: () => clock.at });

test("a second process reuses the first one's session instead of signing in again", () =>
  withDir(async (dir) => {
    const auth = fakeAuth();
    const clock = { at: 1_000_000 };
    const first = await open(dir, auth, clock).token(MEMBER);
    assert.equal(first.source, "password");
    const second = await open(dir, auth, clock).token(MEMBER);
    assert.deepEqual(second, { token: first.token, source: "stored" });
    assert.equal((await open(dir, auth, clock).token(MEMBER)).source, "stored");
    assert.deepEqual(auth.grants, ["password"]);
  }));

test("an expired access token is refreshed, which keeps the session", () =>
  withDir(async (dir) => {
    const auth = fakeAuth();
    const clock = { at: 1_000_000 };
    await open(dir, auth, clock).token(MEMBER);
    clock.at += 3_600_000;
    const later = await open(dir, auth, clock).token(MEMBER);
    assert.deepEqual(later, { token: "access:1:1", source: "refreshed" });
    assert.deepEqual(auth.grants, ["password", "refresh_token"]);
  }));

test("a refused refresh falls back to one password sign-in", () =>
  withDir(async (dir) => {
    const auth = fakeAuth();
    const clock = { at: 1_000_000 };
    await open(dir, auth, clock).token(MEMBER);
    clock.at += 3_600_000;
    auth.forgetAll();
    const later = await open(dir, auth, clock).token(MEMBER);
    assert.equal(later.source, "password");
    assert.deepEqual(auth.grants, ["password", "refresh_token", "password"]);
  }));

test("a wrong password is an error, not a retry loop", () =>
  withDir(async (dir) => {
    let calls = 0;
    const sessions = new MemberSessions({
      authUrl: "http://auth.invalid/auth/v1",
      apiKey: "k",
      file: memberSessionsFile(dir),
      fetch: async () => {
        calls += 1;
        return json({ error: "invalid_credentials" }, 400);
      },
    });
    await assert.rejects(sessions.token(MEMBER), /signing qa-w-owner in returned 400/);
    assert.equal(calls, 1);
  }));

test("forgetting makes the next call sign in; keepInMemory leaves this process its token", () =>
  withDir(async (dir) => {
    const auth = fakeAuth();
    const clock = { at: 1_000_000 };
    const sessions = open(dir, auth, clock);
    const first = await sessions.token(MEMBER);
    sessions.forget(MEMBER.key, { keepInMemory: true });
    assert.deepEqual(await sessions.token(MEMBER), { token: first.token, source: "memory" });
    const later = await open(dir, auth, clock).token(MEMBER);
    assert.equal(later.source, "password", "a later process is handed nothing");
    assert.notEqual(later.token, first.token);
    sessions.forget(MEMBER.key);
    assert.equal((await sessions.token(MEMBER)).source, "password");
  }));

test("a session is never lent to another address, and a reset clears every one", () =>
  withDir(async (dir) => {
    const auth = fakeAuth();
    const clock = { at: 1_000_000 };
    await open(dir, auth, clock).token(MEMBER);
    const other = await open(dir, auth, clock).token({ ...MEMBER, email: "someone@rig.invalid" });
    assert.equal(other.source, "password");
    clearMemberSessions(dir);
    assert.equal((await open(dir, auth, clock).token(MEMBER)).source, "password");
  }));

test("the file holds refresh tokens, so only its owner can read it", () =>
  withDir(async (dir) => {
    await open(dir, fakeAuth(), { at: 1_000_000 }).token(MEMBER);
    const file = memberSessionsFile(dir);
    assert.match(readFileSync(file, "utf8"), /refresh:1:0/);
    if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o077, 0);
  }));

test("with no file nothing outlives the process", async () => {
  const auth = fakeAuth();
  const make = () => new MemberSessions({ authUrl: "http://auth.invalid/auth/v1", apiKey: "k", fetch: auth.fetch, now: () => 1_000_000 });
  await make().token(MEMBER);
  await make().token(MEMBER);
  assert.deepEqual(auth.grants, ["password", "password"]);
});
