// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { pushSearch, replaceSearch, updateSearch } from "./search-state";

function currentUrl(): string {
  const { pathname, search, hash } = window.location;
  return `${pathname}${search}${hash}`;
}

describe("search-state", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/tasks?view=board#top");
  });

  it("replaces the search and keeps the path and hash", () => {
    const length = window.history.length;
    replaceSearch("?view=list&tab=all");
    expect(currentUrl()).toBe("/tasks?view=list&tab=all#top");
    expect(window.history.length).toBe(length);
  });

  it("pushes a new entry for pushSearch", () => {
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    pushSearch(new URLSearchParams({ view: "board", task: "t-1" }));
    expect(push).toHaveBeenCalledWith(null, "", "/tasks?view=board&task=t-1#top");
    expect(replace).not.toHaveBeenCalled();
    expect(currentUrl()).toBe("/tasks?view=board&task=t-1#top");
  });

  it("drops the question mark when no params are left", () => {
    replaceSearch(new URLSearchParams());
    expect(currentUrl()).toBe("/tasks#top");
  });

  it("builds on the live URL, so two quick edits keep each other", () => {
    updateSearch((params) => params.set("tab", "done"));
    updateSearch((params) => params.set("q", "roof"));
    expect(currentUrl()).toBe("/tasks?view=board&tab=done&q=roof#top");
  });

  it("pushes from updateSearch when asked", () => {
    const push = vi.spyOn(window.history, "pushState");
    updateSearch((params) => params.set("task", "t-2"), "push");
    expect(push).toHaveBeenCalledWith(null, "", "/tasks?view=board&task=t-2#top");
  });

  it("writes nothing when the URL would not change", () => {
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    pushSearch("view=board");
    updateSearch(() => {});
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });
});
