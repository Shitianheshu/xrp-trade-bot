import { demoSessions, type DemoSessionRecord } from "@workspace/db";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let current: DemoSessionRecord | null = null;
let closed = false;

function remember(session: DemoSessionRecord | null) {
  current = session;
  closed = false;
}

function clockOf(session: DemoSessionRecord, now = Date.now()) {
  const elapsedMs = Math.max(0, now - session.startedAt.getTime());
  return { elapsedMs, hour: elapsedMs / HOUR, done: elapsedMs >= DAY };
}

export async function loadDemoSession(): Promise<void> {
  remember(await demoSessions.findActive());
}

export function demoClock(userId?: string) {
  const session = current && (!userId || current.userId === userId) ? current : null;
  if (!session?.active) {
    return { active: false, hour: 0, remainingHours: 24, startedAt: null as string | null, endsAt: null as string | null, symbol: "XRP/USDT" };
  }
  const clock = clockOf(session);
  if (clock.done) {
    if (!closed) {
      closed = true;
      current = { ...session, active: false, updatedAt: new Date() };
      void demoSessions.save(current);
    }
    return { active: false, hour: 24, remainingHours: 0, startedAt: session.startedAt.toISOString(), endsAt: new Date(session.startedAt.getTime() + DAY).toISOString(), symbol: session.symbol };
  }
  return {
    active: true,
    hour: Math.round(clock.hour * 100) / 100,
    remainingHours: Math.round(Math.max(0, 24 - clock.hour) * 100) / 100,
    startedAt: session.startedAt.toISOString(),
    endsAt: new Date(session.startedAt.getTime() + DAY).toISOString(),
    symbol: session.symbol,
  };
}

export async function startDemo(userId: string, symbol = "XRP/USDT") {
  const session: DemoSessionRecord = {
    userId,
    active: true,
    symbol,
    startedAt: new Date(),
    seekMs: 0,
    updatedAt: new Date(),
  };
  await demoSessions.save(session);
  remember(session);
  return demoClock(userId);
}

export async function stopDemo(userId: string) {
  const existing = current?.userId === userId ? current : await demoSessions.find(userId);
  if (existing) {
    const session = { ...existing, active: false, updatedAt: new Date() };
    await demoSessions.save(session);
    if (current?.userId === userId) remember(null);
  }
  return demoClock(userId);
}
