/**
 * #722 phase 3: every machine that defines actions is served to clients as
 * `allowed_actions` by one API route file and read by one web file, one Android
 * file and one iOS file. A machine with actions and no row here, or a named file
 * that no longer mentions `allowed_actions`, fails. A client that does not offer
 * a machine's actions says why instead of naming a file.
 *
 * The phones keep their own roster beside their tests
 * (`AllowedActionsRosterTest.kt`, `AllowedActionsRosterTests.swift`); the last
 * two tests here hold those lists to this one.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ALL_MACHINES } from "./index";

const ROOT = join(__dirname, "..", "..", "..", "..");

const ANDROID = "apps/android/app/src/main/kotlin/com/loonext/android/";
const IOS = "apps/ios/Loonext/";

/** A file that reads `allowed_actions`, or the reason the client has none. */
type Reader = string | { none: string };

interface Served {
  api: string;
  web: string;
  android: Reader;
  ios: Reader;
}

const NO_CALENDAR_CONNECTION: Reader = {
  none: "Calendar connections are connected and removed on the web; the phones do not manage them.",
};
const NO_CALENDAR_LINK: Reader = {
  none: "Calendar links are managed on the web; the phones do not manage them.",
};

const ROSTER: Record<string, Served> = {
  call: {
    api: "apps/api/src/routes/calls.ts",
    web: "apps/web/src/components/calls/call-actions.tsx",
    android: ANDROID + "features/calls/CallsLogic.kt",
    ios: IOS + "Features/Calls/CallsLogic.swift",
  },
  scheduled_message: {
    api: "apps/api/src/routes/scheduled-messages.ts",
    web: "apps/web/src/lib/api/scheduled-messages.ts",
    android: ANDROID + "features/inbox/ScheduledSheet.kt",
    ios: IOS + "Features/Inbox/ScheduledSheet.swift",
  },
  calendar_connection: {
    api: "apps/api/src/routes/calendar-connections.ts",
    web: "apps/web/src/components/settings/calendar-connections-card.tsx",
    android: NO_CALENDAR_CONNECTION,
    ios: NO_CALENDAR_CONNECTION,
  },
  calendar_link: {
    api: "apps/api/src/routes/calendar-connections.ts",
    web: "apps/web/src/components/settings/calendar-connections-card.tsx",
    android: NO_CALENDAR_LINK,
    ios: NO_CALENDAR_LINK,
  },
  subscription: {
    api: "apps/api/src/routes/core/company-view.ts",
    web: "apps/web/src/lib/api/company-actions.ts",
    android: ANDROID + "features/settings/BillingSection.kt",
    ios: IOS + "Features/Settings/BillingSection.swift",
  },
  workspace: {
    api: "apps/api/src/routes/core/company-view.ts",
    web: "apps/web/src/lib/api/company-actions.ts",
    android: ANDROID + "features/settings/BillingSection.kt",
    ios: IOS + "Features/Settings/BillingSection.swift",
  },
  conversation: {
    api: "apps/api/src/routes/conversations.ts",
    web: "apps/web/src/components/thread/conversation-actions.tsx",
    android: ANDROID + "features/inbox/InboxTab.kt",
    ios: IOS + "Features/Inbox/InboxTab.swift",
  },
  conversation_visibility: {
    api: "apps/api/src/routes/conversations.ts",
    web: "apps/web/src/components/thread/conversation-actions.tsx",
    android: ANDROID + "ui/common/RecordActions.kt",
    ios: IOS + "Support/RecordActions.swift",
  },
  message: {
    api: "apps/api/src/routes/conversations.ts",
    web: "apps/web/src/components/thread/message-bubble.tsx",
    // The retry button on a bubble and the menu item both read `Message.retryable`.
    android: ANDROID + "core/model/Messaging.kt",
    ios: IOS + "Core/Model/Messaging.swift",
  },
  registration: {
    api: "apps/api/src/routes/registration.ts",
    web: "apps/web/src/components/settings/registration-section.tsx",
    android: ANDROID + "features/settings/RegistrationFixForm.kt",
    ios: IOS + "Features/Settings/RegistrationFixForm.swift",
  },
  payment_request: {
    api: "apps/api/src/routes/payments.ts",
    web: "apps/web/src/components/thread/payment-strip.tsx",
    android: ANDROID + "features/thread/PaymentStrip.kt",
    ios: IOS + "Features/Payments/ThreadPayments.swift",
  },
  phone_number: {
    api: "apps/api/src/routes/numbers.ts",
    web: "apps/web/src/components/settings/number-card.tsx",
    android: ANDROID + "features/settings/NumbersSection.kt",
    ios: IOS + "Features/Settings/NumbersSection.swift",
  },
  port: {
    api: "apps/api/src/routes/porting.ts",
    web: "apps/web/src/components/settings/port-card.tsx",
    android: ANDROID + "features/settings/PortCards.kt",
    ios: IOS + "Features/Settings/PortCards.swift",
  },
  quote: {
    api: "apps/api/src/routes/quotes.ts",
    web: "apps/web/src/components/thread/quote-strip.tsx",
    android: ANDROID + "features/thread/ThreadQuotes.kt",
    ios: IOS + "Features/Quotes/ThreadQuotes.swift",
  },
  text_enablement: {
    api: "apps/api/src/routes/text-enablement.ts",
    web: "apps/web/src/components/settings/text-enable-card.tsx",
    android: ANDROID + "features/settings/TextEnableCards.kt",
    ios: IOS + "Features/Settings/TextEnableCards.swift",
  },
  data_export: {
    api: "apps/api/src/routes/exports.ts",
    web: "apps/web/src/components/settings/export-data-card.tsx",
    android: ANDROID + "features/settings/UsageExportCard.kt",
    ios: IOS + "Features/Settings/UsageExportCard.swift",
  },
  task: {
    api: "apps/api/src/routes/tasks.ts",
    web: "apps/web/src/components/tasks/task-format.ts",
    android: ANDROID + "features/tasks/TaskRecordMenu.kt",
    ios: IOS + "Features/Tasks/TaskRecordMenu.swift",
  },
  invite: {
    api: "apps/api/src/routes/team.ts",
    web: "apps/web/src/app/(app)/settings/team/page.tsx",
    android: ANDROID + "features/settings/TeamSection.kt",
    ios: IOS + "Features/Settings/TeamSection.swift",
  },
};

function hasActions(machine: (typeof ALL_MACHINES)[number]): boolean {
  return (machine.states as readonly string[]).some(
    (state) => (machine.actions as (s: string, r: "owner") => readonly string[])(state, "owner").length > 0,
  );
}

function mentionsAllowedActions(file: string): boolean {
  const path = join(ROOT, file);
  return existsSync(path) && /allowed_?[aA]ctions/.test(readFileSync(path, "utf8"));
}

function readerFile(reader: Reader): string | null {
  return typeof reader === "string" ? reader : null;
}

/** The machine ids a phone roster test lists, by the pattern its rows are written in. */
function phoneRosterIds(file: string, row: RegExp): string[] {
  return [...readFileSync(join(ROOT, file), "utf8").matchAll(row)].map((match) => match[1] as string).sort();
}

describe("allowed_actions roster", () => {
  const withActions = ALL_MACHINES.filter(hasActions);

  it("checks at least one machine", () => {
    expect(withActions.length).toBeGreaterThan(0);
  });

  it("lists every machine that defines actions, and nothing else", () => {
    const ids = withActions.map((machine) => machine.id).sort();
    expect(Object.keys(ROSTER).sort()).toEqual(ids);
  });

  it("names an API route file and a web file that carry allowed_actions", () => {
    let checked = 0;
    for (const machine of withActions) {
      const entry = ROSTER[machine.id];
      if (!entry) continue;
      expect(mentionsAllowedActions(entry.api), `${machine.id}: ${entry.api}`).toBe(true);
      expect(mentionsAllowedActions(entry.web), `${machine.id}: ${entry.web}`).toBe(true);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("names an Android and an iOS file that read allowed_actions, or says why the phone has none", () => {
    let checked = 0;
    for (const machine of withActions) {
      const entry = ROSTER[machine.id];
      if (!entry) continue;
      for (const [client, reader] of [
        ["android", entry.android],
        ["ios", entry.ios],
      ] as const) {
        const file = readerFile(reader);
        if (file === null) {
          expect((reader as { none: string }).none.length, `${machine.id} ${client} needs a reason`).toBeGreaterThan(10);
          continue;
        }
        expect(mentionsAllowedActions(file), `${machine.id} ${client}: ${file}`).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("matches the machines the Android roster test lists", () => {
    const offered = Object.keys(ROSTER)
      .filter((id) => readerFile(ROSTER[id]!.android) !== null)
      .sort();
    const listed = phoneRosterIds(
      "apps/android/app/src/test/kotlin/com/loonext/android/AllowedActionsRosterTest.kt",
      /Row\("(\w+)"/g,
    );
    expect(listed.length).toBeGreaterThan(0);
    expect(listed).toEqual(offered);
  });

  it("matches the machines the iOS roster test lists", () => {
    const offered = Object.keys(ROSTER)
      .filter((id) => readerFile(ROSTER[id]!.ios) !== null)
      .sort();
    const listed = phoneRosterIds(
      "apps/ios/LoonextTests/AllowedActionsRosterTests.swift",
      /Row\(machine: "(\w+)"/g,
    );
    expect(listed.length).toBeGreaterThan(0);
    expect(listed).toEqual(offered);
  });
});
