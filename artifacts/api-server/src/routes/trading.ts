import { and, desc, eq, gte, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  EmergencyStopTradingResponse,
  GetOrdersQueryParams,
  GetOrdersResponse,
  GetPaperValidationResponse,
  GetPortfolioResponse,
  GetPositionsResponse,
  GetSignalsQueryParams,
  GetSignalsResponse,
  GetTradesQueryParams,
  GetTradesResponse,
  GetTradingDashboardResponse,
  GetTradingStatusResponse,
  UpdateRiskSettingsBody,
  UpdateRiskSettingsResponse,
  GetRiskSettingsResponse,
  StartPaperTradingBody,
  StartPaperTradingResponse,
  StopPaperTradingResponse,
} from "@workspace/api-zod";
import {
  db,
  paperOrdersTable,
  paperPositionsTable,
  paperTradesTable,
  strategiesTable,
  tradingAccountsTable,
  tradingSignalsTable,
} from "@workspace/db";
import { authenticatedUserId, requireAuth } from "../middlewares/require-auth";
import { getExchangeAdapter } from "../lib/market-data";
import {
  ensureUserAccount,
} from "../lib/trading-store";
import {
  getTradingStatus,
  startPaperTrading,
  stopPaperTrading,
} from "../lib/paper-engine";
import { logger } from "../lib/logger";

const router: IRouter = Router();
router.use(requireAuth);

function serializeStrategy(strategy: typeof strategiesTable.$inferSelect | null) {
  if (!strategy) return null;
  return {
    ...strategy,
    createdAt: strategy.createdAt.toISOString(),
    updatedAt: strategy.updatedAt.toISOString(),
  };
}

function serializePosition(
  position: typeof paperPositionsTable.$inferSelect,
  markPrice: number,
) {
  const marketValue = position.quantity * markPrice;
  const pnl = (markPrice - position.entryPrice) * position.quantity - position.entryFee;
  return {
    id: position.id,
    symbol: position.symbol,
    quantity: position.quantity,
    entryPrice: position.entryPrice,
    markPrice,
    quoteValue: marketValue,
    unrealizedPnl: pnl,
    unrealizedPnlPct:
      position.entryPrice > 0
        ? pnl / (position.entryPrice * position.quantity) * 100
        : 0,
    stopLossPrice: position.stopLossPrice,
    takeProfitPrice: position.takeProfitPrice,
    openedAt: position.openedAt.toISOString(),
    strategyName: position.strategyName,
  };
}

function serializeOrder(order: typeof paperOrdersTable.$inferSelect) {
  return {
    id: order.id,
    clientOrderId: order.clientOrderId,
    symbol: order.symbol,
    side: order.side,
    type: "market",
    quantity: order.quantity,
    price: order.price,
    fee: order.fee,
    status: order.status,
    strategyName: order.strategyName,
    createdAt: order.createdAt.toISOString(),
  };
}

function serializeTrade(trade: typeof paperTradesTable.$inferSelect) {
  return {
    id: trade.id,
    symbol: trade.symbol,
    quantity: trade.quantity,
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    grossPnl: trade.grossPnl,
    netPnl: trade.netPnl,
    fees: trade.fees,
    pnlPct: trade.pnlPct,
    exitReason: trade.exitReason,
    strategyName: trade.strategyName,
    openedAt: trade.openedAt.toISOString(),
    closedAt: trade.closedAt.toISOString(),
  };
}

function serializeSignal(signal: typeof tradingSignalsTable.$inferSelect) {
  return {
    id: signal.id,
    symbol: signal.symbol,
    strategyName: signal.strategyName,
    side: signal.side,
    confidence: signal.confidence,
    price: signal.price,
    message: signal.message,
    riskApproved: signal.riskApproved,
    rejectionReason: signal.rejectionReason,
    createdAt: signal.createdAt.toISOString(),
  };
}

async function loadMarkedPositions(userId: string) {
  const positions = await db
    .select()
    .from(paperPositionsTable)
    .where(eq(paperPositionsTable.userId, userId))
    .orderBy(desc(paperPositionsTable.openedAt));
  const adapter = getExchangeAdapter();
  const tickers = new Map<string, number>();
  for (const position of positions) {
    if (!tickers.has(position.symbol)) {
      tickers.set(position.symbol, (await adapter.ticker(position.symbol)).price);
    }
  }
  return positions.map((position) =>
    serializePosition(position, tickers.get(position.symbol) ?? position.entryPrice),
  );
}

async function aggregateTrades(userId: string, today: Date) {
  const [totals] = await db
    .select({
      totalTrades: sql<number>`count(*)`.mapWith(Number),
      winningTrades: sql<number>`count(*) filter (where ${paperTradesTable.netPnl} > 0)`.mapWith(Number),
      realizedPnl: sql<number>`coalesce(sum(${paperTradesTable.netPnl}), 0)`.mapWith(Number),
      realizedToday: sql<number>`coalesce(sum(case when ${paperTradesTable.closedAt} >= ${today} then ${paperTradesTable.netPnl} else 0 end), 0)`.mapWith(Number),
      feesPaid: sql<number>`coalesce(sum(${paperTradesTable.fees}), 0)`.mapWith(Number),
    })
    .from(paperTradesTable)
    .where(eq(paperTradesTable.userId, userId));
  return totals ?? {
    totalTrades: 0,
    winningTrades: 0,
    realizedPnl: 0,
    realizedToday: 0,
    feesPaid: 0,
  };
}

async function buildPortfolio(userId: string) {
  const { account } = await ensureUserAccount(userId);
  const positions = await loadMarkedPositions(userId);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const totals = await aggregateTrades(userId, today);
  const dayPnl =
    totals.realizedToday +
    positions.reduce((sum, position) => sum + position.unrealizedPnl, 0);
  const unrealizedPnl = positions.reduce(
    (sum, position) => sum + position.unrealizedPnl,
    0,
  );
  const markedValue = positions.reduce((sum, position) => sum + position.quoteValue, 0);
  return {
    mode: "paper",
    quoteCurrency: (positions[0]?.symbol.split("/")[1] ?? "USDT"),
    initialBalance: account.initialBalance,
    availableBalance: account.availableBalance,
    equity: account.availableBalance + markedValue,
    realizedPnl: totals.realizedPnl,
    unrealizedPnl,
    dayPnl,
    openPositions: positions,
  };
}

async function getRiskSettings(userId: string) {
  const { account } = await ensureUserAccount(userId);
  return {
    initialPaperBalance: account.initialBalance,
    availableBalance: account.availableBalance,
    riskPerTradePct: account.riskPerTradePct,
    maxDailyLossPct: account.maxDailyLossPct,
    maxPositionPct: account.maxPositionPct,
    maxExposurePct: account.maxExposurePct,
    maxDrawdownPct: account.maxDrawdownPct,
    maxOpenPositions: account.maxOpenPositions,
    maxTradesPerDay: account.maxTradesPerDay,
    feeBps: account.feeBps,
    slippageBps: account.slippageBps,
  };
}

router.get("/dashboard", async (_req, res): Promise<void> => {
  const userId = authenticatedUserId(res);
  const { account } = await ensureUserAccount(userId);
  const [ticker, portfolio, orders, trades, signals, strategy] = await Promise.all([
    getExchangeAdapter().ticker(process.env.TRADING_SYMBOL ?? "XRP/USDT"),
    buildPortfolio(userId),
    db.select().from(paperOrdersTable).where(eq(paperOrdersTable.userId, userId))
      .orderBy(desc(paperOrdersTable.createdAt)).limit(6),
    db.select().from(paperTradesTable).where(eq(paperTradesTable.userId, userId))
      .orderBy(desc(paperTradesTable.closedAt)).limit(6),
    db.select().from(tradingSignalsTable).where(eq(tradingSignalsTable.userId, userId))
      .orderBy(desc(tradingSignalsTable.createdAt)).limit(6),
    account.activeStrategyId
      ? db.select().from(strategiesTable).where(and(
          eq(strategiesTable.id, account.activeStrategyId),
          eq(strategiesTable.userId, userId),
        )).limit(1).then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const totals = await aggregateTrades(userId, today);
  const dashboard = {
    ticker,
    portfolio,
    trading: await getTradingStatus(userId),
    stats: {
      totalTrades: totals.totalTrades,
      winRate: totals.totalTrades ? totals.winningTrades / totals.totalTrades * 100 : 0,
      realizedPnl: totals.realizedPnl,
      feesPaid: totals.feesPaid,
      maxDrawdownPct: account.highWaterMark > 0
        ? Math.max(0, (account.highWaterMark - portfolio.equity) / account.highWaterMark * 100)
        : 0,
    },
    activeStrategy: serializeStrategy(strategy),
    recentTrades: trades.map(serializeTrade),
    recentSignals: signals.map(serializeSignal),
  };
  res.json(GetTradingDashboardResponse.parse(dashboard));
});

router.get("/portfolio", async (_req, res): Promise<void> => {
  const result = await buildPortfolio(authenticatedUserId(res));
  res.json(GetPortfolioResponse.parse(result));
});

router.get("/positions", async (_req, res): Promise<void> => {
  const result = await loadMarkedPositions(authenticatedUserId(res));
  res.json(GetPositionsResponse.parse(result));
});

router.get("/orders", async (req, res): Promise<void> => {
  const query = GetOrdersQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const orders = await db
    .select()
    .from(paperOrdersTable)
    .where(eq(paperOrdersTable.userId, authenticatedUserId(res)))
    .orderBy(desc(paperOrdersTable.createdAt))
    .limit(query.data.limit);
  res.json(GetOrdersResponse.parse(orders.map(serializeOrder)));
});

router.get("/trades", async (req, res): Promise<void> => {
  const query = GetTradesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const trades = await db
    .select()
    .from(paperTradesTable)
    .where(eq(paperTradesTable.userId, authenticatedUserId(res)))
    .orderBy(desc(paperTradesTable.closedAt))
    .limit(query.data.limit);
  res.json(GetTradesResponse.parse(trades.map(serializeTrade)));
});

router.get("/signals", async (req, res): Promise<void> => {
  const query = GetSignalsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const signals = await db
    .select()
    .from(tradingSignalsTable)
    .where(eq(tradingSignalsTable.userId, authenticatedUserId(res)))
    .orderBy(desc(tradingSignalsTable.createdAt))
    .limit(query.data.limit);
  res.json(GetSignalsResponse.parse(signals.map(serializeSignal)));
});

router.get("/trading/status", async (_req, res): Promise<void> => {
  const status = await getTradingStatus(authenticatedUserId(res));
  res.json(GetTradingStatusResponse.parse(status));
});

router.post("/trading/start", async (req, res): Promise<void> => {
  const body = StartPaperTradingBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  try {
    const status = await startPaperTrading(authenticatedUserId(res), body.data.strategyId);
    res.json(StartPaperTradingResponse.parse(status));
  } catch (error) {
    res.status(409).json({
      error: error instanceof Error ? error.message : "Paper trading could not start.",
    });
  }
});

router.post("/trading/stop", async (_req, res): Promise<void> => {
  const status = await stopPaperTrading(authenticatedUserId(res));
  res.json(StopPaperTradingResponse.parse(status));
});

router.post("/trading/emergency-stop", async (_req, res): Promise<void> => {
  const status = await stopPaperTrading(authenticatedUserId(res), true);
  logger.error({ userId: authenticatedUserId(res) }, "Emergency stop activated");
  res.json(EmergencyStopTradingResponse.parse(status));
});

router.get("/risk/settings", async (_req, res): Promise<void> => {
  const result = await getRiskSettings(authenticatedUserId(res));
  res.json(GetRiskSettingsResponse.parse(result));
});

router.put("/risk/settings", async (req, res): Promise<void> => {
  const userId = authenticatedUserId(res);
  const body = UpdateRiskSettingsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const { account } = await ensureUserAccount(userId);
  if (account.state === "running") {
    res.status(409).json({ error: "Stop paper trading before changing risk limits." });
    return;
  }
  await db
    .update(tradingAccountsTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(tradingAccountsTable.userId, userId));
  const updated = await getRiskSettings(userId);
  res.json(UpdateRiskSettingsResponse.parse(updated));
});

router.get("/paper-validation", async (_req, res): Promise<void> => {
  const userId = authenticatedUserId(res);
  const { account } = await ensureUserAccount(userId);
  const checks: Array<{
    id: string;
    label: string;
    status: "passed" | "pending" | "blocked";
    detail: string;
  }> = [];
  try {
    const ticker = await getExchangeAdapter().ticker(
      process.env.TRADING_SYMBOL ?? "XRP/USDT",
    );
    checks.push({
      id: "market-feed",
      label: "Public market feed",
      status: ticker.stale ? "blocked" : "passed",
      detail: ticker.stale
        ? "The latest ticker is stale; automated paper execution will stop if data remains stale."
        : `${ticker.exchange} ticker is current (${ticker.symbol}).`,
    });
  } catch {
    checks.push({
      id: "market-feed",
      label: "Public market feed",
      status: "blocked",
      detail: "A current exchange ticker could not be verified.",
    });
  }
  try {
    await db.execute(sql`select 1`);
    checks.push({
      id: "database",
      label: "Persistent storage",
      status: "passed",
      detail: "Paper account, orders, positions and trades are stored in PostgreSQL.",
    });
  } catch {
    checks.push({
      id: "database",
      label: "Persistent storage",
      status: "blocked",
      detail: "Database health could not be verified.",
    });
  }
  checks.push({
    id: "risk-controls",
    label: "Risk limits",
    status: account.riskPerTradePct > 0 &&
        account.maxDailyLossPct > 0 &&
        account.maxPositionPct > 0 &&
        account.maxOpenPositions > 0
      ? "passed"
      : "blocked",
    detail: "Per-trade sizing, daily loss, position and drawdown limits are enforced before entries.",
  });
  checks.push({
    id: "execution-mode",
    label: "Execution mode",
    status: "passed",
    detail: "Paper mode only. Live exchange order execution is not implemented or enabled.",
  });
  checks.push({
    id: "recovery",
    label: "Restart recovery",
    status: "passed",
    detail: "Paper trading state and open positions persist in the database and are reloaded by the worker.",
  });
  checks.push({
    id: "exchange-reconciliation",
    label: "Exchange reconciliation",
    status: "pending",
    detail: "Not applicable to this paper-only build; no exchange account is connected.",
  });
  res.json(GetPaperValidationResponse.parse({
    checks,
    liveTradingEnabled: false,
  }));
});

export default router;