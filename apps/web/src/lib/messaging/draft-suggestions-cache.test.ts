import { beforeEach, describe, expect, it } from "vitest";

import {
  cacheSuggestions,
  clearCachedSuggestions,
  readCachedSuggestions,
} from "./draft-suggestions-cache";

const DRAFTS = ["We can come Thursday.", "What time suits you?"];

describe("draft suggestions cache", () => {
  beforeEach(clearCachedSuggestions);

  it("serves the drafts already paid for", () => {
    cacheSuggestions("c1", "2026-07-25T10:00:00Z", DRAFTS);
    expect(readCachedSuggestions("c1", "2026-07-25T10:00:00Z")).toEqual(DRAFTS);
  });

  it("retires them the moment the conversation moves", () => {
    // A message in either direction changes last_message_at, and drafts
    // written before it no longer answer the conversation.
    cacheSuggestions("c1", "2026-07-25T10:00:00Z", DRAFTS);
    expect(readCachedSuggestions("c1", "2026-07-25T10:05:00Z")).toBeNull();
  });

  it("keeps conversations apart", () => {
    cacheSuggestions("c1", "t", ["for Dana"]);
    cacheSuggestions("c2", "t", ["for Marco"]);
    expect(readCachedSuggestions("c1", "t")).toEqual(["for Dana"]);
    expect(readCachedSuggestions("c2", "t")).toEqual(["for Marco"]);
  });

  it("misses cleanly for a conversation never drafted", () => {
    expect(readCachedSuggestions("never", null)).toBeNull();
  });

  it("stores nothing for an empty answer", () => {
    // "Nothing to suggest" is not worth remembering as an answer.
    cacheSuggestions("c1", "t", []);
    expect(readCachedSuggestions("c1", "t")).toBeNull();
  });

  it("cannot grow without bound over a long session", () => {
    for (let i = 0; i < 200; i += 1) {
      cacheSuggestions(`c${i}`, "t", [`draft ${i}`]);
    }
    // The oldest are evicted; the most recent survive.
    expect(readCachedSuggestions("c0", "t")).toBeNull();
    expect(readCachedSuggestions("c199", "t")).toEqual(["draft 199"]);
  });
});
