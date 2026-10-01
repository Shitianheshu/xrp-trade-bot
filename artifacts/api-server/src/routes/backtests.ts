import { and, desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetBacktestParams,
  GetBacktestResponse,
  GetBacktestsResponse,
  RunBacktestBody,
  RunBacktestResponse,
} from "@workspace/api-zod";
import {
  backtestsTable,
  db,
  marketCandlesTable,
  strategiesTable,
} from "@workspace/db";
import { authenticatedUserId, requireAuth } from "../middlewares/require-auth";
import { getExchangeAdapter, MarketDataError } from "../lib/market-data";
import { runBacktest, type BacktestResult } from "../lib/trading-math";
import { logger } from "../lib/logger";

const router: IRouter = Router();
router.use(requireAuth);

const candlesPerDay: Record<string, number> = {
  "1m": 1440,
  "5m": 288,
  "15m": 96,
  "1h": 24,
  "4h": 6,
  "1d": 1,
};

function serializeRecord(record: typeof backtestsTable.$inferSelect) {
  const result = record.result as BacktestResult;
  return {
    ...result,
    id: record.id,
    symbol: record.symbol,
    interval: record.interval,
    strategyName: record.strategyName,
    createdAt: record.createdAt.toISOString(),
  };
}

router.get("/backtests", async (_req, res): Promise<void> => {
  const records = await db
    .select()
    .from(backtestsTable)
    .where(eq(backtestsTable.userId, authenticatedUserId(res)))
    .orderBy(desc(backtestsTable.createdAt))
    .limit(50);
  res.json(
    GetBacktestsResponse.parse(
      records.map((record) => {
        const item = serializeRecord(record);
        return {
          id: item.id,
          symbol: item.symbol,
          interval: item.interval,
          strategyName: item.strategyName,
          totalReturnPct: item.totalReturnPct,
          netProfit: item.netProfit,
          winRate: item.winRate,
          profitFactor: item.profitFactor,
          maxDrawdownPct: item.maxDrawdownPct,
          tradeCount: item.tradeCount,
          createdAt: item.createdAt,
        };
      }),
    ),
  );
});

router.post("/backtests", async (req, res): Promise<void> => {
  const userId = authenticatedUserId(res);
  const body = RunBacktestBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { strategyId, symbol, interval, days, initialCapital, feeBps, slippageBps } =
    body.data;
  const points = days * candlesPerDay[interval];
  if (points > 10_000) {
    res.status(400).json({
      error: "This interval and date range would require more than 10,000 candles. Use a shorter range or wider interval.",
    });
    return;
  }
  const [strategy] = await db
    .select()
    .from(strategiesTable)
    .where(
      and(
        eq(strategiesTable.id, strategyId),
        eq(strategiesTable.userId, userId),
      ),
    )
    .limit(1);
  if (!strategy) {
    res.status(404).json({ error: "Strategy not found." });
    return;
  }
  try {
    const adapter = getExchangeAdapter();
    const candles = await adapter.history(
      symbol,
      interval,
      Date.now() - days * 86_400_000,
    );
    if (candles.length < Math.max(strategy.params.slowEma, 30) + 5) {
      res.status(502).json({
        error: "Exchange returned too few complete candles for a meaningful backtest.",
      });
      return;
    }
    for (let offset = 0; offset < candles.length; offset += 500) {
      const batch = candles.slice(offset, offset + 500);
      await db
        .insert(marketCandlesTable)
        .values(
          batch.map((candle) => ({
            exchange: adapter.id,
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

    const metrics = runBacktest(
      candles,
      {
        type: strategy.type as "ema_crossover" | "rsi_reversion" | "macd" | "bollinger" | "combined",
        params: strategy.params,
        stopLossPct: strategy.stopLossPct,
        takeProfitPct: strategy.takeProfitPct,
        trailingStopPct: strategy.trailingStopPct,
        minConfidence: strategy.minConfidence,
      },
      initialCapital,
      feeBps,
      slippageBps,
    );
    const [record] = await db
      .insert(backtestsTable)
      .values({
        userId,
        symbol,
        interval,
        strategyName: strategy.name,
        request: body.data,
        result: metrics,
      })
      .returning();
    res.status(201).json(
      RunBacktestResponse.parse(serializeRecord(record)),
    );
  } catch (error) {
    logger.warn({ err: error, symbol, interval }, "Backtest data request failed");
    res.status(error instanceof MarketDataError ? error.status : 502).json({
      error: error instanceof Error
        ? error.message
        : "Historical exchange data is unavailable.",
    });
  }
});

router.get("/backtests/:id", async (req, res): Promise<void> => {
  const params = GetBacktestParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [record] = await db
    .select()
    .from(backtestsTable)
    .where(
      and(
        eq(backtestsTable.id, params.data.id),
        eq(backtestsTable.userId, authenticatedUserId(res)),
      ),
    )
    .limit(1);
  if (!record) {
    res.status(404).json({ error: "Backtest not found." });
    return;
  }
  res.json(GetBacktestResponse.parse(serializeRecord(record)));
});

export default router;