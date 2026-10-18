import type { TankMode, TankTeam } from "@workspace/db";

export type MapRect = { kind: "building" | "wall"; x: number; y: number; w: number; h: number };
export type MapCircle = { kind: "rock" | "tree" | "water"; x: number; y: number; r: number };
export type MapCastle = { team: TankTeam; x: number; y: number; r: number };
export type MapSpawn = { x: number; y: number; hull: number; team: TankTeam | null };
export type MapBase = { team: TankTeam; x: number; y: number; w: number; h: number };
export type TankMap = {
  w: number;
  h: number;
  seed: number;
  theme: "field" | "city";
  bases: MapBase[];
  rects: MapRect[];
  circles: MapCircle[];
  roads: number[][];
  patches: Array<{ x: number; y: number; r: number }>;
  castles: MapCastle[];
  spawns: MapSpawn[];
};

export const TANK_RADIUS = 24;
export const CASTLE_RADIUS = 104;

type Shape = MapRect | MapCircle;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mapSize(seats: number): { w: number; h: number } {
  if (seats <= 10) return { w: 2200, h: 1500 };
  if (seats <= 20) return { w: 2800, h: 1800 };
  if (seats <= 50) return { w: 3800, h: 2500 };
  return { w: 4800, h: 3200 };
}

function isRect(shape: Shape): shape is MapRect {
  return shape.kind === "building" || shape.kind === "wall";
}

function circleHitsRect(x: number, y: number, r: number, rect: { x: number; y: number; w: number; h: number }): boolean {
  const nx = Math.max(rect.x, Math.min(x, rect.x + rect.w));
  const ny = Math.max(rect.y, Math.min(y, rect.y + rect.h));
  return Math.hypot(x - nx, y - ny) < r;
}

function shapesOverlap(a: Shape, b: Shape, gap: number): boolean {
  if (isRect(a) && isRect(b)) {
    return a.x - gap < b.x + b.w && a.x + a.w + gap > b.x && a.y - gap < b.y + b.h && a.y + a.h + gap > b.y;
  }
  if (!isRect(a) && !isRect(b)) return Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r + gap;
  const circle = (isRect(a) ? b : a) as MapCircle;
  const rect = (isRect(a) ? a : b) as MapRect;
  return circleHitsRect(circle.x, circle.y, circle.r + gap, rect);
}

function pointClear(x: number, y: number, r: number, shapes: Shape[]): boolean {
  for (const shape of shapes) {
    if (isRect(shape)) {
      if (circleHitsRect(x, y, r, shape)) return false;
    } else if (Math.hypot(x - shape.x, y - shape.y) < shape.r + r) {
      return false;
    }
  }
  return true;
}

function teamStripWidth(perTeam: number, h: number): { castleX: number; strip: number; rows: number } {
  const rows = Math.max(1, Math.floor((h - 260) / 130));
  const cols = Math.ceil(perTeam / rows);
  const castleX = 250;
  return { castleX, strip: castleX + CASTLE_RADIUS + 90 + cols * 130 + 40, rows };
}

function baseStrip(perTeam: number, h: number): { rows: number; cols: number; strip: number } {
  const rows = Math.max(1, Math.floor((h - 260) / 130));
  const cols = Math.ceil(perTeam / rows);
  return { rows, cols, strip: 110 + cols * 130 + 90 };
}

export function buildTankMap(seed: number, seats: number, mode: TankMode): TankMap {
  if (mode === "tdm") return buildCityMap(seed, seats);
  const rnd = mulberry32(seed);
  const between = (min: number, max: number) => min + rnd() * (max - min);
  const { w, h } = mapSize(seats);
  const perTeam = Math.ceil(seats / 2);
  const team = mode === "team" ? teamStripWidth(perTeam, h) : null;
  const castles: MapCastle[] = team
    ? [
        { team: "red", x: team.castleX, y: h / 2, r: CASTLE_RADIUS },
        { team: "blue", x: w - team.castleX, y: h / 2, r: CASTLE_RADIUS },
      ]
    : [];
  const keepOut: MapRect[] = team
    ? [
        { kind: "wall", x: 0, y: 0, w: team.strip, h },
        { kind: "wall", x: w - team.strip, y: 0, w: team.strip, h },
      ]
    : [];

  const roads: number[][] = [];
  const horizontal: number[] = [];
  let ry = h * between(0.35, 0.65);
  for (let x = -60; x <= w + 60; x += w / 6) {
    horizontal.push(x, ry);
    ry = Math.max(h * 0.2, Math.min(h * 0.8, ry + between(-h * 0.12, h * 0.12)));
  }
  roads.push(horizontal);
  const vertical: number[] = [];
  let rx = w * between(0.4, 0.6);
  for (let y = -60; y <= h + 60; y += h / 5) {
    vertical.push(rx, y);
    rx = Math.max(w * 0.3, Math.min(w * 0.7, rx + between(-w * 0.08, w * 0.08)));
  }
  roads.push(vertical);

  const patches: Array<{ x: number; y: number; r: number }> = [];
  const patchCount = Math.round((w * h) / 90_000);
  for (let index = 0; index < patchCount; index += 1) {
    patches.push({ x: between(0, w), y: between(0, h), r: between(40, 150) });
  }

  const shapes: Shape[] = [];
  const target = Math.round((w * h) / 85_000);
  let placed = 0;
  for (let attempt = 0; attempt < target * 14 && placed < target; attempt += 1) {
    const cx = between(90, w - 90);
    const cy = between(90, h - 90);
    const roll = rnd();
    const feature: Shape[] = [];
    if (roll < 0.16) {
      const bw = between(130, 240);
      const bh = between(100, 170);
      feature.push({ kind: "building", x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh });
    } else if (roll < 0.4) {
      const length = between(170, 320);
      const thick = 26;
      if (rnd() < 0.5) feature.push({ kind: "wall", x: cx - length / 2, y: cy - thick / 2, w: length, h: thick });
      else feature.push({ kind: "wall", x: cx - thick / 2, y: cy - length / 2, w: thick, h: length });
      if (rnd() < 0.35) {
        const first = feature[0] as MapRect;
        const leg = between(110, 190);
        if (first.w > first.h) feature.push({ kind: "wall", x: first.x, y: first.y, w: thick, h: leg });
        else feature.push({ kind: "wall", x: first.x, y: first.y + first.h - thick, w: leg, h: thick });
      }
    } else if (roll < 0.62) {
      const count = 1 + Math.floor(rnd() * 3);
      for (let index = 0; index < count; index += 1) {
        feature.push({ kind: "rock", x: cx + between(-46, 46) * (index ? 1 : 0), y: cy + between(-46, 46) * (index ? 1 : 0), r: between(22, 46) });
      }
    } else if (roll < 0.9) {
      const count = 3 + Math.floor(rnd() * 5);
      for (let index = 0; index < count; index += 1) {
        feature.push({ kind: "tree", x: cx + between(-80, 80) * (index ? 1 : 0), y: cy + between(-80, 80) * (index ? 1 : 0), r: between(18, 28) });
      }
    } else {
      const radius = between(90, 160);
      feature.push({ kind: "water", x: cx, y: cy, r: radius });
      feature.push({ kind: "water", x: cx + between(-radius, radius) * 0.6, y: cy + between(-radius, radius) * 0.5, r: radius * between(0.5, 0.8) });
    }
    const inside = feature.every(shape => isRect(shape)
      ? shape.x > 60 && shape.y > 60 && shape.x + shape.w < w - 60 && shape.y + shape.h < h - 60
      : shape.x - shape.r > 60 && shape.y - shape.r > 60 && shape.x + shape.r < w - 60 && shape.y + shape.r < h - 60);
    if (!inside) continue;
    const clash = feature.some(shape => shapes.some(other => shapesOverlap(shape, other, 90)) || keepOut.some(zone => shapesOverlap(shape, zone, 0)));
    if (clash) continue;
    shapes.push(...feature);
    placed += 1;
  }

  const spawns: MapSpawn[] = [];
  if (team) {
    const rows = team.rows;
    for (const side of ["red", "blue"] as const) {
      const castle = castles.find(item => item.team === side)!;
      const forward = side === "red" ? 1 : -1;
      for (let index = 0; index < perTeam; index += 1) {
        const col = Math.floor(index / rows);
        const row = index % rows;
        const inRow = Math.min(rows, perTeam - col * rows);
        const y = h / 2 + (row - (inRow - 1) / 2) * 130;
        const x = castle.x + forward * (CASTLE_RADIUS + 90 + col * 130);
        spawns.push({ x, y, hull: side === "red" ? 0 : Math.PI, team: side });
      }
    }
  } else {
    let spacing = Math.sqrt((w * h) / seats) * 0.78;
    let misses = 0;
    while (spawns.length < seats) {
      const x = between(120, w - 120);
      const y = between(120, h - 120);
      const open = pointClear(x, y, TANK_RADIUS + 46, shapes) && spawns.every(spawn => Math.hypot(spawn.x - x, spawn.y - y) >= spacing);
      if (open) {
        spawns.push({ x, y, hull: Math.atan2(h / 2 - y, w / 2 - x), team: null });
        misses = 0;
      } else if (++misses > 2500) {
        spacing *= 0.9;
        misses = 0;
      }
    }
  }

  return {
    w,
    h,
    seed,
    theme: "field",
    bases: [],
    rects: shapes.filter(isRect),
    circles: shapes.filter((shape): shape is MapCircle => !isRect(shape)),
    roads,
    patches,
    castles,
    spawns,
  };
}

function buildCityMap(seed: number, seats: number): TankMap {
  const rnd = mulberry32(seed);
  const between = (min: number, max: number) => min + rnd() * (max - min);
  const { w, h } = mapSize(seats);
  const perTeam = Math.ceil(seats / 2);
  const layout = baseStrip(perTeam, h);
  const bases: MapBase[] = [
    { team: "red", x: 0, y: 0, w: layout.strip, h },
    { team: "blue", x: w - layout.strip, y: 0, w: layout.strip, h },
  ];
  const keepOut: MapRect[] = bases.map(base => ({ kind: "wall", x: base.x, y: base.y, w: base.w, h: base.h }));

  const roads: number[][] = [];
  const lanes = Math.max(2, Math.round(h / 650));
  for (let lane = 1; lane <= lanes; lane += 1) {
    const y = (h / (lanes + 1)) * lane;
    roads.push([-60, y, w + 60, y]);
  }
  const avenues = Math.max(2, Math.round(w / 900));
  for (let lane = 1; lane <= avenues; lane += 1) {
    const x = layout.strip + ((w - layout.strip * 2) / (avenues + 1)) * lane;
    roads.push([x, -60, x, h + 60]);
  }
  const onRoad = (shape: Shape) => roads.some(road => {
    const [x1 = 0, y1 = 0, x2 = 0] = road;
    const lane: MapRect = x1 === x2
      ? { kind: "wall", x: x1 - 60, y: 0, w: 120, h }
      : { kind: "wall", x: 0, y: y1 - 60, w, h: 120 };
    return shapesOverlap(shape, lane, 0);
  });

  const patches: Array<{ x: number; y: number; r: number }> = [];
  const patchCount = Math.round((w * h) / 140_000);
  for (let index = 0; index < patchCount; index += 1) patches.push({ x: between(0, w), y: between(0, h), r: between(50, 140) });

  const shapes: Shape[] = [];
  const target = Math.round((w * h) / 70_000);
  let placed = 0;
  for (let attempt = 0; attempt < target * 16 && placed < target; attempt += 1) {
    const cx = between(layout.strip + 60, w - layout.strip - 60);
    const cy = between(90, h - 90);
    const roll = rnd();
    const feature: Shape[] = [];
    if (roll < 0.34) {
      const bw = between(140, 260);
      const bh = between(110, 200);
      feature.push({ kind: "building", x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh });
    } else if (roll < 0.7) {
      const length = between(120, 240);
      const thick = 24;
      const flat = rnd() < 0.5;
      feature.push(flat
        ? { kind: "wall", x: cx - length / 2, y: cy - thick / 2, w: length, h: thick }
        : { kind: "wall", x: cx - thick / 2, y: cy - length / 2, w: thick, h: length });
      if (rnd() < 0.3) {
        const first = feature[0] as MapRect;
        feature.push(flat
          ? { kind: "wall", x: first.x + first.w - thick, y: first.y, w: thick, h: between(90, 150) }
          : { kind: "wall", x: first.x, y: first.y + first.h - thick, w: between(90, 150), h: thick });
      }
    } else if (roll < 0.88) {
      const count = 2 + Math.floor(rnd() * 3);
      const across = rnd() < 0.5;
      for (let index = 0; index < count; index += 1) {
        feature.push({ kind: "rock", x: cx + (across ? index * 46 : 0), y: cy + (across ? 0 : index * 46), r: 18 });
      }
    } else {
      const count = 2 + Math.floor(rnd() * 3);
      for (let index = 0; index < count; index += 1) {
        feature.push({ kind: "tree", x: cx + between(-60, 60) * (index ? 1 : 0), y: cy + between(-60, 60) * (index ? 1 : 0), r: between(18, 24) });
      }
    }
    const inside = feature.every(shape => isRect(shape)
      ? shape.x > 60 && shape.y > 60 && shape.x + shape.w < w - 60 && shape.y + shape.h < h - 60
      : shape.x - shape.r > 60 && shape.y - shape.r > 60 && shape.x + shape.r < w - 60 && shape.y + shape.r < h - 60);
    if (!inside) continue;
    if (feature.some(shape => (shape.kind === "building" || shape.kind === "tree") && onRoad(shape))) continue;
    const clash = feature.some(shape => shapes.some(other => shapesOverlap(shape, other, 80)) || keepOut.some(zone => shapesOverlap(shape, zone, 0)));
    if (clash) continue;
    shapes.push(...feature);
    placed += 1;
  }

  const spawns: MapSpawn[] = [];
  for (const side of ["red", "blue"] as const) {
    for (let index = 0; index < perTeam; index += 1) {
      const col = Math.floor(index / layout.rows);
      const row = index % layout.rows;
      const inRow = Math.min(layout.rows, perTeam - col * layout.rows);
      const y = h / 2 + (row - (inRow - 1) / 2) * 130;
      const fromEdge = 110 + col * 130 + 65;
      spawns.push({ x: side === "red" ? fromEdge : w - fromEdge, y, hull: side === "red" ? 0 : Math.PI, team: side });
    }
  }

  return {
    w,
    h,
    seed,
    theme: "city",
    bases,
    rects: shapes.filter(isRect),
    circles: shapes.filter((shape): shape is MapCircle => !isRect(shape)),
    roads,
    patches,
    castles: [],
    spawns,
  };
}
