import { recentSignals, tickerSummary, type Signal, type TickerSummary } from "@/lib/ch";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function fmtTime(iso: string): string {
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleString();
}

function isFresh(iso: string, minutes = 60): boolean {
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  return (Date.now() - d.getTime()) < minutes * 60 * 1000;
}

export default async function Home() {
  let summary: TickerSummary[] = [];
  let signals: Signal[] = [];
  let error: string | null = null;
  try {
    [summary, signals] = await Promise.all([
      tickerSummary(),
      recentSignals({ limit: 60 }),
    ]);
  } catch (e: any) {
    error = e?.message ?? String(e);
  }

  return (
    <main>
      <div className="header-row">
        <h1><span className="pulse" />Weekend Signal Agent</h1>
        <span className="subtle">Open-web monitoring · {summary.length} tickers · auto-refresh</span>
      </div>

      {error && (
        <div className="empty">
          <strong>Can&apos;t reach ClickHouse.</strong>
          <div style={{ marginTop: 8, fontSize: 12 }}>{error}</div>
          <div style={{ marginTop: 8, fontSize: 12 }}>
            Set <code>CH_HOST</code>, <code>CH_USER</code>, <code>CH_PWD</code> and run <code>schema.sql</code>.
          </div>
        </div>
      )}

      {!error && summary.length === 0 && (
        <div className="empty">
          No signals yet. Start the worker: <code>cd worker &amp;&amp; python pump.py</code>
        </div>
      )}

      {summary.length > 0 && (
        <>
          <h2>Watchlist</h2>
          <div className="grid">
            {summary.map((t) => (
              <div key={t.ticker} className="card">
                <div className="ticker">{t.ticker}</div>
                <div className="stat-row">
                  <div className="stat">
                    <div className={`v ${Number(t.fresh_1h) > 0 ? "hot" : ""}`}>{t.fresh_1h}</div>
                    <div className="l">last hour</div>
                  </div>
                  <div className="stat">
                    <div className="v">{t.fresh_24h}</div>
                    <div className="l">24h</div>
                  </div>
                  <div className="stat">
                    <div className="v">{t.sources}</div>
                    <div className="l">sources</div>
                  </div>
                </div>
                <div className="subtle" style={{ marginTop: 8, fontSize: 11 }}>
                  latest: {t.latest ? fmtTime(t.latest) : "—"}
                </div>
              </div>
            ))}
          </div>

          <h2>Recent signals</h2>
          <div className="feed">
            {signals.map((s, i) => {
              const fresh = isFresh(s.first_seen_at, 60);
              return (
                <div key={i} className={`feed-item ${fresh ? "fresh" : ""}`}>
                  <div className="top">
                    <span className="ticker">{s.ticker}</span>
                    <span className="source">{s.source}</span>
                    {fresh && <span className="badge new">NEW</span>}
                    <span className="time">{fmtTime(s.first_seen_at)}</span>
                  </div>
                  <div className="headline">
                    {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.headline}</a> : s.headline}
                  </div>
                  {s.summary && <div className="summary">{s.summary.slice(0, 280)}{s.summary.length > 280 ? "…" : ""}</div>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}
