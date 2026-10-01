import { doublePrecision, pgTable, text, timestamp, primaryKey, index } from "drizzle-orm/pg-core";

export const marketCandlesTable = pgTable("market_candles", {
  exchange: text("exchange").notNull(),
  symbol: text("symbol").notNull(),
  interval: text("interval").notNull(),
  time: timestamp("time", { withTimezone: true }).notNull(),
  open: doublePrecision("open").notNull(),
  high: doublePrecision("high").notNull(),
  low: doublePrecision("low").notNull(),
  close: doublePrecision("close").notNull(),
  volume: doublePrecision("volume").notNull(),
}, (table) => [
  primaryKey({ columns: [table.exchange, table.symbol, table.interval, table.time] }),
  index("market_candles_symbol_interval_time_idx").on(table.symbol, table.interval, table.time),
]);