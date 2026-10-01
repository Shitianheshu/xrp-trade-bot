import { jsonb, pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";

export const backtestsTable = pgTable("backtests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  symbol: text("symbol").notNull(),
  interval: text("interval").notNull(),
  strategyName: text("strategy_name").notNull(),
  request: jsonb("request").notNull(),
  result: jsonb("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("backtests_user_created_idx").on(table.userId, table.createdAt)]);

export type BacktestRecord = typeof backtestsTable.$inferSelect;