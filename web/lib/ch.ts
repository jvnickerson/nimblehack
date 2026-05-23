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
             formatDateTime(first_seen_at, '%Y-%m-%dT%H:%i:%SZ') AS fseen,
             formatDateTime(fetched_at,    '%Y-%m-%dT%H:%i:%SZ') AS ffetched
      FROM signals ${where}
      ORDER BY first_seen_at DESC
      LIMIT ${limit}
    `,
    format: "JSONEachRow",
    query_params: params,
  });
  const raw = (await resp.json()) as Array<Record<string, unknown>>;
  return raw.map((r) => ({
    ticker: String(r.ticker),
    source: String(r.source),
    headline: String(r.headline ?? ""),
    summary: String(r.summary ?? ""),
    url: String(r.url ?? ""),
    event_type: String(r.event_type ?? ""),
    first_seen_at: String(r.fseen ?? ""),
    fetched_at: String(r.ffetched ?? ""),
  }));
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

export type SentimentRow = { ticker: string; pos: number; neg: number; score: number };

const POS_TERMS = [
  "surge", "soar", "soared", "soars", "rally", "rallies", "rallied",
  "beat", "beats", "beating", "raised", "raise", "raises",
  "record", "strong", "growth", "growing", "gain", "gains", "jump", "jumps",
  "bullish", "outperform", "upgrade", "upgrades", "win", "wins", "won",
  "exceed", "exceeded", "exceeds", "boost", "boosts", "boosted",
  "approve", "approved", "approval", "launch", "launches", "launched",
];
const NEG_TERMS = [
  "drop", "drops", "dropped", "fall", "falls", "fell", "crash", "crashed",
  "miss", "missed", "misses", "cut", "cuts", "slash", "slashed",
  "weak", "loss", "losses", "plunge", "plunged", "plunges",
  "decline", "declines", "declined", "sue", "sues", "sued", "lawsuit",
  "layoff", "layoffs", "fire", "fired", "fires", "down", "downgrade", "downgrades",
  "warning", "warns", "warned", "probe", "probes", "investigation", "fraud",
  "disappoint", "disappointed", "disappoints",
];

function sqlArrayLit(terms: string[]): string {
  return "[" + terms.map((t) => `'${t.replace(/'/g, "''")}'`).join(",") + "]";
}

export async function sentimentByTicker(): Promise<Record<string, SentimentRow>> {
  const resp = await ch().query({
    query: `
      SELECT
        ticker,
        countIf(multiSearchAnyCaseInsensitive(concat(headline, ' ', summary), ${sqlArrayLit(POS_TERMS)}) > 0) AS pos,
        countIf(multiSearchAnyCaseInsensitive(concat(headline, ' ', summary), ${sqlArrayLit(NEG_TERMS)}) > 0) AS neg
      FROM signals
      WHERE first_seen_at >= now() - INTERVAL 1 HOUR
      GROUP BY ticker
    `,
    format: "JSONEachRow",
  });
  const rows = (await resp.json()) as Array<{ ticker: string; pos: number; neg: number }>;
  const out: Record<string, SentimentRow> = {};
  for (const r of rows) {
    const pos = Number(r.pos);
    const neg = Number(r.neg);
    const total = pos + neg;
    const score = total === 0 ? 0 : (pos - neg) / total;
    out[r.ticker] = { ticker: r.ticker, pos, neg, score };
  }
  return out;
}

export async function recentRedditSignals(limit = 30): Promise<Signal[]> {
  const resp = await ch().query({
    query: `
      SELECT ticker, source, headline, summary, url, event_type,
             formatDateTime(first_seen_at, '%Y-%m-%dT%H:%i:%SZ') AS fseen,
             formatDateTime(fetched_at,    '%Y-%m-%dT%H:%i:%SZ') AS ffetched
      FROM signals
      WHERE source = 'reddit' AND first_seen_at >= now() - INTERVAL 30 MINUTE
      ORDER BY first_seen_at DESC
      LIMIT ${limit}
    `,
    format: "JSONEachRow",
  });
  const raw = (await resp.json()) as Array<Record<string, unknown>>;
  return raw.map((r) => ({
    ticker: String(r.ticker),
    source: String(r.source),
    headline: String(r.headline ?? ""),
    summary: String(r.summary ?? ""),
    url: String(r.url ?? ""),
    event_type: String(r.event_type ?? ""),
    first_seen_at: String(r.fseen ?? ""),
    fetched_at: String(r.ffetched ?? ""),
  }));
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
