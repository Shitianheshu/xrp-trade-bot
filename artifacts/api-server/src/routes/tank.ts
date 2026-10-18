import { randomUUID } from "node:crypto";
import { Router, type IRouter, type Response } from "express";
import { isDuplicateKey, tankRooms, type TankPlayer, type TankRoom, type TankTeam } from "@workspace/db";
import { authenticatedUserId, requireAuth } from "../middlewares/require-auth";
import { readVirtualStake } from "../lib/paper-engine";
import { arenaLive, creditStake, debitStake, issueTicket, openArena, roundMoney } from "../lib/tank-arena";

const router: IRouter = Router();
router.use(requireAuth);

const ENTRIES = [5, 10, 25, 50];
const SEATS = [10, 20, 50, 100];
const MODES = ["solo", "team", "tdm"] as const;
const pilotPattern = /^[A-Za-z0-9-]{8,64}$/;
const locks = new Map<string, Promise<unknown>>();

async function withLock<T>(id: string, job: () => Promise<T>): Promise<T> {
  const before = locks.get(id) ?? Promise.resolve();
  const run = before.catch(() => undefined).then(job);
  locks.set(id, run);
  try {
    return await run;
  } finally {
    if (locks.get(id) === run) locks.delete(id);
  }
}

function pilotKey(res: Response, raw: unknown): { userId: string; key: string } | null {
  const pilot = String(raw ?? "");
  if (!pilotPattern.test(pilot)) return null;
  const userId = authenticatedUserId(res);
  return { userId, key: `${userId}:${pilot}` };
}

function cleanCallsign(raw: unknown): string {
  const text = String(raw ?? "").replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 16);
  return text || "Pilot";
}

function perTeam(room: TankRoom): number {
  return Math.ceil(room.seats / 2);
}

function freeSlot(room: TankRoom, team: TankTeam | null): number {
  const taken = new Set(room.players.filter(player => player.team === team).map(player => player.slot));
  const limit = team ? perTeam(room) : room.seats;
  for (let slot = 0; slot < limit; slot += 1) if (!taken.has(slot)) return slot;
  return -1;
}

function teamCount(room: TankRoom, team: TankTeam): number {
  return room.players.filter(player => player.team === team).length;
}

function lighterTeam(room: TankRoom): TankTeam {
  return teamCount(room, "red") <= teamCount(room, "blue") ? "red" : "blue";
}

function presentRoom(room: TankRoom, key: string | null) {
  const host = room.players.find(player => player.key === room.hostId);
  const mine = room.players.find(player => player.key === key) ?? null;
  return {
    id: room.id,
    mode: room.mode,
    entry: room.entry,
    seats: room.seats,
    status: room.status,
    pot: room.pot,
    winner: room.winner,
    hostName: host?.callsign ?? "Host",
    isHost: room.hostId === key,
    live: arenaLive(room.id),
    you: mine ? { pid: mine.pid, team: mine.team, taken: mine.taken, kills: mine.kills, alive: mine.alive } : null,
    players: room.players.map(player => ({
      pid: player.pid,
      callsign: player.callsign,
      team: player.team,
      host: player.key === room.hostId,
      you: player.key === key,
      kills: player.kills,
      deaths: player.deaths,
      taken: player.taken,
      alive: player.alive,
    })),
    createdAt: room.createdAt.toISOString(),
  };
}

function historyRow(room: TankRoom, userId: string) {
  const mine = room.players.filter(player => player.userId === userId);
  const paid = room.entry * mine.length;
  const taken = roundMoney(mine.reduce((sum, player) => sum + player.taken, 0));
  let result: "won" | "lost" | "refunded" | "draw" = "lost";
  if (room.status === "cancelled") result = "refunded";
  else if (room.winner == null) result = "draw";
  else if (mine.some(player => player.pid === room.winner || player.team === room.winner)) result = "won";
  return { id: room.id, mode: room.mode, entry: room.entry, seats: room.seats, paid, taken, result, score: room.score ?? null, createdAt: room.createdAt.toISOString() };
}

function seatIn(room: TankRoom | null, userId: string): TankPlayer | null {
  return room?.players.find(player => player.userId === userId) ?? null;
}

async function snapshot(userId: string) {
  const [mine, open, stake, history] = await Promise.all([
    tankRooms.seatedUser(userId),
    tankRooms.open(30),
    readVirtualStake(userId),
    tankRooms.recent(userId, 8),
  ]);
  return {
    virtualXrp: stake.virtualXrp,
    room: mine ? presentRoom(mine, seatIn(mine, userId)?.key ?? null) : null,
    open: open
      .filter(room => room.id !== mine?.id)
      .map(room => ({
        id: room.id,
        mode: room.mode,
        entry: room.entry,
        seats: room.seats,
        players: room.players.length,
        red: teamCount(room, "red"),
        blue: teamCount(room, "blue"),
        hostName: room.players.find(player => player.key === room.hostId)?.callsign ?? "Host",
        createdAt: room.createdAt.toISOString(),
      })),
    history: history.map(room => historyRow(room, userId)),
  };
}

function fail(res: Response, status: number, error: string) {
  res.status(status).json({ error });
}

router.get("/game/tank", async (req, res): Promise<void> => {
  res.json(await snapshot(authenticatedUserId(res)));
});

router.post("/game/tank/rooms", async (req, res): Promise<void> => {
  const pilot = pilotKey(res, req.body?.pilot);
  if (!pilot) return fail(res, 400, "This window has no pilot id. Reload the page.");
  const entry = Number(req.body?.entry);
  const seats = Number(req.body?.seats);
  const mode = MODES.find(item => item === req.body?.mode);
  if (!ENTRIES.includes(entry) || !SEATS.includes(seats) || !mode) {
    return fail(res, 400, "Choose solo, team, or TDM, an entry of 5, 10, 25, or 50 XRP, and a room of 10, 20, 50, or 100.");
  }
  await withLock(`user:${pilot.userId}`, async () => {
    if (await tankRooms.seatedUser(pilot.userId)) return fail(res, 409, "Your ID already has a seat in a room.");
    if (await debitStake(pilot.userId, entry) == null) return fail(res, 409, "The virtual stake is smaller than the room entry.");
    const team: TankTeam | null = mode === "solo" ? null : "red";
    const player: TankPlayer = {
      key: pilot.key,
      pid: randomUUID().slice(0, 8),
      userId: pilot.userId,
      callsign: cleanCallsign(req.body?.callsign),
      team,
      slot: 0,
      alive: true,
      kills: 0,
      deaths: 0,
      taken: 0,
      joinedAt: new Date(),
    };
    const room: TankRoom = {
      id: randomUUID(),
      hostId: pilot.key,
      mode,
      entry,
      seats,
      seed: Math.floor(Math.random() * 2 ** 31),
      status: "lobby",
      players: [player],
      winner: null,
      pot: entry,
      createdAt: new Date(),
    };
    try {
      await tankRooms.insert(room);
    } catch (error) {
      await creditStake(pilot.userId, entry);
      if (isDuplicateKey(error)) return fail(res, 409, "You already host a room.");
      throw error;
    }
    res.json(await snapshot(pilot.userId));
  });
});

router.post("/game/tank/join", async (req, res): Promise<void> => {
  const pilot = pilotKey(res, req.body?.pilot);
  if (!pilot) return fail(res, 400, "This window has no pilot id. Reload the page.");
  const id = String(req.body?.id ?? "");
  await withLock(`user:${pilot.userId}`, () => withLock(id, async () => {
    if (await tankRooms.seatedUser(pilot.userId)) return fail(res, 409, "Your ID already has a seat in a room. Leave it first.");
    const room = await tankRooms.get(id);
    if (!room || room.status !== "lobby") return fail(res, 409, "That room is no longer taking players.");
    if (room.players.length >= room.seats) return fail(res, 409, "That room is full.");
    const team: TankTeam | null = room.mode === "solo" ? null : lighterTeam(room);
    const slot = freeSlot(room, team);
    if (slot < 0) return fail(res, 409, "That side is full.");
    if (await debitStake(pilot.userId, room.entry) == null) return fail(res, 409, "The virtual stake is smaller than the room entry.");
    room.players.push({
      key: pilot.key,
      pid: randomUUID().slice(0, 8),
      userId: pilot.userId,
      callsign: cleanCallsign(req.body?.callsign),
      team,
      slot,
      alive: true,
      kills: 0,
      deaths: 0,
      taken: 0,
      joinedAt: new Date(),
    });
    room.pot = roundMoney(room.entry * room.players.length);
    await tankRooms.save(room);
    res.json(await snapshot(pilot.userId));
  }));
});

router.post("/game/tank/team", async (req, res): Promise<void> => {
  const userId = authenticatedUserId(res);
  const team = req.body?.team === "blue" ? "blue" : req.body?.team === "red" ? "red" : null;
  const id = String(req.body?.id ?? "");
  await withLock(id, async () => {
    const room = await tankRooms.get(id);
    const me = seatIn(room, userId);
    if (!room || !me || room.status !== "lobby" || room.mode === "solo" || !team) return fail(res, 409, "Sides can change only in a team lobby.");
    if (me.team !== team) {
      if (teamCount(room, team) >= perTeam(room)) return fail(res, 409, `The ${team} side is full.`);
      me.team = team;
      me.slot = freeSlot({ ...room, players: room.players.filter(player => player !== me) }, team);
      await tankRooms.save(room);
    }
    res.json(await snapshot(userId));
  });
});

router.post("/game/tank/leave", async (req, res): Promise<void> => {
  const userId = authenticatedUserId(res);
  const id = String(req.body?.id ?? "");
  await withLock(id, async () => {
    const room = await tankRooms.get(id);
    const me = seatIn(room, userId);
    if (!room || !me || room.status !== "lobby") return fail(res, 409, "You can leave only while the room is waiting.");
    room.players = room.players.filter(player => player !== me);
    await creditStake(userId, room.entry);
    if (!room.players.length) {
      room.status = "cancelled";
      room.endedAt = new Date();
      room.players = [{ ...me, taken: room.entry }];
    } else if (room.hostId === me.key) {
      room.hostId = room.players[0]!.key;
    }
    room.pot = roundMoney(room.entry * room.players.length);
    await tankRooms.save(room);
    res.json(await snapshot(userId));
  });
});

router.post("/game/tank/start", async (req, res): Promise<void> => {
  const userId = authenticatedUserId(res);
  const id = String(req.body?.id ?? "");
  await withLock(id, async () => {
    const room = await tankRooms.get(id);
    if (!room || room.status !== "lobby") return fail(res, 409, "That room is not waiting to start.");
    if (!seatIn(room, userId)) return fail(res, 403, "Only players in this room can start the battle.");
    if (room.mode === "solo" && room.players.length < 2) return fail(res, 409, "A solo battle needs at least two players.");
    if (room.mode !== "solo" && (teamCount(room, "red") < 1 || teamCount(room, "blue") < 1)) {
      return fail(res, 409, "Each side needs at least one player.");
    }
    room.status = "battle";
    room.startedAt = new Date();
    room.pot = roundMoney(room.entry * room.players.length);
    await tankRooms.save(room);
    openArena(room);
    res.json(await snapshot(userId));
  });
});

router.post("/game/tank/ticket", async (req, res): Promise<void> => {
  const room = await tankRooms.get(String(req.body?.id ?? ""));
  const me = seatIn(room, authenticatedUserId(res));
  if (!room || !me || room.status !== "battle" || !arenaLive(room.id)) {
    return fail(res, 409, "That battle is not running.");
  }
  res.json({ ticket: issueTicket(me.key, room.id) });
});

export default router;
