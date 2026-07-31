import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PresenceStrip } from "./presence-strip";

/**
 * #302 — the strip's own two jobs: say the right thing, and say nothing when
 * there is nothing to say.
 *
 * The wording itself is `presenceLabel`'s (packages/shared), asserted there
 * once for all three clients. What is asserted HERE is what only the component
 * can get wrong.
 */
describe("#302 PresenceStrip", () => {
  const viewer = (name: string, typing = false) => ({
    user_id: name.toLowerCase(),
    display_name: name,
    typing,
  });

  it("renders nothing at all when nobody else is here", () => {
    // Not an empty element: a strip that reserves space for an absence makes
    // the composer jump when a colleague opens the thread, which is a worse
    // distraction than the information is worth.
    expect(renderToStaticMarkup(<PresenceStrip viewers={[]} />)).toBe("");
  });

  it("says who is here", () => {
    const html = renderToStaticMarkup(<PresenceStrip viewers={[viewer("Sam")]} />);
    expect(html).toContain("Sam is also here");
  });

  it("announces politely rather than interrupting", () => {
    // A teammate arriving is worth knowing and never worth cutting off what a
    // screen reader is already reading out.
    const html = renderToStaticMarkup(<PresenceStrip viewers={[viewer("Sam")]} />);
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('aria-live="assertive"');
  });

  it("marks replying differently from merely present", () => {
    const here = renderToStaticMarkup(<PresenceStrip viewers={[viewer("Sam")]} />);
    const typing = renderToStaticMarkup(
      <PresenceStrip viewers={[viewer("Sam", true)]} />,
    );
    expect(typing).toContain("Sam is replying…");
    // The dot carries the distinction without a second line of text.
    expect(here).not.toBe(typing);
  });

  it("offers nothing to click — it informs, it does not gate", () => {
    // #302: a lock is worse than the collision. The person holding it walks
    // into a basement and the customer waits. Nothing here is actionable.
    const html = renderToStaticMarkup(
      <PresenceStrip viewers={[viewer("Sam", true), viewer("Dale")]} />,
    );
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<a ");
  });
});
