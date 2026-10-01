import { doublePrecision, pgTable, text, timestamp, uuid, uniqueIndex, index } from "drizzle-orm/pg-core";

export const paperOrdersTable = pgTable("paper_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  clientOrderId: text("client_order_id").notNull(),
  strategyId: uuid("strategy_id").notNull(),
  strategyName: text("strategy_name").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  quantity: doublePrecision("quantity").notNull(),
  price: doublePrecision("price").notNull(),
  fee: doublePrecision("fee").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("paper_orders_user_client_id_uidx").on(table.userId, table.clientOrderId),
  index("paper_orders_user_created_idx").on(table.userId, table.createdAt),
]);

export type PaperOrder = typeof paperOrdersTable.$inferSelect;