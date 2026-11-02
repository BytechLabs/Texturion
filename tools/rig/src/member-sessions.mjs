/**
 * The rig's own sign-ins to local Supabase Auth, kept between processes.
 *
 * The app calls a session id it has not seen a "new device" and mails the
 * account holder (`api_authorize_request` reports `session_new`), and each
 * mail spends the guard's Resend budget. A password sign-in always makes a new
 * session, and every `rig run`, `rig health` and token expiry made one: over a
 * hundred mails a day to the rig's own addresses.
 *
 * A refresh keeps the session id. The first sign-in is stored and later
 * processes refresh it. A password sign-in happens only when nothing is
 * stored, the stored session is gone (reset database, signed out) or the
 * refresh is refused.
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Refresh this long before the access token lapses. */
const EXPIRY_MARGIN_MS = 60_000;
const DEFAULT_LIFETIME_S = 3600;
const REQUEST_TIMEOUT_MS = 10_000;

/** Where rigd and `rig health` share the stored sessions. */
export function memberSessionsFile(stateDir) {
  return join(stateDir, "rigd", "member-sessions.json");
}

/** Forgets every stored session, as a reset database makes necessary. */
export function clearMemberSessions(stateDir) {
  rmSync(memberSessionsFile(stateDir), { force: true });
}

/**
 * @typedef {{ email: string, access_token: string, refresh_token?: string, expires_at: number }} StoredSession
 * @typedef {"memory" | "stored" | "refreshed" | "password"} SessionSource
 */
export class MemberSessions {
  /** @type {Map<string, StoredSession>} */
  #memory = new Map();
  #o;

  /**
   * @param {{ authUrl: string, apiKey: string, file?: string, fetch?: typeof fetch, now?: () => number }} options
   *   `authUrl` is the Auth service's base (`<supabase>/auth/v1`); with no `file` nothing outlives the process.
   */
  constructor(options) {
    this.#o = { fetch: globalThis.fetch, now: Date.now, ...options };
  }

  /**
   * An access token for the member, signing in only when no session can be
   * reused. `source` says where it came from: "stored" is a session an earlier
   * process made and nothing here has tried yet.
   *
   * @param {{ key: string, email: string, password: string }} member
   * @returns {Promise<{ token: string, source: SessionSource }>}
   */
  async token(member) {
    const { now } = this.#o;
    const live = (session) => session && session.email === member.email && session.expires_at - EXPIRY_MARGIN_MS > now();

    const held = this.#memory.get(member.key);
    if (live(held)) return { token: held.access_token, source: "memory" };

    // Another process may have refreshed since this one last looked.
    const stored = this.#read()[member.key];
    if (live(stored)) {
      this.#memory.set(member.key, stored);
      return { token: stored.access_token, source: "stored" };
    }
    const refreshToken = stored?.email === member.email ? stored.refresh_token : held?.refresh_token;
    if (refreshToken) {
      const refreshed = await this.#grant("refresh_token", { refresh_token: refreshToken }, member);
      if (refreshed) return { token: refreshed.access_token, source: "refreshed" };
    }
    const signedIn = await this.#grant("password", { email: member.email, password: member.password }, member);
    if (!signedIn) throw new Error(`member sessions: signing ${member.key} in was refused`);
    return { token: signedIn.access_token, source: "password" };
  }

  /**
   * Drops the member's session so the next call signs in anew. `keepInMemory`
   * leaves this process holding the old token, for a run that signs the
   * session out and then checks the API refuses it.
   */
  forget(key, { keepInMemory = false } = {}) {
    if (!keepInMemory) this.#memory.delete(key);
    if (!this.#o.file) return;
    const all = this.#read();
    if (!(key in all)) return;
    delete all[key];
    this.#write(all);
  }

  /** A refused grant returns undefined: the caller falls back to the next kind of sign-in. */
  async #grant(kind, body, member) {
    const response = await this.#o.fetch(`${this.#o.authUrl.replace(/\/+$/, "")}/token?grant_type=${kind}`, {
      method: "POST",
      headers: { apikey: this.#o.apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      if (kind === "password" || response.status >= 500) {
        throw new Error(`member sessions: signing ${member.key} in returned ${response.status}`);
      }
      return undefined;
    }
    const answer = await response.json();
    if (!answer.access_token) throw new Error(`member sessions: no session for ${member.key}`);
    /** @type {StoredSession} */
    const session = {
      email: member.email,
      access_token: answer.access_token,
      ...(answer.refresh_token ? { refresh_token: answer.refresh_token } : {}),
      expires_at: this.#o.now() + (answer.expires_in ?? DEFAULT_LIFETIME_S) * 1000,
    };
    this.#memory.set(member.key, session);
    if (this.#o.file) this.#write({ ...this.#read(), [member.key]: session });
    return session;
  }

  /** @returns {Record<string, StoredSession>} */
  #read() {
    if (!this.#o.file) return {};
    try {
      const parsed = JSON.parse(readFileSync(this.#o.file, "utf8"));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  /** Written whole and renamed into place, readable by the rig's account alone: it holds refresh tokens. */
  #write(all) {
    const file = this.#o.file;
    mkdirSync(dirname(file), { recursive: true });
    const scratch = `${file}.${process.pid}.tmp`;
    writeFileSync(scratch, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
    try {
      chmodSync(scratch, 0o600);
    } catch {
      // No POSIX modes on this filesystem.
    }
    renameSync(scratch, file);
  }
}
