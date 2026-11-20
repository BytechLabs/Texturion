#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";

const android = new URL("../apps/android/app/src/main/kotlin/com/loonext/android/core/i18n/", import.meta.url);
const ios = new URL("../apps/ios/Loonext/Core/I18n/", import.meta.url);
const literal = String.raw`"(?:[^"\\]|\\.)*"`;
const entries = new RegExp(
  String.raw`^\s*"([a-zA-Z]\w*\.\w+)"\s*(?:to\b|:)\s*(${literal}(?:\s*\+\s*${literal})*)`,
  "gm",
);

const platformCopy = new Set([
  "settings.devicesAppLockHelp",
  "settings.cancelExportIntro",
  "settings.supportBodyApp",
  "settings.supportBodyAppNoVersion",
  "settingsMore.micRefused",
  "settingsMore.tfaFactorName",
  "settingsMore.tfaPasskeyFactorName",
  "settingsMore.tfaPasskeyPitch",
  "shell.lockCannotEnable",
  "thread.micNeededForCalls",
  // Android can retry after process exit. iOS resumes on the next launch.
  "thread.queuedOffline",
]);

// The screens display different amounts of detail for these actions.
const surfaceCopy = new Set([
  "contactsTasks.importChoose",
  "inbox.forYouAllCaughtUp",
  "inbox.forYouRecentCalls",
  "inbox.forYouWorkMany",
  "inbox.forYouWorkOne",
  "settings.cancelWhyAsk",
  "settings.enableUsStartedPaused",
  "settings.pauseOfferBody",
  "settings.winbackDismissFailed",
  "thread.deleteConversationBody",
  "thread.deleteConversationTitle",
  "thread.goToMessage",
]);

// These differences are already in use on both clients.
const existingCopy = new Set([
  "contactsTasks.assigneesCount",
  "contactsTasks.repeatEveryLabel",
  "contactsTasks.repeatKindAfterDone",
  "contactsTasks.repeatKindAfterDoneHint",
  "contactsTasks.repeatKindScheduleHint",
  "contactsTasks.repeatNeedsDue",
  "contactsTasks.scopeBody",
  "contactsTasks.scopeThis",
  "settings.cancelReasonSeasonal",
  "settings.noticeCancelling",
  "settings.noticeCancellingOn",
  "settings.planLineCalling",
  "settings.planLineExtraTexts",
  "settings.planLineTexting",
  "settings.prepaidEndsCredited",
  "settings.prepaidEndsPlain",
  "settings.prepaidHeading",
  "settingsMore.wirelessRequires",
  "shell.handOverUnsentMany",
  "thread.didYouMean",
]);

const distinctArguments = new Set([
  "settings.pauseOfferBody",
  "thread.deleteConversationBody",
  "thread.deleteConversationTitle",
]);

function catalogue(directory, extension) {
  const result = new Map();
  for (const file of readdirSync(directory).filter((name) => name.endsWith(extension))) {
    const source = readFileSync(new URL(file, directory), "utf8");
    for (const [, key, expression] of source.matchAll(entries)) {
      const values = result.get(key) ?? [];
      const fragments = expression.match(new RegExp(literal, "g"));
      values.push(fragments.map((fragment) => fragment.slice(1, -1)).join(""));
      result.set(key, values);
    }
  }
  return result;
}

function argumentsIn(text) {
  return [...new Set(Array.from(text.matchAll(/\{(\w+)\}/g), ([, argument]) => argument))]
    .toSorted((a, b) => a < b ? -1 : Number(a > b)).join(",");
}

const androidKeys = catalogue(android, ".kt");
const iosKeys = catalogue(ios, ".swift");
const shared = [...androidKeys.keys()].filter((key) => iosKeys.has(key));
const failures = [];

for (const key of shared) {
  const androidValues = androidKeys.get(key);
  const iosValues = iosKeys.get(key);
  if (androidValues.length !== 2 || iosValues.length !== 2) {
    failures.push(`${key} needs one English and one French value on each phone`);
    continue;
  }
  for (const [index, language] of ["English", "French"].entries()) {
    const androidValue = androidValues[index];
    const iosValue = iosValues[index];
    if (argumentsIn(androidValue) !== argumentsIn(iosValue) && !distinctArguments.has(key)) {
      failures.push(`${key} has different ${language} placeholders`);
    }
    if (androidValue !== iosValue &&
        !platformCopy.has(key) && !surfaceCopy.has(key) && !existingCopy.has(key)) {
      failures.push(`${key} has different ${language} copy`);
    }
  }
}

if (shared.length < 3000) failures.push(`Only ${shared.length} native catalogue keys matched`);
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Compared ${shared.length} shared keys in English and French`);
}
