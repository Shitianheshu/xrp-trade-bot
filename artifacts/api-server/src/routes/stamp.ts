import { randomBytes, randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { accounts, isDuplicateKey, stampRounds, type StampRound } from "@workspace/db";
import { authenticatedUserId, requireAuth } from "../middlewares/require-auth";
import { readVirtualStake } from "../lib/paper-engine";

const router: IRouter = Router();
router.use(requireAuth);

const GROWTH = 0.22;
const SNACKS = [1, 5, 10];
const INK = 0.03;

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e8) / 1e8;
}

export function stampMultiple(elapsedMs: number): number {
  const seconds = Math.max(0, elapsedMs) / 1000;
  const raw = Math.exp(GROWTH * seconds);
  return Math.round(Math.min(25, raw) * 100) / 100;
}

function jamDelayMs(crashMultiple: number): number {
  if (crashMultiple <= 1) return 0;
  return Math.round(Math.log(crashMultiple) / GROWTH * 1000);
}

function rollCrash(): number {
  const unit = randomBytes(4).readUInt32BE(0) / 0x100000000;
  if (unit < INK) return 1;
  const raw = (1 - INK) / (1 - unit);
  const multiple = Math.floor(raw * 100) / 100;
  return Math.min(25, Math.max(1.01, multiple));
}

function stampLine(multiple: number, status: StampRound["status"]): string {
  if (status === "jammed") return "The stamp landed. The printer ate the snack.";
  if (status === "torn") return "You tore the receipt. The stamp missed, and it is offended.";
  if (multiple < 1.2) return "The shrimp ties its shoes.";
  if (multiple < 1.8) return "It found a paperclip and is feeling brave.";
  if (multiple < 2.6) return "It is writing a poem about fees.";
  if (multiple < 4) return "The stamp is breathing on the ink pad.";
  if (multiple < 7) return "Someone in accounting just stood up.";
  if (multiple < 12) return "The shrimp is doing a tiny victory dance.";
  return "This receipt is long enough to wear as a scarf.";
}

async function credit(userId: string, payout: number): Promise<number> {
  const stake = await readVirtualStake(userId);
  const next = roundMoney(stake.virtualXrp + payout);
  await accounts.update(userId, { virtualXrp: next, updatedAt: new Date() });
  return next;
}

async function resolve(userId: string, round: StampRound, torn: boolean): Promise<{ round: StampRound; virtualXrp: number }> {
  const now = Date.now();
  const jammed = now >= round.jamAt;
  const multiple = jammed ? round.crashMultiple : stampMultiple(now - round.startedAt);
  const status: StampRound["status"] = jammed || !torn ? "jammed" : "torn";
  const payout = status === "torn" ? roundMoney(round.snack * multiple) : 0;
  const won = await stampRounds.settle(userId, round.id, { status, multiple, payout });
  const stake = await readVirtualStake(userId);
  if (!won) return { round: { ...round, status, multiple, payout }, virtualXrp: stake.virtualXrp };
  const virtualXrp = payout > 0 ? await credit(userId, payout) : stake.virtualXrp;
  return { round: { ...round, status, multiple, payout }, virtualXrp };
}

function present(round: StampRound | null, virtualXrp: number, now: number) {
  const live = round && round.status === "running" ? stampMultiple(now - round.startedAt) : round?.multiple ?? 1;
  return {
    now,
    virtualXrp,
    round: round ? {
      id: round.id,
      status: round.status,
      snack: round.snack,
      multiple: round.status === "running" ? live : round.multiple,
      payout: round.payout,
      line: stampLine(round.status === "running" ? live : round.multiple, round.status),
      startedAt: round.startedAt,
    } : null,
  };
}

router.get("/game/stamp", async (_req, res): Promise<void> => {
  const userId = authenticatedUserId(res);
  const now = Date.now();
  let round = await stampRounds.active(userId);
  let stake = await readVirtualStake(userId);
  if (round && now >= round.jamAt) {
    const settled = await resolve(userId, round, false);
    round = settled.round;
    stake = { ...stake, virtualXrp: settled.virtualXrp };
  }
  const history = await stampRounds.recent(userId, 8);
  res.json({
    ...present(round, stake.virtualXrp, now),
    history: history.map(item => ({
      id: item.id,
      status: item.status,
      snack: item.snack,
      multiple: item.multiple,
      payout: item.payout,
      createdAt: item.createdAt.toISOString(),
    })),
  });
});

router.post("/game/stamp/start", async (req, res): Promise<void> => {
  const userId = authenticatedUserId(res);
  const snack = Number(req.body?.snack);
  if (!SNACKS.includes(snack)) {
    res.status(400).json({ error: "Choose a snack of 1, 5, or 10 XRP." });
    return;
  }
  const existing = await stampRounds.active(userId);
  const stake = await readVirtualStake(userId);
  if (existing) {
    res.json(present(existing, stake.virtualXrp, Date.now()));
    return;
  }
  if (stake.virtualXrp < snack) {
    res.status(409).json({ error: "The virtual stake is smaller than that snack." });
    return;
  }
  const startedAt = Date.now();
  const crashMultiple = rollCrash();
  const round: StampRound = {
    id: randomUUID(),
    userId,
    snack,
    crashMultiple,
    jamAt: startedAt + jamDelayMs(crashMultiple),
    startedAt,
    status: "running",
    multiple: 1,
    payout: 0,
    createdAt: new Date(startedAt),
  };
  const next = roundMoney(stake.virtualXrp - snack);
  await accounts.update(userId, { virtualXrp: next, updatedAt: new Date() });
  try {
    await stampRounds.insert(round);
  } catch (error) {
    await accounts.update(userId, { virtualXrp: stake.virtualXrp, updatedAt: new Date() });
    if (isDuplicateKey(error)) {
      const active = await stampRounds.active(userId);
      res.json(present(active, stake.virtualXrp, Date.now()));
      return;
    }
    throw error;
  }
  if (round.jamAt <= Date.now()) {
    const settled = await resolve(userId, round, false);
    res.json(present(settled.round, settled.virtualXrp, Date.now()));
    return;
  }
  res.json(present(round, next, startedAt));
});

router.post("/game/stamp/tear", async (req, res): Promise<void> => {
  const userId = authenticatedUserId(res);
  const id = String(req.body?.id ?? "");
  const round = await stampRounds.active(userId);
  if (!round || round.id !== id) {
    res.status(409).json({ error: "That receipt is already finished." });
    return;
  }
  const multiple = stampMultiple(Date.now() - round.startedAt);
  if (Date.now() < round.jamAt && multiple < 1.08) {
    res.status(409).json({ error: "Let the shrimp take one step." });
    return;
  }
  const settled = await resolve(userId, round, true);
  const history = await stampRounds.recent(userId, 8);
  res.json({
    ...present(settled.round, settled.virtualXrp, Date.now()),
    history: history.map(item => ({
      id: item.id,
      status: item.status,
      snack: item.snack,
      multiple: item.multiple,
      payout: item.payout,
      createdAt: item.createdAt.toISOString(),
    })),
  });
});

export default router;
