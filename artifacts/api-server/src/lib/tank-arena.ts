import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { accounts, tankRooms, type TankPlayer, type TankRoom, type TankTeam } from "@workspace/db";
import { logger } from "./logger";
import { readVirtualStake } from "./paper-engine";
import { buildTankMap, CASTLE_RADIUS, type TankMap } from "./tank-map";

export const TANK_HP = 100;
export const SHELL_DAMAGE = 34;
const COUNTDOWN_MS = 4_000;
const SOLO_LIMIT_MS = 6 * 60_000;
const TEAM_LIMIT_MS = 8 * 60_000;
const TDM_LIMIT_MS = 8 * 60_000;
const RESPAWN_MS = 5_000;
const TDM_RESPAWN_MS = 3_000;
const SHIELD_MS = 2_500;
const FORFEIT_MS = 20_000;
const FIRE_GAP_MS = 300;
const SHOT_TTL_MS = 2_500;
const SHOT_REACH = 900;
const MAX_SPEED = 165;
const SNAPSHOT_MS = 66;
const TICKET_TTL_MS = 60_000;

type LivePlayer = {
  record: TankPlayer;
  index: number;
  x: number;
  y: number;
  hull: number;
  turret: number;
  hp: number;
  alive: boolean;
  lastPosAt: number;
  lastFireAt: number;
  socket: WebSocket | null;
  leftAt: number;
  respawnAt: number;
  shieldUntil: number;
  streak: number;
};

type Castle = { team: TankTeam; x: number; y: number; hp: number; max: number };
type Shot = { by: string; at: number; x: number; y: number; used: boolean };

type Arena = {
  room: TankRoom;
  map: TankMap;
  players: Map<string, LivePlayer>;
  roster: LivePlayer[];
  castles: Castle[];
  shots: Map<string, Shot>;
  score: Record<TankTeam, number>;
  target: number;
  startsAt: number;
  endsAt: number;
  ended: boolean;
  work: Promise<void>;
  timer: ReturnType<typeof setInterval>;
  snapTimer: ReturnType<typeof setInterval>;
};

const arenas = new Map<string, Arena>();
const tickets = new Map<string, { key: string; roomId: string; expires: number }>();
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e8) / 1e8;
}

export async function creditStake(userId: string, amount: number): Promise<number> {
  const stake = await readVirtualStake(userId);
  const next = roundMoney(stake.virtualXrp + amount);
  await accounts.update(userId, { virtualXrp: next, updatedAt: new Date() });
  return next;
}

export async function debitStake(userId: string, amount: number): Promise<number | null> {
  const stake = await readVirtualStake(userId);
  if (stake.virtualXrp < amount) return null;
  const next = roundMoney(stake.virtualXrp - amount);
  await accounts.update(userId, { virtualXrp: next, updatedAt: new Date() });
  return next;
}

export function castleHp(seats: number): number {
  return 900 + seats * 30;
}

export function tdmTarget(seats: number): number {
  return Math.min(75, Math.max(10, Math.round(seats * 0.75)));
}

export function issueTicket(key: string, roomId: string): string {
  const now = Date.now();
  for (const [id, ticket] of tickets) if (ticket.expires < now) tickets.delete(id);
  const id = randomUUID();
  tickets.set(id, { key, roomId, expires: now + TICKET_TTL_MS });
  return id;
}

export function arenaLive(roomId: string): boolean {
  const arena = arenas.get(roomId);
  return Boolean(arena && !arena.ended);
}

function send(socket: WebSocket | null, message: unknown) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(arena: Arena, message: unknown, except?: string) {
  const text = JSON.stringify(message);
  for (const player of arena.roster) {
    if (player.record.pid === except) continue;
    if (player.socket && player.socket.readyState === WebSocket.OPEN) player.socket.send(text);
  }
}

function queue(arena: Arena, job: () => Promise<void>) {
  arena.work = arena.work.then(job).catch(error => {
    logger.error({ err: error, roomId: arena.room.id }, "Tank arena job failed");
  });
}

function spawnFor(arena: Arena, record: TankPlayer) {
  const pool = arena.map.spawns.filter(spawn => spawn.team === record.team);
  if (arena.room.mode !== "tdm" || pool.length < 2) return pool[record.slot % pool.length] ?? arena.map.spawns[0]!;
  const others = arena.roster.filter(player => player.alive && player.record.pid !== record.pid);
  let best = pool[0]!;
  let bestRoom = -1;
  for (const spawn of pool) {
    const nearest = others.reduce((least, player) => Math.min(least, Math.hypot(player.x - spawn.x, player.y - spawn.y)), Infinity);
    if (nearest > bestRoom) {
      bestRoom = nearest;
      best = spawn;
    }
  }
  return best;
}

function results(arena: Arena) {
  return arena.roster.map(player => ({
    pid: player.record.pid,
    callsign: player.record.callsign,
    team: player.record.team,
    kills: player.record.kills,
    deaths: player.record.deaths,
    taken: player.record.taken,
    alive: player.alive,
  }));
}

function persist(arena: Arena) {
  queue(arena, async () => {
    arena.room.players = arena.roster.map(player => ({ ...player.record, alive: player.alive }));
    await tankRooms.save(arena.room);
  });
}

function finish(arena: Arena, winner: string | null) {
  if (arena.ended) return;
  arena.ended = true;
  clearInterval(arena.timer);
  clearInterval(arena.snapTimer);
  const room = arena.room;
  room.winner = winner;
  const payouts: Array<{ player: LivePlayer; amount: number }> = [];
  if (room.mode === "solo") {
    const survivors = arena.roster.filter(player => player.alive);
    for (const player of survivors) payouts.push({ player, amount: room.entry });
  } else if (winner === "red" || winner === "blue") {
    const side = arena.roster.filter(player => player.record.team === winner);
    const share = side.length ? roundMoney(room.pot / side.length) : 0;
    for (const player of side) payouts.push({ player, amount: share });
  } else {
    for (const player of arena.roster) payouts.push({ player, amount: room.entry });
  }
  for (const { player, amount } of payouts) player.record.taken = roundMoney(player.record.taken + amount);
  room.status = "done";
  room.endedAt = new Date();
  if (room.mode === "tdm") room.score = { ...arena.score };
  broadcast(arena, { t: "end", winner, results: results(arena), score: room.mode === "tdm" ? arena.score : null });
  queue(arena, async () => {
    for (const { player, amount } of payouts) if (amount > 0) await creditStake(player.record.userId, amount);
    room.players = arena.roster.map(player => ({ ...player.record, alive: player.alive }));
    await tankRooms.save(room);
  });
  setTimeout(() => {
    for (const player of arena.roster) player.socket?.close(1000, "Battle over");
    arenas.delete(room.id);
  }, 15_000);
}

function checkEnd(arena: Arena) {
  if (arena.ended) return;
  const now = Date.now();
  const room = arena.room;
  if (room.mode === "solo") {
    const alive = arena.roster.filter(player => player.alive);
    if (alive.length <= 1) finish(arena, alive[0]?.record.pid ?? null);
    else if (now >= arena.endsAt) finish(arena, null);
    return;
  }
  if (room.mode === "tdm") {
    for (const side of ["red", "blue"] as const) {
      if (arena.score[side] >= arena.target) {
        finish(arena, side);
        return;
      }
    }
  }
  for (const castle of arena.castles) {
    if (castle.hp <= 0) {
      finish(arena, castle.team === "red" ? "blue" : "red");
      return;
    }
  }
  for (const side of ["red", "blue"] as const) {
    const members = arena.roster.filter(player => player.record.team === side);
    const gone = members.length > 0 && members.every(player => !player.socket && player.leftAt > 0 && now - player.leftAt > FORFEIT_MS);
    if (gone) {
      finish(arena, side === "red" ? "blue" : "red");
      return;
    }
  }
  if (now >= arena.endsAt && room.mode === "tdm") {
    const { red, blue } = arena.score;
    finish(arena, red === blue ? null : red > blue ? "red" : "blue");
    return;
  }
  if (now >= arena.endsAt) {
    const [red, blue] = arena.castles;
    const redShare = red ? red.hp / red.max : 0;
    const blueShare = blue ? blue.hp / blue.max : 0;
    finish(arena, Math.abs(redShare - blueShare) < 1e-9 ? null : redShare > blueShare ? "red" : "blue");
  }
}

function breakTank(arena: Arena, victim: LivePlayer, killer: LivePlayer | null) {
  victim.alive = false;
  victim.hp = 0;
  victim.record.deaths += 1;
  const room = arena.room;
  let bounty = 0;
  victim.streak = 0;
  if (killer) {
    killer.record.kills += 1;
    killer.streak += 1;
    if (room.mode === "solo") {
      bounty = room.entry;
      killer.record.taken = roundMoney(killer.record.taken + bounty);
      const userId = killer.record.userId;
      queue(arena, async () => { await creditStake(userId, bounty); });
    }
    if (room.mode === "tdm" && killer.record.team && killer.record.team !== victim.record.team) {
      arena.score[killer.record.team] += 1;
    }
  }
  if (room.mode === "team") {
    const castle = arena.castles.find(item => item.team === victim.record.team);
    victim.respawnAt = castle && castle.hp > 0 ? Date.now() + RESPAWN_MS : 0;
  }
  if (room.mode === "tdm") victim.respawnAt = Date.now() + TDM_RESPAWN_MS;
  broadcast(arena, {
    t: "kill",
    victim: victim.record.pid,
    by: killer?.record.pid ?? null,
    bounty,
    respawnAt: victim.respawnAt || null,
    streak: killer?.streak ?? 0,
    score: room.mode === "tdm" ? arena.score : null,
  });
  persist(arena);
  checkEnd(arena);
}

function tick(arena: Arena) {
  const now = Date.now();
  for (const [id, shot] of arena.shots) if (now - shot.at > SHOT_TTL_MS) arena.shots.delete(id);
  if (now < arena.startsAt) return;
  for (const player of arena.roster) {
    if (arena.room.mode === "solo" && player.alive && !player.socket && player.leftAt > 0 && now - player.leftAt > FORFEIT_MS) {
      breakTank(arena, player, null);
    }
    if (arena.room.mode !== "solo" && !player.alive && player.respawnAt > 0 && now >= player.respawnAt) {
      const castle = arena.castles.find(item => item.team === player.record.team);
      if (arena.room.mode === "team" && (!castle || castle.hp <= 0)) {
        player.respawnAt = 0;
        continue;
      }
      const spawn = spawnFor(arena, player.record);
      player.alive = true;
      player.hp = TANK_HP;
      player.x = spawn.x;
      player.y = spawn.y;
      player.hull = spawn.hull;
      player.turret = spawn.hull;
      player.respawnAt = 0;
      player.lastPosAt = now;
      player.shieldUntil = arena.room.mode === "tdm" ? now + SHIELD_MS : 0;
      broadcast(arena, { t: "spawn", pid: player.record.pid, x: spawn.x, y: spawn.y, hull: spawn.hull, shield: player.shieldUntil || null });
    }
  }
  checkEnd(arena);
}

function snapshot(arena: Arena) {
  const now = Date.now();
  broadcast(arena, {
    t: "snap",
    now,
    tanks: arena.roster.map(player => [
      Math.round(player.x),
      Math.round(player.y),
      Math.round(player.hull * 1000) / 1000,
      Math.round(player.turret * 1000) / 1000,
      player.hp,
      player.alive ? 1 : 0,
      player.socket ? 1 : 0,
      player.shieldUntil > now ? 1 : 0,
    ]),
    castles: arena.castles.map(castle => castle.hp),
    score: arena.room.mode === "tdm" ? [arena.score.red, arena.score.blue] : null,
  });
}

export function openArena(room: TankRoom): void {
  if (arenas.has(room.id)) return;
  const map = buildTankMap(room.seed, room.seats, room.mode);
  const now = Date.now();
  const roster: LivePlayer[] = room.players.map((record, index) => {
    const pool = map.spawns.filter(spawn => spawn.team === record.team);
    const spawn = pool[record.slot % pool.length] ?? map.spawns[0]!;
    return {
      record,
      index,
      x: spawn.x,
      y: spawn.y,
      hull: spawn.hull,
      turret: spawn.hull,
      hp: TANK_HP,
      alive: true,
      lastPosAt: now,
      lastFireAt: 0,
      socket: null,
      leftAt: now,
      respawnAt: 0,
      shieldUntil: room.mode === "tdm" ? now + COUNTDOWN_MS + SHIELD_MS : 0,
      streak: 0,
    };
  });
  const arena: Arena = {
    room,
    map,
    players: new Map(roster.map(player => [player.record.pid, player])),
    roster,
    castles: map.castles.map(castle => ({ team: castle.team, x: castle.x, y: castle.y, hp: castleHp(room.seats), max: castleHp(room.seats) })),
    shots: new Map(),
    score: { red: 0, blue: 0 },
    target: tdmTarget(room.seats),
    startsAt: now + COUNTDOWN_MS,
    endsAt: now + COUNTDOWN_MS + (room.mode === "team" ? TEAM_LIMIT_MS : room.mode === "tdm" ? TDM_LIMIT_MS : SOLO_LIMIT_MS),
    ended: false,
    work: Promise.resolve(),
    timer: setInterval(() => tick(arena), 250),
    snapTimer: setInterval(() => snapshot(arena), SNAPSHOT_MS),
  };
  arenas.set(room.id, arena);
}

function handleMessage(arena: Arena, player: LivePlayer, raw: RawData) {
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(raw.toString()) as Record<string, unknown>;
  } catch {
    return;
  }
  const now = Date.now();
  if (arena.ended || now < arena.startsAt) return;
  const type = message.t;
  if (type === "pos") {
    if (!player.alive) return;
    const x = Number(message.x);
    const y = Number(message.y);
    const hull = Number(message.hull);
    const turret = Number(message.turret);
    if (![x, y, hull, turret].every(Number.isFinite)) return;
    const elapsed = Math.min(1, Math.max(0.016, (now - player.lastPosAt) / 1000));
    const reach = MAX_SPEED * elapsed * 1.6 + 24;
    let nx = Math.max(24, Math.min(arena.map.w - 24, x));
    let ny = Math.max(24, Math.min(arena.map.h - 24, y));
    const distance = Math.hypot(nx - player.x, ny - player.y);
    if (distance > reach) {
      nx = player.x + ((nx - player.x) / distance) * reach;
      ny = player.y + ((ny - player.y) / distance) * reach;
      send(player.socket, { t: "warp", x: nx, y: ny });
    }
    player.x = nx;
    player.y = ny;
    player.hull = hull;
    player.turret = turret;
    player.lastPosAt = now;
    return;
  }
  if (type === "fire") {
    if (!player.alive || now - player.lastFireAt < FIRE_GAP_MS) return;
    const id = String(message.id ?? "").slice(0, 40);
    const angle = Number(message.a);
    if (!id || !Number.isFinite(angle) || arena.shots.has(id)) return;
    player.lastFireAt = now;
    player.shieldUntil = 0;
    let x = Number(message.x);
    let y = Number(message.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x - player.x, y - player.y) > 90) {
      x = player.x + Math.cos(angle) * 36;
      y = player.y + Math.sin(angle) * 36;
    }
    arena.shots.set(id, { by: player.record.pid, at: now, x, y, used: false });
    broadcast(arena, { t: "fire", by: player.record.pid, id, x, y, a: angle }, player.record.pid);
    return;
  }
  if (type === "hit") {
    const shot = arena.shots.get(String(message.id ?? ""));
    if (!shot || shot.used || shot.by !== player.record.pid) return;
    const target = String(message.target ?? "");
    if (target.startsWith("castle:")) {
      const castle = arena.castles.find(item => `castle:${item.team}` === target);
      if (!castle || castle.hp <= 0 || castle.team === player.record.team) return;
      if (Math.hypot(castle.x - shot.x, castle.y - shot.y) > SHOT_REACH + CASTLE_RADIUS) return;
      shot.used = true;
      castle.hp = Math.max(0, castle.hp - SHELL_DAMAGE);
      broadcast(arena, { t: "castle", team: castle.team, hp: castle.hp, by: player.record.pid, id: message.id });
      if (castle.hp <= 0) {
        for (const member of arena.roster) if (member.record.team === castle.team) member.respawnAt = 0;
      }
      checkEnd(arena);
      return;
    }
    const victim = arena.players.get(target);
    if (!victim || !victim.alive || victim === player) return;
    if (arena.room.mode !== "solo" && victim.record.team === player.record.team) return;
    if (Math.hypot(victim.x - shot.x, victim.y - shot.y) > SHOT_REACH) return;
    shot.used = true;
    if (victim.shieldUntil > now) {
      broadcast(arena, { t: "shield", target, id: message.id });
      return;
    }
    victim.hp = Math.max(0, victim.hp - SHELL_DAMAGE);
    broadcast(arena, { t: "hit", target, by: player.record.pid, hp: victim.hp, id: message.id });
    if (victim.hp <= 0) breakTank(arena, victim, player);
  }
}

export function handleTankUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, url: URL): void {
  const ticket = tickets.get(url.searchParams.get("ticket") ?? "");
  if (!ticket || ticket.expires < Date.now()) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  tickets.delete(url.searchParams.get("ticket") ?? "");
  const arena = arenas.get(ticket.roomId);
  const player = arena?.roster.find(item => item.record.key === ticket.key);
  if (!arena || !player || arena.ended) {
    socket.write("HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, client => {
    if (player.socket && player.socket !== client) player.socket.close(4000, "Opened in another window");
    player.socket = client;
    player.leftAt = 0;
    send(client, {
      t: "init",
      you: player.record.pid,
      now: Date.now(),
      startsAt: arena.startsAt,
      endsAt: arena.endsAt,
      room: { id: arena.room.id, mode: arena.room.mode, entry: arena.room.entry, seats: arena.room.seats, pot: arena.room.pot },
      map: arena.map,
      roster: arena.roster.map(item => ({
        pid: item.record.pid,
        callsign: item.record.callsign,
        team: item.record.team,
        kills: item.record.kills,
        deaths: item.record.deaths,
        taken: item.record.taken,
        x: item.x,
        y: item.y,
        hull: item.hull,
        turret: item.turret,
        hp: item.hp,
        alive: item.alive,
      })),
      castles: arena.castles,
      score: arena.score,
      target: arena.target,
      hp: TANK_HP,
    });
    client.on("message", raw => handleMessage(arena, player, raw));
    const left = () => {
      if (player.socket !== client) return;
      player.socket = null;
      player.leftAt = Date.now();
    };
    client.on("close", left);
    client.on("error", left);
  });
}

export async function recoverTankRooms(): Promise<void> {
  const rooms = await tankRooms.unfinished();
  for (const room of rooms) {
    if (!Array.isArray(room.players)) {
      if (room.hostId && Number(room.entry) > 0) await creditStake(room.hostId, Number(room.entry));
      await tankRooms.close(room.id, "cancelled");
      continue;
    }
    if (arenas.has(room.id)) continue;
    for (const player of room.players) {
      const owed = room.status === "lobby" || room.mode !== "solo" || player.alive ? room.entry : 0;
      if (owed > 0) {
        await creditStake(player.userId, owed);
        player.taken = roundMoney(player.taken + owed);
      }
    }
    room.status = "cancelled";
    room.endedAt = new Date();
    await tankRooms.save(room);
    logger.info({ roomId: room.id }, "Closed an unfinished tank room and returned the entries");
  }
}
