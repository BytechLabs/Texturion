/**
 * How many bytes a company is actually storing, from one `api_storage_usage`
 * row.
 *
 * `total_bytes` is measured from the storage buckets themselves, so it counts
 * everything a company holds: note attachments, picture messages, and voicemail
 * recordings. Adding the two named arms instead undercounts every workspace
 * that takes calls, which is every workspace, because voicemail audio is
 * nowhere in that sum.
 *
 * The sum is kept only as a fallback for a response shaped before `total_bytes`
 * existed. Shared because the cost projection and the storage-abuse alert must
 * never disagree about how much is stored: storage is free and capless, so
 * alerting is the only backstop there is.
 */
export interface StorageUsageRow {
  attachments_bytes?: number | string | null;
  mms_bytes?: number | string | null;
  total_bytes?: number | string | null;
}

export function storedBytes(row: StorageUsageRow | null | undefined): number {
  if (!row) return 0;
  const total = Number(row.total_bytes ?? 0);
  if (Number.isFinite(total) && total > 0) return total;
  const attachments = Number(row.attachments_bytes ?? 0);
  const mms = Number(row.mms_bytes ?? 0);
  const sum =
    (Number.isFinite(attachments) ? attachments : 0) +
    (Number.isFinite(mms) ? mms : 0);
  return sum > 0 ? sum : 0;
}
