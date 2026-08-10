#!/usr/bin/env node
/**
 * [#601] Is the dependency graph actually on?
 *
 * `Dependency review` — the one check that would refuse a pull request adding a
 * dependency with a HIGH advisory or an AGPL licence — has failed on every pull
 * request that has ever run it, always with the same sentence:
 *
 *     Dependency review is not supported on this repository.
 *     Please ensure that Dependency graph is enabled
 *
 * It is not the pull request. The graph is off, and it is off at the ORGANISATION
 * level: `PATCH /repos/{owner}/{repo}` with `security_and_analysis[dependency_graph]`
 * returns 200, changes nothing, and the field is absent from the response. Only an
 * owner with `admin:org` can turn it on.
 *
 * That left a bad choice. Leaving the check red on every pull request teaches
 * everybody to merge past a red mark, which is worse than not having the check —
 * and it is red about a repository setting no contributor can fix. Deleting it
 * gives up the gate, and nobody re-adds a deleted job the day the setting changes.
 *
 * So the two halves are separated, the same way `check-swift-advisories.mjs` is:
 *
 *   * the pull-request gate runs only when it CAN run, and says so in an
 *     annotation when it cannot, rather than failing somebody else's change;
 *   * this script is the loud half. It runs on the weekly schedule, gates no
 *     merge, and exits non-zero for as long as the setting is off. A red
 *     scheduled run is the notification.
 *
 * "I could not check" is a different sentence from "there is nothing to find",
 * and this exists so the first one keeps being said out loud until somebody acts.
 *
 * Exits 0 when the graph answers, 1 when it does not, and 1 when the probe itself
 * cannot be shown to work — see the canary.
 */

/**
 * A repository whose dependency graph is definitely on, asked first so that a 404
 * about ours means what we think it means.
 *
 * Every public repository gets the graph enabled by default, so a 404 here is not
 * "that repo opted out" — it is the probe being broken: a token that cannot read
 * the endpoint, a moved route, an API-wide outage. Without it, a change to any of
 * those would read exactly like the setting we are watching for, and this script
 * would go on reporting the same failure long after it stopped measuring anything.
 *
 * `actions/checkout` is public, has a manifest, and is not going anywhere.
 */
const CANARY = "actions/checkout";

/** Retry only what a retry can fix. */
const RETRIES = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ask one repository for its SBOM.
 *
 * Returns the package count on success and `null` on a 404, which is precisely
 * how this endpoint reports "the graph is off for this repository". Anything else
 * throws, because anything else is a different question.
 */
async function sbomPackageCount(repo, token) {
  let response;
  try {
    response = await fetch(
      `https://api.github.com/repos/${repo}/dependency-graph/sbom`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "loonext-security-check",
        },
      },
    );
  } catch (cause) {
    throw Object.assign(new Error(`network error: ${cause.message}`), {
      retriable: true,
    });
  }

  // The answer this whole script is about. Not retriable: the setting will not
  // change between two requests a second apart, and retrying it three times only
  // makes the log longer.
  if (response.status === 404) return null;

  if (!response.ok) {
    // 401 and 403 are a token, not weather.
    const retriable = response.status >= 500 || response.status === 429;
    throw Object.assign(
      new Error(`HTTP ${response.status} ${response.statusText}`),
      { retriable },
    );
  }

  const body = await response.json();
  return body?.sbom?.packages?.length ?? 0;
}

async function withRetries(repo, token) {
  let last;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      return await sbomPackageCount(repo, token);
    } catch (error) {
      last = error;
      if (!error.retriable || attempt === RETRIES) break;
      await sleep(attempt * 2000);
    }
  }
  throw last;
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error(
      "GITHUB_TOKEN is not set, so nothing was checked. This script reports on a " +
        "repository setting and cannot fall back to a local answer.",
    );
    process.exit(1);
  }

  const repo = process.env.GITHUB_REPOSITORY ?? "BytechLabs/Texturion";

  // The canary first, so that silence about our own repository means something.
  let canary;
  try {
    canary = await withRetries(CANARY, token);
  } catch (error) {
    console.error(
      `The probe could not be shown to work: asking ${CANARY} for its SBOM ` +
        `failed with ${error.message}. That says nothing about ${repo} — treat ` +
        "this as unknown, not clean.",
    );
    process.exit(1);
  }
  if (canary === null) {
    console.error(
      `The probe is broken: ${CANARY} reports no dependency graph, and every ` +
        "public repository has one. The endpoint, the token's permissions or the " +
        "API itself has changed, so a 404 about our own repository would no " +
        "longer mean the setting is off. Fix the probe before trusting it again.",
    );
    process.exit(1);
  }
  console.log(`Probe works: ${CANARY} answered with ${canary} packages.`);

  let ours;
  try {
    ours = await withRetries(repo, token);
  } catch (error) {
    console.error(`Could not ask ${repo} for its SBOM: ${error.message}`);
    process.exit(1);
  }

  if (ours === null) {
    console.error(
      [
        "",
        `THE DEPENDENCY GRAPH IS OFF FOR ${repo}.`,
        "",
        "While it is, `Dependency review` cannot evaluate anything, so a pull",
        "request adding a dependency with a HIGH advisory or an AGPL licence",
        "would be merged without a word. That gate is skipped rather than failed",
        "on pull requests — it is not a contributor's setting to fix — so this",
        "run is the only thing saying so.",
        "",
        "To fix it, an owner with `admin:org` opens:",
        "  https://github.com/organizations/BytechLabs/settings/security_analysis",
        "and enables Dependency graph. It is free on public repositories.",
        "",
        "This is not fixable from a workflow: PATCH /repos/{owner}/{repo} with",
        "security_and_analysis[dependency_graph] returns 200, changes nothing,",
        "and the field is absent from the response.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log(
    `The dependency graph is on for ${repo}: ${ours} packages. ` +
      "`Dependency review` can evaluate a pull request.",
  );
}

await main();
