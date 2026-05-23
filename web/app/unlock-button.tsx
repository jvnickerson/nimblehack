"use client";
import { useEffect, useState, useCallback } from "react";

type Phase = "idle" | "quote" | "paying" | "report" | "error";

type Quote = {
  status: number;
  accepts: Array<{
    maxAmountRequired: string;
    asset: string;
    network: string;
    payTo: string;
    description: string;
  }>;
};

type Report = {
  ticker: string;
  generated_at: string;
  totals: { signals: number; sources: number; last_5min: number; last_1h: number; last_24h: number };
  velocity_24h: Array<{ hour: string; count: number }>;
  top_sources: Array<{ source: string; count: number }>;
  recent_headlines: Array<{ source: string; headline: string; url: string; first_seen_at: string }>;
  themes: Array<{ label: string; size: number }>;
  vector_indexed: { embedded: number; total: number };
};

export function UnlockButton({ ticker }: { ticker: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const close = useCallback(() => {
    setPhase("idle");
    setQuote(null);
    setReport(null);
    setErr(null);
  }, []);

  useEffect(() => {
    if (phase === "idle") return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [phase, close]);

  const fetchQuote = async () => {
    setErr(null);
    setPhase("quote");
    try {
      const r = await fetch(`/premium/report/${ticker}`, { cache: "no-store" });
      if (r.status === 402) {
        setQuote(await r.json());
      } else if (r.ok) {
        // already paid (e.g. cached middleware)
        const j = await r.json();
        setReport(j.report);
        setPhase("report");
      } else {
        setErr(`Unexpected status ${r.status}`);
        setPhase("error");
      }
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setPhase("error");
    }
  };

  const pay = async () => {
    setPhase("paying");
    try {
      // DEMO: synthesize an x402 payment receipt header.
      // Real implementation would use the CDP wallet SDK to:
      //   1. construct an EIP-712 payment payload for the quote
      //   2. sign + submit on-chain to RECEIVER_WALLET
      //   3. pass the resulting receipt (tx hash + signature) as X-PAYMENT
      const receipt = `demo-receipt-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
      const r = await fetch(`/premium/report/${ticker}`, {
        method: "GET",
        headers: { "X-PAYMENT": receipt },
        cache: "no-store",
      });
      if (!r.ok) {
        setErr(`Server rejected payment (${r.status})`);
        setPhase("error");
        return;
      }
      const j = await r.json();
      setReport(j.report);
      setPhase("report");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setPhase("error");
    }
  };

  return (
    <>
      <button className="unlock-btn" onClick={fetchQuote}>🔓 Unlock report · $0.10</button>

      {phase !== "idle" && (
        <div className="modal-backdrop" onClick={close}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={close} aria-label="Close">×</button>

            {phase === "quote" && quote && (
              <>
                <div className="modal-eyebrow">HTTP 402 · Payment Required</div>
                <h3 className="modal-title">Deep report on {ticker}</h3>
                <p className="modal-sub">
                  Pay <strong>{quote.accepts[0].maxAmountRequired} {quote.accepts[0].asset}</strong> on{" "}
                  <strong>{quote.accepts[0].network}</strong> to unlock signal velocity, source breakdown, themes, and full headlines.
                </p>
                <div className="modal-meta">
                  <div><span>To:</span> <code>{quote.accepts[0].payTo.slice(0, 8)}…{quote.accepts[0].payTo.slice(-6)}</code></div>
                  <div><span>Protocol:</span> <a href="https://www.x402.org" target="_blank" rel="noreferrer">x402 v1</a></div>
                </div>
                <button className="pay-btn" onClick={pay}>Pay with CDP wallet</button>
                <div className="modal-foot">
                  Demo mode — payment is stubbed for the hackathon. Real version signs an EIP-712 payment via the CDP wallet SDK and posts the receipt as <code>X-PAYMENT</code>.
                </div>
              </>
            )}

            {phase === "paying" && (
              <>
                <h3 className="modal-title">Settling payment…</h3>
                <p className="modal-sub">Signing payment and submitting to {quote?.accepts[0]?.network ?? "chain"}…</p>
                <div className="spinner" />
              </>
            )}

            {phase === "report" && report && (
              <>
                <div className="modal-eyebrow">✅ Paid · 200 OK</div>
                <h3 className="modal-title">Deep report · {report.ticker}</h3>
                <p className="modal-sub">{new Date(report.generated_at).toLocaleString()}</p>

                <div className="report-grid">
                  <div className="report-stat"><div className="v">{report.totals.signals}</div><div className="l">total signals</div></div>
                  <div className="report-stat"><div className="v">{report.totals.last_24h}</div><div className="l">24h</div></div>
                  <div className="report-stat"><div className="v">{report.totals.last_1h}</div><div className="l">1h</div></div>
                  <div className="report-stat"><div className="v">{report.totals.last_5min}</div><div className="l">5 min</div></div>
                </div>

                {report.top_sources.length > 0 && (
                  <>
                    <h4 className="report-h4">Sources</h4>
                    <div className="bars">
                      {report.top_sources.map((s) => {
                        const max = Math.max(...report.top_sources.map((x) => Number(x.count)));
                        const pct = Math.round((Number(s.count) / max) * 100);
                        return (
                          <div key={s.source} className="bar-row">
                            <span className="bar-label">{s.source}</span>
                            <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
                            <span className="bar-count">{s.count}</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {report.themes.length > 0 && (
                  <>
                    <h4 className="report-h4">Emerging themes (24h)</h4>
                    <div className="themes">
                      {report.themes.map((t) => (
                        <span key={t.label} className="theme-chip">
                          {t.label} <span className="theme-count">{t.size}</span>
                        </span>
                      ))}
                    </div>
                  </>
                )}

                {report.recent_headlines.length > 0 && (
                  <>
                    <h4 className="report-h4">Top headlines</h4>
                    <div className="report-headlines">
                      {report.recent_headlines.slice(0, 8).map((h, i) => (
                        <div key={i} className="report-headline">
                          <span className="source">{h.source}</span>
                          {h.url ? <a href={h.url} target="_blank" rel="noreferrer">{h.headline}</a> : <span>{h.headline}</span>}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <div className="modal-foot">
                  Vector index for {report.ticker}: {report.vector_indexed.embedded}/{report.vector_indexed.total}
                </div>
              </>
            )}

            {phase === "error" && (
              <>
                <h3 className="modal-title">Something broke</h3>
                <p className="modal-sub">{err}</p>
                <button className="pay-btn" onClick={close}>Close</button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
