import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../../..");
const android = "apps/android/app/src/main/kotlin/com/loonext/android/features/settings";
const ios = "apps/ios/Loonext/Features/Settings";

it.each([
  "apps/web/src/app/onboarding/business/page.tsx",
  "apps/web/src/app/onboarding/port/carrier/page.tsx",
  "apps/web/src/app/onboarding/port/timing/page.tsx",
  "apps/web/src/components/settings/registration-fix-form.tsx",
  "apps/web/src/components/settings/start-port-dialog.tsx",
  `${android}/RegistrationFixForm.kt`,
  `${android}/PortCards.kt`,
  `${ios}/RegistrationFixForm.swift`,
  `${ios}/PortCards.swift`,
])("does not ask for personal identifier fragments in %s", (file) => {
  const source = readFileSync(resolve(root, file), "utf8");
  expect(source).not.toMatch(/\b(?:SSN|SIN|NAS)\b|ssn_sin_last4|ssnSinLast4|last4Of|regSsn|regSin|portLast4/i);
});
