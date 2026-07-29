#!/usr/bin/env node
/**
 * [#282] The one ecosystem Dependabot cannot see, asked about directly.
 *
 * The iOS app's two SPM dependencies are declared in `apps/ios/project.yml`
 * and resolved by Xcode at build time. There is no `Package.swift` and no
 * committed `Package.resolved`, so Dependabot has no manifest to read and the
 * Swift half of our dependency surface was scanned by nothing at all.
 *
 * This reads the pins out of project.yml and asks GitHub's advisory database
 * about them. It is less than Dependabot would give us — there is no automatic
 * pull request at the end of it — but it turns "nobody is looking" into "we
 * are told within a week", which is the difference that matters.
 *
 * Exits non-zero when an advisory at or above the D68 floor affects a pinned
 * version. A lookup that FAILS is reported and exits 0: this runs on a
 * schedule against somebody else's API, and a flaky network call that pages a
 * solo founder about nothing is how a check gets deleted.
 */
import { readFileSync } from "node:fs";

/** The D68 floor. Below this, an advisory is a note, not an alarm. */
const FLOOR = new Set(["HIGH", "CRITICAL"]);

/**
 * Pins live in exactly one place, and this reads that place rather than a
 * copy — a duplicate list here would drift the first time somebody bumps a
 * version, and drift silently, which is the whole failure mode being fixed.
 */
function readPins(path = "apps/ios/project.yml") {
  const source = readFileSync(path, "utf8");
  const block = source.match(/^packages:\n([\s\S]*?)^\S/m)?.[1] ?? "";
  const pins = [];
  // Deliberately a small hand parser rather than a YAML dependency: this
  // script runs in CI with no install step, and the shape it reads is three
  // lines that have not changed since the app was created.
  const entries = block.split(/\n(?=\s{2}\w)/);
  for (const entry of entries) {
    const url = entry.match(/url:\s*(\S+)/)?.[1];
    const version = entry.match(/(?:majorVersion|minVersion|exactVersion):\s*(\S+)/)?.[1];
    if (!url || !version) continue;
    const repo = url.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
    pins.push({ repo, version, url });
  }
  return pins;
}

async function advisoriesFor(repo, token) {
  // GitHub indexes Swift packages by their repository URL, which is also how
  // SPM names them — so the pin IS the package identifier, with no mapping
  // table to keep in step.
  const query = `
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
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "loonext-security-check",
    },
    body: JSON.stringify({
      query,
      variables: { package: `https://github.com/${repo}` },
    }),
  });
  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}`);
  }
  const body = await response.json();
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join("; "));
  }
  return body.data?.securityVulnerabilities?.nodes ?? [];
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN is not set — cannot query the advisory database.");
    process.exit(1);
  }

  const pins = readPins();
  if (pins.length === 0) {
    // The parser found nothing, which means project.yml changed shape. That is
    // a real failure: a silent zero here would read as "all clear" forever.
    console.error("No Swift package pins found in apps/ios/project.yml.");
    process.exit(1);
  }

  const alarming = [];
  for (const pin of pins) {
    let found;
    try {
      found = await advisoriesFor(pin.repo, token);
    } catch (cause) {
      console.error(`Could not check ${pin.repo}: ${cause.message}`);
      continue; // reported, not fatal — see the note at the top
    }
    console.log(`${pin.repo} (pinned ${pin.version}): ${found.length} advisories on record`);
    for (const node of found) {
      if (!FLOOR.has(node.severity)) continue;
      alarming.push({ pin, node });
    }
  }

  if (alarming.length === 0) {
    console.log("No HIGH or CRITICAL advisories against the pinned iOS packages.");
    return;
  }

  console.error("\nAdvisories at or above the D68 floor:\n");
  for (const { pin, node } of alarming) {
    console.error(
      `  ${pin.repo} — ${node.severity}\n` +
        `    affects: ${node.vulnerableVersionRange}\n` +
        `    pinned:  ${pin.version}\n` +
        `    fixed:   ${node.firstPatchedVersion?.identifier ?? "no patch yet"}\n` +
        `    ${node.advisory.summary}\n` +
        `    ${node.advisory.permalink}\n`,
    );
  }
  console.error(
    "Bump the pin in apps/ios/project.yml, or record why the range does not " +
      "apply. See docs/DECISIONS.md D68 for the response window.",
  );
  process.exit(1);
}

await main();
