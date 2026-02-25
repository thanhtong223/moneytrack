export type FxRate = {
  usdToVnd: number;
  fetchedAt: string;
  source: string;
};

const fallbackRate: FxRate = {
  usdToVnd: 25500,
  fetchedAt: new Date().toISOString(),
  source: 'fallback',
};

export async function fetchUsdVndRate(): Promise<FxRate> {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!res.ok) throw new Error('rate request failed');

    const data = (await res.json()) as { rates?: Record<string, number>; time_last_update_utc?: string };
    const vnd = data.rates?.VND;
    if (!vnd || Number.isNaN(vnd)) throw new Error('invalid VND rate');

    return {
      usdToVnd: vnd,
      fetchedAt: data.time_last_update_utc ? new Date(data.time_last_update_utc).toISOString() : new Date().toISOString(),
      source: 'open.er-api.com',
    };
  } catch {
    return fallbackRate;
  }
}
