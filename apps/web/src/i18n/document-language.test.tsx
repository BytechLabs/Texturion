/** @vitest-environment happy-dom */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LocaleProvider, useLocale } from "./provider";

/**
 * WCAG 2.2 §3.1.1 Language of Page — Level A.
 *
 * ## What was wrong
 *
 * `app/layout.tsx` hard-codes `<html lang="en">`. That was true of every page
 * until the app learned a second language and false of every French page after.
 *
 * The consequence is not cosmetic. A screen reader chooses its pronunciation
 * rules from this attribute, so a French sentence under `lang="en"` is read
 * aloud by an English speech engine: the words are correct and the speech is
 * not French. It also tells translation tooling and search engines that a page
 * of French is English.
 *
 * ## Why it is asserted here rather than in the layout
 *
 * The layout renders on the SERVER, where no member's locale exists — the
 * language is a person's setting that arrives from `/v1/me` after the document
 * has been sent. So the attribute can only be correct if something sets it
 * once the locale resolves, and this is the check that something does.
 *
 * We publish a WCAG 2.2 **Level AA** conformance statement (`docs/
 * ACCESSIBILITY.md`), which includes every Level A criterion. A statement
 * handed to a buyer is the wrong document to have quietly outrun.
 */

function Probe() {
  const { locale } = useLocale();
  return <span>{locale}</span>;
}

describe("the document declares the language it is actually in", () => {
  it("says English for an English reader", () => {
    render(
      <LocaleProvider userLocale="en">
        <Probe />
      </LocaleProvider>,
    );
    expect(document.documentElement.lang).toBe("en");
  });

  it("says fr-CA for a French reader", () => {
    render(
      <LocaleProvider userLocale="fr-CA">
        <Probe />
      </LocaleProvider>,
    );
    // The exact tag matters: "fr" and "fr-CA" pick different voices, and
    // Quebec French is the one this product is written in.
    expect(document.documentElement.lang).toBe("fr-CA");
  });

  it("follows the same order the rest of the app follows", () => {
    // user > device > company > English (#228). A member reading in English on
    // a French workspace is reading English, and the document has to agree —
    // this is the case where a per-URL locale would have got it wrong.
    render(
      <LocaleProvider userLocale="en" companyLocale="fr-CA" deviceLocale="fr-CA">
        <Probe />
      </LocaleProvider>,
    );
    expect(document.documentElement.lang).toBe("en");
  });

  it("changes when the reader's language changes", () => {
    // Not a one-shot on mount: somebody switching language in settings stays on
    // the same page, and an attribute set once would leave the document
    // claiming the language they just left.
    const view = render(
      <LocaleProvider userLocale="en">
        <Probe />
      </LocaleProvider>,
    );
    expect(document.documentElement.lang).toBe("en");
    view.rerender(
      <LocaleProvider userLocale="fr-CA">
        <Probe />
      </LocaleProvider>,
    );
    expect(document.documentElement.lang).toBe("fr-CA");
  });
});
