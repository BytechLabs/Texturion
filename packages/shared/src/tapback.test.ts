import { describe, expect, it } from "vitest";

import { foldTapbacks, parseTapback } from "./tapback";

describe(parseTapback, () => {
  it.each([
    ['Loved "We can come on Friday."', "❤️", "We can come on Friday.", false],
    ["A adoré « On peut passer vendredi. »", "❤️", "On peut passer vendredi.", false],
    ["N’a pas aimé « Vendredi »", "👎", "Vendredi", false],
    ['Removed a heart from "Friday"', "❤️", "Friday", true],
    ["A retiré un « J’aime » de « Vendredi »", "👍", "Vendredi", true],
    ["👍🏽 to “Friday”", "👍🏽", "Friday", false],
    ["A réagi 😂 à « Vendredi »", "😂", "Vendredi", false],
  ])("parses %s", (body, emoji, quote, removed) => {
    expect(parseTapback(body)).toEqual({ emoji, quote, removed });
  });

  it.each(["Loved it!", 'Loved ""', 'Loved "Friday" but can we do Monday?', 'Hi 👍 to "Friday"'])(
    "keeps %s as a plain message",
    (body) => expect(parseTapback(body)).toBeNull(),
  );
});

describe(foldTapbacks, () => {
  const target = { id: "outbound" };
  const love = { id: "love", reaction_to_message_id: target.id, reaction_emoji: "❤️" };
  const like = { id: "like", reaction_to_message_id: target.id, reaction_emoji: "👍" };
  const remove = { ...love, id: "remove-love", reaction_removed: true };

  it("shows the current reaction without a separate bubble", () => {
    const result = foldTapbacks([target, love, like, remove]);
    expect(result.messages).toEqual([target]);
    expect(result.reactions.get(target.id)).toBe("👍");
    expect(foldTapbacks([target, love, remove]).reactions.size).toBe(0);
  });

  it("shows the received words until the target is loaded", () => {
    expect(foldTapbacks([love]).messages).toEqual([love]);
  });
});
