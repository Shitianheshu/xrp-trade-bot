import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import {
  db,
  marketCandlesTable,
} from "@workspace/db";
import {
  GetMarketOhlcvQueryParams,
  GetMarketOhlcvResponse,
  GetMarketTickerQueryParams,
  GetMarketTickerResponse,
  GetReadinessResponse,
} from "@workspace/api-zod";
import {
  getExchangeAdapter,
  MarketDataError,
} from "../lib/market-data";

const router: IRouter = Router();

router.get("/ready", async (_req, res): Promise<void> => {
  let database: "ok" | "unavailable" = "ok";
  let marketData: "ok" | "unavailable" = "ok";
  try {
    await db.execute(sql`select 1`);
  } catch {
    database = "unavailable";
  }
  try {
    const ticker = await getExchangeAdapter().ticker(
      process.env.TRADING_SYMBOL ?? "XRP/USDT",
    );
    if (ticker.stale) marketData = "unavailable";
  } catch {
    marketData = "unavailable";
  }
  const result = {
    status: database === "ok" && marketData === "ok" ? "ready" : "degraded",
    database,
    marketData,
    tradingMode: "paper",
  };
  res.json(GetReadinessResponse.parse(result));
});

router.get("/market/ticker", async (req, res): Promise<void> => {
  const query = GetMarketTickerQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  try {
    const ticker = await getExchangeAdapter().ticker(query.data.symbol);
    res.json(GetMarketTickerResponse.parse(ticker));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Market data unavailable.";
    const status = error instanceof MarketDataError ? error.status : 502;
    req.log.warn({ err: error, symbol: query.data.symbol }, "Ticker request failed");
    res.status(status).json({ error: message });
  }
});

router.get("/market/ohlcv", async (req, res): Promise<void> => {
  const query = GetMarketOhlcvQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  try {
    const { symbol, interval, limit } = query.data;
    const exchange = getExchangeAdapter();
    const candles = await exchange.candles(symbol, interval, limit);
    if (candles.length) {
      await db
        .insert(marketCandlesTable)
        .values(
          candles.map((candle) => ({
            exchange: exchange.id,
            symbol,
            interval,
            time: new Date(candle.time),
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
          })),
        )
        .onConflictDoUpdate({
          target: [
            marketCandlesTable.exchange,
            marketCandlesTable.symbol,
            marketCandlesTable.interval,
            marketCandlesTable.time,
          ],
          set: {
            open: sql`excluded.open`,
            high: sql`excluded.high`,
            low: sql`excluded.low`,
            close: sql`excluded.close`,
            volume: sql`excluded.volume`,
          },
        });
    }
    res.json(GetMarketOhlcvResponse.parse(candles));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Market data unavailable.";
    const status = error instanceof MarketDataError ? error.status : 502;
    req.log.warn({ err: error, symbol: query.data.symbol }, "Candle request failed");
    res.status(status).json({ error: message });
  }
});

export default router;