import type { ContactFieldFilter, ContactSort } from "@/lib/api/contacts";

import { updateSearch } from "./search-state";

export function contactsViewFromSearch(params: URLSearchParams) {
  const field = params.get("field");
  const sort = params.get("sort");
  const order: ContactSort = sort === "recent" || sort === "added" ? sort : "name";
  return {
    query: params.get("q") ?? "",
    tagId: params.get("tag") ?? undefined,
    field: field ? { key: field, value: params.get("value") ?? "" } : undefined,
    sort: order,
  };
}

export function writeQuery(query: string) {
  updateSearch((params) => {
    if (query === "") params.delete("q");
    else params.set("q", query);
  });
}

export function writeTag(tagId: string | undefined) {
  updateSearch((params) => {
    if (tagId === undefined) params.delete("tag");
    else params.set("tag", tagId);
  });
}

export function writeField(field: ContactFieldFilter | undefined) {
  updateSearch((params) => {
    if (field === undefined) {
      params.delete("field");
      params.delete("value");
    } else {
      params.set("field", field.key);
      params.set("value", field.value);
    }
  });
}

export function writeSort(sort: ContactSort) {
  updateSearch((params) => {
    if (sort === "name") params.delete("sort");
    else params.set("sort", sort);
  });
}
