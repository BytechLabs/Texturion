/**
 * #232 phase 3 — which line a website conversation lands on.
 *
 * The rule these tests defend is not "read a column". It is that the SAME
 * number comes back both times: the widget resolves once to send the
 * verification code and again, in a later request, to thread the message. If
 * those two disagree, the visitor proves their phone against one line and the
 * crew's reply arrives from another — which reads, to the person who just
 * typed their number into a plumber's website, as a stranger texting them.
 */
import { describe, expect, it } from "vitest";

import { resolveWidgetNumber } from "./widget-number";

const FIRST = { id: "n1", number_e164: "+14155550101" };
const SECOND = { id: "n2", number_e164: "+14155550202" };

/**
 * The two queries the resolver makes, and nothing else.
 *
 * Hand-rolled rather than reaching for the routes harness because this is not
 * a route: a fake that answers exactly `companies.maybeSingle` and the ordered
 * `phone_numbers` list says what the resolver is allowed to depend on, and
 * fails loudly if it starts depending on more.
 */
function fakeDb(opts: {
  chosen?: string | null;
  active?: { id: string; number_e164: string }[];
}) {
  const active = opts.active ?? [FIRST, SECOND];
  return {
    from(table: string) {
      if (table === "companies") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({
            data: { widget_number_id: opts.chosen ?? null },
            error: null,
          }),
        };
        return chain;
      }
      if (table === "phone_numbers") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: async () => ({ data: active, error: null }),
        };
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

describe("#232 the widget's line", () => {
  it("WN-1: defaults to the workspace's first number", () => {
    // Null means "we have not been told", which is nearly every workspace:
    // Starter includes one number, so there is nothing to choose and nothing
    // is asked. The default has to be the behaviour they already had.
    return expect(resolveWidgetNumber(fakeDb({ chosen: null }), "c1")).resolves.toEqual(
      FIRST,
    );
  });

  it("WN-2: uses the number the owner chose", async () => {
    // The reason the column exists: a service line and a sales line in one
    // workspace, and the website should reach whichever one is staffed.
    await expect(resolveWidgetNumber(fakeDb({ chosen: "n2" }), "c1")).resolves.toEqual(
      SECOND,
    );
  });

  it("WN-3: a choice that is no longer active falls back rather than failing", async () => {
    // THE ONE THAT MATTERS. A chosen number can be released, suspended for
    // non-payment, or ported out, and none of those events knows the widget
    // exists. Refusing the submission would take a paid-for conversion offline
    // over a setting nobody remembers making — on the customer's website, where
    // they would not see it happen.
    await expect(
      resolveWidgetNumber(fakeDb({ chosen: "n2", active: [FIRST] }), "c1"),
    ).resolves.toEqual(FIRST);
  });

  it("WN-4: no active number at all resolves to nothing, not to a guess", async () => {
    // A workspace mid-signup, or one whose number was released. The caller
    // answers with the same "unavailable" it gives an unknown key, so a
    // stranger on somebody else's website learns nothing about why.
    await expect(
      resolveWidgetNumber(fakeDb({ chosen: null, active: [] }), "c1"),
    ).resolves.toBeNull();
  });

  it("WN-5: both halves of a submission get the same answer", async () => {
    // The whole point of one resolver. Called twice for one workspace — as the
    // start and verify routes do, minutes apart — it must not be able to
    // disagree with itself.
    const db = fakeDb({ chosen: "n2" });
    const forTheCode = await resolveWidgetNumber(db, "c1");
    const forTheThread = await resolveWidgetNumber(db, "c1");
    expect(forTheCode).toEqual(forTheThread);
  });
});
