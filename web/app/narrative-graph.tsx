"use client";
import dynamic from "next/dynamic";
import { useMemo, useRef, useEffect, useState } from "react";
import type { Signal } from "@/lib/ch";
import { tokenize } from "@/lib/themes";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

type GNode = {
  id: string;
  kind: "ticker" | "theme" | "signal";
  label: string;
  ticker?: string;
  source?: string;
  size: number;
  color: string;
  fresh?: boolean;
};
type GLink = { source: string; target: string };

const TICKER_COLOR = "#7ce38b";
const THEME_COLOR = "#f0b429";
const SOURCE_COLORS: Record<string, string> = {
  reddit: "#ff7a59",
  yahoo_news: "#58a6ff",
  bloomberg: "#c792ea",
  sec_8K: "#ffb86c",
  sec_10K: "#ffb86c",
  sec_10Q: "#ffb86c",
};

function buildGraph(signals: Signal[]): { nodes: GNode[]; links: GLink[] } {
  const tickers = new Set<string>();
  for (const s of signals) tickers.add(s.ticker);

  const nodes: GNode[] = [];
  const links: GLink[] = [];

  // Ticker nodes
  for (const t of tickers) {
    nodes.push({
      id: `T:${t}`,
      kind: "ticker",
      label: t,
      size: 18,
      color: TICKER_COLOR,
    });
  }

  // Signal nodes + ticker links
  const seenSig = new Set<string>();
  for (const s of signals) {
    const sid = `S:${s.ticker}:${s.headline.slice(0, 50)}`;
    if (seenSig.has(sid)) continue;
    seenSig.add(sid);
    const fresh =
      Date.now() - new Date(s.first_seen_at.endsWith("Z") ? s.first_seen_at : s.first_seen_at + "Z").getTime() <
      5 * 60 * 1000;
    nodes.push({
      id: sid,
      kind: "signal",
      label: s.headline,
      ticker: s.ticker,
      source: s.source,
      size: fresh ? 5 : 3,
      color: SOURCE_COLORS[s.source] ?? "#8b9aae",
      fresh,
    });
    links.push({ source: `T:${s.ticker}`, target: sid });
  }

  // Theme nodes: only words that appear across 2+ tickers (real cross-narrative)
  const themeToTickers = new Map<string, Set<string>>();
  for (const s of signals) {
    const toks = new Set(tokenize(s.headline + " " + (s.summary ?? "")));
    for (const t of toks) {
      if (!themeToTickers.has(t)) themeToTickers.set(t, new Set());
      themeToTickers.get(t)!.add(s.ticker);
    }
  }
  for (const [theme, tset] of themeToTickers) {
    if (tset.size < 2) continue;
    nodes.push({
      id: `M:${theme}`,
      kind: "theme",
      label: theme,
      size: 6 + Math.min(8, tset.size * 2),
      color: THEME_COLOR,
    });
    for (const t of tset) links.push({ source: `T:${t}`, target: `M:${theme}` });
  }

  return { nodes, links };
}

export function NarrativeGraph({ signals }: { signals: Signal[] }) {
  const data = useMemo(() => buildGraph(signals), [signals]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dims, setDims] = useState({ w: 1100, h: 380 });
  const fgRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const cr = e.contentRect;
        setDims({ w: Math.max(320, cr.width), h: 380 });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (fgRef.current?.d3Force) {
      fgRef.current.d3Force("charge")?.strength(-80);
      fgRef.current.d3Force("link")?.distance(28);
    }
  }, [data]);

  const tickerCount = data.nodes.filter((n) => n.kind === "ticker").length;
  const themeCount = data.nodes.filter((n) => n.kind === "theme").length;
  const signalCount = data.nodes.filter((n) => n.kind === "signal").length;

  return (
    <div className="graph-card" ref={containerRef}>
      <div className="graph-header">
        <div>
          <span className="graph-title">Narrative Graph</span>
          <span className="graph-sub">
            tickers ↔ themes ↔ signals · cross-ticker overlaps form clusters
          </span>
        </div>
        <div className="graph-legend">
          <span><i style={{ background: TICKER_COLOR }} /> ticker</span>
          <span><i style={{ background: THEME_COLOR }} /> theme</span>
          <span><i style={{ background: SOURCE_COLORS.reddit }} /> reddit</span>
          <span><i style={{ background: SOURCE_COLORS.yahoo_news }} /> yahoo</span>
          <span><i style={{ background: SOURCE_COLORS.bloomberg }} /> bloomberg</span>
          <span><i style={{ background: SOURCE_COLORS.sec_8K }} /> sec</span>
          <span className="legend-count">
            {tickerCount} tickers · {themeCount} themes · {signalCount} signals
          </span>
        </div>
      </div>
      <div className="graph-canvas">
        <ForceGraph2D
          ref={fgRef as any}
          graphData={data as any}
          width={dims.w}
          height={dims.h}
          backgroundColor="#0e1420"
          nodeRelSize={3}
          nodeVal={(n: any) => n.size}
          nodeColor={(n: any) => n.color}
          linkColor={() => "rgba(140, 160, 190, 0.18)"}
          linkWidth={0.6}
          cooldownTicks={120}
          d3AlphaDecay={0.025}
          warmupTicks={30}
          nodeCanvasObject={(node: any, ctx, scale) => {
            const r = Math.sqrt(node.size) * 1.5;
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
            ctx.fillStyle = node.color;
            ctx.fill();
            if (node.kind === "ticker") {
              ctx.fillStyle = "#0b0f14";
              ctx.font = `${10 / Math.max(1, Math.sqrt(scale))}px ui-sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(node.label, node.x, node.y);
              ctx.font = `bold ${10 / Math.max(0.6, Math.sqrt(scale))}px ui-sans-serif`;
              ctx.fillStyle = "#e6edf3";
              ctx.fillText(node.label, node.x, node.y - r - 6);
            } else if (node.kind === "theme" && scale > 1.5) {
              ctx.fillStyle = THEME_COLOR;
              ctx.font = `${9 / Math.max(0.8, Math.sqrt(scale))}px ui-sans-serif`;
              ctx.textAlign = "center";
              ctx.fillText(node.label, node.x, node.y - r - 4);
            } else if (node.kind === "signal" && node.fresh) {
              // pulse outline for fresh signals
              ctx.beginPath();
              ctx.arc(node.x, node.y, r + 2, 0, 2 * Math.PI);
              ctx.strokeStyle = "rgba(88, 166, 255, 0.55)";
              ctx.lineWidth = 1;
              ctx.stroke();
            }
          }}
          nodePointerAreaPaint={(node: any, color, ctx) => {
            ctx.fillStyle = color;
            const r = Math.sqrt(node.size) * 2;
            ctx.beginPath();
            ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
            ctx.fill();
          }}
        />
      </div>
    </div>
  );
}
