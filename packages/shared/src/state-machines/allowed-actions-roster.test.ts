/**
 * #722 phase 3: every machine that defines actions is served to clients as
 * `allowed_actions` by one API route file and read by one web file. A machine
 * with actions and no row here, or a named file that no longer mentions
 * `allowed_actions`, fails.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ALL_MACHINES } from "./index";

const ROOT = join(__dirname, "..", "..", "..", "..");

interface Served {
  api: string;
  web: string;
}
interface ClientOnly {
  clientOnly: string;
}

const ROSTER: Record<string, Served | ClientOnly> = {
  call: { api: "apps/api/src/routes/calls.ts", web: "apps/web/src/components/calls/call-actions.tsx" },
  scheduled_message: {
    api: "apps/api/src/routes/scheduled-messages.ts",
    web: "apps/web/src/lib/api/scheduled-messages.ts",
  },
  calendar_connection: {
    api: "apps/api/src/routes/calendar-connections.ts",
    web: "apps/web/src/components/settings/calendar-connections-card.tsx",
  },
  calendar_link: {
    api: "apps/api/src/routes/calendar-connections.ts",
    web: "apps/web/src/components/settings/calendar-connections-card.tsx",
  },
  subscription: {
    api: "apps/api/src/routes/core/company-view.ts",
    web: "apps/web/src/lib/api/company-actions.ts",
  },
  workspace: {
    api: "apps/api/src/routes/core/company-view.ts",
    web: "apps/web/src/lib/api/company-actions.ts",
  },
  conversation: {
    api: "apps/api/src/routes/conversations.ts",
    web: "apps/web/src/components/thread/conversation-actions.tsx",
  },
  conversation_visibility: {
    api: "apps/api/src/routes/conversations.ts",
    web: "apps/web/src/components/thread/conversation-actions.tsx",
  },
  message: {
    api: "apps/api/src/routes/conversations.ts",
    web: "apps/web/src/components/thread/message-bubble.tsx",
  },
  registration: {
    api: "apps/api/src/routes/registration.ts",
    web: "apps/web/src/components/settings/registration-section.tsx",
  },
  payment_request: {
    api: "apps/api/src/routes/payments.ts",
    web: "apps/web/src/components/thread/payment-strip.tsx",
  },
  phone_number: {
    api: "apps/api/src/routes/numbers.ts",
    web: "apps/web/src/components/settings/number-card.tsx",
  },
  port: {
    api: "apps/api/src/routes/porting.ts",
    web: "apps/web/src/components/settings/port-card.tsx",
  },
  quote: {
    api: "apps/api/src/routes/quotes.ts",
    web: "apps/web/src/components/thread/quote-strip.tsx",
  },
  text_enablement: {
    api: "apps/api/src/routes/text-enablement.ts",
    web: "apps/web/src/components/settings/text-enable-card.tsx",
  },
  data_export: {
    api: "apps/api/src/routes/exports.ts",
    web: "apps/web/src/components/settings/export-data-card.tsx",
  },
  task: {
    api: "apps/api/src/routes/tasks.ts",
    web: "apps/web/src/components/tasks/task-format.ts",
  },
  invite: {
    api: "apps/api/src/routes/team.ts",
    web: "apps/web/src/app/(app)/settings/team/page.tsx",
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
      if (!entry || "clientOnly" in entry) continue;
      expect(mentionsAllowedActions(entry.api), `${machine.id}: ${entry.api}`).toBe(true);
      expect(mentionsAllowedActions(entry.web), `${machine.id}: ${entry.web}`).toBe(true);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("gives every clientOnly entry a reason", () => {
    for (const entry of Object.values(ROSTER)) {
      if ("clientOnly" in entry) expect(entry.clientOnly.length).toBeGreaterThan(10);
    }
  });
});
