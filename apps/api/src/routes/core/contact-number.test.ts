import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

import { stripComments } from "../../test/source-tree";

const creationPaths = [
  ["contacts.ts", 'contactsRoutes.post("/contacts",', "contactNumberOwner("],
  ["contacts.ts", "async function upsertImportedContacts(", "contactNumberOwners("],
  ["contacts.ts", '"/contacts/:id/phones",', "contactNumberOwner("],
  ["compose.ts", "async function resolveComposeContact(", "contactNumberOwner("],
  ["public-api.ts", "`${PUBLIC_API_BASE}/contacts`,\n  requireScope(\"contacts:write\")", "contactNumberOwner("],
] as const;

it.each(creationPaths)("resolves primary and alternate owners in %s near %s", (file, start, resolver) => {
  const source = stripComments(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
  const index = source.indexOf(start);
  expect(index).toBeGreaterThanOrEqual(0);
  const remainder = source.slice(index + start.length);
  const end = remainder.search(/\n(?:async function|[A-Za-z]+Routes\.|(?:export )?const )/);
  const section = remainder.slice(0, end < 0 ? undefined : end);
  expect(section).toContain(resolver);
  expect(section).not.toMatch(/\.from\("contacts"\)(?:(?!\.from\(|;)[\s\S])*?\.eq\("phone_e164"/);
});
