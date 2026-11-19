import { afterEach, expect, it, vi } from "vitest";

import { supabaseStub } from "../test/routes-harness";
import { completeEnv, stubFetch } from "../test/support";
import { processCustomerErasures } from "./customer-erasure";

const env = completeEnv();
const companyId = "aaaaaaaa-1111-4222-8333-444444444444";
const contactId = "bbbbbbbb-1111-4222-8333-444444444444";
const conversationId = "cccccccc-1111-4222-8333-444444444444";

afterEach(() => vi.unstubAllGlobals());

it("retries a failed storage removal before purging the row or completing the receipt", async () => {
  const sb = supabaseStub(env);
  const order: string[] = [];
  let storageFails = true;
  sb.on("POST", "/rest/v1/rpc/api_customer_erasures_due", () => [{ id: contactId, company_id: companyId }]);
  sb.on("POST", "/rest/v1/rpc/api_customer_erasure_batch", () => [{ kind: "conversation", id: conversationId }]);
  sb.on("POST", "/rest/v1/rpc/api_trash_object_paths", () => [{ bucket: "attachments", path: "file.png" }]);
  sb.on("DELETE", "/storage/v1/object/attachments", () => {
    order.push("storage");
    return storageFails ? Response.json({ message: "unavailable" }, { status: 500 }) : [];
  });
  sb.on("POST", "/rest/v1/rpc/api_purge_trash_item", () => {
    order.push("row");
    return { outcome: "purged", company_id: companyId };
  });
  sb.on("POST", "/rest/v1/rpc/api_customer_erasure_exports", () => []);
  sb.on("POST", "/rest/v1/rpc/api_finish_customer_erasure", () => {
    order.push("receipt");
    return true;
  });
  stubFetch(sb.route);

  await expect(processCustomerErasures(env)).rejects.toThrow("Customer erasure failed");
  expect(order).toEqual(["storage"]);
  storageFails = false;
  await expect(processCustomerErasures(env)).resolves.toEqual({ completed: 1 });
  expect(order).toEqual(["storage", "storage", "row", "receipt"]);
});

it("removes revoked archive copies before completing an erasure", async () => {
  const sb = supabaseStub(env);
  const exportId = "dddddddd-1111-4222-8333-444444444444";
  const order: string[] = [];
  let removable = false;
  let removed = false;
  sb.on("POST", "/rest/v1/rpc/api_customer_erasures_due", () => [{ id: contactId, company_id: companyId }]);
  sb.on("POST", "/rest/v1/rpc/api_customer_erasure_batch", () => []);
  sb.on("POST", "/rest/v1/rpc/api_customer_erasure_exports", () => [
    { id: exportId, storage_prefix: `${companyId}/${exportId}`, removable },
  ]);
  sb.on("POST", "/storage/v1/object/list/exports", () => [{ id: "part", name: "messages.jsonl" }]);
  sb.on("DELETE", "/storage/v1/object/exports", () => {
    order.push("storage");
    return removed ? [] : Response.json({ message: "unavailable" }, { status: 500 });
  });
  sb.on("PATCH", "/rest/v1/data_exports", () => {
    order.push("reaped");
    return [];
  });
  sb.on("POST", "/rest/v1/rpc/api_finish_customer_erasure", () => {
    order.push("receipt");
    return true;
  });
  stubFetch(sb.route);

  await expect(processCustomerErasures(env)).resolves.toEqual({ completed: 0 });
  expect(order).toEqual([]);
  removable = true;
  await expect(processCustomerErasures(env)).rejects.toThrow("Customer erasure failed");
  expect(order).toEqual(["storage"]);
  removed = true;
  await expect(processCustomerErasures(env)).resolves.toEqual({ completed: 1 });
  expect(order).toEqual(["storage", "storage", "reaped", "receipt"]);
});
