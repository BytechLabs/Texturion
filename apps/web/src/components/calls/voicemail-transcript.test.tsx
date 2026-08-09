/**
 * #566 — the one transcript renderer, and the control that gets it out.
 *
 * The founder: *"What about other UX like copying the transcription? By holding?
 * Or something? Idk"*
 *
 * This component exists because the same paragraph was rendered at four places on
 * web with four sets of class strings that had already drifted. The tests worth
 * having are therefore about the thing that made it worth naming: the control is
 * always there, it does not navigate, and the text is what yields.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VoicemailTranscript } from "./voicemail-transcript";

const WORDS =
  "Hi, this is Priya at 44 Maple. The upstairs faucet has really low pressure.";

describe("VoicemailTranscript", () => {
  it("renders the words and a way to copy them", () => {
    const html = renderToStaticMarkup(<VoicemailTranscript text={WORDS} />);
    expect(html).toContain(WORDS);
    // Icon-only, so the label is the only thing naming the action.
    expect(html).toContain('aria-label="Copy transcript"');
  });

  it("never lets the control be the thing that shrinks", () => {
    // The whole lesson of this issue: the prose reflows, the control does not.
    const html = renderToStaticMarkup(<VoicemailTranscript text={WORDS} />);
    const button = html.slice(html.indexOf("<button"));
    expect(button).toContain("shrink-0");
    // And the prose is allowed to be narrower than its content.
    expect(html).toContain("min-w-0 flex-1");
  });

  it("is a button, not a link — these live inside an <a>", () => {
    // A call row is a Link and a thread event line sits in one. `type="button"`
    // plus the handler's preventDefault/stopPropagation is what stops a copy
    // from navigating; the type is the half a test can see.
    const html = renderToStaticMarkup(<VoicemailTranscript text={WORDS} />);
    expect(html).toContain('type="button"');
  });

  it("reads at body size on a reading surface, and quietly in a row", () => {
    // The call permalink is where somebody followed a link to READ this; a row is
    // where they are scanning past it.
    const row = renderToStaticMarkup(<VoicemailTranscript text={WORDS} />);
    const page = renderToStaticMarkup(
      <VoicemailTranscript text={WORDS} prominent />,
    );
    expect(row).toContain("text-[12.5px]");
    expect(row).toContain("text-app-muted");
    expect(page).toContain("text-sm");
    expect(page).toContain("text-app-ink");
  });

  it("takes a caller's spacing without losing its own layout", () => {
    const html = renderToStaticMarkup(
      <VoicemailTranscript text={WORDS} className="mt-1.5" />,
    );
    expect(html).toContain("mt-1.5");
    expect(html).toContain("flex items-start gap-1.5");
  });
});
