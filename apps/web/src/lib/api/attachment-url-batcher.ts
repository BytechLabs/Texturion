import {
  ERROR_CODE_STATUS,
  INTERNAL_ERROR_STATUS,
} from "@loonext/shared";

import { recordClientError } from "@/lib/observability/recent-errors";

import type { ApiRequest } from "./core";
import { ApiError, parseErrorBody } from "./error";
import type { AttachmentUrl, AttachmentVariant } from "./types";

const BATCH_PATH = "/v1/attachments/urls";
/** How long a company's mints wait to go out together. */
const WAIT_MS = 10;
/** The most items POST /v1/attachments/urls takes in one request. */
const CHUNK_SIZE = 25;

interface BatchItem {
  id: string;
  requested_variant: AttachmentVariant;
  variant: AttachmentVariant;
  url: string;
  expires_at: string;
  ttl_seconds: number;
}

interface BatchError {
  id: string;
  requested_variant: AttachmentVariant;
  code: string;
  message: string;
}

interface BatchResponse {
  data: BatchItem[];
  errors: BatchError[];
}

interface Pending {
  id: string;
  variant: AttachmentVariant;
  waiters: { resolve: (url: AttachmentUrl) => void; reject: (error: unknown) => void }[];
}

export type LoadAttachmentUrl = (
  companyId: string,
  attachmentId: string,
  variant: AttachmentVariant,
) => Promise<AttachmentUrl>;

function itemKey(id: string, variant: AttachmentVariant): string {
  return `${id}:${variant}`;
}

function singlePath({ id, variant }: Pending): string {
  return `/v1/attachments/${id}/url${variant === "original" ? "?variant=original" : ""}`;
}

/** The ApiError the GET would have thrown for this item. */
function itemError(error: BatchError): ApiError {
  const status =
    (ERROR_CODE_STATUS as Record<string, number>)[error.code] ??
    INTERNAL_ERROR_STATUS;
  recordClientError(`POST ${BATCH_PATH} ${status} ${error.code}`);
  return parseErrorBody(status, {
    error: { code: error.code, message: error.message },
  });
}

function settle(item: Pending, outcome: Promise<AttachmentUrl>): void {
  outcome.then(
    (url) => item.waiters.forEach((waiter) => waiter.resolve(url)),
    (error: unknown) => item.waiters.forEach((waiter) => waiter.reject(error)),
  );
}

/** Sends a company's mints from one render as POST /v1/attachments/urls, each caller getting its own item's URL or refusal. */
export function createAttachmentUrlBatcher(request: ApiRequest): LoadAttachmentUrl {
  const queues = new Map<string, Map<string, Pending>>();

  async function send(companyId: string, chunk: Pending[]): Promise<void> {
    let response: BatchResponse;
    try {
      response = await request<BatchResponse>(BATCH_PATH, {
        method: "POST",
        companyId,
        body: { items: chunk.map(({ id, variant }) => ({ id, variant })) },
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        // An older Worker without the batch route.
        for (const item of chunk) {
          settle(item, request<AttachmentUrl>(singlePath(item), { companyId }));
        }
        return;
      }
      for (const item of chunk) settle(item, Promise.reject(error));
      return;
    }

    const minted = new Map(
      (response?.data ?? []).map((item) => [itemKey(item.id, item.requested_variant), item]),
    );
    const refused = new Map(
      (response?.errors ?? []).map((item) => [itemKey(item.id, item.requested_variant), item]),
    );
    for (const item of chunk) {
      const key = itemKey(item.id, item.variant);
      const url = minted.get(key);
      const refusal = refused.get(key);
      if (url) {
        settle(
          item,
          Promise.resolve({
            url: url.url,
            expires_at: url.expires_at,
            ttl_seconds: url.ttl_seconds,
            variant: url.variant,
          }),
        );
      } else {
        settle(
          item,
          Promise.reject(refusal ? itemError(refusal) : parseErrorBody(500, null)),
        );
      }
    }
  }

  function flush(companyId: string): void {
    const pending = [...(queues.get(companyId)?.values() ?? [])];
    queues.delete(companyId);
    for (let start = 0; start < pending.length; start += CHUNK_SIZE) {
      void send(companyId, pending.slice(start, start + CHUNK_SIZE));
    }
  }

  return (companyId, attachmentId, variant) =>
    new Promise<AttachmentUrl>((resolve, reject) => {
      let queue = queues.get(companyId);
      if (!queue) {
        queue = new Map();
        queues.set(companyId, queue);
        setTimeout(() => flush(companyId), WAIT_MS);
      }
      const key = itemKey(attachmentId, variant);
      const item = queue.get(key) ?? { id: attachmentId, variant, waiters: [] };
      item.waiters.push({ resolve, reject });
      queue.set(key, item);
    });
}
