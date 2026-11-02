export function volumeCleanupSql(input: { company: string }): string;

export function volumeFixtureSql(input: {
  company: string;
  owner: string;
  number: string;
  e164: string;
  areaCode: string;
  country: string;
  conversations: number;
  messages: number;
  provisioningKey: string;
  companyName: string;
  /** Give the workspace an active plan, as a paying customer's is. */
  active?: boolean;
}): string;
