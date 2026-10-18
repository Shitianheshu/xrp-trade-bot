import { randomBytes, randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { accounts, coinRounds, isDuplicateKey, type CoinBeat, type CoinRound } from "@workspace/db";
import { authenticatedUserId, requireAuth } from "../middlewares/require-auth";
import { readVirtualStake } from "../lib/paper-engine";

const router: IRouter = Router();
router.use(requireAuth);

const SNACKS = [1, 5, 10];
const JUMP_MS = 420;
const COIN_VALUE = 0.28;
const CLEAR_BONUS = 0.5;

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e8) / 1e8;
}

function unit(): number {
  return randomBytes(1)[0] / 255;
}

export function buildCourse(): CoinBeat[] {
  const kinds: CoinBeat["kind"][] = [];
  for (let index = 0; index < 12; index += 1) {
    const roll = unit();
    kinds.push(roll < 0.42 ? "coin" : roll < 0.72 ? "high" : "pit");
  }
  if (!kinds.includes("pit")) kinds[3] = "pit";
  if (!kinds.includes("coin")) kinds[1] = "coin";
  if (!kinds.includes("high")) kinds[6] = "high";
  for (let index = 1; index < kinds.length; index += 1) {
    if (kinds[index] === "pit" && kinds[index - 1] === "pit") kinds[index] = "high";
  }
  let at = 1200;
  return kinds.map(kind => {
    const beat = { at, kind };
    at += 780;
    return beat;
  });
}

export function cleanJumps(jumps: unknown, elapsed: number): number[] {
  if (!Array.isArray(jumps)) return [];
  const sorted = jumps
    .map(value => Number(value))
    .filter(value => Number.isFinite(value) && value >= 0 && value <= elapsed + 80)
    .sort((left, right) => left - right);
  const kept: number[] = [];
  for (const jump of sorted) {
    const previous = kept[kept.length - 1];
    if (previous != null && jump < previous + JUMP_MS) continue;
    kept.push(Math.round(jump));
    if (kept.length >= 24) break;
  }
  return kept;
}

export function scoreCourse(beats: CoinBeat[], jumps: number[], elapsed: number): { coins: number; status: "cleared" | "fell"; multiple: number } {
  const airborne = (at: number) => jumps.some(jump => at >= jump && at <= jump + JUMP_MS);
  const end = beats[beats.length - 1]?.at ?? 0;
  let coins = 0;
  for (const beat of beats) {
    if (beat.at > elapsed + 80) break;
    const up = airborne(beat.at);
    if (beat.kind === "pit" && !up) {
      return { coins, status: "fell", multiple: roundMoney(coins * COIN_VALUE) };
    }
    if (beat.kind === "coin" && !up) coins += 1;
    if (beat.kind === "high" && up) coins += 1;
  }
  if (elapsed + 80 < end) {
    return { coins, status: "fell", multiple: roundMoney(coins * COIN_VALUE) };
  }
  return { coins, status: "cleared", multiple: roundMoney(coins * COIN_VALUE + CLEAR_BONUS) };
}

function lineFor(status: CoinRound["status"], coins: number): string {
  if (status === "running") return "Pip is running. Jump the gaps. Catch the high coins. Stay down for the low ones.";
  if (status === "cleared") return `Pip cleared the course with ${coins} coin${coins === 1 ? "" : "s"}.`;
  return coins > 0
    ? `Pip fell after catching ${coins} coin${coins === 1 ? "" : "s"}.`
    : "Pip fell in a gap before catching a coin.";
}

async function credit(userId: string, payout: number): Promise<number> {
  const stake = await readVirtualStake(userId);
  const next = roundMoney(stake.virtualXrp + payout);
  await accounts.update(userId, { virtualXrp: next, updatedAt: new Date() });
  return next;
}

function present(round: CoinRound | null, virtualXrp: number, now: number, history: CoinRound[] = []) {
  return {
    now,
    virtualXrp,
    round: round ? {
      id: round.id,
      status: round.status,
      snack: round.snack,
      beats: round.beats,
      startedAt: round.startedAt,
      coins: round.coins,
      multiple: round.multiple,
      payout: round.payout,
      line: lineFor(round.status, round.coins),
    } : null,
    history: history.map(item => ({
      id: item.id,
      status: item.status,
      snack: item.snack,
      coins: item.coins,
      multiple: item.multiple,
      payout: item.payout,
      createdAt: item.createdAt.toISOString(),
    })),
  };
}

router.get("/game/coin", async (_req, res): Promise<void> => {
  const userId = authenticatedUserId(res);
  const now = Date.now();
  let round = await coinRounds.active(userId);
  let stake = await readVirtualStake(userId);
  if (round) {
    const end = round.beats[round.beats.length - 1]?.at ?? 0;
    if (now - round.startedAt > end + 2500) {
      const won = await coinRounds.settle(userId, round.id, { status: "fell", coins: 0, multiple: 0, payout: 0 });
      if (won) round = { ...round, status: "fell", coins: 0, multiple: 0, payout: 0 };
    }
  }
  const history = await coinRounds.recent(userId, 8);
  res.json(present(round && round.status === "running" ? round : null, stake.virtualXrp, now, history));
});

router.post("/game/coin/start", async (req, res): Promise<void> => {
  const userId = authenticatedUserId(res);
  const snack = Number(req.body?.snack);
  if (!SNACKS.includes(snack)) {
    res.status(400).json({ error: "Choose a snack of 1, 5, or 10 XRP." });
    return;
  }
  const existing = await coinRounds.active(userId);
  const stake = await readVirtualStake(userId);
  if (existing) {
    const history = await coinRounds.recent(userId, 8);
    res.json(present(existing, stake.virtualXrp, Date.now(), history));
    return;
  }
  if (stake.virtualXrp < snack) {
    res.status(409).json({ error: "The virtual stake is smaller than that snack." });
    return;
  }
  const startedAt = Date.now();
  const round: CoinRound = {
    id: randomUUID(),
    userId,
    snack,
    beats: buildCourse(),
    startedAt,
    status: "running",
    coins: 0,
    multiple: 0,
    payout: 0,
    createdAt: new Date(startedAt),
  };
  const next = roundMoney(stake.virtualXrp - snack);
  await accounts.update(userId, { virtualXrp: next, updatedAt: new Date() });
  try {
    await coinRounds.insert(round);
  } catch (error) {
    await accounts.update(userId, { virtualXrp: stake.virtualXrp, updatedAt: new Date() });
    if (isDuplicateKey(error)) {
      const active = await coinRounds.active(userId);
      const history = await coinRounds.recent(userId, 8);
      res.json(present(active, stake.virtualXrp, Date.now(), history));
      return;
    }
    throw error;
  }
  const history = await coinRounds.recent(userId, 8);
  res.json(present(round, next, startedAt, history));
});

router.post("/game/coin/finish", async (req, res): Promise<void> => {
  const userId = authenticatedUserId(res);
  const id = String(req.body?.id ?? "");
  const round = await coinRounds.active(userId);
  if (!round || round.id !== id) {
    res.status(409).json({ error: "That course is already finished." });
    return;
  }
  const elapsed = Date.now() - round.startedAt;
  const jumps = cleanJumps(req.body?.jumps, elapsed);
  const result = scoreCourse(round.beats, jumps, elapsed);
  const payout = roundMoney(round.snack * result.multiple);
  const won = await coinRounds.settle(userId, round.id, {
    status: result.status,
    coins: result.coins,
    multiple: result.multiple,
    payout,
  });
  const stake = await readVirtualStake(userId);
  const virtualXrp = won && payout > 0 ? await credit(userId, payout) : stake.virtualXrp;
  const settled: CoinRound = { ...round, status: result.status, coins: result.coins, multiple: result.multiple, payout: won ? payout : 0 };
  const history = await coinRounds.recent(userId, 8);
  res.json(present(settled, virtualXrp, Date.now(), history));
});

export default router;
