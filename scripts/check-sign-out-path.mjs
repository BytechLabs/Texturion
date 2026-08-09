#!/usr/bin/env node
/**
 * Signing out has to go through the one function that ends the session properly.
 *
 * ## The defect this exists for
 *
 * Every client ended a session by calling GoTrue `/logout` and nothing else. That
 * deletes the auth session; it does not touch `user_sessions.revoked_at` and it
 * does not sweep `member_telephony_credentials` — both of those happen only inside
 * `api_revoke_sessions`, which no sign-out path called.
 *
 * Since `api_authorize_request` authorizes on `revoked_at is null` and never checks
 * that the GoTrue session still exists, a captured access token kept full `/v1`
 * read and send for the remainder of its life AFTER the user pressed Sign out. And
 * it was invisible while it happened: `api_list_user_sessions` inner-joins
 * `auth.sessions`, which `/logout` had just deleted, so the row that needed killing
 * was missing from Settings → Devices.
 *
 * ## Why a guard and not just a fix
 *
 * The sequence has an order — hand back the push subscription, revoke the session,
 * then clear the local credentials — and every step but the last needs the session
 * being ended. On web that ordering was written out by hand at **nine** call sites,
 * with the push half correct at each and the revoke half missing at all of them.
 *
 * That is the shape: not one forgotten call, but one rule copied nine times, where
 * a step added later reaches some copies and not others. The push release itself is
 * the proof — it was added to eight of the nine and the login page never got it.
 *
 * ## What this checks
 *
 * On web, `auth.signOut(` may only be called from `lib/auth/end-session.ts`.
 * Everything else calls `endSessionOnThisDevice`.
 *
 * The two native clients have exactly one sign-out call site each and no
 * equivalent to drift against, so they are checked differently: the sign-out path
 * must mention the revoke. That is a weaker check and it is weaker on purpose —
 * inventing a shared helper for a single call site would be ceremony, but a
 * silently-dropped revoke would look identical to the bug.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const WEB_ROOT = "apps/web/src";

/** The one place allowed to end a Supabase session. */
const WEB_OWNER = "apps/web/src/lib/auth/end-session.ts";

/**
 * The native sign-out call sites, and what each must still do.
 *
 * Named rather than derived, because there is one of each and a walk would be
 * looking for a pattern that exists once. The entries are re-checked every run: a
 * file that has moved fails loudly rather than quietly stopping being covered.
 */
const NATIVE = [
  {
    file: "apps/android/app/src/main/kotlin/com/loonext/android/features/shell/RootViewModel.kt",
    needs: "revokeThisSession",
    marker: "authManager.signOut()",
  },
  {
    file: "apps/ios/Loonext/Features/Shell/RootViewModel.swift",
    needs: "revokeThisSession",
    marker: "authManager.signOut()",
  },
];

function sources(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry).replaceAll("\\", "/");
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

/** Comment lines are prose. Without this, documenting the rule breaks it. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*(\/\/|\*).*$/gm, "");
}

const problems = [];
let callers = 0;
let scanned = 0;

for (const file of sources(WEB_ROOT)) {
  // A test may drive sign-out directly to assert what it does; no customer session
  // ends there.
  if (/\.test\.(ts|tsx)$/.test(file)) continue;
  scanned += 1;
  const source = stripComments(readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
  if (!/auth\.signOut\(/.test(source)) continue;
  callers += 1;
  if (file !== WEB_OWNER) {
    problems.push(
      `${file} calls auth.signOut() directly. Use endSessionOnThisDevice() from ` +
        `lib/auth/end-session.ts — it hands back the push subscription and revokes ` +
        `the session server-side first, both of which need the session being ended. ` +
        `Ending it here leaves the access token authorized for the rest of its life.`,
    );
  }
}

// The owner must exist and must still do both jobs. Checking the callers while
// exempting the implementation exempts the thing being guarded — that is how the
// avatar guard (#569) was defeated by gutting the shared component.
{
  let owner = null;
  try {
    // Comments stripped, and each rule below looks for a CALL rather than a
    // mention. Both matter, and the break test proved it: this file documents at
    // length what it does, so a docblock naming `sessions/revoke` satisfied a
    // substring check even with the request replaced — and `releasePushOnThisDevice`
    // stayed matched by its own import line after the call was commented out. A
    // guard that reads the prose beside the code cannot see the code stop working.
    owner = stripComments(readFileSync(WEB_OWNER, "utf8").replace(/\r\n/g, "\n"));
  } catch {
    problems.push(
      `cannot read ${WEB_OWNER} — this guard has lost the function every web ` +
        `sign-out is routed through, so every check above passes vacuously.`,
    );
  }
  if (owner !== null) {
    if (!/auth\.signOut\(/.test(owner)) {
      problems.push(
        `${WEB_OWNER} no longer calls auth.signOut(). Every caller delegates to it, ` +
          `so a sign-out that does not end the local session leaves somebody signed ` +
          `in believing they are not.`,
      );
    }
    if (!/apiFetch<[^>]*>\(\s*"\/v1\/sessions\/revoke"/.test(owner)) {
      problems.push(
        `${WEB_OWNER} no longer revokes the session server-side. That is the entire ` +
          `defect this file was written for: GoTrue /logout deletes the auth session ` +
          `and nothing else, so the access token stays authorized and the softphone ` +
          `credential survives.`,
      );
    }
    if (!/releasePushOnThisDevice\(/.test(owner)) {
      problems.push(
        `${WEB_OWNER} no longer releases the push subscription (#264). The row is ` +
          `keyed on (user_id, endpoint) with no session binding, so it outlives the ` +
          `session and the next person at that browser gets the previous member's ` +
          `customer messages.`,
      );
    }
  }
}

for (const { file, needs, marker } of NATIVE) {
  let source = null;
  try {
    source = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  } catch {
    problems.push(
      `cannot read ${file} — the native sign-out path named here has moved, so it ` +
        `is no longer covered. Update this list rather than deleting the entry.`,
    );
    continue;
  }
  const body = stripComments(source);
  if (!body.includes(marker)) {
    problems.push(
      `${file} no longer contains \`${marker}\`, so this guard cannot find the ` +
        `sign-out it is checking. Either it moved — update the entry — or sign-out ` +
        `stopped clearing the local session.`,
    );
    continue;
  }
  if (!body.includes(needs)) {
    problems.push(
      `${file} signs out without calling \`${needs}\`. GoTrue /logout ends the auth ` +
        `session and nothing else: \`user_sessions.revoked_at\` stays null, the ` +
        `softphone credential is never swept, and the access token on that handset ` +
        `keeps working for the rest of its life.`,
    );
  }
}

if (scanned === 0 || callers === 0) {
  // Loud rather than vacuous. `end-session.ts` is itself one caller, so zero means
  // the pattern has stopped matching and this guard is checking nothing.
  problems.push(
    `scanned ${scanned} web source(s) and found ${callers} auth.signOut() caller(s) ` +
      `— expected at least one (end-session.ts itself). The pattern no longer ` +
      `matches the tree, so a pass here means nothing.`,
  );
}

if (problems.length > 0) {
  console.error("Signing out must revoke the session, not just forget it:\n");
  for (const problem of problems) console.error(`  - ${problem}\n`);
  process.exit(1);
}

console.log(
  `Sign-out path: ${callers} web caller of auth.signOut() (the owner), ` +
    `${NATIVE.length} native path(s), each revoking server-side first.`,
);
