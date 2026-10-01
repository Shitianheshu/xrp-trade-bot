import { pgTable, numeric, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";

export const tradingAccountsTable = pgTable("trading_accounts", {
  userId: text("user_id").primaryKey(),
  initialBalance: numeric("initial_balance", { precision: 30, scale: 12, mode: "number" }).notNull().default(10000),
  availableBalance: numeric("available_balance", { precision: 30, scale: 12, mode: "number" }).notNull().default(10000),
  dayStartBalance: numeric("day_start_balance", { precision: 30, scale: 12, mode: "number" }).notNull().default(10000),
  highWaterMark: numeric("high_water_mark", { precision: 30, scale: 12, mode: "number" }).notNull().default(10000),
  riskPerTradePct: numeric("risk_per_trade_pct", { precision: 8, scale: 4, mode: "number" }).notNull().default(1),
  maxDailyLossPct: numeric("max_daily_loss_pct", { precision: 8, scale: 4, mode: "number" }).notNull().default(3),
  maxPositionPct: numeric("max_position_pct", { precision: 8, scale: 4, mode: "number" }).notNull().default(10),
  maxExposurePct: numeric("max_exposure_pct", { precision: 8, scale: 4, mode: "number" }).notNull().default(10),
  maxDrawdownPct: numeric("max_drawdown_pct", { precision: 8, scale: 4, mode: "number" }).notNull().default(10),
  maxOpenPositions: integer("max_open_positions").notNull().default(1),
  maxTradesPerDay: integer("max_trades_per_day").notNull().default(20),
  feeBps: numeric("fee_bps", { precision: 8, scale: 4, mode: "number" }).notNull().default(10),
  slippageBps: numeric("slippage_bps", { precision: 8, scale: 4, mode: "number" }).notNull().default(5),
  state: text("state").notNull().default("stopped"),
  emergencyStop: boolean("emergency_stop").notNull().default(false),
  activeStrategyId: text("active_strategy_id"),
  lastMarketUpdate: timestamp("last_market_update", { withTimezone: true }),
  dayStartedAt: timestamp("day_started_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type TradingAccount = typeof tradingAccountsTable.$inferSelect;