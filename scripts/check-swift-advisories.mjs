#!/usr/bin/env node
/**
 * [#282] The one ecosystem Dependabot cannot see, asked about directly.
 *
 * The iOS app's two SPM dependencies are declared in `apps/ios/project.yml` and
 * resolved by Xcode at build time. There is no `Package.swift` and no committed
 * `Package.resolved`, so Dependabot has no manifest to read and the Swift half of
 * our dependency surface was scanned by nothing at all.
 *
 * This reads the pins out of project.yml and asks GitHub's advisory database
 * about them. It is less than Dependabot would give us — there is no automatic
 * pull request at the end of it — but it turns "nobody is looking" into "we are
 * told within a week", which is the difference that matters.
 *
 * ---------------------------------------------------------------------------
 * #581: IT USED TO PRINT "NO ADVISORIES" HAVING LOOKED AT NOTHING. TWICE OVER.
 *
 * First, the package identifier was wrong. GitHub indexes Swift packages as
 * `github.com/owner/repo`; this asked for `https://github.com/owner/repo`, which
 * matches nothing, so every query returned an empty list and every empty list was
 * printed as a clean bill. Both spellings were tried against a package with known
 * advisories — 0 nodes with the scheme, 5 without.
 *
 * Second, a failed lookup was caught, logged and skipped, and the run still ended
 * on "No HIGH or CRITICAL advisories". Two dead network calls read exactly like
 * two clean packages.
 *
 * So there are now three things between this script and the words "no
 * advisories": the CANARY below has to come back non-empty, proving the query
 * still works at all; every pin has to get an answer, with retries for genuine
 * flakiness; and the count of answers has to equal the count of pins. A lookup
 * that cannot be completed exits NON-ZERO — the job is scheduled-only and gates
 * no merge, so a red run is the notification, and "I could not check" is a
 * different sentence from "there is nothing to find". That reverses the original
 * decision here, deliberately: it was written to avoid paging a founder over a
 * flaky call, and the retries are what keeps that promise now.
 *
 * Exits non-zero when an advisory at or above the D68 floor is ON RECORD for a
 * pinned package, when a pin could not be checked, or when the lookup itself
 * cannot be shown to work.
 */
import { readFileSync } from "node:fs";

/** The D68 floor. Below this, an advisory is a note, not an alarm. */
const FLOOR = new Set(["HIGH", "CRITICAL"]);

/**
 * How GitHub names a Swift package: the repository, WITHOUT a scheme. Getting
 * this wrong is silent — a wrong name is an empty result, not an error — which is
 * why the canary below exists rather than a comment saying "checked once".
 */
const packageName = (repo) => `github.com/${repo}`;

/**
 * A package that HAS advisories, queried first so that silence about our own pins
 * means something.
 *
 * `apple/swift-nio` carries several HIGH and CRITICAL advisories and is not going
 * anywhere. If this comes back empty the lookup is broken — a renamed ecosystem,
 * a changed identifier, a token that cannot read the database — or the advisories
 * were withdrawn, in which case pick another canary deliberately and say so here.
 * Either way the honest answer about our own packages is "unknown", not "clean".
 */
const CANARY = "apple/swift-nio";

/** Retry only what a retry can fix. */
const RETRIES = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pins live in exactly one place, and this reads that place rather than a copy —
 * a duplicate list here would drift the first time somebody bumps a version, and
 * drift silently, which is the whole failure mode being fixed.
 */
function readPins(path = "apps/ios/project.yml") {
  const source = readFileSync(path, "utf8");
  const block = source.match(/^packages:\n([\s\S]*?)^\S/m)?.[1] ?? "";
  const pins = [];
  // Deliberately a small hand parser rather than a YAML dependency: this script
  // runs in CI with no install step, and the shape it reads is three lines that
  // have not changed since the app was created.
  const entries = block.split(/\n(?=\s{2}\w)/);
  for (const entry of entries) {
    const url = entry.match(/url:\s*(\S+)/)?.[1];
    const constraint = entry.match(/(majorVersion|minVersion|exactVersion):\s*(\S+)/);
    if (!url || !constraint) continue;
    const repo = url.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
    pins.push({ repo, kind: constraint[1], version: constraint[2], url });
  }
  return pins;
}

/**
 * What is actually installed, said honestly.
 *
 * `majorVersion: 4.1.0` is XcodeGen for "4.1.0 up to the next major", so the
 * version Xcode resolves at build time is NOT the number in the file and nothing
 * in this repository records what it was. That is why an advisory's
 * `vulnerableVersionRange` is PRINTED rather than evaluated: a range comparison
 * against a number we do not actually ship would be a guess, and a guess here
 * fails in the direction of silence. So every advisory at the floor is raised and
 * a human reads the range. Louder than necessary beats quieter than true.
 */
function describe(pin) {
  return pin.kind === "exactVersion"
    ? `exactly ${pin.version}`
    : `${pin.version} or newer within its major, resolved by Xcode`;
}

async function query(pkg, token) {
  const gql = `
    query($package: String!) {
      securityVulnerabilities(ecosystem: SWIFT, package: $package, first: 20) {
        nodes {
          severity
          vulnerableVersionRange
          firstPatchedVersion { identifier }
          advisory { summary permalink }
        }
      }
    }`;
  let response;
  try {
    response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "loonext-security-check",
      },
      body: JSON.stringify({ query: gql, variables: { package: pkg } }),
    });
  } catch (cause) {
    throw Object.assign(new Error(`network error: ${cause.message}`), {
      retriable: true,
    });
  }
  if (!response.ok) {
    // 401 is a token, not weather. Retrying it wastes a minute and still fails.
    throw Object.assign(new Error(`GitHub API returned ${response.status}`), {
      retriable: response.status === 429 || response.status === 408 || response.status >= 500,
    });
  }
  const body = await response.json();
  if (body.errors?.length) {
    throw Object.assign(new Error(body.errors.map((error) => error.message).join("; ")), {
      retriable: body.errors.some((error) => error.type === "RATE_LIMITED"),
    });
  }
  return body.data?.securityVulnerabilities?.nodes ?? [];
}

async function advisoriesFor(repo, token) {
  let last;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      return await query(packageName(repo), token);
    } catch (cause) {
      last = cause;
      if (!cause.retriable || attempt === RETRIES) break;
      await sleep(attempt * 2000);
    }
  }
  throw last;
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN is not set — cannot query the advisory database.");
    process.exit(1);
  }

  const pins = readPins();
  if (pins.length === 0) {
    // The parser found nothing, which means project.yml changed shape. That is a
    // real failure: a silent zero here would read as "all clear" forever.
    console.error("No Swift package pins found in apps/ios/project.yml.");
    process.exit(1);
  }

  let canary = [];
  try {
    canary = await advisoriesFor(CANARY, token);
  } catch (cause) {
    console.error(
      `Could not reach the advisory database at all (${cause.message}).\n` +
        "Nothing was checked, so nothing is being reported as clean.",
    );
    process.exit(1);
  }
  if (canary.length === 0) {
    console.error(
      `The lookup returned NOTHING for ${CANARY}, which has advisories on ` +
        "record.\nThat means this script is asking the wrong question — a " +
        "renamed ecosystem, a\nchanged package identifier (it must be " +
        "`github.com/owner/repo`, with no scheme),\nor a token that cannot read " +
        "the database. An empty answer from a broken query\nis exactly how this " +
        "check spent months reporting no advisories (#581).\n\nIf the canary's " +
        "advisories were genuinely withdrawn, choose another package that\nhas " +
        "some and say so in the comment beside CANARY.",
    );
    process.exit(1);
  }
  console.log(
    `Lookup verified: ${canary.length} advisories on record for ${CANARY}.`,
  );

  const checked = [];
  const unchecked = [];
  const alarming = [];
  for (const pin of pins) {
    let found;
    try {
      found = await advisoriesFor(pin.repo, token);
    } catch (cause) {
      unchecked.push({ pin, why: cause.message });
      continue;
    }
    checked.push(pin);
    console.log(`${pin.repo} (${describe(pin)}): ${found.length} advisories on record`);
    for (const node of found) {
      if (!FLOOR.has(node.severity)) continue;
      alarming.push({ pin, node });
    }
  }

  if (alarming.length > 0) {
    console.error("\nAdvisories at or above the D68 floor:\n");
    for (const { pin, node } of alarming) {
      console.error(
        `  ${pin.repo} — ${node.severity}\n` +
          `    affects: ${node.vulnerableVersionRange}\n` +
          `    pinned:  ${describe(pin)}\n` +
          `    fixed:   ${node.firstPatchedVersion?.identifier ?? "no patch yet"}\n` +
          `    ${node.advisory.summary}\n` +
          `    ${node.advisory.permalink}\n`,
      );
    }
    console.error(
      "Bump the pin in apps/ios/project.yml, or record why the range does not " +
        "apply. See docs/DECISIONS.md D68 for the response window.",
    );
  }

  if (unchecked.length > 0) {
    console.error(
      `\n${unchecked.length} of ${pins.length} pinned package(s) could not be ` +
        `checked after ${RETRIES} attempts:\n`,
    );
    for (const { pin, why } of unchecked) console.error(`  ${pin.repo} — ${why}`);
    console.error(
      "\nAn unchecked pin is an UNKNOWN, and the only job of this script is to " +
        "say which\nit is. Re-run it; if it keeps failing the lookup is broken " +
        "and needs fixing, not\nignoring.",
    );
  }

  if (alarming.length > 0 || unchecked.length > 0) process.exit(1);

  // The invariant this file exists for: the clean bill is unreachable unless
  // every pin got an answer, from a lookup already proven to return something.
  if (checked.length !== pins.length) {
    console.error(
      `Checked ${checked.length} of ${pins.length} pins and was about to report ` +
        "all clear.",
    );
    process.exit(1);
  }

  console.log(
    `No HIGH or CRITICAL advisories against the pinned iOS packages — all ` +
      `${checked.length} checked.`,
  );
}

await main();
