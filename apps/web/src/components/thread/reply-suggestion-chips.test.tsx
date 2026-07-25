import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * The drafts strip. Pins the offer to fill in what Lou has not been told: the
 * setting exists either way, but almost nobody goes looking for it, and the
 * moment the gap is felt is when the drafts are on screen and vaguer than they
 * need to be.
 */
import { ReplySuggestionChips } from "./reply-suggestion-chips";

const DRAFTS = ["We can come by Thursday.", "What time suits you?"];

function render(props: { businessUnknown?: boolean; loading?: boolean } = {}) {
  return renderToStaticMarkup(
    <ReplySuggestionChips
      suggestions={props.loading ? [] : DRAFTS}
      loading={props.loading}
      businessUnknown={props.businessUnknown}
      onUse={vi.fn()}
      onDismiss={vi.fn()}
    />,
  );
}

describe("ReplySuggestionChips", () => {
  it("offers to tell Lou what the business does when it has not been told", () => {
    const html = render({ businessUnknown: true });
    expect(html).toContain("know what you do yet");
    expect(html).toContain('href="/settings/ai"');
  });

  it("says nothing about it once the description is set", () => {
    expect(render({ businessUnknown: false })).not.toContain(
      "know what you do yet",
    );
  });

  it("holds the offer back until the drafts have landed", () => {
    // Nothing is felt yet while the placeholders are still animating.
    expect(render({ businessUnknown: true, loading: true })).not.toContain(
      "know what you do yet",
    );
  });

  it("still renders every draft", () => {
    const html = render({ businessUnknown: true });
    for (const draft of DRAFTS) expect(html).toContain(draft);
  });
});
