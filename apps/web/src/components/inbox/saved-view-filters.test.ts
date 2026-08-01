/**
 * #280 — the translation between the inbox URL and what a view stores.
 *
 * The failure to design against is not a crash: it is a view that saves
 * cleanly and opens something else. Every case here is a shape that would do
 * exactly that quietly.
 */
import { describe, expect, it } from "vitest";

import type { InboxUrlFilters } from "./filter-url";
import {
  suggestViewName,
  urlFiltersToView,
  viewFiltersToUrl,
  viewMatchesUrl,
} from "./saved-view-filters";

const MEMBER = "11111111-2222-4333-8444-555555555555";
const TAG = "22222222-3333-4444-8555-666666666666";

describe("#280 urlFiltersToView", () => {
  it("stores 'Mine' as a relative filter, never as a user id", () => {
    // The whole reason `assigned_to_me` exists. Storing an id here would make a
    // shared "Mine" mean one specific person on everybody else's screen.
    expect(urlFiltersToView({ assignee: "me" })).toEqual({
      assigned_to_me: true,
    });
  });

  it("keeps a named assignee as an id", () => {
    expect(urlFiltersToView({ assignee: MEMBER })).toEqual({
      assigned_user_id: MEMBER,
    });
  });

  it("turns the deferral chip into the API's tri-state", () => {
    // The URL's boolean means "show me what I deferred", which is `only` —
    // not `all`, which would also fold them into the ordinary list.
    expect(urlFiltersToView({ snoozed: true })).toEqual({ snoozed: "only" });
  });

  it("never stores the search box", () => {
    // A search is a question asked once. Saving it would turn a shared "my open
    // threads" into "my open threads mentioning boiler" for everybody.
    expect(urlFiltersToView({ status: "open", q: "boiler" })).toEqual({
      status: "open",
    });
  });

  it("carries the whole filter bar across", () => {
    const url: InboxUrlFilters = {
      status: "waiting",
      assignee: MEMBER,
      tag: TAG,
      unread: true,
      spam: true,
    };
    expect(urlFiltersToView(url)).toEqual({
      status: "waiting",
      assigned_user_id: MEMBER,
      tag_id: TAG,
      unread: true,
      is_spam: true,
    });
  });
});

describe("#280 viewFiltersToUrl", () => {
  it("round-trips every filter a view can hold", () => {
    const url: InboxUrlFilters = {
      status: "open",
      assignee: "me",
      tag: TAG,
      unread: true,
      snoozed: true,
    };
    expect(viewFiltersToUrl(urlFiltersToView(url))).toEqual(url);
  });

  it("leaves an in-progress search alone when a view is applied", () => {
    // Switching views mid-search should change the view, not empty the box.
    expect(
      viewFiltersToUrl({ status: "open" }, { q: "boiler", status: "closed" }),
    ).toEqual({ status: "open", q: "boiler" });
  });

  it("ignores a stored filter the app no longer understands", () => {
    expect(viewFiltersToUrl({ status: "open", colour: "red" } as never)).toEqual({
      status: "open",
    });
  });
});

describe("#280 viewMatchesUrl", () => {
  it("lights up the chip for the view currently on screen", () => {
    expect(viewMatchesUrl({ assigned_to_me: true }, { assignee: "me" })).toBe(
      true,
    );
  });

  it("does not go dark just because somebody typed in the search box", () => {
    // Search is not part of a view, so it must not affect which chip is active.
    expect(
      viewMatchesUrl({ status: "open" }, { status: "open", q: "boiler" }),
    ).toBe(true);
  });

  it("distinguishes a view that has one filter more", () => {
    expect(
      viewMatchesUrl({ status: "open" }, { status: "open", unread: true }),
    ).toBe(false);
    expect(
      viewMatchesUrl({ status: "open", unread: true }, { status: "open" }),
    ).toBe(false);
  });

  it("does not confuse 'Mine' with a specific teammate", () => {
    expect(viewMatchesUrl({ assigned_to_me: true }, { assignee: MEMBER })).toBe(
      false,
    );
  });
});

describe("#280 suggestViewName", () => {
  it("describes the arrangement, so the save form is never empty", () => {
    expect(suggestViewName({ status: "open", unread: true })).toBe(
      "Open · Unread",
    );
    expect(suggestViewName({ assignee: "me", status: "waiting" })).toBe(
      "Waiting · Mine",
    );
  });

  it("uses the tag's own name when it has been looked up", () => {
    expect(suggestViewName({ tag: TAG }, { tag: "Quote sent" })).toBe(
      "Quote sent",
    );
  });

  it("suggests nothing for the unfiltered list", () => {
    // "Everything" is a name to offer only if somebody deliberately saves the
    // whole inbox, not a default put in their mouth.
    expect(suggestViewName({})).toBe("");
  });

  it("renders no em or en dash (Law 6)", () => {
    const name = suggestViewName({
      status: "open",
      assignee: "me",
      unread: true,
      spam: true,
      snoozed: true,
    });
    expect(name).not.toMatch(/[–—]/);
  });
});
