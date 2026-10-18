import {
  accounts,
  strategies,
  type StrategyParameters,
  type StrategyRecord,
  type TradingAccount,
} from "@workspace/db";

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

export async function ensureUserAccount(userId: string): Promise<{ account: TradingAccount; strategy: StrategyRecord }> {
  let account = await accounts.findByUser(userId);
  if (!account) {
    account = await accounts.insert(userId);
    account ??= await accounts.findByUser(userId);
  }
  if (!account) throw new Error("Unable to initialize the paper account.");

  let strategy = await strategies.findByName(userId, "Baseline XRP strategy");
  if (!strategy) {
    strategy = await strategies.insert({
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
    });
    strategy ??= await strategies.findByName(userId, "Baseline XRP strategy");
  }
  if (!strategy) throw new Error("Unable to initialize the baseline strategy.");

  if (!account.activeStrategyId) {
    await accounts.update(userId, { activeStrategyId: strategy.id, updatedAt: new Date() });
    account = await accounts.findByUser(userId);
  }
  if (!account) throw new Error("Unable to load the paper account.");
  return { account, strategy };
}

export function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
