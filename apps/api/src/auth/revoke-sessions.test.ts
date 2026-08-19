import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * #581/C7 — ending somebody's access has to end ALL of it, on every path.
 *
 * There are five ways a person's access ends: they sign a device out, an owner signs
 * their devices out, they are removed from a workspace, the workspace closes, or they
 * delete their account. Each has to mark the sessions revoked, drop the push
 * registrations, and delete the member's softphone credential AT TELNYX.
 *
 * The third is the one that kept getting missed, and it is the one that matters most for
 * the case the control exists for: a handset somebody else is holding. Deleting our row
 * stops us handing that credential to a NEW registration; it does nothing about a phone
 * that has already registered, whose login token stays valid. So the row went, the
 * credential lived on at Telnyx, and the phone kept ringing and could answer a customer
 * as the business — with the id that would have found the orphan deleted along with the
 * row.
 *
 * One path did it right. Three called `api_revoke_user_sessions`, a wrapper returning
 * `(result ->> 'sessions')::int` that throws the credential ids away, and the fifth ran
 * entirely in SQL with nothing wired to Telnyx at all.
 *
 * These are source checks rather than behaviour, deliberately: the behaviour of each
 * path is asserted in its own route suite (`sessions.test.ts`, `team.test.ts`,
 * `workspace-closure.test.ts`, `account.test.ts` — each one watching for the DELETE
 * reaching Telnyx). What no route test can see is a SIXTH path arriving later and
 * quietly reaching for the wrapper again, which is what happened three times already.
 */

// Derived from this file rather than from the working directory: vitest runs with
// `apps/api` as cwd and a repo-root path would resolve to `apps/api/apps/api`.
const API_SRC = join(import.meta.dirname, "..").replaceAll("\\", "/");
const rel = (path: string) => `${API_SRC}/${path}`;

/** The one module allowed to name the discarding wrapper — in its own history. */
const OWNER = rel("auth/revoke-sessions.ts");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry).replaceAll("\\", "/");
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.ts$/.test(full) && !/\.test\.ts$/.test(full)) out.push(full);
  }
  return out;
}

/*
 * Comment lines are prose. Without this, explaining the rule would break it.
 *
 * #519 CENTRALISED THIS AND THIS FILE KEPT A PRIVATE COPY, which had the exact
 * defect the shared one was written to fix: `/\/\*[\s\S]*?\*\//` opens a block
 * comment at the FIRST slash-star it meets, wherever it is — including inside a
 * string literal. Hono wildcard routes are string literals full of slash-stars.
 *
 * Measured on today's tree, the private copy blanked index.ts 195-238 (opened
 * by `"/v1/*"`), routes/widget.ts 199-295 (`"/widget/*"`) and
 * routes/marketing.ts 73-87 (`"/marketing/*"`) — roughly 7KB of production
 * source that the scan below reported "none" over without reading.
 *
 * That matters here more than most places. This file exists to catch "a SIXTH
 * path arriving later and quietly reaching for the wrapper again, which is what
 * happened three times already" — and index.ts's middleware block is exactly
 * where a global revocation hook would plausibly land. A session row deleted
 * without the telephony credential leaves a handset that already registered
 * still ringing, still able to answer a customer as the business.
 *
 * The floor below counts FILES OPENED, not text searched, so it could never
 * have noticed.
 */
import { stripComments } from "../test/source-tree";

describe("every path that ends access goes through the one that finishes the job", () => {
  it("nothing calls the wrapper that throws the credential ids away", () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const file of sources(API_SRC)) {
      scanned += 1;
      if (file === OWNER) continue;
      const body = stripComments(readFileSync(file, "utf8"));
      if (body.includes("api_revoke_user_sessions")) offenders.push(file);
    }
    // Loud rather than vacuous: a walk that stops finding files passes everything.
    expect(scanned).toBeGreaterThan(100);
    expect(
      offenders,
      "these call `api_revoke_user_sessions`, which returns a bare count and drops the " +
        "telephony credential ids — so the row goes and the credential stays alive at " +
        "Telnyx, and a phone that had already registered keeps ringing and can answer " +
        "a customer as the business. Use `revokeSessions` from auth/revoke-sessions.ts.",
    ).toEqual([]);
  });

  it("the shared module still does both halves", () => {
    // Checking the callers while exempting the implementation exempts the thing being
    // guarded. It must call the RPC that returns the ids, and it must delete them.
    const owner = stripComments(readFileSync(OWNER, "utf8"));
    expect(owner).toContain('db.rpc("api_revoke_sessions"');
    expect(owner).toContain("/v2/telephony_credentials/");
    expect(owner).toContain('method: "DELETE"');
  });

  it("each of the five paths reaches the shared module", () => {
    /**
     * Named per file, because there are five and each arrives differently — the same
     * reason `check-sign-out-path` names its native call sites. Every entry is
     * re-checked, so a path that moves fails loudly instead of quietly stopping being
     * covered. `account.ts` uses the Telnyx half on its own: its ids come back from
     * `delete_account`, which does the row deletion itself in SQL.
     */
    const paths: [file: string, needs: string, why: string][] = [
      [
        rel("routes/sessions.ts"),
        "revokeSessions(",
        "signing a device out, and an owner signing a member's devices out",
      ],
      [
        rel("routes/team.ts"),
        "revokeSessions(",
        "offboarding a member, and a member leaving of their own accord",
      ],
      [
        rel("routes/workspace-closure.ts"),
        "revokeSessions(",
        "closing the workspace, for every member of it",
      ],
      [
        rel("routes/account.ts"),
        "releaseTelnyxCredentials(",
        "deleting your own account, whose ids come back from delete_account",
      ],
    ];
    for (const [file, needs, why] of paths) {
      const body = stripComments(readFileSync(file, "utf8"));
      expect(body, `${file} (${why}) must reach the shared module`).toContain(needs);
    }
  });
});
