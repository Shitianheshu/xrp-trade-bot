import { jsonb, pgTable, text, numeric, integer, boolean, timestamp, uuid, index, uniqueIndex } from "drizzle-orm/pg-core";

export interface StrategyParameters {
  fastEma: number;
  slowEma: number;
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  bollingerPeriod: number;
  bollingerStdDev: number;
}

export const strategiesTable = pgTable("trading_strategies", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  symbol: text("symbol").notNull().default("XRP/USDT"),
  interval: text("interval").notNull().default("1h"),
  type: text("type").notNull().default("combined"),
  params: jsonb("params").$type<StrategyParameters>().notNull(),
  stopLossPct: numeric("stop_loss_pct", { precision: 8, scale: 4, mode: "number" }).notNull().default(2),
  takeProfitPct: numeric("take_profit_pct", { precision: 8, scale: 4, mode: "number" }).notNull().default(4),
  trailingStopPct: numeric("trailing_stop_pct", { precision: 8, scale: 4, mode: "number" }),
  maxPositionPct: numeric("max_position_pct", { precision: 8, scale: 4, mode: "number" }).notNull().default(10),
  maxDailyLossPct: numeric("max_daily_loss_pct", { precision: 8, scale: 4, mode: "number" }).notNull().default(3),
  maxTradesPerDay: integer("max_trades_per_day").notNull().default(20),
  cooldownSeconds: integer("cooldown_seconds").notNull().default(300),
  minConfidence: numeric("min_confidence", { precision: 8, scale: 4, mode: "number" }).notNull().default(0.65),
  active: boolean("active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("trading_strategies_user_idx").on(table.userId),
  uniqueIndex("trading_strategies_user_name_uidx").on(table.userId, table.name),
]);

export type Strategy = typeof strategiesTable.$inferSelect;