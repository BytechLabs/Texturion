#!/usr/bin/env node
/**
 * IndexNow ping (#127 distribution): submits every sitemap URL to
 * api.indexnow.org, which fans out to Bing, Yandex, Seznam, Naver, and the
 * other IndexNow-participating engines. Google does not consume IndexNow;
 * Google discovery is Search Console (founder-side, see LAUNCH-PLAYBOOK.md §1).
 *
 * The key is NOT a secret: the protocol requires it to be publicly hosted at
 * https://loonext.com/<key>.txt (public/<key>.txt in this repo) precisely so
 * engines can verify the pinger controls the host.
 *
 * Run AFTER a deploy (the key file and any new URLs must be live first):
 *   node apps/web/scripts/indexnow-ping.mjs            # ping all sitemap URLs
 *   node apps/web/scripts/indexnow-ping.mjs <url> ...  # ping specific URLs
 *
 * Re-run whenever content changes (new blog post, page edits). Engines
 * de-dupe; re-pinging an unchanged URL is harmless.
 */

const HOST = "loonext.com";
const KEY = "69712604689fb0903b974f369d8da787";
const SITEMAP = `https://${HOST}/sitemap.xml`;

async function sitemapUrls() {
  const res = await fetch(SITEMAP);
  if (!res.ok) throw new Error(`sitemap fetch failed: ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

const urlList = process.argv.length > 2 ? process.argv.slice(2) : await sitemapUrls();

// Sanity: the key file must be live before engines will accept the ping.
const keyRes = await fetch(`https://${HOST}/${KEY}.txt`);
if (!keyRes.ok || !(await keyRes.text()).includes(KEY)) {
  console.error(`key file https://${HOST}/${KEY}.txt is not live (${keyRes.status}); deploy first`);
  process.exit(1);
}

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList }),
});

// 200 = accepted, 202 = accepted (key validation pending). Anything else is a bug.
console.log(`IndexNow: ${res.status} ${res.statusText} for ${urlList.length} URLs`);
if (res.status !== 200 && res.status !== 202) {
  console.error(await res.text());
  process.exit(1);
}
