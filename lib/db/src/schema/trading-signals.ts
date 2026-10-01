import { boolean, doublePrecision, pgTable, text, timestamp, uuid, index, uniqueIndex } from "drizzle-orm/pg-core";

export const tradingSignalsTable = pgTable("trading_signals", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  signalKey: text("signal_key").notNull(),
  strategyId: uuid("strategy_id").notNull(),
  strategyName: text("strategy_name").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  confidence: doublePrecision("confidence").notNull(),
  price: doublePrecision("price").notNull(),
  message: text("message").notNull(),
  riskApproved: boolean("risk_approved").notNull(),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("trading_signals_user_key_uidx").on(table.userId, table.signalKey),
  index("trading_signals_user_created_idx").on(table.userId, table.createdAt),
]);

export type TradingSignal = typeof tradingSignalsTable.$inferSelect;