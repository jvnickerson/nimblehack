import { NextRequest, NextResponse } from "next/server";
import { ch } from "@/lib/ch";

export const dynamic = "force-dynamic";

// x402 payment quote — what the client must satisfy to access this resource.
// Stubbed receiver wallet + amount for demo; replace with your CDP wallet for real on-chain.
const PRICE_USDC = "0.10";
const RECEIVER_WALLET = "0xDEMODEMODEMODEMODEMODEMODEMODEMODEMODEMO";
const CHAIN = "base-sepolia";
const ASSET = "USDC";

type Report = {
  ticker: string;
  generated_at: string;
  totals: { signals: number; sources: number; last_5min: number; last_1h: number; last_24h: number };
  velocity_24h: Array<{ hour: string; count: number }>;
  top_sources: Array<{ source: string; count: number }>;
  recent_headlines: Array<{
    source: string;
    headline: string;
    summary: string;
    url: string;
    first_seen_at: string;
  }>;
  themes: Array<{ label: string; size: number }>;
  vector_indexed: { embedded: number; total: number };
};

function paymentQuote(ticker: string, origin: string) {
  return {
    status: 402,
    error: "Payment Required",
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: CHAIN,
        maxAmountRequired: PRICE_USDC,
        asset: ASSET,
        payTo: RECEIVER_WALLET,
        resource: `${origin}/premium/report/${ticker}`,
        description: `Deep weekend signal report for ${ticker}`,
        mimeType: "application/json",
        maxTimeoutSeconds: 60,
      },
    ],
    paymentInstructions: {
      human: `Send ${PRICE_USDC} ${ASSET} on ${CHAIN} to ${RECEIVER_WALLET}, then retry with header X-PAYMENT: <receipt>`,
      docs: "https://www.x402.org",
    },
  };
}

function verifyPayment(header: string | null): { ok: boolean; reason?: string } {
  // DEMO STUB: any non-empty header passes. Swap for real x402 verification:
  //   - parse the EIP-712 signed payment payload
  //   - check on-chain receipt via viem / CDP SDK against RECEIVER_WALLET + amount + nonce
  //   - reject replays via signature/nonce cache (ClickHouse table works fine)
  if (!header || header.trim().length < 4) {
    return { ok: false, reason: "missing or empty X-PAYMENT header" };
  }
  return { ok: true };
}

async function buildReport(ticker: string): Promise<Report> {
  const client = ch();
  const T = ticker.toUpperCase();

  const totalsP = client.query({
    query: `
      SELECT
        count() AS signals,
        uniqExact(source) AS sources,
        countIf(first_seen_at >= now() - INTERVAL 5 MINUTE) AS last_5min,
        countIf(first_seen_at >= now() - INTERVAL 1 HOUR) AS last_1h,
        countIf(first_seen_at >= now() - INTERVAL 24 HOUR) AS last_24h
      FROM signals WHERE ticker = {t:String}
    `,
    format: "JSONEachRow",
    query_params: { t: T },
  });

  const velocityP = client.query({
    query: `
      SELECT toString(toStartOfHour(first_seen_at)) AS hour, count() AS count
      FROM signals
      WHERE ticker = {t:String} AND first_seen_at >= now() - INTERVAL 24 HOUR
      GROUP BY hour ORDER BY hour ASC
    `,
    format: "JSONEachRow",
    query_params: { t: T },
  });

  const sourcesP = client.query({
    query: `
      SELECT source, count() AS count
      FROM signals WHERE ticker = {t:String}
      GROUP BY source ORDER BY count DESC LIMIT 10
    `,
    format: "JSONEachRow",
    query_params: { t: T },
  });

  const recentP = client.query({
    query: `
      SELECT source, headline, summary, url, toString(first_seen_at) AS first_seen_at
      FROM signals WHERE ticker = {t:String}
      ORDER BY first_seen_at DESC LIMIT 10
    `,
    format: "JSONEachRow",
    query_params: { t: T },
  });

  const vecP = client.query({
    query: `
      SELECT count() AS total, countIf(length(embedding) > 0) AS embedded
      FROM signals WHERE ticker = {t:String}
    `,
    format: "JSONEachRow",
    query_params: { t: T },
  });

  // Themes: pseudo-clustering via dominant tokens in headlines until vectors land.
  // Once embeddings exist, swap for cosineDistance-based clustering.
  const themesP = client.query({
    query: `
      WITH tokens AS (
        SELECT arrayJoin(splitByRegexp('[^A-Za-z]+', lower(headline))) AS token
        FROM signals WHERE ticker = {t:String} AND first_seen_at >= now() - INTERVAL 24 HOUR
      )
      SELECT token AS label, count() AS size
      FROM tokens
      WHERE length(token) > 4
        AND token NOT IN ('after','their','about','would','still','price','these','those','first','quarter','today','company','market','share','stock','shares','bloomberg','yahoo','reuters')
      GROUP BY token
      ORDER BY size DESC LIMIT 8
    `,
    format: "JSONEachRow",
    query_params: { t: T },
  });

  const [totals, velocity_24h, top_sources, recent, vec, themes] = await Promise.all([
    totalsP.then((r) => r.json()),
    velocityP.then((r) => r.json()),
    sourcesP.then((r) => r.json()),
    recentP.then((r) => r.json()),
    vecP.then((r) => r.json()),
    themesP.then((r) => r.json()),
  ]);

  const t = (totals as any[])[0] ?? { signals: 0, sources: 0, last_5min: 0, last_1h: 0, last_24h: 0 };
  const v = (vec as any[])[0] ?? { total: 0, embedded: 0 };

  return {
    ticker: T,
    generated_at: new Date().toISOString(),
    totals: {
      signals: Number(t.signals),
      sources: Number(t.sources),
      last_5min: Number(t.last_5min),
      last_1h: Number(t.last_1h),
      last_24h: Number(t.last_24h),
    },
    velocity_24h: velocity_24h as Report["velocity_24h"],
    top_sources: top_sources as Report["top_sources"],
    recent_headlines: recent as Report["recent_headlines"],
    themes: themes as Report["themes"],
    vector_indexed: { embedded: Number(v.embedded), total: Number(v.total) },
  };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await ctx.params;
  const origin = req.nextUrl.origin;
  const payment = req.headers.get("x-payment");
  const v = verifyPayment(payment);
  if (!v.ok) {
    return NextResponse.json(paymentQuote(ticker, origin), {
      status: 402,
      headers: {
        "WWW-Authenticate": `x402 realm="nimblehack" amount="${PRICE_USDC}" asset="${ASSET}" chain="${CHAIN}" payTo="${RECEIVER_WALLET}"`,
        "Cache-Control": "no-store",
      },
    });
  }
  try {
    const report = await buildReport(ticker);
    return NextResponse.json(
      { paid: true, payment_receipt_hint: (payment ?? "").slice(0, 16) + "…", report },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}

export const POST = GET;
