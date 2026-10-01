import { logger } from "./logger";

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketTicker {
  exchange: string;
  symbol: string;
  price: number;
  change24h: number;
  changePct24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  updatedAt: string;
  stale: boolean;
}

export interface ExchangeAdapter {
  readonly id: string;
  ticker(symbol: string): Promise<MarketTicker>;
  candles(symbol: string, interval: string, limit: number): Promise<Candle[]>;
  history(symbol: string, interval: string, startTime: number): Promise<Candle[]>;
}

const BINANCE_API = "https://api.binance.com";
const BINANCE_INTERVALS = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);
const QUOTES = new Set(["USDT", "USDC", "USD", "BTC", "ETH", "JPY"]);
const tickerCache = new Map<string, { expires: number; value: MarketTicker }>();
const candleCache = new Map<string, { expires: number; value: Candle[] }>();

export class MarketDataError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = "MarketDataError";
  }
}

function validateSymbol(symbol: string): string {
  const match = /^([A-Z0-9]{2,14})\/([A-Z0-9]{2,10})$/.exec(symbol);
  if (!match || !QUOTES.has(match[2])) {
    throw new MarketDataError(
      "Use a supported spot pair such as XRP/USDT or XRP/JPY.",
      400,
    );
  }
  return `${match[1]}${match[2]}`;
}

async function fetchJson(url: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
      if (response.status === 429 || response.status >= 500) {
        if (attempt < 2) {
          const retryAfter = Number(response.headers.get("retry-after"));
          const delay = Number.isFinite(retryAfter)
            ? Math.min(Math.max(retryAfter, 0), 2) * 1000
            : 250 * 2 ** attempt;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }
      if (!response.ok) {
        throw new MarketDataError(
          response.status === 429
            ? "Exchange rate limit reached; try again shortly."
            : `Exchange returned HTTP ${response.status}.`,
          502,
        );
      }
      return await response.json();
    } catch (error) {
      if (error instanceof MarketDataError) throw error;
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
  logger.warn({ err: lastError }, "Binance market data request failed");
  throw new MarketDataError("Exchange market data is temporarily unavailable.");
}

function finiteNumber(value: unknown, field: string): number {
  const result = Number(value);
  if (!Number.isFinite(result)) {
    throw new MarketDataError(`Exchange returned invalid ${field}.`);
  }
  return result;
}

function parseCandleRow(row: unknown): Candle {
  if (!Array.isArray(row) || row.length < 6) {
    throw new MarketDataError("Exchange returned an invalid candle.");
  }
  return {
    time: new Date(finiteNumber(row[0], "candle time")).toISOString(),
    open: finiteNumber(row[1], "candle open"),
    high: finiteNumber(row[2], "candle high"),
    low: finiteNumber(row[3], "candle low"),
    close: finiteNumber(row[4], "candle close"),
    volume: finiteNumber(row[5], "candle volume"),
  };
}

class BinancePublicAdapter implements ExchangeAdapter {
  readonly id = "binance";

  async ticker(symbol: string): Promise<MarketTicker> {
    const exchangeSymbol = validateSymbol(symbol);
    const cached = tickerCache.get(exchangeSymbol);
    if (cached && cached.expires > Date.now()) return cached.value;

    const data = (await fetchJson(
      `${BINANCE_API}/api/v3/ticker/24hr?symbol=${encodeURIComponent(exchangeSymbol)}`,
    )) as Record<string, unknown>;
    const updatedAt = new Date(finiteNumber(data.closeTime, "ticker time")).toISOString();
    const value: MarketTicker = {
      exchange: this.id,
      symbol,
      price: finiteNumber(data.lastPrice, "price"),
      change24h: finiteNumber(data.priceChange, "24-hour change"),
      changePct24h: finiteNumber(data.priceChangePercent, "24-hour percentage change"),
      high24h: finiteNumber(data.highPrice, "24-hour high"),
      low24h: finiteNumber(data.lowPrice, "24-hour low"),
      volume24h: finiteNumber(data.volume, "24-hour volume"),
      updatedAt,
      stale: Date.now() - Date.parse(updatedAt) > 60_000,
    };
    tickerCache.set(exchangeSymbol, { expires: Date.now() + 3000, value });
    return value;
  }

  async candles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    const exchangeSymbol = validateSymbol(symbol);
    if (!BINANCE_INTERVALS.has(interval)) {
      throw new MarketDataError("Unsupported candle interval.", 400);
    }
    const safeLimit = Math.max(30, Math.min(1000, Math.floor(limit)));
    const cacheKey = `${exchangeSymbol}:${interval}:${safeLimit}`;
    const cached = candleCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.value;

    const data = (await fetchJson(
      `${BINANCE_API}/api/v3/klines?symbol=${encodeURIComponent(exchangeSymbol)}&interval=${interval}&limit=${safeLimit}`,
    )) as unknown[];
    const now = Date.now();
    const candles = data.map(parseCandleRow).filter((candle) => Date.parse(candle.time) < now);
    candleCache.set(cacheKey, { expires: Date.now() + 5000, value: candles });
    return candles;
  }

  async history(symbol: string, interval: string, startTime: number): Promise<Candle[]> {
    const exchangeSymbol = validateSymbol(symbol);
    if (!BINANCE_INTERVALS.has(interval)) {
      throw new MarketDataError("Unsupported candle interval.", 400);
    }
    const output: Candle[] = [];
    let cursor = startTime;
    const now = Date.now();
    // Hard limit bounds exchange load; callers must reject requests needing more data.
    while (cursor < now && output.length < 10_000) {
      const batch = (await fetchJson(
        `${BINANCE_API}/api/v3/klines?symbol=${encodeURIComponent(exchangeSymbol)}&interval=${interval}&startTime=${cursor}&limit=1000`,
      )) as unknown[];
      if (!batch.length) break;
      const parsed = batch.map(parseCandleRow).filter((candle) => Date.parse(candle.time) < now);
      output.push(...parsed);
      const lastTimestamp = Number((batch[batch.length - 1] as unknown[])[0]);
      if (!Number.isFinite(lastTimestamp) || lastTimestamp < cursor || batch.length < 1000) break;
      cursor = lastTimestamp + 1;
    }
    return output.slice(0, 10_000);
  }
}

const adapters: Record<string, ExchangeAdapter> = {
  binance: new BinancePublicAdapter(),
};

export function getExchangeAdapter(): ExchangeAdapter {
  const id = (process.env.EXCHANGE ?? "binance").toLowerCase();
  const adapter = adapters[id];
  if (!adapter) {
    throw new MarketDataError(
      `Exchange "${id}" has no installed market-data adapter. Configure EXCHANGE=binance.`,
      503,
    );
  }
  return adapter;
}