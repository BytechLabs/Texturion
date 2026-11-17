const PRO_INCLUDED_CONNECTIONS = 500;
const WARN_FRACTION = 0.8;

// The current cycle's billed peaks leave no hosted test allocation (#814).
const HOSTED_REALTIME_BUDGET: RealtimeBudget | undefined = undefined;

interface RealtimeBudget {
  projectRef: string;
  connections: number;
  otherProjectConnections: number;
  expiresAt: string;
}

export async function hostedRealtimeLevels<T>(
  supabaseOrigin: string,
  levels: T[],
  connectionsAt: (level: T) => number,
  {
    budget = HOSTED_REALTIME_BUDGET,
    token = process.env.LOONEXT_CAPACITY_SUPABASE_MANAGEMENT_TOKEN,
    fetcher = globalThis.fetch,
    warn = (message: string) => process.stderr.write(`capacity: ${message}\n`),
  }: {
    budget?: RealtimeBudget;
    token?: string;
    fetcher?: typeof fetch;
    warn?: (message: string) => void;
  } = {},
): Promise<T[]> {
  if (
    !budget ||
    !/^[a-z0-9]{20}$/.test(budget.projectRef) ||
    supabaseOrigin !== `https://${budget.projectRef}.supabase.co` ||
    !(Date.parse(budget.expiresAt) > Date.now()) ||
    !Number.isSafeInteger(budget.connections) || budget.connections < 1 ||
    !Number.isSafeInteger(budget.otherProjectConnections) || budget.otherProjectConnections < 0 ||
    budget.connections + budget.otherProjectConnections > PRO_INCLUDED_CONNECTIONS
  ) {
    warn("dropping hosted Realtime load because this project has no current connection allocation");
    return [];
  }

  const ceiling = token && await readRealtimeCeiling(budget.projectRef, token, fetcher);
  if (!ceiling || ceiling > budget.connections) {
    warn("dropping hosted Realtime load because the Supabase project ceiling could not be verified within its allocation");
    return [];
  }

  const warningAt = Math.ceil(ceiling * WARN_FRACTION);
  if (levels.some((level) => connectionsAt(level) >= warningAt)) {
    warn(`hosted Realtime request reaches the ${warningAt}-connection warning threshold for a ${ceiling}-connection ceiling`);
  }
  const allowed = levels.filter((level) => connectionsAt(level) <= ceiling);
  if (allowed.length < levels.length) {
    warn(`hosted Realtime levels dropped above the ${ceiling}-connection ceiling: ${levels.length - allowed.length}`);
  }
  return allowed;
}

async function readRealtimeCeiling(
  projectRef: string,
  token: string,
  fetcher: typeof fetch,
): Promise<number | undefined> {
  try {
    const response = await fetcher(`https://api.supabase.com/v1/projects/${projectRef}/config/realtime`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return undefined;
    const data = (await response.json()) as { max_concurrent_users?: number } | null;
    const ceiling = data?.max_concurrent_users;
    return typeof ceiling === "number" && Number.isSafeInteger(ceiling) && ceiling > 0
      ? ceiling
      : undefined;
  } catch {
    return undefined;
  }
}
