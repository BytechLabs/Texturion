import { describe, expect, it } from "vitest";

import { checkLogicalExpression, checkRestRequest, checkSelect } from "./schema-columns";

describe("schema column checks (#750)", () => {
  it("accepts aliases, casts, embeds and computed columns", () => {
    expect(
      checkSelect(
        "id,title,done_state:task_done_at,source_call:calls!source_call_id(id,state),contacts(name)",
        "tasks",
      ),
    ).toEqual([]);
  });

  it("names the column the table lacks, at any depth", () => {
    expect(checkSelect("user_id,email", "profiles").map((p) => p.column)).toEqual([
      "email",
    ]);
    expect(
      checkSelect("id,contacts(id,nope)", "tasks").map((p) => `${p.table}.${p.column}`),
    ).toEqual(["contacts.nope"]);
  });

  it("refuses an embed with no foreign key between the tables", () => {
    expect(checkSelect("profiles!inner(display_name)", "company_members")).toHaveLength(1);
  });

  it("reads the columns inside or/and groups", () => {
    expect(
      checkLogicalExpression("(a_b.is.null,and(id.eq.1,nope.lt.2))", "tasks").map(
        (p) => p.column,
      ),
    ).toEqual(["a_b", "nope"]);
  });

  it("accepts null filtering on a selected relation", () => {
    const url = new URL("https://example.test/contacts?select=id,contact_addresses()&or=(name.ilike.*elm*,contact_addresses.not.is.null)");
    expect(checkRestRequest("GET", "contacts", url, undefined)).toEqual([]);

    url.searchParams.set("or", "(name.ilike.*elm*,contact_addresses.eq.elm)");
    expect(checkRestRequest("GET", "contacts", url, undefined).map((problem) => problem.column))
      .toEqual(["contact_addresses"]);
  });
});
