import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

import { TRANSLATED_PAGES, localizedPath } from "../src/lib/marketing/translated-pages.ts";

const origin = "https://loonext.com";
const dom = new Window();
const parser = new dom.DOMParser();
const errors = [];
let pages = 0;
let links = 0;

for (const page of TRANSLATED_PAGES) {
  if (page.index === false) continue;
  const file = new URL(`../.next/server/app${page.fr}.html`, import.meta.url);
  const html = readFileSync(file, "utf8");
  const document = parser.parseFromString(html, "text/html");
  if (document.documentElement.lang !== "fr-CA") {
    errors.push(`${page.fr}: expected lang="fr-CA"`);
  }
  const openGraphLocale = document.querySelector('meta[property="og:locale"]');
  if (openGraphLocale?.getAttribute("content") !== "fr_CA") {
    errors.push(`${page.fr}: expected og:locale="fr_CA"`);
  }
  pages++;

  for (const anchor of document.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    const target = new URL(href, new URL(page.fr, origin));
    if (target.origin !== origin || anchor.getAttribute("hreflang") === "en") continue;
    links++;
    const expected = localizedPath(target.pathname, "fr-CA");
    if (expected !== target.pathname) {
      errors.push(`${page.fr}: ${href} should link to ${expected}`);
    }
  }
}

await dom.happyDOM.close();
console.log(`Checked ${pages} French pages and ${links} internal links.`);
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
}
