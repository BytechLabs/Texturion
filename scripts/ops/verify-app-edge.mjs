#!/usr/bin/env node
/**
 * What the deployed web Worker serves, asked of production after a release.
 *
 * Two classes no local gate can see:
 *
 * 1. Cache headers on files the assets layer answers before the Worker runs.
 *    They come from `apps/web/public/_headers` and `wrangler.jsonc`, and only
 *    the wire says whether they took effect.
 * 2. Public token pages. `/pay/<token>` and `/photos/<token>` answered 500 for
 *    every link a customer opened, because a dynamic page fails only at
 *    request time. A made-up token must still get a page a person can read.
 *
 * Credential-free: unauthenticated GETs of URLs any visitor can open.
 *
 * It also asks whether the API Worker runs beside its database, and whether
 * the pages carry the Next build id ship.yml computed (WEB_BUILD_ID).
 *
 * Usage: node scripts/ops/verify-app-edge.mjs [--app https://app.loonext.com] [--site https://loonext.com] [--api https://api.loonext.com] [--build-id <id>]
 */
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const at = args.indexOf(name);
  return (at >= 0 ? args[at + 1] : fallback).replace(/\/$/, "");
};
const APP = arg("--app", "https://app.loonext.com");
const SITE = arg("--site", "https://loonext.com");
const BUILD_ID = arg("--build-id", process.env.WEB_BUILD_ID ?? "");
const HEADERS = { "user-agent": "loonext-release-check" };

const failures = [];
const passes = [];

async function get(url) {
  try {
    return await fetch(url, { redirect: "manual", headers: HEADERS });
  } catch (cause) {
    failures.push(`${url}: network error ${String(cause?.message ?? cause).slice(0, 80)}`);
    return null;
  }
}

function check(ok, pass, fail) {
  if (ok) passes.push(pass);
  else failures.push(fail);
}

// 1. A hashed chunk named by the login page is immutable.
const login = await get(`${APP}/login`);
if (login) {
  const html = await login.text();

  // Next writes the build id into the page's RSC payload as "b". Inside the
  // HTML that payload is a JS string, so the quotes may be escaped.
  if (BUILD_ID) {
    const escaped = BUILD_ID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    check(
      new RegExp(`\\\\?"b\\\\?":\\\\?"${escaped}\\\\?"`).test(html),
      `the login page carries build id ${BUILD_ID}`,
      `${APP}/login does not carry "b":"${BUILD_ID}", so generateBuildId in next.config.ts was not used and every deploy still resets open tabs`,
    );
  } else {
    console.log("skip build id: WEB_BUILD_ID is not set and no --build-id was given");
  }

  const chunk = /\/_next\/static\/chunks\/[^"'\s]+\.js/.exec(html)?.[0];
  if (!chunk) {
    failures.push(`${APP}/login names no /_next/static/chunks/*.js file, so the cache rule cannot be checked`);
  } else {
    const response = await get(`${APP}${chunk}`);
    const cache = response?.headers.get("cache-control") ?? "";
    check(
      response?.status === 200 && /immutable/.test(cache) && /max-age=31536000/.test(cache),
      `hashed chunk is immutable (${cache})`,
      `${APP}${chunk} answered ${response?.status} with Cache-Control "${cache}", not a year of immutable`,
    );
  }
}

// The service worker must stay revalidated, or installed workers never update.
const sw = await get(`${APP}/sw.js`);
if (sw) {
  const cache = sw.headers.get("cache-control") ?? "";
  check(
    sw.status === 200 && !/immutable/.test(cache) && !/max-age=[1-9]/.test(cache),
    `/sw.js is revalidated (${cache})`,
    `${APP}/sw.js answered ${sw.status} with Cache-Control "${cache}"; it must be checked on every use`,
  );
}

// The offline page is served at its own path, not redirected.
const offline = await get(`${APP}/offline.html`);
if (offline) {
  check(
    offline.status === 200,
    "/offline.html answers 200 with no redirect",
    `${APP}/offline.html answered ${offline.status}${offline.headers.get("location") ? ` to ${offline.headers.get("location")}` : ""}; the service worker cannot use a redirected copy`,
  );
}

// The manifest is cached for a day instead of fetched on every page load.
const manifest = await get(`${APP}/manifest.webmanifest`);
if (manifest) {
  const cache = manifest.headers.get("cache-control") ?? "";
  check(
    manifest.status === 200 && /max-age=86400/.test(cache),
    `manifest is cached for a day (${cache})`,
    `${APP}/manifest.webmanifest answered ${manifest.status} with Cache-Control "${cache}"`,
  );
}

// The API runs beside its database (placement in apps/api/wrangler.jsonc).
// Cloudflare names where a placed Worker ran in a cf-placement header.
const api = await get(`${arg("--api", "https://api.loonext.com")}/health`);
if (api) {
  const placed = api.headers.get("cf-placement");
  check(
    api.status === 200 && placed !== null,
    `API answers with placement (cf-placement: ${placed})`,
    `the API /health answered ${api.status} with no cf-placement header, so it runs at the caller's edge and every database round trip crosses to us-east-1`,
  );
}

// 2. Every public token page answers a made-up token with a page, never a 5xx.
const TOKEN = "release-check-" + "0000000000000000";
for (const url of [`${APP}/pay/${TOKEN}`, `${APP}/photos/${TOKEN}`, `${APP}/invite/${TOKEN}`, `${SITE}/q/${TOKEN}`]) {
  const response = await get(url);
  if (!response) continue;
  check(
    response.status < 500,
    `${new URL(url).pathname.split("/")[1]} link page answers ${response.status}`,
    `${url} answered ${response.status}; a customer opening an expired or mistyped link must get a page`,
  );
}

for (const line of passes) console.log(`ok   ${line}`);
if (failures.length > 0) {
  for (const line of failures) console.error(`FAIL ${line}`);
  process.exit(1);
}
console.log(`App edge: ${passes.length} check(s) passed on ${APP} and ${SITE}.`);
