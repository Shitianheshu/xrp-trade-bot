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

export interface StrategyRecord {
  id: string;
  userId: string;
  name: string;
  symbol: string;
  interval: string;
  type: string;
  params: StrategyParameters;
  stopLossPct: number;
  takeProfitPct: number;
  trailingStopPct: number | null;
  maxPositionPct: number;
  maxDailyLossPct: number;
  maxTradesPerDay: number;
  cooldownSeconds: number;
  minConfidence: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TradingAccount {
  userId: string;
  initialBalance: number;
  availableBalance: number;
  dayStartBalance: number;
  highWaterMark: number;
  riskPerTradePct: number;
  maxDailyLossPct: number;
  maxPositionPct: number;
  maxExposurePct: number;
  maxDrawdownPct: number;
  maxOpenPositions: number;
  maxTradesPerDay: number;
  feeBps: number;
  slippageBps: number;
  state: string;
  emergencyStop: boolean;
  activeStrategyId: string | null;
  virtualXrp?: number;
  virtualDeployed?: number;
  lastMarketUpdate: Date | null;
  dayStartedAt: Date;
  updatedAt: Date;
}

export interface PaperOrder {
  id: string;
  userId: string;
  clientOrderId: string;
  strategyId: string;
  strategyName: string;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  fee: number;
  status: string;
  createdAt: Date;
}

export interface PaperPosition {
  id: string;
  userId: string;
  strategyId: string;
  strategyName: string;
  symbol: string;
  quantity: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  highestPrice: number;
  entryFee: number;
  openedAt: Date;
}

export interface PaperTrade {
  id: string;
  userId: string;
  strategyId: string;
  strategyName: string;
  symbol: string;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  grossPnl: number;
  netPnl: number;
  fees: number;
  pnlPct: number;
  exitReason: string;
  openedAt: Date;
  closedAt: Date;
}

export interface TradingSignal {
  id: string;
  userId: string;
  signalKey: string;
  strategyId: string;
  strategyName: string;
  symbol: string;
  side: string;
  confidence: number;
  price: number;
  message: string;
  riskApproved: boolean;
  rejectionReason: string | null;
  createdAt: Date;
}

export interface MarketCandleRecord {
  exchange: string;
  symbol: string;
  interval: string;
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BacktestRecord {
  id: string;
  userId: string;
  symbol: string;
  interval: string;
  strategyName: string;
  request: unknown;
  result: unknown;
  createdAt: Date;
}
