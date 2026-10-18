import { Router, type IRouter } from "express";
import {
  CreateStrategyBody,
  CreateStrategyResponse,
  GetStrategiesResponse,
  UpdateStrategyBody,
  UpdateStrategyParams,
  UpdateStrategyResponse,
} from "@workspace/api-zod";
import { accounts, strategies, type StrategyRecord } from "@workspace/db";
import {
  authenticatedUserId,
  requireAuth,
} from "../middlewares/require-auth";
import { ensureUserAccount } from "../lib/trading-store";

const router: IRouter = Router();
router.use(requireAuth);

function serializeStrategy(strategy: StrategyRecord) {
  return {
    ...strategy,
    createdAt: strategy.createdAt.toISOString(),
    updatedAt: strategy.updatedAt.toISOString(),
  };
}

type IndicatorParams = StrategyRecord["params"];

function invalidIndicatorParams(params: IndicatorParams): string | null {
  if (params.fastEma >= params.slowEma) return "Fast EMA must be shorter than slow EMA.";
  if (params.rsiOversold >= params.rsiOverbought) return "RSI oversold must be below RSI overbought.";
  if (params.macdFast >= params.macdSlow) return "MACD fast must be shorter than MACD slow.";
  return null;
}

router.get("/strategies", async (_req, res): Promise<void> => {
  const userId = authenticatedUserId(res);
  await ensureUserAccount(userId);
  const rows = await strategies.listByUser(userId);
  res.json(GetStrategiesResponse.parse(rows.map(serializeStrategy)));
});

router.post("/strategies", async (req, res): Promise<void> => {
  const userId = authenticatedUserId(res);
  const body = CreateStrategyBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const paramsError = invalidIndicatorParams(body.data.params);
  if (paramsError) {
    res.status(400).json({ error: paramsError });
    return;
  }
  await ensureUserAccount(userId);
  const strategy = await strategies.insert({ ...body.data, userId, trailingStopPct: body.data.trailingStopPct ?? null });
  if (!strategy) {
    res.status(409).json({ error: "A strategy with that name already exists." });
    return;
  }
  res.status(201).json(CreateStrategyResponse.parse(serializeStrategy(strategy)));
});

router.put("/strategies/:id", async (req, res): Promise<void> => {
  const userId = authenticatedUserId(res);
  const params = UpdateStrategyParams.safeParse(req.params);
  const body = UpdateStrategyBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (body.data.params) {
    const paramsError = invalidIndicatorParams(body.data.params);
    if (paramsError) {
      res.status(400).json({ error: paramsError });
      return;
    }
  }

  const account = await accounts.findByUser(userId);
  if (
    account?.state === "running" &&
    account.activeStrategyId === params.data.id &&
    body.data.active !== false
  ) {
    res.status(409).json({ error: "Stop paper trading before editing its active strategy." });
    return;
  }
  const existing = await strategies.findOne(params.data.id, userId);
  if (!existing) {
    res.status(404).json({ error: "Strategy not found." });
    return;
  }
  if (body.data.active === true) {
    await strategies.deactivateAll(userId);
  }
  const updated = await strategies.update(params.data.id, userId, {
    ...body.data,
    updatedAt: new Date(),
  });
  if (!updated) {
    res.status(404).json({ error: "Strategy not found." });
    return;
  }
  if (body.data.active === true) {
    await accounts.update(userId, {
      activeStrategyId: updated.id,
      state: "stopped",
      updatedAt: new Date(),
    });
  } else if (body.data.active === false) {
    await accounts.clearActiveStrategy(userId, updated.id);
  }
  res.json(UpdateStrategyResponse.parse(serializeStrategy(updated)));
});

export default router;
