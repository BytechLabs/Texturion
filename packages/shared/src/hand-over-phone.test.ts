import { describe, expect, it } from "vitest";

import {
  HAND_OVER_PHONE_ACTION,
  HAND_OVER_PHONE_CANCEL,
  HAND_OVER_PHONE_CONFIRM,
  HAND_OVER_PHONE_TITLE,
  handOverPhoneBody,
  handOverPhoneCosts,
} from "./hand-over-phone";

import { EN as WEB_EN, FR_CA as WEB_FR } from "../../../apps/web/src/i18n/catalog";

/*
 * #228 — this module names keys, so the assertions resolve them through the
 * catalogue. The web never renders this screen (it is "hand this PHONE over"),
 * but the catalogue is where the shared vocabulary lives for all three, and
 * both phones read the same keys from their own.
 */
function lookUp(table: unknown, key: string, lang: string): string {
  const [section, name] = key.split(".");
  const value = (table as Record<string, Record<string, string>>)[section]?.[name];
  if (typeof value !== "string") throw new Error(`no ${lang} for ${key}`);
  return value;
}

const say = (key: string): string => lookUp(WEB_EN, key, "English");
const sayFr = (key: string): string => lookUp(WEB_FR, key, "French");

describe("what the handover says (#330)", () => {
  it("names what leaves the phone, rather than saying 'your data'", () => {
    // The person handing it over is deciding whether it is safe to. "Some data
    // will be removed" does not answer that; the list does.
    const body = handOverPhoneBody(0, say);
    expect(body).toContain("conversations");
    expect(body).toContain("customers");
    expect(body).toContain("signed out");
  });

  it("says the next person signs in as themselves", () => {
    // The whole point. Handing the phone over signed in as somebody else is the
    // behaviour this replaces, and it attributes every reply to the wrong person.
    expect(handOverPhoneBody(0, say)).toContain("signs in as themselves");
  });

  it("warns about unsent messages, and counts them", () => {
    // Ending the session clears the outbox, so a handover discards whatever is
    // still waiting for signal. A number is actionable in a way that "any unsent
    // messages" is not.
    expect(handOverPhoneBody(1, say)).toContain("One message");
    expect(handOverPhoneBody(1, say)).toContain("discarded");
    expect(handOverPhoneBody(3, say)).toContain("3 messages");
    expect(handOverPhoneBody(3, say)).toContain("discarded");
  });

  it("tells somebody what to do instead, not just what they will lose", () => {
    expect(handOverPhoneBody(2, say)).toContain("signal");
  });

  it("says nothing about unsent messages when there are none", () => {
    // The common case is a clean handover. A warning that fires every time is a
    // warning nobody reads on the day it matters.
    const body = handOverPhoneBody(0, say);
    expect(body).not.toContain("discarded");
    expect(body).not.toContain("signal");
  });

  it("is one sentence longer, not a different screen, when there is a cost", () => {
    // Same dialog either way: a second layout for the warning case would be a
    // second thing to keep true.
    expect(handOverPhoneBody(1, say).startsWith(handOverPhoneBody(0, say))).toBe(true);
  });
});

describe("handOverPhoneCosts (#330)", () => {
  it("is true only when something would actually be lost", () => {
    expect(handOverPhoneCosts(0)).toBe(false);
    expect(handOverPhoneCosts(1)).toBe(true);
    expect(handOverPhoneCosts(9)).toBe(true);
  });
});

describe("the labels (#330)", () => {
  it("names the intent rather than the mechanism", () => {
    // "Sign out" describes what the code does. "Hand this phone to someone else"
    // is the sentence already in the head of the person about to do it.
    expect(say(HAND_OVER_PHONE_ACTION).toLowerCase()).toContain("phone");
    expect(say(HAND_OVER_PHONE_ACTION).toLowerCase()).toContain("someone else");
  });

  it("makes both buttons say what they do", () => {
    // Not "OK"/"Cancel". Either of these is a reasonable choice on a job site, and
    // the wrong one costs either a customer's privacy or an unsent message.
    expect(say(HAND_OVER_PHONE_CONFIRM).toLowerCase()).toContain("sign out");
    expect(say(HAND_OVER_PHONE_CANCEL).toLowerCase()).toContain("stay signed in");
  });
});

/*
 * #228 — the warning has to survive translation, in both directions.
 *
 * This is the screen where somebody decides whether handing the phone over
 * costs them an unsent message. A French reader getting the plural form for one
 * message reads "1 messages" and a half-translated warning reads as a bug in
 * the thing that is about to delete their outbox.
 */
describe("#228 the handover reads in French too", () => {
  it("keeps the one-message case singular", () => {
    expect(handOverPhoneBody(1, sayFr)).not.toMatch(/1 messages/);
    expect(handOverPhoneBody(3, sayFr)).toContain("3");
  });

  it("says every one of its lines in French, and differently", () => {
    for (const key of [
      HAND_OVER_PHONE_ACTION,
      HAND_OVER_PHONE_TITLE,
      HAND_OVER_PHONE_CONFIRM,
      HAND_OVER_PHONE_CANCEL,
    ]) {
      expect(sayFr(key).length, key).toBeGreaterThan(0);
      expect(sayFr(key), `${key} is not translated`).not.toBe(say(key));
    }
  });

  it("gives the confirm and the cancel different words", () => {
    // The two buttons on a destructive dialog. A catalogue that answered the
    // same string for both would satisfy every assertion above and leave
    // somebody guessing which one keeps their messages.
    expect(sayFr(HAND_OVER_PHONE_CONFIRM)).not.toBe(sayFr(HAND_OVER_PHONE_CANCEL));
  });
});
