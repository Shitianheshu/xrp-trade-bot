import { and, asc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateStrategyBody,
  CreateStrategyResponse,
  GetStrategiesResponse,
  UpdateStrategyBody,
  UpdateStrategyParams,
  UpdateStrategyResponse,
} from "@workspace/api-zod";
import { db, strategiesTable, tradingAccountsTable } from "@workspace/db";
import {
  authenticatedUserId,
  requireAuth,
} from "../middlewares/require-auth";
import { ensureUserAccount } from "../lib/trading-store";

const router: IRouter = Router();
router.use(requireAuth);

function serializeStrategy(strategy: typeof strategiesTable.$inferSelect) {
  return {
    ...strategy,
    createdAt: strategy.createdAt.toISOString(),
    updatedAt: strategy.updatedAt.toISOString(),
  };
}

router.get("/strategies", async (_req, res): Promise<void> => {
  const userId = authenticatedUserId(res);
  await ensureUserAccount(userId);
  const strategies = await db
    .select()
    .from(strategiesTable)
    .where(eq(strategiesTable.userId, userId))
    .orderBy(asc(strategiesTable.createdAt));
  res.json(GetStrategiesResponse.parse(strategies.map(serializeStrategy)));
});

router.post("/strategies", async (req, res): Promise<void> => {
  const userId = authenticatedUserId(res);
  const body = CreateStrategyBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  await ensureUserAccount(userId);
  const [strategy] = await db
    .insert(strategiesTable)
    .values({ ...body.data, userId })
    .returning();
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
  const strategy = await db.transaction(async (tx) => {
    if (body.data.active === true) {
      await tx
        .update(strategiesTable)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(strategiesTable.userId, userId));
    }
    const [updated] = await tx
      .update(strategiesTable)
      .set({ ...body.data, updatedAt: new Date() })
      .where(
        and(
          eq(strategiesTable.id, params.data.id),
          eq(strategiesTable.userId, userId),
        ),
      )
      .returning();
    if (!updated) return undefined;

    if (body.data.active === true) {
      await tx
        .update(tradingAccountsTable)
        .set({
          activeStrategyId: updated.id,
          state: "stopped",
          updatedAt: new Date(),
        })
        .where(eq(tradingAccountsTable.userId, userId));
    } else if (body.data.active === false) {
      await tx
        .update(tradingAccountsTable)
        .set({
          activeStrategyId: null,
          state: "stopped",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tradingAccountsTable.userId, userId),
            eq(tradingAccountsTable.activeStrategyId, updated.id),
          ),
        );
    }
    return updated;
  });
  if (!strategy) {
    res.status(404).json({ error: "Strategy not found." });
    return;
  }
  res.json(UpdateStrategyResponse.parse(serializeStrategy(strategy)));
});

export default router;