import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

import { localizedPath, TRANSLATED_PAGES } from "../src/lib/marketing/translated-pages.ts";

const origin = "https://loonext.com";
const dom = new Window();
const parser = new dom.DOMParser();
const errors = [];
const sharedLabels = new Set([
  "Loonext", "Bytech Labs", "Loonext Pro", "Loonext Starter", "Pro", "Starter",
  "Loonext vs Heymarket", "Loonext vs Quo", "Heymarket Standard", "Quo", "Quo Starter",
  "Canada", "CA, Canada", ", Canada", "Contacts", "HVAC", "Salons",
  "Alicia G", "Bri L", "Dale K", "Dan R", "Diane Alvarez", "Greg P", "Jordan P",
  "Karen H", "Karen M", "Karen Mullins", "Marcus O", "Marcus T", "Morgan W", "Nadia K",
  "Nguyen family", "Priya R", "Rivera, D.", "The Hendersons", "Theo B",
  "Firebase Cloud Messaging", "STOP", "us-east-1", "{first_name}",
  "Province", "Alberta", "Saskatchewan", "Manitoba", "Ontario", "PRDKMO",
  "Telnyx", "Stripe", "Supabase", "Resend", "GoogleFirebase Cloud Messaging", "PostHog",
  "Authorization: Bearer lnx_…", "Loonext-Signature: t=…,v1=…", "Loonext-Api-Version",
]);
const visibleLabels = "h1,h2,h3,h4,h5,p,li,a,button,label,summary,span,dt,dd,th,td,figcaption,blockquote";
let pages = 0;
let links = 0;
let labels = 0;

function allowedSharedLabel(label) {
  const withoutTime = label.replace(/\s*\d{1,2}:\d{2} [AP]M$|\s*\d+[mh]$/u, "");
  return sharedLabels.has(withoutTime) || !/\p{L}/u.test(withoutTime) ||
    /^[A-Z]{1,2}$/u.test(withoutTime) || withoutTime === "o" ||
    /^[^\s@]+@loonext\.com$/u.test(withoutTime) || /^\d+[a-z]$/u.test(withoutTime) ||
    /^\(\d{3}\) · Toronto$/u.test(withoutTime) || /^Jordan P · \(\d{3}\) \d{3}-\d{4}$/u.test(withoutTime);
}

function developerIdentifier(path, label) {
  return path === "/fr/developpeurs" && /^(?:\/?public\/v\d+|(?:GET|POST|DELETE) \/[a-z/:]+|[a-z]+[:.][a-z_]+)$/u.test(label);
}

function renderedLabels(document) {
  for (const element of document.querySelectorAll("script,style,template,svg,code,pre,[hidden],a[hreflang=en]")) {
    element.remove();
  }
  return new Set(Array.from(document.body.querySelectorAll(visibleLabels),
    (element) => element.textContent.replaceAll(/\s+/gu, " ").trim()).filter(Boolean));
}

function readPage(path) {
  const file = new URL(`../.next/server/app${path === "/" ? "/index" : path}.html`, import.meta.url);
  return parser.parseFromString(readFileSync(file, "utf8"), "text/html");
}

for (const page of TRANSLATED_PAGES) {
  if (page.index === false) continue;
  const document = readPage(page.fr);
  if (document.documentElement.lang !== "fr-CA") {
    errors.push(`${page.fr}: expected lang="fr-CA"`);
  }
  const openGraphLocale = document.querySelector('meta[property="og:locale"]');
  if (openGraphLocale?.getAttribute("content") !== "fr_CA") {
    errors.push(`${page.fr}: expected og:locale="fr_CA"`);
  }
  pages += 1;

  for (const anchor of document.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    const target = new URL(href, new URL(page.fr, origin));
    if (target.origin !== origin || anchor.getAttribute("hreflang") === "en") continue;
    links += 1;
    const expected = localizedPath(target.pathname, "fr-CA");
    if (expected !== target.pathname) {
      errors.push(`${page.fr}: ${href} should link to ${expected}`);
    }
    if (["/signup", "/login"].includes(target.pathname) && target.searchParams.get("lang") !== "fr-CA") {
      errors.push(`${page.fr}: ${href} should carry lang=fr-CA`);
    }
  }

  const english = renderedLabels(readPage(page.en));
  const french = renderedLabels(document);
  labels += french.size;
  for (const label of french) {
    if (english.has(label) && !allowedSharedLabel(label) && !developerIdentifier(page.fr, label) &&
        !(page.fr === "/fr/sous-traitants" && /^@cf\/[\w./-]+(?:, @cf\/[\w./-]+)*$/u.test(label))) {
      errors.push(`${page.fr}: identical English and French label ${JSON.stringify(label)}`);
    }
  }
}

await dom.happyDOM.close();
console.log(`Checked ${pages} French pages, ${labels} rendered labels, and ${links} internal links.`);
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
}
