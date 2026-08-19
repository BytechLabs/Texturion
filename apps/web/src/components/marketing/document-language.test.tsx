/** @vitest-environment happy-dom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DocumentLanguage } from "./document-language";

/**
 * WCAG 2.2 §3.1.1 Language of Page, on the marketing routes.
 *
 * `/fr/contact` shipped French content inside `<html lang="en">`, in the same
 * week `docs/ACCESSIBILITY.md` gained a row claiming §3.1.1. The claim and the
 * page disagreed, and the claim is the one handed to a buyer — so this is a
 * gap I opened, closed, and checked.
 *
 * A screen reader picks its pronunciation from that attribute. French read by
 * an English engine is every word correct and none of it French.
 */

afterEach(() => {
  cleanup();
  document.documentElement.lang = "en";
});

describe("the marketing document declares its own language", () => {
  it("says fr-CA on a French route", () => {
    render(<DocumentLanguage locale="fr-CA" />);
    expect(document.documentElement.lang).toBe("fr-CA");
  });

  it("says en on an English route", () => {
    document.documentElement.lang = "fr-CA";
    render(<DocumentLanguage locale="en" />);
    // Not only "sets French when French": an English page after a French one
    // has to say English again, or a client-side navigation leaves the document
    // claiming the language of the page before it.
    expect(document.documentElement.lang).toBe("en");
  });

  it("follows a change rather than setting once", () => {
    const view = render(<DocumentLanguage locale="en" />);
    expect(document.documentElement.lang).toBe("en");
    view.rerender(<DocumentLanguage locale="fr-CA" />);
    expect(document.documentElement.lang).toBe("fr-CA");
  });

  it("renders nothing", () => {
    // It is an effect wearing a component's clothes; anything it drew would be
    // an unexplained node in the middle of the marketing frame.
    const { container } = render(<DocumentLanguage locale="fr-CA" />);
    expect(container.innerHTML).toBe("");
  });
});
