import { doublePrecision, pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";

export const paperTradesTable = pgTable("paper_trades", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  strategyId: uuid("strategy_id").notNull(),
  strategyName: text("strategy_name").notNull(),
  symbol: text("symbol").notNull(),
  quantity: doublePrecision("quantity").notNull(),
  entryPrice: doublePrecision("entry_price").notNull(),
  exitPrice: doublePrecision("exit_price").notNull(),
  grossPnl: doublePrecision("gross_pnl").notNull(),
  netPnl: doublePrecision("net_pnl").notNull(),
  fees: doublePrecision("fees").notNull(),
  pnlPct: doublePrecision("pnl_pct").notNull(),
  exitReason: text("exit_reason").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("paper_trades_user_closed_idx").on(table.userId, table.closedAt)]);

export type PaperTrade = typeof paperTradesTable.$inferSelect;