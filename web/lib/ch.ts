import { createClient, type ClickHouseClient } from "@clickhouse/client";

let _client: ClickHouseClient | null = null;

export function ch(): ClickHouseClient {
  if (_client) return _client;
  const host = process.env.CH_HOST;
  const password = process.env.CH_PWD;
  if (!host || !password) {
    throw new Error("CH_HOST and CH_PWD must be set");
  }
  _client = createClient({
    url: `https://${host}:8443`,
    username: process.env.CH_USER ?? "default",
    password,
  });
  return _client;
}

export type Signal = {
  ticker: string;
  source: string;
  headline: string;
  summary: string;
  url: string;
  event_type: string;
  first_seen_at: string;
  fetched_at: string;
};

export type TickerSummary = {
  ticker: string;
  total: number;
  fresh_24h: number;
  fresh_1h: number;
  sources: number;
  latest: string;
};

export async function recentSignals(opts: {
  ticker?: string;
  sinceMinutes?: number;
  limit?: number;
} = {}): Promise<Signal[]> {
  const conds: string[] = [];
  const params: Record<string, unknown> = {};
  if (opts.ticker) {
    conds.push("ticker = {ticker:String}");
    params.ticker = opts.ticker;
  }
  if (opts.sinceMinutes) {
    conds.push(`first_seen_at >= now() - INTERVAL ${opts.sinceMinutes} MINUTE`);
  }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const limit = opts.limit ?? 200;
  const resp = await ch().query({
    query: `
      SELECT ticker, source, headline, summary, url, event_type,
             toString(first_seen_at) AS first_seen_at,
             toString(fetched_at) AS fetched_at
      FROM signals ${where}
      ORDER BY first_seen_at DESC
      LIMIT ${limit}
    `,
    format: "JSONEachRow",
    query_params: params,
  });
  return (await resp.json()) as Signal[];
}

export async function tickerSummary(): Promise<TickerSummary[]> {
  const resp = await ch().query({
    query: `
      SELECT
        ticker,
        count() AS total,
        countIf(first_seen_at >= now() - INTERVAL 24 HOUR) AS fresh_24h,
        countIf(first_seen_at >= now() - INTERVAL 5 MINUTE) AS fresh_1h,
        uniqExact(source) AS sources,
        toString(max(first_seen_at)) AS latest
      FROM signals
      GROUP BY ticker
      ORDER BY fresh_1h DESC, fresh_24h DESC
    `,
    format: "JSONEachRow",
  });
  return (await resp.json()) as TickerSummary[];
}

export type IndexStats = {
  total: number;
  embedded: number;
  pct: number;
  sources: number;
  signals_5min: number;
};

export async function indexStats(): Promise<IndexStats> {
  const resp = await ch().query({
    query: `
      SELECT
        count() AS total,
        countIf(length(embedding) > 0) AS embedded,
        uniqExact(source) AS sources,
        countIf(first_seen_at >= now() - INTERVAL 5 MINUTE) AS signals_5min
      FROM signals
    `,
    format: "JSONEachRow",
  });
  const rows = (await resp.json()) as Array<{
    total: number; embedded: number; sources: number; signals_5min: number;
  }>;
  const r = rows[0] ?? { total: 0, embedded: 0, sources: 0, signals_5min: 0 };
  const pct = r.total > 0 ? Math.round((Number(r.embedded) / Number(r.total)) * 100) : 0;
  return { ...r, pct };
}
