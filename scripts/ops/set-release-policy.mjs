/**
 * [#339] Set what we recommend, and — rarely — what we insist on.
 *
 *   node scripts/ops/set-release-policy.mjs --platform ios
 *   node scripts/ops/set-release-policy.mjs --platform ios --recommended 1.5.0 --apply
 *   node scripts/ops/set-release-policy.mjs --platform ios --minimum 1.5.0 \
 *        --message "A security fix" --apply
 *   node scripts/ops/set-release-policy.mjs --platform ios --clear --apply
 *
 * The floor lives in the database rather than in a build for one reason: a
 * floor baked into a client can only be LOWERED by shipping a client, and the
 * moment you need to lower it is the moment shipping is the thing that is
 * broken. `--clear` is the rollback, and it takes effect within the endpoint's
 * five-minute cache.
 *
 * ---------------------------------------------------------------------------
 * D71 governs the floor, and this script enforces the mechanical parts of it.
 *
 * A minimum version takes somebody's business phone away until they act. The
 * plumber standing in a customer's basement did not choose this moment to
 * update, and for most bugs being blocked is worse than the bug. So:
 *
 *   - a floor requires --message. A demand with no reason reads as an ad for
 *     our own convenience, and the person reading it is deciding whether to
 *     trust us.
 *   - the blast radius is printed BEFORE the write, counted against sessions
 *     seen in the last 30 days, and sessions with NO known version are counted
 *     as blocked — because they are, and they are the majority on day one.
 *   - a floor is refused on the same day the recommended version moves to the
 *     same number. D71: never raise the floor to a release that has not had
 *     time to reach anybody.
 */
import { fail, runScript, showRows } from "./lib.mjs";

const PLATFORMS = new Set(["web", "android", "ios"]);
const VERSION = /^[0-9]{1,4}(\.[0-9]{1,4}){0,3}$/;

/** Four integer segments, so 1.10.0 outranks 1.9.0. Mirrors SQL version_key. */
function versionKey(version) {
  if (!version || !VERSION.test(version)) return null;
  const parts = version.split(".").map(Number);
  return [0, 1, 2, 3].map((i) => parts[i] ?? 0);
}

function isNewer(a, b) {
  const ka = versionKey(a);
  const kb = versionKey(b);
  if (!ka || !kb) return false;
  for (let i = 0; i < 4; i += 1) {
    if (ka[i] !== kb[i]) return ka[i] > kb[i];
  }
  return false;
}

await runScript("set-release-policy", async ({ args, apply, db, script }) => {
  const platform = typeof args.platform === "string" ? args.platform : null;
  if (!platform || !PLATFORMS.has(platform)) {
    fail("--platform web|android|ios is required.");
  }

  const clearing = args.clear === true;
  const recommended = clearing ? null : (args.recommended ?? null);
  const minimum = clearing ? null : (args.minimum ?? null);
  const message = clearing ? null : (args.message ?? null);
  const updateUrl = clearing ? null : (args["update-url"] ?? null);

  for (const [flag, value] of [
    ["--recommended", recommended],
    ["--minimum", minimum],
  ]) {
    if (value !== null && !VERSION.test(String(value))) {
      fail(`${flag} must look like 1.4.0 (up to four numeric segments), got "${value}".`);
    }
  }

  if (minimum && !message) {
    fail(
      "a --minimum requires --message. Somebody is about to lose access to " +
        "their business phone line; they are owed the reason in the same screen.",
    );
  }

  if (minimum && recommended && isNewer(minimum, recommended)) {
    fail("--minimum cannot be newer than --recommended; the database refuses it too.");
  }

  // D71: the floor may not point at a build that has had no time to land.
  const current = await db.select(
    "app_release_policy",
    "platform,recommended_version,minimum_version,message,update_url,updated_at",
    { platform: "eq." + platform },
  );
  const before = current[0];
  if (!before) fail(`no policy row for platform ${platform}`);

  if (minimum && isNewer(minimum, before.recommended_version)) {
    fail(
      `--minimum ${minimum} is newer than the version currently recommended ` +
        `(${before.recommended_version ?? "none"}). D71: recommend it first, let it ` +
        `reach people, and raise the floor on a later day.`,
    );
  }

  showRows("Policy now", [
    {
      platform: before.platform,
      recommended: before.recommended_version ?? "-",
      minimum: before.minimum_version ?? "-",
      message: before.message ?? "-",
      updated_at: before.updated_at,
    },
  ]);

  showRows("Policy after", [
    {
      platform,
      recommended: recommended ?? "-",
      minimum: minimum ?? "-",
      message: message ?? "-",
      update_url: updateUrl ?? "-",
    },
  ]);

  // The blast radius, always — including on a dry run, which is the whole
  // point of having one. Counted the same way the endpoint will judge it.
  const sessions = await db.select(
    "user_sessions",
    "session_id,app_version,last_seen_at",
    { client: "eq." + platform, revoked_at: "is.null" },
  );
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const live = sessions.filter((s) => Date.parse(s.last_seen_at) > cutoff);
  const blocked = minimum
    ? live.filter((s) => !s.app_version || isNewer(minimum, s.app_version))
    : [];

  console.log(`  Active ${platform} sessions (last 30 days): ${live.length}`);
  if (minimum) {
    const unknown = blocked.filter((s) => !s.app_version).length;
    console.log(
      `  BLOCKED by a ${minimum} floor: ${blocked.length}` +
        (unknown ? ` (${unknown} of them report no version at all)` : ""),
    );
    console.log(
      "  Each of those is a person who cannot use their business phone until they update.\n",
    );
  } else {
    console.log("  No floor: nobody is blocked.\n");
  }

  if (!apply) return;

  const result = await db.rpc("api_set_release_policy", {
    p_platform: platform,
    p_recommended: recommended,
    p_minimum: minimum,
    p_message: message,
    p_update_url: updateUrl,
    p_actor: null,
  });

  console.log(
    `  ${script}: ${platform} policy updated — ` +
      `${result?.blocked_sessions ?? 0} of ${result?.active_sessions ?? 0} ` +
      `active sessions are below the floor.\n`,
  );
  if (minimum) {
    console.log(
      "  Rollback: re-run with --clear --apply. It takes effect within the\n" +
        "  endpoint's five-minute cache; no deploy is involved.\n",
    );
  }
});
