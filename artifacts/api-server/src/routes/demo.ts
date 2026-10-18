import { Router, type IRouter } from "express";
import { authenticatedUserId, requireAuth } from "../middlewares/require-auth";
import { getExchangeAdapter } from "../lib/market-data";
import { demoClock, startDemo, stopDemo } from "../lib/demo-market";
import { ensureUserAccount } from "../lib/trading-store";

const router: IRouter = Router();
router.use(requireAuth);

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e8) / 1e8;
}

function tradeCost(price: number, spend: number, feeBps: number, slippageBps: number) {
  const feeRate = Math.max(0, feeBps) / 10_000;
  const notional = spend > 0 ? spend / (1 + feeRate) : 0;
  const quantity = price > 0 ? Math.floor((notional / price) * 1e6) / 1e6 : 0;
  const fillPrice = roundMoney(price * (1 + Math.max(0, slippageBps) / 10_000));
  const fee = roundMoney(quantity * fillPrice * feeRate);
  const slippage = roundMoney(quantity * (fillPrice - price));
  return {
    spend: roundMoney(spend),
    quantity,
    fillPrice,
    fee,
    slippage,
    total: roundMoney(fee + slippage),
  };
}

async function view(userId: string, symbol = "XRP/USDT") {
  const clock = demoClock(userId);
  const [{ account }, ticker] = await Promise.all([
    ensureUserAccount(userId),
    getExchangeAdapter().ticker(symbol),
  ]);
  const cash = account.availableBalance;
  return {
    ...clock,
    symbol: ticker.symbol,
    price: ticker.price,
    change24h: ticker.change24h,
    changePct24h: ticker.changePct24h,
    updatedAt: ticker.updatedAt,
    exchange: ticker.exchange,
    feeBps: account.feeBps,
    slippageBps: account.slippageBps,
    costs: [25, 50, 100].map(spendPct => ({
      spendPct,
      ...tradeCost(ticker.price, cash * spendPct / 100, account.feeBps, account.slippageBps),
    })),
  };
}

router.get("/demo", async (_req, res): Promise<void> => {
  res.json(await view(authenticatedUserId(res)));
});

router.post("/demo/start", async (req, res): Promise<void> => {
  const symbol = typeof req.body?.symbol === "string" && /^[A-Z0-9]{2,14}\/[A-Z0-9]{2,10}$/.test(req.body.symbol.trim().toUpperCase())
    ? req.body.symbol.trim().toUpperCase()
    : "XRP/USDT";
  await startDemo(authenticatedUserId(res), symbol);
  res.json(await view(authenticatedUserId(res), symbol));
});

router.post("/demo/stop", async (_req, res): Promise<void> => {
  const userId = authenticatedUserId(res);
  await stopDemo(userId);
  res.json(await view(userId));
});

export default router;
