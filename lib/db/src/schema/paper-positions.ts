import { doublePrecision, pgTable, text, timestamp, uuid, uniqueIndex, index } from "drizzle-orm/pg-core";

export const paperPositionsTable = pgTable("paper_positions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  strategyId: uuid("strategy_id").notNull(),
  strategyName: text("strategy_name").notNull(),
  symbol: text("symbol").notNull(),
  quantity: doublePrecision("quantity").notNull(),
  entryPrice: doublePrecision("entry_price").notNull(),
  stopLossPrice: doublePrecision("stop_loss_price").notNull(),
  takeProfitPrice: doublePrecision("take_profit_price").notNull(),
  highestPrice: doublePrecision("highest_price").notNull(),
  entryFee: doublePrecision("entry_fee").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("paper_positions_user_symbol_uidx").on(table.userId, table.symbol),
  index("paper_positions_user_idx").on(table.userId),
]);

export type PaperPosition = typeof paperPositionsTable.$inferSelect;