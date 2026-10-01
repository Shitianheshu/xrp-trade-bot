import { and, desc, eq } from "drizzle-orm";
import {
  db,
  paperPositionsTable,
  strategiesTable,
  tradingAccountsTable,
} from "@workspace/db";
import type { StrategyParameters } from "@workspace/db";

export const DEFAULT_PARAMS: StrategyParameters = {
  fastEma: 12,
  slowEma: 26,
  rsiPeriod: 14,
  rsiOversold: 35,
  rsiOverbought: 68,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  bollingerPeriod: 20,
  bollingerStdDev: 2,
};

export async function ensureUserAccount(userId: string) {
  let [account] = await db
    .select()
    .from(tradingAccountsTable)
    .where(eq(tradingAccountsTable.userId, userId))
    .limit(1);

  if (!account) {
    [account] = await db
      .insert(tradingAccountsTable)
      .values({ userId })
      .onConflictDoNothing()
      .returning();
    if (!account) {
      [account] = await db
        .select()
        .from(tradingAccountsTable)
        .where(eq(tradingAccountsTable.userId, userId))
        .limit(1);
    }
  }
  if (!account) throw new Error("Unable to initialize the paper account.");

  let [strategy] = await db
    .select()
    .from(strategiesTable)
    .where(
      and(
        eq(strategiesTable.userId, userId),
        eq(strategiesTable.name, "Baseline XRP strategy"),
      ),
    )
    .limit(1);

  if (!strategy) {
    [strategy] = await db
      .insert(strategiesTable)
      .values({
        userId,
        name: "Baseline XRP strategy",
        symbol: process.env.TRADING_SYMBOL ?? "XRP/USDT",
        interval: "1h",
        type: "combined",
        params: DEFAULT_PARAMS,
        stopLossPct: 2,
        takeProfitPct: 4,
        trailingStopPct: null,
        maxPositionPct: 10,
        maxDailyLossPct: 3,
        maxTradesPerDay: 20,
        cooldownSeconds: 300,
        minConfidence: 0.65,
        active: true,
      })
      .onConflictDoNothing()
      .returning();
    if (!strategy) {
      [strategy] = await db
        .select()
        .from(strategiesTable)
        .where(
          and(
            eq(strategiesTable.userId, userId),
            eq(strategiesTable.name, "Baseline XRP strategy"),
          ),
        )
        .limit(1);
    }
  }
  if (!strategy) throw new Error("Unable to initialize the baseline strategy.");

  if (!account.activeStrategyId) {
    await db
      .update(tradingAccountsTable)
      .set({ activeStrategyId: strategy.id, updatedAt: new Date() })
      .where(eq(tradingAccountsTable.userId, userId));
    [account] = await db
      .select()
      .from(tradingAccountsTable)
      .where(eq(tradingAccountsTable.userId, userId))
      .limit(1);
  }
  if (!account) throw new Error("Unable to load the paper account.");
  return { account, strategy };
}

export async function listOpenPositions(userId: string) {
  return db
    .select()
    .from(paperPositionsTable)
    .where(eq(paperPositionsTable.userId, userId))
    .orderBy(desc(paperPositionsTable.openedAt));
}

export function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}