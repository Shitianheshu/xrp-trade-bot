import { randomUUID } from "node:crypto";
import { MongoClient, MongoServerError, type Collection, type Document } from "mongodb";
import type {
  BacktestRecord,
  MarketCandleRecord,
  PaperOrder,
  PaperPosition,
  PaperTrade,
  StrategyRecord,
  TradingAccount,
  TradingSignal,
} from "./types";

export type {
  BacktestRecord,
  MarketCandleRecord,
  PaperOrder,
  PaperPosition,
  PaperTrade,
  StrategyParameters,
  StrategyRecord,
  TradingAccount,
  TradingSignal,
} from "./types";

const DEFAULT_URI = "mongodb://127.0.0.1:27017/xrp-trading";

let client: MongoClient | undefined;
let connecting: Promise<MongoClient> | undefined;

function uri(): string {
  return process.env.MONGODB_URI?.trim() || DEFAULT_URI;
}

export function isDuplicateKey(error: unknown): boolean {
  return error instanceof MongoServerError && error.code === 11000;
}

async function mongo(): Promise<MongoClient> {
  if (client) return client;
  if (!connecting) {
    connecting = (async () => {
      const next = new MongoClient(uri());
      await next.connect();
      client = next;
      await ensureIndexes(next);
      return next;
    })().finally(() => {
      connecting = undefined;
    });
  }
  return connecting;
}

function database(connection: MongoClient) {
  const named = new URL(uri()).pathname.replace(/^\//, "");
  return connection.db(named || "xrp-trading");
}

async function collection<T extends Document>(name: string): Promise<Collection<T>> {
  const connection = await mongo();
  return database(connection).collection<T>(name);
}

function lean<T>(doc: (T & { _id?: unknown }) | null): T | null {
  if (!doc) return null;
  const { _id: _ignored, ...rest } = doc;
  return rest as T;
}

async function ensureIndexes(connection: MongoClient): Promise<void> {
  const db = database(connection);
  await Promise.all([
    db.collection("trading_accounts").createIndex({ userId: 1 }, { unique: true }),
    db.collection("trading_strategies").createIndex({ userId: 1, name: 1 }, { unique: true }),
    db.collection("trading_strategies").createIndex({ userId: 1, createdAt: 1 }),
    db.collection("paper_orders").createIndex({ userId: 1, clientOrderId: 1 }, { unique: true }),
    db.collection("paper_orders").createIndex({ userId: 1, createdAt: -1 }),
    db.collection("paper_positions").createIndex({ userId: 1, symbol: 1 }, { unique: true }),
    db.collection("paper_positions").createIndex({ userId: 1, openedAt: -1 }),
    db.collection("paper_trades").createIndex({ userId: 1, closedAt: -1 }),
    db.collection("trading_signals").createIndex({ userId: 1, signalKey: 1 }, { unique: true }),
    db.collection("trading_signals").createIndex({ userId: 1, createdAt: -1 }),
    db.collection("market_candles").createIndex(
      { exchange: 1, symbol: 1, interval: 1, time: 1 },
      { unique: true },
    ),
    db.collection("backtests").createIndex({ userId: 1, createdAt: -1 }),
    db.collection("openai_keys").createIndex({ userId: 1 }, { unique: true }),
    db.collection("telegram_links").createIndex({ userId: 1 }, { unique: true }),
    db.collection("telegram_alarms").createIndex({ userId: 1, key: 1 }, { unique: true }),
    db.collection("demo_sessions").createIndex({ userId: 1 }, { unique: true }),
    db.collection("stamp_rounds").createIndex(
      { userId: 1 },
      { unique: true, partialFilterExpression: { status: "running" } },
    ),
    db.collection("stamp_rounds").createIndex({ userId: 1, createdAt: -1 }),
    db.collection("coin_rounds").createIndex(
      { userId: 1 },
      { unique: true, partialFilterExpression: { status: "running" } },
    ),
    db.collection("coin_rounds").createIndex({ userId: 1, createdAt: -1 }),
    db.collection("tank_rooms").createIndex(
      { hostId: 1 },
      { unique: true, partialFilterExpression: { status: { $in: ["lobby", "battle"] } } },
    ),
    db.collection("tank_rooms").createIndex({ hostId: 1, createdAt: -1 }),
    db.collection("tank_rooms").createIndex({ "players.key": 1, status: 1 }),
    db.collection("tank_rooms").createIndex({ "players.userId": 1, createdAt: -1 }),
    db.collection("tank_rooms").createIndex({ status: 1, createdAt: -1 }),
  ]);
}

export async function pingDatabase(): Promise<void> {
  const connection = await mongo();
  await connection.db("admin").command({ ping: 1 });
}

export async function closeDatabase(): Promise<void> {
  if (!client) return;
  await client.close();
  client = undefined;
}

const ACCOUNT_DEFAULTS: Omit<TradingAccount, "userId" | "dayStartedAt" | "updatedAt"> = {
  initialBalance: 10000,
  availableBalance: 10000,
  dayStartBalance: 10000,
  highWaterMark: 10000,
  riskPerTradePct: 1,
  maxDailyLossPct: 3,
  maxPositionPct: 10,
  maxExposurePct: 10,
  maxDrawdownPct: 10,
  maxOpenPositions: 1,
  maxTradesPerDay: 20,
  feeBps: 10,
  slippageBps: 5,
  state: "stopped",
  emergencyStop: false,
  activeStrategyId: null,
  virtualXrp: 200,
  virtualDeployed: 0,
  lastMarketUpdate: null,
};

export const accounts = {
  async findByUser(userId: string): Promise<TradingAccount | null> {
    const col = await collection<TradingAccount>("trading_accounts");
    return lean(await col.findOne({ userId }));
  },
  async insert(userId: string): Promise<TradingAccount | null> {
    const now = new Date();
    const account: TradingAccount = {
      userId,
      ...ACCOUNT_DEFAULTS,
      dayStartedAt: now,
      updatedAt: now,
    };
    const col = await collection<TradingAccount>("trading_accounts");
    try {
      await col.insertOne(account);
      return account;
    } catch (error) {
      if (isDuplicateKey(error)) return null;
      throw error;
    }
  },
  async update(userId: string, patch: Partial<TradingAccount>): Promise<void> {
    const col = await collection<TradingAccount>("trading_accounts");
    await col.updateOne({ userId }, { $set: patch });
  },
  async clearActiveStrategy(userId: string, strategyId: string): Promise<void> {
    const col = await collection<TradingAccount>("trading_accounts");
    await col.updateOne(
      { userId, activeStrategyId: strategyId },
      { $set: { activeStrategyId: null, state: "stopped", updatedAt: new Date() } },
    );
  },
  async listRunning(limit = 100): Promise<Array<{ userId: string }>> {
    const col = await collection<TradingAccount>("trading_accounts");
    return col
      .find({ state: "running", emergencyStop: false }, { projection: { userId: 1, _id: 0 } })
      .limit(limit)
      .toArray();
  },
};

export const strategies = {
  async listByUser(userId: string): Promise<StrategyRecord[]> {
    const col = await collection<StrategyRecord>("trading_strategies");
    const rows = await col.find({ userId }).sort({ createdAt: 1 }).toArray();
    return rows.map((row) => lean(row)!);
  },
  async findOne(id: string, userId: string): Promise<StrategyRecord | null> {
    const col = await collection<StrategyRecord>("trading_strategies");
    return lean(await col.findOne({ id, userId }));
  },
  async findByName(userId: string, name: string): Promise<StrategyRecord | null> {
    const col = await collection<StrategyRecord>("trading_strategies");
    return lean(await col.findOne({ userId, name }));
  },
  async insert(input: Omit<StrategyRecord, "id" | "createdAt" | "updatedAt" | "active"> & { id?: string; active?: boolean }): Promise<StrategyRecord | null> {
    const now = new Date();
    const strategy: StrategyRecord = {
      id: input.id ?? randomUUID(),
      userId: input.userId,
      name: input.name,
      symbol: input.symbol,
      interval: input.interval,
      type: input.type,
      params: input.params,
      stopLossPct: input.stopLossPct,
      takeProfitPct: input.takeProfitPct,
      trailingStopPct: input.trailingStopPct ?? null,
      maxPositionPct: input.maxPositionPct,
      maxDailyLossPct: input.maxDailyLossPct,
      maxTradesPerDay: input.maxTradesPerDay,
      cooldownSeconds: input.cooldownSeconds,
      minConfidence: input.minConfidence,
      active: input.active ?? false,
      createdAt: now,
      updatedAt: now,
    };
    const col = await collection<StrategyRecord>("trading_strategies");
    try {
      await col.insertOne(strategy);
      return strategy;
    } catch (error) {
      if (isDuplicateKey(error)) return null;
      throw error;
    }
  },
  async deactivateAll(userId: string): Promise<void> {
    const col = await collection<StrategyRecord>("trading_strategies");
    await col.updateMany({ userId }, { $set: { active: false, updatedAt: new Date() } });
  },
  async update(id: string, userId: string, patch: Partial<StrategyRecord>): Promise<StrategyRecord | null> {
    const col = await collection<StrategyRecord>("trading_strategies");
    const next = await col.findOneAndUpdate(
      { id, userId },
      { $set: { ...patch, updatedAt: patch.updatedAt ?? new Date() } },
      { returnDocument: "after" },
    );
    return lean(next);
  },
};

export const orders = {
  async list(userId: string, limit: number): Promise<PaperOrder[]> {
    const col = await collection<PaperOrder>("paper_orders");
    const rows = await col.find({ userId }).sort({ createdAt: -1 }).limit(limit).toArray();
    return rows.map((row) => lean(row)!);
  },
  async countBuysSince(userId: string, since: Date, strategyId?: string): Promise<number> {
    const col = await collection<PaperOrder>("paper_orders");
    return col.countDocuments({
      userId,
      side: "buy",
      createdAt: { $gte: since },
      ...(strategyId ? { strategyId } : {}),
    });
  },
  async latestForStrategy(userId: string, strategyId: string): Promise<PaperOrder | null> {
    const col = await collection<PaperOrder>("paper_orders");
    return lean(await col.find({ userId, strategyId }).sort({ createdAt: -1 }).limit(1).next());
  },
  async insert(order: Omit<PaperOrder, "id" | "createdAt">): Promise<PaperOrder> {
    const doc: PaperOrder = { ...order, id: randomUUID(), createdAt: new Date() };
    const col = await collection<PaperOrder>("paper_orders");
    await col.insertOne(doc);
    return doc;
  },
  async insertIgnore(order: Omit<PaperOrder, "id" | "createdAt">): Promise<PaperOrder | null> {
    try {
      return await orders.insert(order);
    } catch (error) {
      if (isDuplicateKey(error)) return null;
      throw error;
    }
  },
};

export const positions = {
  async list(userId: string): Promise<PaperPosition[]> {
    const col = await collection<PaperPosition>("paper_positions");
    const rows = await col.find({ userId }).sort({ openedAt: -1 }).toArray();
    return rows.map((row) => lean(row)!);
  },
  async findOne(userId: string, id: string): Promise<PaperPosition | null> {
    const col = await collection<PaperPosition>("paper_positions");
    return lean(await col.findOne({ userId, id }));
  },
  async insert(position: Omit<PaperPosition, "id" | "openedAt">): Promise<PaperPosition> {
    const doc: PaperPosition = { ...position, id: randomUUID(), openedAt: new Date() };
    const col = await collection<PaperPosition>("paper_positions");
    await col.insertOne(doc);
    return doc;
  },
  async update(id: string, patch: Partial<PaperPosition>): Promise<void> {
    const col = await collection<PaperPosition>("paper_positions");
    await col.updateOne({ id }, { $set: patch });
  },
  async remove(userId: string, id: string): Promise<void> {
    const col = await collection<PaperPosition>("paper_positions");
    await col.deleteOne({ userId, id });
  },
};

export const trades = {
  async list(userId: string, limit: number): Promise<PaperTrade[]> {
    const col = await collection<PaperTrade>("paper_trades");
    const rows = await col.find({ userId }).sort({ closedAt: -1 }).limit(limit).toArray();
    return rows.map((row) => lean(row)!);
  },
  async since(userId: string, since: Date): Promise<PaperTrade[]> {
    const col = await collection<PaperTrade>("paper_trades");
    const rows = await col.find({ userId, closedAt: { $gte: since } }).toArray();
    return rows.map((row) => lean(row)!);
  },
  async summarize(userId: string, today: Date) {
    const col = await collection<PaperTrade>("paper_trades");
    const rows = await col.find({ userId }, { projection: { netPnl: 1, fees: 1, closedAt: 1, _id: 0 } }).toArray();
    return rows.reduce(
      (totals, trade) => {
        totals.totalTrades += 1;
        if (trade.netPnl > 0) totals.winningTrades += 1;
        totals.realizedPnl += trade.netPnl;
        totals.feesPaid += trade.fees;
        if (trade.closedAt >= today) totals.realizedToday += trade.netPnl;
        return totals;
      },
      { totalTrades: 0, winningTrades: 0, realizedPnl: 0, realizedToday: 0, feesPaid: 0 },
    );
  },
  async insert(trade: Omit<PaperTrade, "id">): Promise<PaperTrade> {
    const doc: PaperTrade = { ...trade, id: randomUUID() };
    const col = await collection<PaperTrade>("paper_trades");
    await col.insertOne(doc);
    return doc;
  },
};

export const signals = {
  async list(userId: string, limit: number): Promise<TradingSignal[]> {
    const col = await collection<TradingSignal>("trading_signals");
    const rows = await col.find({ userId }).sort({ createdAt: -1 }).limit(limit).toArray();
    return rows.map((row) => lean(row)!);
  },
  async insertIgnore(signal: Omit<TradingSignal, "id" | "createdAt"> & { createdAt?: Date }): Promise<TradingSignal | null> {
    const doc: TradingSignal = {
      ...signal,
      id: randomUUID(),
      rejectionReason: signal.rejectionReason ?? null,
      createdAt: signal.createdAt ?? new Date(),
    };
    const col = await collection<TradingSignal>("trading_signals");
    try {
      await col.insertOne(doc);
      return doc;
    } catch (error) {
      if (isDuplicateKey(error)) return null;
      throw error;
    }
  },
  async update(id: string, patch: Partial<TradingSignal>): Promise<void> {
    const col = await collection<TradingSignal>("trading_signals");
    await col.updateOne({ id }, { $set: patch });
  },
};

export const candles = {
  async upsertMany(rows: MarketCandleRecord[]): Promise<void> {
    if (!rows.length) return;
    const col = await collection<MarketCandleRecord>("market_candles");
    await col.bulkWrite(
      rows.map((candle) => ({
        updateOne: {
          filter: {
            exchange: candle.exchange,
            symbol: candle.symbol,
            interval: candle.interval,
            time: candle.time,
          },
          update: { $set: candle },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  },
};

export type OpenAiKey = {
  userId: string;
  apiKey: string;
  updatedAt: Date;
};

export const openAiKeys = {
  async find(userId: string): Promise<OpenAiKey | null> {
    const col = await collection<OpenAiKey>("openai_keys");
    return lean(await col.findOne({ userId }));
  },
  async save(record: OpenAiKey): Promise<void> {
    const col = await collection<OpenAiKey>("openai_keys");
    await col.updateOne({ userId: record.userId }, { $set: record }, { upsert: true });
  },
  async remove(userId: string): Promise<void> {
    const col = await collection<OpenAiKey>("openai_keys");
    await col.deleteOne({ userId });
  },
};

export type TelegramLink = {
  userId: string;
  botToken: string;
  chatId: string;
  botUsername: string;
  enabled: boolean;
  updatedAt: Date;
  updateOffset?: number;
};

export const telegramLinks = {
  async find(userId: string): Promise<TelegramLink | null> {
    const col = await collection<TelegramLink>("telegram_links");
    return lean(await col.findOne({ userId }));
  },
  async save(link: TelegramLink): Promise<void> {
    const col = await collection<TelegramLink>("telegram_links");
    await col.updateOne({ userId: link.userId }, { $set: link }, { upsert: true });
  },
  async remove(userId: string): Promise<void> {
    const col = await collection<TelegramLink>("telegram_links");
    await col.deleteOne({ userId });
  },
  async listEnabled(): Promise<TelegramLink[]> {
    const col = await collection<TelegramLink>("telegram_links");
    const rows = await col.find({ enabled: true }).toArray();
    return rows.map(row => lean(row)!);
  },
  async listConnected(): Promise<TelegramLink[]> {
    const col = await collection<TelegramLink>("telegram_links");
    const rows = await col.find({}).toArray();
    return rows.map(row => lean(row)!);
  },
  async setOffset(userId: string, updateOffset: number): Promise<void> {
    const col = await collection<TelegramLink>("telegram_links");
    await col.updateOne({ userId }, { $set: { updateOffset } });
  },
};

export type DemoSessionRecord = {
  userId: string;
  active: boolean;
  symbol: string;
  startedAt: Date;
  seekMs: number;
  updatedAt: Date;
};

export const demoSessions = {
  async find(userId: string): Promise<DemoSessionRecord | null> {
    const col = await collection<DemoSessionRecord>("demo_sessions");
    return lean(await col.findOne({ userId }));
  },
  async findActive(): Promise<DemoSessionRecord | null> {
    const col = await collection<DemoSessionRecord>("demo_sessions");
    return lean(await col.findOne({ active: true }));
  },
  async save(session: DemoSessionRecord): Promise<void> {
    const col = await collection<DemoSessionRecord>("demo_sessions");
    await col.updateOne({ userId: session.userId }, { $set: session }, { upsert: true });
  },
};

export type StampRound = {
  id: string;
  userId: string;
  snack: number;
  crashMultiple: number;
  jamAt: number;
  startedAt: number;
  status: "running" | "torn" | "jammed";
  multiple: number;
  payout: number;
  createdAt: Date;
};

export const stampRounds = {
  async active(userId: string): Promise<StampRound | null> {
    const col = await collection<StampRound>("stamp_rounds");
    return lean(await col.findOne({ userId, status: "running" }));
  },
  async insert(round: StampRound): Promise<StampRound> {
    const col = await collection<StampRound>("stamp_rounds");
    await col.insertOne(round);
    return round;
  },
  async settle(userId: string, id: string, patch: Pick<StampRound, "status" | "multiple" | "payout">): Promise<boolean> {
    const col = await collection<StampRound>("stamp_rounds");
    const updated = await col.findOneAndUpdate(
      { id, userId, status: "running" },
      { $set: patch },
      { returnDocument: "after" },
    );
    return updated != null;
  },
  async recent(userId: string, limit: number): Promise<StampRound[]> {
    const col = await collection<StampRound>("stamp_rounds");
    const rows = await col.find({ userId, status: { $ne: "running" } }).sort({ createdAt: -1 }).limit(limit).toArray();
    return rows.map(row => lean(row)!);
  },
};

export type CoinBeat = { at: number; kind: "coin" | "high" | "pit" };

export type CoinRound = {
  id: string;
  userId: string;
  snack: number;
  beats: CoinBeat[];
  startedAt: number;
  status: "running" | "cleared" | "fell";
  coins: number;
  multiple: number;
  payout: number;
  createdAt: Date;
};

export const coinRounds = {
  async active(userId: string): Promise<CoinRound | null> {
    const col = await collection<CoinRound>("coin_rounds");
    return lean(await col.findOne({ userId, status: "running" }));
  },
  async find(userId: string, id: string): Promise<CoinRound | null> {
    const col = await collection<CoinRound>("coin_rounds");
    return lean(await col.findOne({ userId, id }));
  },
  async insert(round: CoinRound): Promise<CoinRound> {
    const col = await collection<CoinRound>("coin_rounds");
    await col.insertOne(round);
    return round;
  },
  async settle(userId: string, id: string, patch: Pick<CoinRound, "status" | "coins" | "multiple" | "payout">): Promise<boolean> {
    const col = await collection<CoinRound>("coin_rounds");
    const updated = await col.findOneAndUpdate(
      { id, userId, status: "running" },
      { $set: patch },
      { returnDocument: "after" },
    );
    return updated != null;
  },
  async recent(userId: string, limit: number): Promise<CoinRound[]> {
    const col = await collection<CoinRound>("coin_rounds");
    const rows = await col.find({ userId, status: { $ne: "running" } }).sort({ createdAt: -1 }).limit(limit).toArray();
    return rows.map(row => lean(row)!);
  },
};

export type TankTeam = "red" | "blue";
export type TankMode = "solo" | "team" | "tdm";

export type TankPlayer = {
  key: string;
  pid: string;
  userId: string;
  callsign: string;
  team: TankTeam | null;
  slot: number;
  alive: boolean;
  kills: number;
  deaths: number;
  taken: number;
  joinedAt: Date;
};

export type TankRoom = {
  id: string;
  hostId: string;
  mode: TankMode;
  entry: number;
  seats: number;
  seed: number;
  status: "lobby" | "battle" | "done" | "cancelled";
  players: TankPlayer[];
  winner: string | null;
  pot: number;
  score?: Record<TankTeam, number>;
  createdAt: Date;
  startedAt?: Date;
  endedAt?: Date;
};

export const tankRooms = {
  async get(id: string): Promise<TankRoom | null> {
    const col = await collection<TankRoom>("tank_rooms");
    return lean(await col.findOne({ id, players: { $exists: true } }));
  },
  async containing(key: string): Promise<TankRoom | null> {
    const col = await collection<TankRoom>("tank_rooms");
    return lean(await col.findOne({ "players.key": key, status: { $in: ["lobby", "battle"] } }));
  },
  async seatedUser(userId: string): Promise<TankRoom | null> {
    const col = await collection<TankRoom>("tank_rooms");
    return lean(await col.findOne({ "players.userId": userId, status: { $in: ["lobby", "battle"] } }, { sort: { createdAt: -1 } }));
  },
  async open(limit: number): Promise<TankRoom[]> {
    const col = await collection<TankRoom>("tank_rooms");
    const rows = await col.find({ status: "lobby", players: { $exists: true } }).sort({ createdAt: -1 }).limit(limit).toArray();
    return rows.map(row => lean(row)!);
  },
  async unfinished(): Promise<TankRoom[]> {
    const col = await collection<TankRoom>("tank_rooms");
    const rows = await col.find({ status: { $in: ["lobby", "battle"] } }).toArray();
    return rows.map(row => lean(row)!);
  },
  async insert(room: TankRoom): Promise<TankRoom> {
    const col = await collection<TankRoom>("tank_rooms");
    await col.insertOne(room);
    return room;
  },
  async save(room: TankRoom): Promise<void> {
    const col = await collection<TankRoom>("tank_rooms");
    await col.updateOne({ id: room.id }, { $set: room });
  },
  async close(id: string, status: "done" | "cancelled"): Promise<void> {
    const col = await collection<TankRoom>("tank_rooms");
    await col.updateOne({ id }, { $set: { status, endedAt: new Date() } });
  },
  async recent(userId: string, limit: number): Promise<TankRoom[]> {
    const col = await collection<TankRoom>("tank_rooms");
    const rows = await col
      .find({ "players.userId": userId, status: { $in: ["done", "cancelled"] } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    return rows.map(row => lean(row)!);
  },
};

export const telegramAlarms = {
  async claim(userId: string, key: string): Promise<boolean> {
    const col = await collection<{ userId: string; key: string; createdAt: Date }>("telegram_alarms");
    try {
      await col.insertOne({ userId, key, createdAt: new Date() });
      return true;
    } catch (error) {
      if (isDuplicateKey(error)) return false;
      throw error;
    }
  },
  async release(userId: string, key: string): Promise<void> {
    const col = await collection<{ userId: string; key: string }>("telegram_alarms");
    await col.deleteOne({ userId, key });
  },
};

export const backtests = {
  async list(userId: string, limit = 50): Promise<BacktestRecord[]> {
    const col = await collection<BacktestRecord>("backtests");
    const rows = await col.find({ userId }).sort({ createdAt: -1 }).limit(limit).toArray();
    return rows.map((row) => lean(row)!);
  },
  async findOne(id: string, userId: string): Promise<BacktestRecord | null> {
    const col = await collection<BacktestRecord>("backtests");
    return lean(await col.findOne({ id, userId }));
  },
  async insert(input: Omit<BacktestRecord, "id" | "createdAt">): Promise<BacktestRecord> {
    const doc: BacktestRecord = { ...input, id: randomUUID(), createdAt: new Date() };
    const col = await collection<BacktestRecord>("backtests");
    await col.insertOne(doc);
    return doc;
  },
};
