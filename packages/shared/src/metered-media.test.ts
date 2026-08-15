import { describe, expect, it } from "vitest";

import {
  METERED_ORIGINAL_HINT,
  WIFI_ONLY_DESCRIPTION,
  WIFI_ONLY_LABEL,
  mayFetchMedia,
  type ConnectionKind,
} from "./metered-media";

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

/** #228 — the module names keys now, so the copy assertions resolve them. */
function look(table: unknown, key: string): string {
  const [section, name] = key.split(".");
  const value = (table as Record<string, Record<string, string>>)[section]?.[
    name
  ];
  if (typeof value !== "string") throw new Error(`no entry for ${key}`);
  return value;
}

/**
 * #289 — "download photos on Wi-Fi only, at minimum".
 *
 * Vectors shared with the Kotlin and Swift ports. The thing worth holding here
 * is the LINE the setting cuts along: #240 made a thread fetch a 200 KB preview
 * and a full-size view fetch the original, and the setting follows that split
 * rather than blocking photos outright. A phone that got this wrong would show
 * a wall of grey rectangles on a job site, which is how a deliberate setting
 * gets reported as a broken app.
 */
const ALL: ConnectionKind[] = ["unmetered", "metered", "unknown"];

describe("the thread always reads", () => {
  it("lets the preview through on every connection, setting or no setting", () => {
    // The preview IS the thread. Blocking it would make the app look broken to
    // somebody who turned a setting on last month and has no idea why today's
    // photos will not load.
    for (const connection of ALL) {
      for (const wifiOnlyOriginals of [true, false]) {
        expect(
          mayFetchMedia({
            variant: "preview",
            connection,
            wifiOnlyOriginals,
            requested: false,
          }),
          `${connection}/${wifiOnlyOriginals}`,
        ).toBe(true);
      }
    }
  });
});

describe("the full-size photo waits", () => {
  it("loads normally when the setting is off", () => {
    // Default off: #289 says most people will never open the setting, and
    // putting a tap between every tradesperson and every photo would solve a
    // problem most of them do not have.
    for (const connection of ALL) {
      expect(
        mayFetchMedia({
          variant: "original",
          connection,
          wifiOnlyOriginals: false,
          requested: false,
        }),
        connection,
      ).toBe(true);
    }
  });

  it("loads on Wi-Fi even with the setting on", () => {
    expect(
      mayFetchMedia({
        variant: "original",
        connection: "unmetered",
        wifiOnlyOriginals: true,
        requested: false,
      }),
    ).toBe(true);
  });

  it("waits on mobile data with the setting on", () => {
    expect(
      mayFetchMedia({
        variant: "original",
        connection: "metered",
        wifiOnlyOriginals: true,
        requested: false,
      }),
    ).toBe(false);
  });

  it("loads the one the person tapped", () => {
    // A per-image escape rather than a per-session one: the point of the
    // setting is that data is spent deliberately, and "load this one" is the
    // deliberate act.
    expect(
      mayFetchMedia({
        variant: "original",
        connection: "metered",
        wifiOnlyOriginals: true,
        requested: true,
      }),
    ).toBe(true);
  });

  it("treats a connection the OS will not describe as unmetered", () => {
    // A phone that cannot answer is usually a phone without the permission to
    // answer. The failure we can afford is spending data somebody did not want
    // spent — not a photo that never loads with no way to find out why.
    expect(
      mayFetchMedia({
        variant: "original",
        connection: "unknown",
        wifiOnlyOriginals: true,
        requested: false,
      }),
    ).toBe(true);
  });
});

describe("what the reader is told", () => {
  it("names the condition and the remedy in one line", () => {
    // The alternative — a spinner that never resolves, or a generic "couldn't
    // load" — is how a deliberate setting gets reported as a bug.
    const en = look(WEB_EN, METERED_ORIGINAL_HINT);
    expect(en).toContain("mobile data");
    expect(en.toLowerCase()).toContain("tap");

    // #228 — both halves in French too. A translation that kept only the
    // condition ("Vous êtes sur les données mobiles.") would leave a reader
    // looking at a photo that never arrives with nothing to do about it, which
    // is the exact failure this sentence was written to prevent.
    const fr = look(WEB_FR, METERED_ORIGINAL_HINT);
    expect(fr.toLowerCase()).toContain("données mobiles");
    expect(fr.toLowerCase()).toContain("touchez");
  });

  it("#228: the setting says what still loads, in both languages", () => {
    // The description exists to stop the label reading as "photos are off".
    // Threads and galleries always load; only the full-size fetch waits.
    for (const [language, table] of [
      ["English", WEB_EN],
      ["French", WEB_FR],
    ] as const) {
      const description = look(table, WIFI_ONLY_DESCRIPTION);
      expect(description.length, language).toBeGreaterThan(40);
      expect(description, language).not.toBe(look(table, WIFI_ONLY_LABEL));
    }
    expect(look(WEB_FR, WIFI_ONLY_LABEL)).not.toBe(
      look(WEB_EN, WIFI_ONLY_LABEL),
    );
  });
});
