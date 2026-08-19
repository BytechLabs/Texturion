import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createSessionRuntime } from "./runtime";
import { completeEnv } from "../test/support";

import {
  afterHoursDefaultGreeting,
  defaultGreeting,
  sanitizeGreeting,
} from "../messaging/inbound-ring";
import { unavailableNotice, UNAVAILABLE_NOTICE } from "./transitions";

/**
 * #228 — what WE say aloud to a caller, in the language the business works in.
 *
 * Three sentences on a call are ours rather than the business's: the
 * unavailable notice (#490 states it is explicitly not their greeting), the
 * default greeting a workspace that never recorded one gets, and the
 * after-hours default. All three were English on every call, so a customer
 * ringing a French business heard an English sentence in that business's voice
 * — on the phone, where there is no screen to explain it.
 *
 * These are pure functions, which is the whole reason this file can exist: the
 * call path itself needs a Durable Object and a carrier, and the WORDS need
 * neither.
 */
describe("#228 the words we speak to a caller", () => {
  const NAME = "Brightside Plumbing";

  it("refuses a call in French for a French workspace", () => {
    expect(unavailableNotice("fr-CA")).toContain("Réessayez plus tard");
    expect(unavailableNotice("fr-CA")).not.toContain("try again later");
  });

  it("keeps the English refusal exactly as it was", () => {
    // Unchanged wording for every workspace already hearing it: this is a new
    // language, not a rewrite of the one that shipped.
    expect(unavailableNotice("en")).toBe(UNAVAILABLE_NOTICE);
    expect(unavailableNotice(undefined)).toBe(UNAVAILABLE_NOTICE);
    expect(unavailableNotice("de")).toBe(UNAVAILABLE_NOTICE);
  });

  it("speaks our default greeting in French, and keeps the name", () => {
    const fr = defaultGreeting(NAME, "fr-CA");
    expect(fr).toContain("Laissez un message");
    // The company name is a proper noun and the one part of the sentence that
    // is theirs — translating it would rename the business.
    expect(fr).toContain(NAME);
    expect(fr).not.toContain("leave a message");
  });

  it("speaks the after-hours default in French, with the reopening time", () => {
    const fr = afterHoursDefaultGreeting(NAME, "Monday at 8am", "fr-CA");
    expect(fr).toContain("fermés");
    // `nextOpen` is formatted by the caller, so it is interpolated rather than
    // rebuilt — the assertion is that it still arrives.
    expect(fr).toContain("Monday at 8am");
    expect(fr).not.toContain("We're closed");
  });

  it("omits the reopening clause in both languages when there is none", () => {
    expect(afterHoursDefaultGreeting(NAME, null, "fr-CA")).not.toContain("—");
    expect(afterHoursDefaultGreeting(NAME, null)).not.toContain("—");
  });

  it("returns an owner's OWN greeting untouched, whatever the locale", () => {
    // #518: a sentence of ours bolted onto theirs is not an improvement they
    // asked for, and that holds in both languages. Only our FALLBACK has a
    // language to get right.
    const own = "Salut, c'est Marc. Laissez-moi un message.";
    expect(sanitizeGreeting(own, NAME, "fr-CA")).toBe(own);
    expect(sanitizeGreeting(own, NAME, "en")).toBe(own);
  });

  it("falls back in the workspace's language when they wrote nothing", () => {
    expect(sanitizeGreeting(null, NAME, "fr-CA")).toBe(defaultGreeting(NAME, "fr-CA"));
    expect(sanitizeGreeting("   ", NAME, "fr-CA")).toBe(defaultGreeting(NAME, "fr-CA"));
    expect(sanitizeGreeting(null, NAME)).toBe(defaultGreeting(NAME));
  });
});

/**
 * AND THAT THE CALL PATH ACTUALLY PASSES IT.
 *
 * The block above tests the words. It says nothing about whether
 * `greetingText` hands them the machine's locale — and it did not: dropping
 * the argument from the runtime left every assertion above green, which is the
 * decorative-guard shape this repo keeps finding. A test of a pure function is
 * not a test of the wiring to it.
 */
describe("#228 the call path hands the locale to the words", () => {
  const rt = createSessionRuntime(completeEnv());

  it("speaks our default greeting in the machine's language", () => {
    const spoken = rt.greetingText({
      companyName: "Reed Roofing",
      greeting: null,
      afterHours: false,
      nextOpenLabel: null,
      locale: "fr-CA",
    } as never);
    expect(spoken).toContain("Laissez un message");
    expect(spoken).not.toContain("leave a message");
  });

  it("speaks the after-hours default in the machine's language", () => {
    const spoken = rt.greetingText({
      companyName: "Reed Roofing",
      greeting: null,
      afterHours: true,
      nextOpenLabel: "demain à 8h",
      locale: "fr-CA",
    } as never);
    expect(spoken).toContain("fermés");
    expect(spoken).toContain("demain à 8h");
  });

  it("stays English for a machine with no locale, as every session before this had", () => {
    // A call persisted before this shipped resumes without the field. It must
    // speak what it always spoke rather than throw or render undefined.
    const spoken = rt.greetingText({
      companyName: "Reed Roofing",
      greeting: null,
      afterHours: false,
      nextOpenLabel: null,
    } as never);
    expect(spoken).toContain("leave a message");
  });
});

/**
 * AND THAT THE COMPANY ROW IS ASKED FOR IT.
 *
 * The two blocks above cover the words and the wiring from the machine. Neither
 * can see the step before: if the inbound path stops SELECTING `locale`, the
 * context carries undefined, every machine is English, and all ten assertions
 * stay green.
 *
 * A source check, and a floor rather than a proof — it cannot tell that the
 * column reaches the context, only that it is still asked for. Exercising the
 * real loader needs a stubbed carrier, a stubbed database and a frozen clock,
 * which `runtime.after-hours.test.ts` already stands up; this is the cheap
 * assertion that the one thing those fixtures would not notice has not been
 * quietly deleted.
 */
describe("#228 the inbound path reads the company's language", () => {
  const source = readFileSync(
    join(import.meta.dirname, "runtime.ts"),
    "utf8",
  );

  it("selects locale on the company row the call path loads", () => {
    const at = source.indexOf('"id,name,plan,current_period_start');
    expect(at, "the inbound company select has moved or been renamed").toBeGreaterThan(-1);
    // Within the select expression, not anywhere in the file: `locale` appears
    // in prose and in other queries throughout this module.
    const select = source.slice(at, source.indexOf(".eq(", at));
    expect(
      select,
      "the inbound company select no longer asks for locale, so every call " +
        "speaks English whatever the workspace is set to",
    ).toContain("locale");
  });

  it("hands it to the session context", () => {
    expect(
      source,
      "loadInitiatedContext no longer puts the locale on the context",
    ).toContain(".locale ?? undefined");
  });
});
