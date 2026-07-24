/**
 * Unit tests for the ILIKE search-escaping helpers (SPEC §7). Both must
 * neutralize PostgREST's `*` wildcard — PostgREST maps `*`→`%` at the URL layer
 * before SQL, so a user `*` would otherwise over-match — alongside the SQL LIKE
 * metacharacters.
 */
import { describe, expect, it } from "vitest";

import { escapeLike, orIlikeValue } from "./http";

describe("escapeLike", () => {
  it("backslash-escapes SQL LIKE wildcards", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("c\\d")).toBe("c\\\\d");
  });

  it("strips PostgREST's `*` wildcard (unescapable at the URL layer)", () => {
    expect(escapeLike("a*b")).toBe("ab");
    expect(escapeLike("*")).toBe("");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeLike("Dana Smith")).toBe("Dana Smith");
  });
});

describe("orIlikeValue", () => {
  it("strips the PostgREST or= tree reserved chars AND the wildcards", () => {
    expect(orIlikeValue('a",()b')).toBe("ab");
    expect(orIlikeValue("a%_b")).toBe("ab");
  });

  it("strips `*` so it can't over-match the name.ilike.*<q>* filter", () => {
    expect(orIlikeValue("sm*i")).toBe("smi");
    expect(orIlikeValue("***")).toBe("");
  });

  it("leaves ordinary search text untouched", () => {
    expect(orIlikeValue("+16135551000")).toBe("+16135551000");
    expect(orIlikeValue("Dana Smith")).toBe("Dana Smith");
  });
});
