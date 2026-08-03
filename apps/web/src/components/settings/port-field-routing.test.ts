/**
 * #319 — every field a port rejection names is one the fix form actually
 * carries, and can be reached.
 *
 * The rejection notice ends with "Take me to it", which scrolls to and focuses
 * the input the catalogue blames. It finds that input by `[name="<field>"]`.
 * The catalogue's field names and the form's inputs are two lists in two files
 * with nothing connecting them, so they can drift into a button that renders,
 * looks like help, and does nothing when tapped. That is worse than no button:
 * the customer concludes the product is broken on the screen where they were
 * already told their transfer was rejected.
 *
 * It HAD drifted before this test existed. The port form rendered `id` only —
 * the registration form gets `name` for free from react-hook-form's field
 * spread, and this one is controlled by hand — so every port rejection shipped
 * an inert button.
 *
 * Driven off the shared parity vectors rather than a list written here, so a
 * catalogue entry added later is checked without anybody remembering this file.
 * `LoonextTests/PortRejectionRoutingTests.swift` asserts the same thing on iOS.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { explainRejection } from "@loonext/shared";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

interface Vector {
  domain: string;
  reason: string;
  recognised: boolean;
  field: string | null;
}

function portVectors(): Vector[] {
  const raw = readFileSync(
    join(REPO_ROOT, "packages/shared/vectors/rejections.json"),
    "utf8",
  );
  const parsed: unknown = JSON.parse(raw);
  const rows = Array.isArray(parsed) ? (parsed as Vector[]) : [];
  return rows.filter((row) => row.domain === "port");
}

/** The `name` of every input the port fix form renders. */
function formFieldNames(): string[] {
  const source = readFileSync(
    join(import.meta.dirname, "port-fix-form.tsx"),
    "utf8",
  );
  // The FIELDS table is the form's own list; reading it keeps this test honest
  // if a field is renamed, rather than pinning a copy of the names here.
  return [...source.matchAll(/key:\s*"([a-z_]+)"/g)].map((m) => m[1]);
}

describe("#319 a port rejection can reach the field it blames", () => {
  it("reads real vectors and a real form, so a pass means something", () => {
    expect(portVectors().length).toBeGreaterThan(0);
    expect(formFieldNames().length).toBeGreaterThan(3);
  });

  it("every field the catalogue names is one the form renders", () => {
    const names = new Set(formFieldNames());
    const missing: string[] = [];
    for (const vector of portVectors()) {
      const guidance = explainRejection("port", vector.reason);
      const field = guidance?.field;
      if (!field) continue;
      if (!names.has(field)) missing.push(`${vector.reason} -> ${field}`);
    }
    expect(
      missing,
      `The catalogue sends these rejections to a field the port fix form does ` +
        `not render, so "Take me to it" would do nothing: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("the form gives those inputs a name, which is how they are found", () => {
    // The defect this file was written for. `id` alone is invisible to
    // `querySelector('[name=...]')`, so the button was inert on every port
    // rejection while looking exactly like help.
    const source = readFileSync(
      join(import.meta.dirname, "port-fix-form.tsx"),
      "utf8",
    );
    expect(source).toMatch(/name=\{field\.key\}/);
  });
});
