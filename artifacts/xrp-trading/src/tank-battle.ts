export type Team = 'red' | 'blue';
export type Mode = 'solo' | 'team' | 'tdm';
export type Score = Record<Team, number>;
type MapRect = { kind: 'building' | 'wall'; x: number; y: number; w: number; h: number };
type MapCircle = { kind: 'rock' | 'tree' | 'water'; x: number; y: number; r: number };
type MapCastle = { team: Team; x: number; y: number; r: number };
type MapBase = { team: Team; x: number; y: number; w: number; h: number };
type TankMap = {
  w: number;
  h: number;
  seed: number;
  theme?: 'field' | 'city';
  bases?: MapBase[];
  rects: MapRect[];
  circles: MapCircle[];
  roads: number[][];
  patches: Array<{ x: number; y: number; r: number }>;
  castles: MapCastle[];
  spawns: Array<{ x: number; y: number; hull: number; team: Team | null }>;
};
type RosterEntry = {
  pid: string;
  callsign: string;
  team: Team | null;
  kills: number;
  deaths: number;
  taken: number;
  x: number;
  y: number;
  hull: number;
  turret: number;
  hp: number;
  alive: boolean;
};
type InitMessage = {
  t: 'init';
  you: string;
  now: number;
  startsAt: number;
  endsAt: number;
  room: { id: string; mode: Mode; entry: number; seats: number; pot: number };
  map: TankMap;
  roster: RosterEntry[];
  castles: Array<{ team: Team; x: number; y: number; hp: number; max: number }>;
  score?: Score;
  target?: number;
  hp: number;
};
export type BattleResult = {
  winner: string | null;
  mode: Mode;
  score: Score | null;
  target: number;
  you: string;
  yourTeam: Team | null;
  entry: number;
  pot: number;
  results: Array<{ pid: string; callsign: string; team: Team | null; kills: number; deaths: number; taken: number; alive: boolean }>;
};
export type BattleHud = {
  hp: number;
  alive: boolean;
  kills: number;
  taken: number;
  enemies: number;
  allies: number;
  timeLeft: number;
  countdown: number;
  respawnIn: number;
  castles: Array<{ team: Team; hp: number; max: number }>;
  mode: Mode;
  team: Team | null;
  connected: boolean;
  score: Score | null;
  target: number;
  streak: number;
};
type Callbacks = {
  onHud: (hud: BattleHud) => void;
  onEnd: (result: BattleResult) => void;
  onDrop: (reason: string) => void;
};

type Tank = {
  pid: string;
  callsign: string;
  team: Team | null;
  x: number;
  y: number;
  hull: number;
  turret: number;
  tx: number;
  ty: number;
  thull: number;
  tturret: number;
  hp: number;
  alive: boolean;
  online: boolean;
  flash: number;
  recoil: number;
  kills: number;
  taken: number;
  respawnAt: number;
  trail: number;
  shield: boolean;
  streak: number;
};
type Shell = { id: string; x: number; y: number; vx: number; vy: number; life: number; owner: string; mine: boolean; team: Team | null };
type Marker = { x: number; y: number; at: number; kill: boolean };
type Ripple = { x: number; y: number; at: number };
type Puff = { x: number; y: number; vx: number; vy: number; life: number; max: number; radius: number; kind: 'smoke' | 'fire' | 'dust' };
type Feed = { text: string; at: number; tone: 'good' | 'bad' | 'plain' };

const TANK_R = 24;
const SHELL_SPEED = 9;
const SHELL_LIFE = 80;
const FIRE_COOLDOWN_MS = 360;
const SEND_MS = 50;
const TERRAIN_SCALE = 0.5;
const TEAM_COLORS: Record<Team, { hull: [string, string, string]; turret: string; tag: string }> = {
  red: { hull: ['#6e2f28', '#a5574a', '#5b2620'], turret: '#7d3a31', tag: '#f87171' },
  blue: { hull: ['#2c4a66', '#4f7ca6', '#233d55'], turret: '#355a7d', tag: '#60a5fa' },
};
const CITY_COLORS: Record<Team, { hull: [string, string, string]; turret: string; tag: string; neon: string; glow: string }> = {
  red: { hull: ['#2a1218', '#9f2a38', '#1f0d12'], turret: '#5c1622', tag: '#fb7185', neon: '#ff4d6d', glow: 'rgba(255, 77, 109, .55)' },
  blue: { hull: ['#0d2238', '#2766a8', '#0a1a2c'], turret: '#163e66', tag: '#38bdf8', neon: '#3ccbff', glow: 'rgba(60, 203, 255, .55)' },
};
const STREAK_CALLS: Record<number, string> = { 2: 'Double break', 3: 'Triple break', 5: 'Rampage', 7: 'Unstoppable', 10: 'Legendary' };
const SOLO_SELF = { hull: ['#556331', '#7d9148', '#4d5a2c'] as [string, string, string], turret: '#445226', tag: '#86efac' };
const SOLO_OTHER = { hull: ['#6e5b3b', '#a48458', '#5c4a30'] as [string, string, string], turret: '#5a4930', tag: '#fcd34d' };

function timeText(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function wrapAngle(angle: number): number {
  let value = angle;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

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

function renderCityTerrain(map: TankMap): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(map.w * TERRAIN_SCALE);
  canvas.height = Math.ceil(map.h * TERRAIN_SCALE);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(TERRAIN_SCALE, TERRAIN_SCALE);
  const rnd = mulberry32(map.seed ^ 0x5bd1e995);
  const base = ctx.createLinearGradient(0, 0, map.w, map.h);
  base.addColorStop(0, '#1a2130');
  base.addColorStop(0.5, '#1f2737');
  base.addColorStop(1, '#181e2b');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, map.w, map.h);
  for (const patch of map.patches) {
    const gradient = ctx.createRadialGradient(patch.x, patch.y, 0, patch.x, patch.y, patch.r);
    gradient.addColorStop(0, rnd() < 0.5 ? 'rgba(8, 11, 18, .45)' : 'rgba(60, 72, 96, .22)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(patch.x, patch.y, patch.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(148, 163, 184, .06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= map.w; x += 80) { ctx.moveTo(x, 0); ctx.lineTo(x, map.h); }
  for (let y = 0; y <= map.h; y += 80) { ctx.moveTo(0, y); ctx.lineTo(map.w, y); }
  ctx.stroke();
  const specks = Math.round((map.w * map.h) / 3000);
  for (let index = 0; index < specks; index += 1) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(255, 255, 255, .035)' : 'rgba(0, 0, 0, .18)';
    ctx.fillRect(rnd() * map.w, rnd() * map.h, 2, 2);
  }
  for (const road of map.roads) {
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = road;
    const vertical = x1 === x2;
    ctx.fillStyle = '#121824';
    if (vertical) ctx.fillRect(x1 - 60, 0, 120, map.h); else ctx.fillRect(0, y1 - 60, map.w, 120);
    ctx.fillStyle = 'rgba(148, 163, 184, .16)';
    if (vertical) { ctx.fillRect(x1 - 62, 0, 3, map.h); ctx.fillRect(x1 + 59, 0, 3, map.h); }
    else { ctx.fillRect(0, y1 - 62, map.w, 3); ctx.fillRect(0, y1 + 59, map.w, 3); }
    ctx.strokeStyle = 'rgba(250, 204, 21, .45)';
    ctx.lineWidth = 3;
    ctx.setLineDash([26, 22]);
    ctx.beginPath();
    ctx.moveTo(vertical ? x1 : -60, vertical ? -60 : y1);
    ctx.lineTo(vertical ? x2 : map.w + 60, vertical ? y2 : y1);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const a of map.roads) {
    for (const b of map.roads) {
      if (!(a[0] === a[2]) || b[0] === b[2]) continue;
      const cx = a[0] ?? 0;
      const cy = b[1] ?? 0;
      ctx.fillStyle = '#121824';
      ctx.fillRect(cx - 60, cy - 60, 120, 120);
      ctx.fillStyle = 'rgba(226, 232, 240, .22)';
      for (let stripe = -48; stripe <= 40; stripe += 16) {
        ctx.fillRect(cx + stripe, cy - 78, 9, 14);
        ctx.fillRect(cx + stripe, cy + 64, 9, 14);
        ctx.fillRect(cx - 78, cy + stripe, 14, 9);
        ctx.fillRect(cx + 64, cy + stripe, 14, 9);
      }
    }
  }
  for (const zone of map.bases ?? []) {
    const color = CITY_COLORS[zone.team];
    const fade = ctx.createLinearGradient(zone.team === 'red' ? zone.x : zone.x + zone.w, 0, zone.team === 'red' ? zone.x + zone.w : zone.x, 0);
    fade.addColorStop(0, zone.team === 'red' ? 'rgba(255, 77, 109, .16)' : 'rgba(60, 203, 255, .16)');
    fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = fade;
    ctx.fillRect(zone.x, zone.y, zone.w, zone.h);
    const edge = zone.team === 'red' ? zone.x + zone.w : zone.x;
    ctx.strokeStyle = color.neon;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 4;
    ctx.setLineDash([30, 16]);
    ctx.beginPath();
    ctx.moveTo(edge, 30);
    ctx.lineTo(edge, zone.h - 30);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = color.neon;
    const dir = zone.team === 'red' ? 1 : -1;
    for (let y = 120; y < zone.h - 80; y += 160) {
      const x = edge - dir * 60;
      ctx.beginPath();
      ctx.moveTo(x - dir * 22, y - 26);
      ctx.lineTo(x + dir * 10, y);
      ctx.lineTo(x - dir * 22, y + 26);
      ctx.lineTo(x - dir * 8, y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 0.1;
    ctx.save();
    ctx.translate(zone.x + zone.w / 2, zone.h / 2);
    ctx.rotate(zone.team === 'red' ? -Math.PI / 2 : Math.PI / 2);
    ctx.font = '800 120px Outfit, Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(zone.team === 'red' ? 'RED BASE' : 'BLUE BASE', 0, 0);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = 'rgba(148, 163, 184, .35)';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, map.w - 12, map.h - 12);
  return canvas;
}

function renderTerrain(map: TankMap): HTMLCanvasElement {
  if (map.theme === 'city') return renderCityTerrain(map);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(map.w * TERRAIN_SCALE);
  canvas.height = Math.ceil(map.h * TERRAIN_SCALE);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(TERRAIN_SCALE, TERRAIN_SCALE);
  const rnd = mulberry32(map.seed ^ 0x9e3779b9);
  const base = ctx.createLinearGradient(0, 0, map.w, map.h);
  base.addColorStop(0, '#6f8f49');
  base.addColorStop(0.5, '#7a9a50');
  base.addColorStop(1, '#678744');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, map.w, map.h);
  for (const patch of map.patches) {
    const gradient = ctx.createRadialGradient(patch.x, patch.y, 0, patch.x, patch.y, patch.r);
    const dirt = rnd() < 0.55;
    gradient.addColorStop(0, dirt ? 'rgba(142, 118, 78, .5)' : 'rgba(88, 120, 56, .55)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(patch.x, patch.y, patch.r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tufts = Math.round((map.w * map.h) / 2200);
  for (let index = 0; index < tufts; index += 1) {
    const x = rnd() * map.w;
    const y = rnd() * map.h;
    const shade = rnd();
    ctx.fillStyle = shade < 0.5 ? 'rgba(52, 82, 34, .35)' : shade < 0.85 ? 'rgba(150, 178, 96, .28)' : 'rgba(120, 98, 64, .3)';
    ctx.fillRect(x, y, 2 + rnd() * 3, 2 + rnd() * 3);
  }
  const roadPath = (points: number[]) => {
    ctx.beginPath();
    ctx.moveTo(points[0] ?? 0, points[1] ?? 0);
    for (let index = 2; index + 3 < points.length; index += 2) {
      const cx = points[index] ?? 0;
      const cy = points[index + 1] ?? 0;
      const nx = points[index + 2] ?? cx;
      const ny = points[index + 3] ?? cy;
      ctx.quadraticCurveTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2);
    }
    ctx.lineTo(points[points.length - 2] ?? 0, points[points.length - 1] ?? 0);
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const road of map.roads) {
    roadPath(road);
    ctx.strokeStyle = 'rgba(92, 76, 50, .55)';
    ctx.lineWidth = 86;
    ctx.stroke();
    roadPath(road);
    ctx.strokeStyle = '#a8946d';
    ctx.lineWidth = 70;
    ctx.stroke();
    ctx.setLineDash([18, 22]);
    for (const offset of [-16, 16]) {
      ctx.save();
      ctx.translate(0, offset);
      roadPath(road);
      ctx.strokeStyle = 'rgba(80, 64, 42, .35)';
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.restore();
    }
    ctx.setLineDash([]);
  }
  for (const castle of map.castles) {
    const plaza = ctx.createRadialGradient(castle.x, castle.y, 40, castle.x, castle.y, 230);
    plaza.addColorStop(0, '#b3a88f');
    plaza.addColorStop(0.75, '#9d927a');
    plaza.addColorStop(1, 'rgba(157, 146, 122, 0)');
    ctx.fillStyle = plaza;
    ctx.beginPath();
    ctx.arc(castle.x, castle.y, 230, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(70, 62, 48, .18)';
    ctx.lineWidth = 2;
    for (let ring = 70; ring < 200; ring += 26) {
      ctx.beginPath();
      ctx.arc(castle.x, castle.y, ring, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  const water = map.circles.filter(circle => circle.kind === 'water');
  for (const pond of water) {
    ctx.fillStyle = '#c8b98c';
    ctx.beginPath();
    ctx.arc(pond.x, pond.y, pond.r + 12, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const pond of water) {
    const gradient = ctx.createRadialGradient(pond.x - pond.r * 0.3, pond.y - pond.r * 0.3, pond.r * 0.1, pond.x, pond.y, pond.r);
    gradient.addColorStop(0, '#4f93bd');
    gradient.addColorStop(1, '#2a5d86');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(pond.x, pond.y, pond.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(255, 255, 255, .22)';
  ctx.lineWidth = 2;
  for (const pond of water) {
    for (let ripple = 0; ripple < 3; ripple += 1) {
      const angle = rnd() * Math.PI * 2;
      const distance = rnd() * pond.r * 0.55;
      ctx.beginPath();
      ctx.arc(pond.x + Math.cos(angle) * distance, pond.y + Math.sin(angle) * distance, 10 + rnd() * 16, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = '#3d4a2a';
  ctx.lineWidth = 16;
  ctx.strokeRect(8, 8, map.w - 16, map.h - 16);
  ctx.strokeStyle = 'rgba(255, 255, 255, .12)';
  ctx.lineWidth = 2;
  ctx.setLineDash([14, 10]);
  ctx.strokeRect(22, 22, map.w - 44, map.h - 44);
  ctx.setLineDash([]);
  return canvas;
}

function renderMinimap(map: TankMap, width: number): HTMLCanvasElement {
  const height = Math.round((width * map.h) / map.w);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const s = width / map.w;
  const city = map.theme === 'city';
  ctx.fillStyle = city ? '#1b2231' : '#4d6a34';
  ctx.fillRect(0, 0, width, height);
  for (const zone of map.bases ?? []) {
    ctx.fillStyle = zone.team === 'red' ? 'rgba(255, 77, 109, .28)' : 'rgba(60, 203, 255, .28)';
    ctx.fillRect(zone.x * s, zone.y * s, zone.w * s, zone.h * s);
  }
  ctx.strokeStyle = city ? 'rgba(15, 20, 30, .95)' : 'rgba(168, 148, 109, .8)';
  ctx.lineWidth = Math.max(2, 60 * s);
  for (const road of map.roads) {
    ctx.beginPath();
    for (let index = 0; index + 1 < road.length; index += 2) {
      const x = (road[index] ?? 0) * s;
      const y = (road[index + 1] ?? 0) * s;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (const circle of map.circles) {
    ctx.fillStyle = circle.kind === 'water' ? '#3b79a6' : circle.kind === 'tree' ? (city ? '#1f6f4a' : '#2d4f24') : (city ? '#64748b' : '#8a877f');
    ctx.beginPath();
    ctx.arc(circle.x * s, circle.y * s, Math.max(1, circle.r * s), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = city ? '#475569' : '#c9c4b8';
  for (const rect of map.rects) ctx.fillRect(rect.x * s, rect.y * s, Math.max(1, rect.w * s), Math.max(1, rect.h * s));
  return canvas;
}

function drawRock(ctx: CanvasRenderingContext2D, rock: MapCircle) {
  ctx.fillStyle = 'rgba(20, 24, 12, .3)';
  ctx.beginPath();
  ctx.ellipse(rock.x + 6, rock.y + 8, rock.r, rock.r * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  const gradient = ctx.createRadialGradient(rock.x - rock.r * 0.35, rock.y - rock.r * 0.4, rock.r * 0.1, rock.x, rock.y, rock.r);
  gradient.addColorStop(0, '#b4b1a8');
  gradient.addColorStop(1, '#5e5c55');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  const sides = 9;
  for (let side = 0; side <= sides; side += 1) {
    const angle = (side / sides) * Math.PI * 2;
    const wobble = 0.86 + 0.14 * Math.sin(side * 2.7 + rock.x * 0.01);
    const x = rock.x + Math.cos(angle) * rock.r * wobble;
    const y = rock.y + Math.sin(angle) * rock.r * wobble;
    if (side === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.fill();
  ctx.strokeStyle = 'rgba(40, 38, 34, .35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(rock.x - rock.r * 0.3, rock.y - rock.r * 0.1);
  ctx.lineTo(rock.x + rock.r * 0.1, rock.y + rock.r * 0.2);
  ctx.lineTo(rock.x + rock.r * 0.35, rock.y + rock.r * 0.05);
  ctx.stroke();
}

function drawWall(ctx: CanvasRenderingContext2D, wall: MapRect) {
  ctx.fillStyle = 'rgba(20, 24, 12, .32)';
  ctx.fillRect(wall.x + 6, wall.y + 7, wall.w, wall.h);
  const gradient = wall.w > wall.h
    ? ctx.createLinearGradient(0, wall.y, 0, wall.y + wall.h)
    : ctx.createLinearGradient(wall.x, 0, wall.x + wall.w, 0);
  gradient.addColorStop(0, '#c4c0b6');
  gradient.addColorStop(1, '#8b877e');
  ctx.fillStyle = gradient;
  ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
  ctx.strokeStyle = 'rgba(60, 58, 52, .45)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(wall.x + 0.5, wall.y + 0.5, wall.w - 1, wall.h - 1);
  ctx.beginPath();
  if (wall.w > wall.h) for (let x = wall.x + 40; x < wall.x + wall.w; x += 40) { ctx.moveTo(x, wall.y); ctx.lineTo(x, wall.y + wall.h); }
  else for (let y = wall.y + 40; y < wall.y + wall.h; y += 40) { ctx.moveTo(wall.x, y); ctx.lineTo(wall.x + wall.w, y); }
  ctx.stroke();
}

function drawBuilding(ctx: CanvasRenderingContext2D, building: MapRect) {
  ctx.fillStyle = 'rgba(20, 24, 12, .35)';
  ctx.fillRect(building.x + 12, building.y + 14, building.w, building.h);
  ctx.fillStyle = '#6f6253';
  ctx.fillRect(building.x, building.y, building.w, building.h);
  const inset = 7;
  const across = building.w >= building.h;
  const roof = across
    ? ctx.createLinearGradient(0, building.y, 0, building.y + building.h)
    : ctx.createLinearGradient(building.x, 0, building.x + building.w, 0);
  roof.addColorStop(0, '#b45a44');
  roof.addColorStop(0.5, '#8e3f2f');
  roof.addColorStop(0.51, '#7a3427');
  roof.addColorStop(1, '#a24d3a');
  ctx.fillStyle = roof;
  ctx.fillRect(building.x + inset, building.y + inset, building.w - inset * 2, building.h - inset * 2);
  ctx.strokeStyle = 'rgba(40, 20, 14, .4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (across) {
    for (let x = building.x + inset + 12; x < building.x + building.w - inset; x += 12) { ctx.moveTo(x, building.y + inset); ctx.lineTo(x, building.y + building.h - inset); }
  } else {
    for (let y = building.y + inset + 12; y < building.y + building.h - inset; y += 12) { ctx.moveTo(building.x + inset, y); ctx.lineTo(building.x + building.w - inset, y); }
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 220, 190, .35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (across) { ctx.moveTo(building.x + inset, building.y + building.h / 2); ctx.lineTo(building.x + building.w - inset, building.y + building.h / 2); }
  else { ctx.moveTo(building.x + building.w / 2, building.y + inset); ctx.lineTo(building.x + building.w / 2, building.y + building.h - inset); }
  ctx.stroke();
  ctx.fillStyle = '#4b4038';
  ctx.fillRect(building.x + building.w * 0.72, building.y + building.h * 0.2, 14, 14);
}

function drawCityWall(ctx: CanvasRenderingContext2D, wall: MapRect) {
  ctx.fillStyle = 'rgba(0, 0, 0, .4)';
  ctx.fillRect(wall.x + 5, wall.y + 6, wall.w, wall.h);
  const across = wall.w > wall.h;
  const gradient = across ? ctx.createLinearGradient(0, wall.y, 0, wall.y + wall.h) : ctx.createLinearGradient(wall.x, 0, wall.x + wall.w, 0);
  gradient.addColorStop(0, '#94a3b8');
  gradient.addColorStop(1, '#4b5563');
  ctx.fillStyle = gradient;
  ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(wall.x, wall.y, wall.w, wall.h);
  ctx.clip();
  ctx.fillStyle = 'rgba(250, 204, 21, .75)';
  const span = across ? wall.w : wall.h;
  for (let along = -20; along < span + 20; along += 28) {
    ctx.beginPath();
    if (across) {
      ctx.moveTo(wall.x + along, wall.y + wall.h);
      ctx.lineTo(wall.x + along + 12, wall.y + wall.h);
      ctx.lineTo(wall.x + along + 22, wall.y + wall.h - 6);
      ctx.lineTo(wall.x + along + 10, wall.y + wall.h - 6);
    } else {
      ctx.moveTo(wall.x + wall.w, wall.y + along);
      ctx.lineTo(wall.x + wall.w, wall.y + along + 12);
      ctx.lineTo(wall.x + wall.w - 6, wall.y + along + 22);
      ctx.lineTo(wall.x + wall.w - 6, wall.y + along + 10);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(15, 23, 42, .6)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(wall.x + 0.5, wall.y + 0.5, wall.w - 1, wall.h - 1);
  ctx.beginPath();
  if (across) for (let x = wall.x + 48; x < wall.x + wall.w; x += 48) { ctx.moveTo(x, wall.y); ctx.lineTo(x, wall.y + wall.h); }
  else for (let y = wall.y + 48; y < wall.y + wall.h; y += 48) { ctx.moveTo(wall.x, y); ctx.lineTo(wall.x + wall.w, y); }
  ctx.stroke();
}

function drawCityBuilding(ctx: CanvasRenderingContext2D, building: MapRect, time: number) {
  ctx.fillStyle = 'rgba(0, 0, 0, .5)';
  ctx.fillRect(building.x + 14, building.y + 16, building.w, building.h);
  ctx.fillStyle = '#0f1520';
  ctx.fillRect(building.x, building.y, building.w, building.h);
  const roof = ctx.createLinearGradient(building.x, building.y, building.x + building.w, building.y + building.h);
  roof.addColorStop(0, '#334155');
  roof.addColorStop(1, '#1e293b');
  ctx.fillStyle = roof;
  ctx.fillRect(building.x + 6, building.y + 6, building.w - 12, building.h - 12);
  ctx.strokeStyle = 'rgba(148, 163, 184, .25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(building.x + 14.5, building.y + 14.5, building.w - 29, building.h - 29);
  const seed = Math.abs(Math.round(building.x * 7 + building.y * 13));
  const units = 1 + (seed % 3);
  for (let unit = 0; unit < units; unit += 1) {
    const ux = building.x + 26 + ((seed >> (unit * 3)) % Math.max(1, Math.floor(building.w - 70)));
    const uy = building.y + 26 + ((seed >> (unit * 2 + 1)) % Math.max(1, Math.floor(building.h - 70)));
    ctx.fillStyle = '#475569';
    ctx.fillRect(ux, uy, 26, 20);
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(ux + 13, uy + 10, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(148, 163, 184, .5)';
    ctx.beginPath();
    const spin = time / 120 + unit;
    ctx.moveTo(ux + 13 + Math.cos(spin) * 6, uy + 10 + Math.sin(spin) * 6);
    ctx.lineTo(ux + 13 - Math.cos(spin) * 6, uy + 10 - Math.sin(spin) * 6);
    ctx.stroke();
  }
  const pulse = 0.55 + 0.45 * Math.sin(time / 700 + seed);
  ctx.fillStyle = seed % 2 ? `rgba(56, 189, 248, ${0.5 * pulse + 0.2})` : `rgba(167, 139, 250, ${0.5 * pulse + 0.2})`;
  if (building.w >= building.h) ctx.fillRect(building.x + 6, building.y + building.h - 9, building.w - 12, 3);
  else ctx.fillRect(building.x + building.w - 9, building.y + 6, 3, building.h - 12);
  ctx.fillStyle = `rgba(248, 113, 113, ${pulse})`;
  ctx.beginPath();
  ctx.arc(building.x + 12, building.y + 12, 2.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawBollard(ctx: CanvasRenderingContext2D, rock: MapCircle) {
  ctx.fillStyle = 'rgba(0, 0, 0, .4)';
  ctx.beginPath();
  ctx.ellipse(rock.x + 5, rock.y + 6, rock.r, rock.r * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();
  const gradient = ctx.createRadialGradient(rock.x - rock.r * 0.4, rock.y - rock.r * 0.4, 1, rock.x, rock.y, rock.r);
  gradient.addColorStop(0, '#cbd5e1');
  gradient.addColorStop(1, '#475569');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(rock.x, rock.y, rock.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(250, 204, 21, .8)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(rock.x, rock.y, rock.r * 0.62, 0, Math.PI * 2);
  ctx.stroke();
}

function drawPlanter(ctx: CanvasRenderingContext2D, tree: MapCircle, time: number) {
  ctx.fillStyle = 'rgba(0, 0, 0, .4)';
  ctx.beginPath();
  ctx.arc(tree.x + 6, tree.y + 8, tree.r + 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#334155';
  ctx.beginPath();
  ctx.roundRect(tree.x - tree.r - 6, tree.y - tree.r - 6, (tree.r + 6) * 2, (tree.r + 6) * 2, 8);
  ctx.fill();
  const sway = Math.sin(time / 900 + tree.x * 0.05) * 1;
  ctx.fillStyle = '#14532d';
  ctx.beginPath();
  ctx.arc(tree.x + sway, tree.y, tree.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#22c55e';
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.arc(tree.x - tree.r * 0.25 + sway, tree.y - tree.r * 0.25, tree.r * 0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawTree(ctx: CanvasRenderingContext2D, tree: MapCircle, time: number) {
  const sway = Math.sin(time / 900 + tree.x * 0.05) * 1.2;
  ctx.fillStyle = 'rgba(16, 28, 10, .35)';
  ctx.beginPath();
  ctx.ellipse(tree.x + 8, tree.y + 10, tree.r * 1.05, tree.r * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2d5326';
  ctx.beginPath();
  ctx.arc(tree.x + sway, tree.y, tree.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3e7234';
  ctx.beginPath();
  ctx.arc(tree.x - tree.r * 0.2 + sway, tree.y - tree.r * 0.2, tree.r * 0.72, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(122, 176, 88, .55)';
  ctx.beginPath();
  ctx.arc(tree.x - tree.r * 0.35 + sway, tree.y - tree.r * 0.35, tree.r * 0.32, 0, Math.PI * 2);
  ctx.fill();
}

function drawCastle(ctx: CanvasRenderingContext2D, castle: { team: Team; x: number; y: number; hp: number; max: number }, time: number) {
  const color = TEAM_COLORS[castle.team];
  const half = 82;
  const broken = castle.hp <= 0;
  ctx.save();
  ctx.translate(castle.x, castle.y);
  ctx.fillStyle = 'rgba(20, 24, 12, .35)';
  ctx.fillRect(-half + 12, -half + 14, half * 2, half * 2);
  if (broken) {
    ctx.fillStyle = '#4a4640';
    ctx.fillRect(-half, -half, half * 2, half * 2);
    ctx.fillStyle = '#6b665d';
    for (let index = 0; index < 26; index += 1) {
      const angle = index * 2.4;
      const distance = (index * 13) % half;
      ctx.fillRect(Math.cos(angle) * distance - 6, Math.sin(angle) * distance - 5, 12, 10);
    }
    ctx.restore();
    return;
  }
  const stone = ctx.createLinearGradient(-half, -half, half, half);
  stone.addColorStop(0, '#b9b3a6');
  stone.addColorStop(1, '#7f796d');
  ctx.fillStyle = stone;
  ctx.fillRect(-half, -half, half * 2, half * 2);
  ctx.fillStyle = '#9b958a';
  ctx.fillRect(-half + 16, -half + 16, half * 2 - 32, half * 2 - 32);
  ctx.fillStyle = '#6c665b';
  for (let step = -half; step < half; step += 16) {
    ctx.fillRect(step, -half - 5, 9, 7);
    ctx.fillRect(step, half - 2, 9, 7);
    ctx.fillRect(-half - 5, step, 7, 9);
    ctx.fillRect(half - 2, step, 7, 9);
  }
  ctx.fillStyle = '#5b554b';
  ctx.fillRect(castle.team === 'red' ? half - 6 : -half - 4, -18, 10, 36);
  for (const [cx, cy] of [[-half, -half], [half, -half], [-half, half], [half, half]] as const) {
    ctx.fillStyle = '#857f73';
    ctx.beginPath();
    ctx.arc(cx, cy, 28, 0, Math.PI * 2);
    ctx.fill();
    const roof = ctx.createRadialGradient(cx - 8, cy - 8, 2, cx, cy, 22);
    roof.addColorStop(0, color.tag);
    roof.addColorStop(1, color.hull[2]);
    ctx.fillStyle = roof;
    ctx.beginPath();
    ctx.arc(cx, cy, 21, 0, Math.PI * 2);
    ctx.fill();
  }
  const keep = ctx.createLinearGradient(-34, -34, 34, 34);
  keep.addColorStop(0, color.hull[1]);
  keep.addColorStop(1, color.hull[2]);
  ctx.fillStyle = '#6f695e';
  ctx.fillRect(-40, -40, 80, 80);
  ctx.fillStyle = keep;
  ctx.fillRect(-32, -32, 64, 64);
  ctx.strokeStyle = 'rgba(255, 255, 255, .25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-32, -32);
  ctx.lineTo(32, 32);
  ctx.moveTo(32, -32);
  ctx.lineTo(-32, 32);
  ctx.stroke();
  ctx.fillStyle = '#2b2b2b';
  ctx.fillRect(-1.5, -64, 3, 50);
  ctx.fillStyle = color.tag;
  ctx.beginPath();
  ctx.moveTo(1.5, -64);
  for (let step = 0; step <= 10; step += 1) {
    const x = 1.5 + step * 3.4;
    ctx.lineTo(x, -64 + Math.sin(time / 180 + step * 0.7) * 2.6);
  }
  for (let step = 10; step >= 0; step -= 1) {
    const x = 1.5 + step * 3.4;
    ctx.lineTo(x, -46 + Math.sin(time / 180 + step * 0.7) * 2.6);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  const width = 190;
  ctx.fillStyle = 'rgba(11, 18, 32, .78)';
  ctx.fillRect(castle.x - width / 2 - 2, castle.y - half - 46, width + 4, 22);
  ctx.fillStyle = 'rgba(255, 255, 255, .12)';
  ctx.fillRect(castle.x - width / 2, castle.y - half - 30, width, 5);
  ctx.fillStyle = color.tag;
  ctx.fillRect(castle.x - width / 2, castle.y - half - 30, width * Math.max(0, castle.hp / castle.max), 5);
  ctx.fillStyle = '#fff';
  ctx.font = '600 11px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${castle.team === 'red' ? 'Red' : 'Blue'} castle · ${Math.ceil(castle.hp)}`, castle.x, castle.y - half - 34);
}

function drawTank(ctx: CanvasRenderingContext2D, tank: Tank, mode: Mode, me: boolean, time: number) {
  const modern = mode === 'tdm' && tank.team ? CITY_COLORS[tank.team] : null;
  const palette = modern ?? (tank.team ? TEAM_COLORS[tank.team] : me ? SOLO_SELF : SOLO_OTHER);
  ctx.save();
  ctx.translate(tank.x, tank.y);
  if (!tank.alive) {
    ctx.rotate(tank.hull);
    ctx.fillStyle = 'rgba(0, 0, 0, .3)';
    ctx.beginPath();
    ctx.ellipse(0, 6, 32, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2b2a26';
    ctx.fillRect(-26, -16, 52, 32);
    ctx.fillStyle = '#3e3b34';
    ctx.beginPath();
    ctx.arc(-2, 0, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1a1916';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(4, 0);
    ctx.lineTo(22, 10);
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (modern) {
    const glow = ctx.createRadialGradient(0, 0, 10, 0, 0, 46);
    glow.addColorStop(0, modern.glow);
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 46, 0, Math.PI * 2);
    ctx.fill();
  }
  if (me) {
    ctx.strokeStyle = modern ? 'rgba(255, 255, 255, .7)' : 'rgba(134, 239, 172, .55)';
    ctx.lineWidth = 2;
    ctx.setLineDash(modern ? [6, 6] : []);
    ctx.lineDashOffset = modern ? -time / 40 : 0;
    ctx.beginPath();
    ctx.arc(0, 0, 36, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = 'rgba(30, 36, 18, .3)';
  ctx.beginPath();
  ctx.ellipse(4, 9, 31, 14, tank.hull, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(tank.hull);
  ctx.fillStyle = '#24281c';
  ctx.beginPath();
  ctx.roundRect(-29, -19, 58, 10, 3);
  ctx.roundRect(-29, 9, 58, 10, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, .45)';
  ctx.lineWidth = 1;
  const tread = (tank.trail * 0.6) % 6;
  ctx.beginPath();
  for (let x = -28 + tread; x < 28; x += 6) {
    ctx.moveTo(x, -19); ctx.lineTo(x, -9);
    ctx.moveTo(x, 9); ctx.lineTo(x, 19);
  }
  ctx.stroke();
  const hull = ctx.createLinearGradient(-22, -12, 22, 12);
  hull.addColorStop(0, palette.hull[0]);
  hull.addColorStop(0.55, palette.hull[1]);
  hull.addColorStop(1, palette.hull[2]);
  ctx.fillStyle = hull;
  ctx.beginPath();
  ctx.roundRect(-23, -12, 48, 24, 4);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, .16)';
  ctx.fillRect(12, -8, 10, 16);
  ctx.fillStyle = 'rgba(0, 0, 0, .25)';
  ctx.fillRect(-22, -4, 6, 8);
  if (modern) {
    ctx.fillStyle = modern.neon;
    ctx.fillRect(-20, -11, 40, 2);
    ctx.fillRect(-20, 9, 40, 2);
    ctx.fillRect(22, -6, 2.5, 12);
  }
  ctx.restore();

  ctx.save();
  ctx.translate(tank.x, tank.y);
  ctx.rotate(tank.turret);
  ctx.fillStyle = '#2c3322';
  ctx.fillRect(6 - tank.recoil, -2.6, 26, 5.2);
  ctx.fillRect(29 - tank.recoil, -3.6, 6, 7.2);
  ctx.fillStyle = palette.turret;
  ctx.beginPath();
  ctx.ellipse(-2, 0, 13, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, .14)';
  ctx.beginPath();
  ctx.ellipse(-5, -3, 6, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1d2216';
  ctx.beginPath();
  ctx.arc(-4, 0, 3.4, 0, Math.PI * 2);
  ctx.fill();
  if (tank.flash > 0) {
    ctx.fillStyle = 'rgba(255, 196, 92, .95)';
    ctx.beginPath();
    ctx.moveTo(35 - tank.recoil, -7);
    ctx.lineTo(50 - tank.recoil, 0);
    ctx.lineTo(35 - tank.recoil, 7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, .85)';
    ctx.beginPath();
    ctx.arc(38 - tank.recoil, 0, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  if (tank.shield) {
    const pulse = 0.5 + 0.5 * Math.sin(time / 120);
    const bubble = ctx.createRadialGradient(tank.x, tank.y, 20, tank.x, tank.y, 44);
    bubble.addColorStop(0, 'rgba(255, 255, 255, 0)');
    bubble.addColorStop(0.8, `rgba(186, 230, 253, ${0.12 + pulse * 0.1})`);
    bubble.addColorStop(1, `rgba(125, 211, 252, ${0.35 + pulse * 0.25})`);
    ctx.fillStyle = bubble;
    ctx.beginPath();
    ctx.arc(tank.x, tank.y, 44, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(224, 242, 254, ${0.5 + pulse * 0.4})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let side = 0; side <= 6; side += 1) {
      const angle = (side / 6) * Math.PI * 2 + time / 900;
      const x = tank.x + Math.cos(angle) * 44;
      const y = tank.y + Math.sin(angle) * 44;
      if (side === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  ctx.font = '600 11px Inter, sans-serif';
  ctx.textAlign = 'center';
  const label = me ? `${tank.callsign} (you)` : tank.callsign;
  const width = ctx.measureText(label).width + 12;
  ctx.fillStyle = 'rgba(11, 18, 32, .7)';
  ctx.beginPath();
  ctx.roundRect(tank.x - width / 2, tank.y - 52, width, 16, 8);
  ctx.fill();
  ctx.fillStyle = mode !== 'solo' || me ? palette.tag : '#f8fafc';
  ctx.fillText(label, tank.x, tank.y - 40);
  ctx.fillStyle = 'rgba(0, 0, 0, .5)';
  ctx.fillRect(tank.x - 18, tank.y - 33, 36, 4);
  ctx.fillStyle = tank.hp > 60 ? '#4ade80' : tank.hp > 30 ? '#facc15' : '#ef4444';
  ctx.fillRect(tank.x - 18, tank.y - 33, 36 * Math.max(0, tank.hp) / 100, 4);
  if (!tank.online) {
    ctx.fillStyle = 'rgba(255, 255, 255, .7)';
    ctx.font = '600 9px Inter, sans-serif';
    ctx.fillText('offline', tank.x, tank.y + 40);
  }
}

export function startBattle(canvas: HTMLCanvasElement, url: string, callbacks: Callbacks): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => undefined;
  const socket = new WebSocket(url);
  let init: InitMessage | null = null;
  let terrain: HTMLCanvasElement | null = null;
  let minimap: HTMLCanvasElement | null = null;
  let offset = 0;
  let finished = false;
  let disposed = false;
  const tanks = new Map<string, Tank>();
  let roster: Tank[] = [];
  let castles: Array<{ team: Team; x: number; y: number; hp: number; max: number }> = [];
  let score: Score = { red: 0, blue: 0 };
  let target = 0;
  let firstBlood = false;
  let announce: { text: string; sub: string; at: number; tone: 'good' | 'bad' | 'plain' } | null = null;
  const markers: Marker[] = [];
  const ripples: Ripple[] = [];
  const shells: Shell[] = [];
  const puffs: Puff[] = [];
  const scorches: Array<{ x: number; y: number; r: number }> = [];
  const feed: Feed[] = [];
  const keys = new Set<string>();
  const screen = { x: 0, y: 0, inside: false };
  const pointer = { x: 0, y: 0 };
  const camera = { x: 0, y: 0, ready: false };
  let firing = false;
  let lastFire = 0;
  let lastSend = 0;
  let shotCount = 0;
  let lastFrame = performance.now();
  let hudAt = 0;
  let frame = 0;
  const serverNow = () => Date.now() + offset;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(320, Math.floor(rect.width * ratio));
    canvas.height = Math.max(240, Math.floor(rect.height * ratio));
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  const addPuff = (x: number, y: number, kind: Puff['kind'], count: number, spread = 1) => {
    for (let index = 0; index < count; index += 1) {
      if (puffs.length > 600) puffs.shift();
      const angle = Math.random() * Math.PI * 2;
      const speed = (kind === 'smoke' ? 0.2 + Math.random() * 0.5 : kind === 'dust' ? 0.3 + Math.random() * 0.4 : 0.8 + Math.random() * 1.6) * spread;
      const life = kind === 'smoke' ? 60 + Math.random() * 30 : kind === 'dust' ? 28 : 18 + Math.random() * 10;
      puffs.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (kind === 'smoke' ? 0.3 : 0),
        life,
        max: life,
        radius: kind === 'smoke' ? 6 + Math.random() * 9 : kind === 'dust' ? 4 + Math.random() * 4 : 3 + Math.random() * 4,
        kind,
      });
    }
  };
  const explode = (x: number, y: number, big: boolean) => {
    addPuff(x, y, 'fire', big ? 26 : 6, big ? 1.6 : 0.8);
    addPuff(x, y, 'smoke', big ? 22 : 5, big ? 1.3 : 0.7);
    if (big) {
      scorches.push({ x, y, r: 34 + Math.random() * 10 });
      if (scorches.length > 80) scorches.shift();
    }
  };
  const pushFeed = (text: string, tone: Feed['tone']) => {
    feed.push({ text, at: performance.now(), tone });
    if (feed.length > 6) feed.shift();
  };
  const me = () => (init ? tanks.get(init.you) ?? null : null);

  const solidAt = (x: number, y: number, includeWater: boolean): boolean => {
    if (!init) return false;
    for (const rect of init.map.rects) if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) return true;
    for (const circle of init.map.circles) {
      if (circle.kind === 'water' && !includeWater) continue;
      if (Math.hypot(x - circle.x, y - circle.y) < circle.r) return true;
    }
    return false;
  };

  const resolve = (tank: Tank) => {
    if (!init) return;
    const map = init.map;
    for (let pass = 0; pass < 3; pass += 1) {
      for (const rect of map.rects) {
        const nx = Math.max(rect.x, Math.min(tank.x, rect.x + rect.w));
        const ny = Math.max(rect.y, Math.min(tank.y, rect.y + rect.h));
        const dx = tank.x - nx;
        const dy = tank.y - ny;
        const distance = Math.hypot(dx, dy);
        if (distance >= TANK_R) continue;
        if (distance > 0.001) {
          tank.x = nx + (dx / distance) * TANK_R;
          tank.y = ny + (dy / distance) * TANK_R;
        } else {
          const left = tank.x - rect.x;
          const right = rect.x + rect.w - tank.x;
          const top = tank.y - rect.y;
          const bottom = rect.y + rect.h - tank.y;
          const least = Math.min(left, right, top, bottom);
          if (least === left) tank.x = rect.x - TANK_R;
          else if (least === right) tank.x = rect.x + rect.w + TANK_R;
          else if (least === top) tank.y = rect.y - TANK_R;
          else tank.y = rect.y + rect.h + TANK_R;
        }
      }
      const round = [...map.circles.map(circle => ({ x: circle.x, y: circle.y, r: circle.r })), ...castles.map(castle => ({ x: castle.x, y: castle.y, r: 104 }))];
      for (const circle of round) {
        const dx = tank.x - circle.x;
        const dy = tank.y - circle.y;
        const distance = Math.hypot(dx, dy) || 0.001;
        const reach = circle.r + TANK_R;
        if (distance < reach) {
          tank.x = circle.x + (dx / distance) * reach;
          tank.y = circle.y + (dy / distance) * reach;
        }
      }
      for (const other of roster) {
        if (other === tank || !other.alive) continue;
        const dx = tank.x - other.x;
        const dy = tank.y - other.y;
        const distance = Math.hypot(dx, dy) || 0.001;
        if (distance < TANK_R * 2) {
          tank.x = other.x + (dx / distance) * TANK_R * 2;
          tank.y = other.y + (dy / distance) * TANK_R * 2;
        }
      }
      tank.x = Math.max(TANK_R + 10, Math.min(map.w - TANK_R - 10, tank.x));
      tank.y = Math.max(TANK_R + 10, Math.min(map.h - TANK_R - 10, tank.y));
    }
  };

  const fire = () => {
    const self = me();
    if (!init || !self?.alive || finished || serverNow() < init.startsAt) return;
    const now = performance.now();
    if (now - lastFire < FIRE_COOLDOWN_MS) return;
    lastFire = now;
    shotCount += 1;
    const id = `${init.you}-${shotCount}`;
    const angle = self.turret;
    const x = self.x + Math.cos(angle) * 40;
    const y = self.y + Math.sin(angle) * 40;
    shells.push({ id, x, y, vx: Math.cos(angle) * SHELL_SPEED, vy: Math.sin(angle) * SHELL_SPEED, life: SHELL_LIFE, owner: init.you, mine: true, team: self.team });
    self.shield = false;
    self.flash = 5;
    self.recoil = 6;
    addPuff(x, y, 'smoke', 3, 0.6);
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: 'fire', id, x, y, a: angle }));
  };

  socket.onmessage = event => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(String(event.data)) as Record<string, unknown>;
    } catch {
      return;
    }
    if (message.t === 'init') {
      init = message as unknown as InitMessage;
      offset = init.now - Date.now();
      terrain = renderTerrain(init.map);
      minimap = renderMinimap(init.map, 200);
      castles = init.castles.map(castle => ({ ...castle }));
      score = { red: init.score?.red ?? 0, blue: init.score?.blue ?? 0 };
      target = init.target ?? 0;
      firstBlood = score.red + score.blue > 0;
      tanks.clear();
      roster = init.roster.map(entry => {
        const tank: Tank = {
          pid: entry.pid, callsign: entry.callsign, team: entry.team,
          x: entry.x, y: entry.y, hull: entry.hull, turret: entry.turret,
          tx: entry.x, ty: entry.y, thull: entry.hull, tturret: entry.turret,
          hp: entry.hp, alive: entry.alive, online: true, flash: 0, recoil: 0,
          kills: entry.kills, taken: entry.taken, respawnAt: 0, trail: 0,
          shield: init!.room.mode === 'tdm', streak: 0,
        };
        tanks.set(entry.pid, tank);
        return tank;
      });
      camera.ready = false;
      return;
    }
    if (!init) return;
    if (message.t === 'snap') {
      const rows = message.tanks as number[][];
      offset = offset * 0.9 + (Number(message.now) - Date.now()) * 0.1;
      rows.forEach((row, index) => {
        const tank = roster[index];
        if (!tank) return;
        const [x = 0, y = 0, hull = 0, turret = 0, hp = 0, alive = 0, online = 0, shield = 0] = row;
        const wasAlive = tank.alive;
        tank.hp = hp;
        tank.alive = alive === 1;
        tank.online = online === 1;
        tank.shield = shield === 1;
        if (tank.pid === init!.you) {
          if (!wasAlive && tank.alive) { tank.x = x; tank.y = y; tank.hull = hull; }
          return;
        }
        if (!camera.ready || Math.hypot(tank.x - x, tank.y - y) > 300) { tank.x = x; tank.y = y; }
        tank.tx = x; tank.ty = y; tank.thull = hull; tank.tturret = turret;
      });
      const hp = message.castles as number[];
      hp.forEach((value, index) => { const castle = castles[index]; if (castle) castle.hp = value; });
      const tally = message.score as number[] | null;
      if (tally) score = { red: tally[0] ?? 0, blue: tally[1] ?? 0 };
      return;
    }
    if (message.t === 'fire') {
      const owner = tanks.get(String(message.by));
      const angle = Number(message.a);
      const x = Number(message.x);
      const y = Number(message.y);
      shells.push({ id: String(message.id), x, y, vx: Math.cos(angle) * SHELL_SPEED, vy: Math.sin(angle) * SHELL_SPEED, life: SHELL_LIFE, owner: String(message.by), mine: false, team: owner?.team ?? null });
      if (owner) { owner.flash = 5; owner.recoil = 6; owner.tturret = angle; owner.shield = false; }
      addPuff(x, y, 'smoke', 2, 0.6);
      return;
    }
    if (message.t === 'hit') {
      const target = tanks.get(String(message.target));
      const index = shells.findIndex(shell => shell.id === message.id);
      if (index >= 0) shells.splice(index, 1);
      if (target) {
        target.hp = Number(message.hp);
        explode(target.x, target.y, false);
        if (message.by === init.you && target.hp > 0) markers.push({ x: target.x, y: target.y, at: performance.now(), kill: false });
      }
      return;
    }
    if (message.t === 'shield') {
      const target = tanks.get(String(message.target));
      const index = shells.findIndex(shell => shell.id === message.id);
      if (index >= 0) shells.splice(index, 1);
      if (target) ripples.push({ x: target.x, y: target.y, at: performance.now() });
      return;
    }
    if (message.t === 'castle') {
      const castle = castles.find(item => item.team === message.team);
      const index = shells.findIndex(shell => shell.id === message.id);
      if (index >= 0) shells.splice(index, 1);
      if (castle) {
        castle.hp = Number(message.hp);
        explode(castle.x + (Math.random() - 0.5) * 120, castle.y + (Math.random() - 0.5) * 120, castle.hp <= 0);
        if (castle.hp <= 0) {
          for (let index2 = 0; index2 < 6; index2 += 1) explode(castle.x + (Math.random() - 0.5) * 160, castle.y + (Math.random() - 0.5) * 160, true);
          pushFeed(`${castle.team === 'red' ? 'Red' : 'Blue'} castle has fallen`, castle.team === init.roster.find(entry => entry.pid === init!.you)?.team ? 'bad' : 'good');
        }
      }
      return;
    }
    if (message.t === 'kill') {
      const victim = tanks.get(String(message.victim));
      const killer = message.by ? tanks.get(String(message.by)) : null;
      if (victim) {
        victim.alive = false;
        victim.hp = 0;
        victim.respawnAt = Number(message.respawnAt) || 0;
        explode(victim.x, victim.y, true);
      }
      if (killer) {
        killer.kills += 1;
        killer.taken += Number(message.bounty) || 0;
        killer.streak = Number(message.streak) || killer.streak + 1;
      }
      if (victim) victim.streak = 0;
      const bounty = Number(message.bounty) || 0;
      const mine = killer?.pid === init.you;
      const lost = victim?.pid === init.you;
      const tally = message.score as Score | null;
      if (tally) score = { red: tally.red, blue: tally.blue };
      if (mine && victim) markers.push({ x: victim.x, y: victim.y, at: performance.now(), kill: true });
      if (init.room.mode === 'tdm' && killer) {
        const myTeam = tanks.get(init.you)?.team;
        const tone = killer.team === myTeam ? 'good' : 'bad';
        const call = STREAK_CALLS[killer.streak];
        if (!firstBlood) announce = { text: 'First blood', sub: `${killer.callsign} opened the score`, at: performance.now(), tone };
        else if (call) announce = { text: call, sub: killer.callsign, at: performance.now(), tone };
        else if (mine) announce = { text: `Broke ${victim?.callsign ?? 'a tank'}`, sub: `+1 for ${killer.team === 'red' ? 'Red' : 'Blue'}`, at: performance.now(), tone: 'good' };
        firstBlood = true;
      }
      const text = killer
        ? `${killer.callsign} broke ${victim?.callsign ?? 'a tank'}${bounty ? ` · +${bounty} XRP` : ''}`
        : `${victim?.callsign ?? 'A tank'} left the field`;
      pushFeed(text, mine ? 'good' : lost ? 'bad' : 'plain');
      return;
    }
    if (message.t === 'spawn') {
      const tank = tanks.get(String(message.pid));
      if (tank) {
        tank.alive = true;
        tank.hp = 100;
        tank.respawnAt = 0;
        tank.x = tank.tx = Number(message.x);
        tank.y = tank.ty = Number(message.y);
        tank.hull = tank.thull = Number(message.hull);
        tank.turret = tank.tturret = tank.hull;
        tank.shield = Boolean(message.shield);
        addPuff(tank.x, tank.y, 'dust', 14, 1.2);
      }
      return;
    }
    if (message.t === 'warp') {
      const self = me();
      if (self) { self.x = Number(message.x); self.y = Number(message.y); }
      return;
    }
    if (message.t === 'end') {
      finished = true;
      const yourTeam = init.roster.find(entry => entry.pid === init!.you)?.team ?? null;
      callbacks.onEnd({
        winner: (message.winner as string | null) ?? null,
        mode: init.room.mode,
        score: (message.score as Score | null) ?? null,
        target,
        you: init.you,
        yourTeam,
        entry: init.room.entry,
        pot: init.room.pot,
        results: message.results as BattleResult['results'],
      });
    }
  };
  socket.onclose = event => {
    if (!finished && !disposed) callbacks.onDrop(event.reason || 'The battle connection closed.');
  };

  const toWorld = () => {
    pointer.x = screen.x + camera.x;
    pointer.y = screen.y + camera.y;
  };
  const onKey = (event: KeyboardEvent) => {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
    keys.add(event.code);
  };
  const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
  const onMove = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    screen.x = event.clientX - rect.left;
    screen.y = event.clientY - rect.top;
    screen.inside = true;
  };
  const onDown = (event: PointerEvent) => {
    onMove(event);
    firing = true;
    canvas.setPointerCapture?.(event.pointerId);
  };
  const onUp = () => { firing = false; };
  const onBlur = () => { keys.clear(); firing = false; };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp);

  const loop = (time: number) => {
    if (disposed) return;
    frame = window.requestAnimationFrame(loop);
    const dt = Math.min(3, (time - lastFrame) / 16.667);
    lastFrame = time;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = init?.map.theme === 'city' ? '#0b1220' : '#3d4a2a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!init || !terrain) {
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '600 16px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Joining the battle…', canvas.width / 2, canvas.height / 2);
      return;
    }
    const map = init.map;
    const city = map.theme === 'city';
    const tdm = init.room.mode === 'tdm';
    const now = serverNow();
    const started = now >= init.startsAt && !finished;
    const self = me();

    if (self?.alive && started) {
      let turn = 0;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) turn -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) turn += 1;
      self.hull = wrapAngle(self.hull + turn * 0.045 * dt);
      const forward = (keys.has('KeyW') || keys.has('ArrowUp') ? 2.6 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1.5 : 0);
      if (forward !== 0) {
        self.x += Math.cos(self.hull) * forward * dt;
        self.y += Math.sin(self.hull) * forward * dt;
        self.trail += Math.abs(forward) * dt;
        if (Math.random() < 0.18 * dt) addPuff(self.x - Math.cos(self.hull) * 28, self.y - Math.sin(self.hull) * 28, 'smoke', 1, 0.5);
        if (Math.random() < 0.25 * dt) addPuff(self.x - Math.cos(self.hull) * 20, self.y - Math.sin(self.hull) * 20, 'dust', 1, 0.6);
      } else if (turn !== 0) {
        self.trail += dt;
      }
      resolve(self);
      if (screen.inside) toWorld();
      const aim = Math.atan2(pointer.y - self.y, pointer.x - self.x);
      self.turret = self.turret + wrapAngle(aim - self.turret) * Math.min(1, 0.35 * dt);
      if (firing || keys.has('Space')) fire();
      if (time - lastSend > SEND_MS && socket.readyState === WebSocket.OPEN) {
        lastSend = time;
        socket.send(JSON.stringify({ t: 'pos', x: Math.round(self.x * 10) / 10, y: Math.round(self.y * 10) / 10, hull: Math.round(self.hull * 1000) / 1000, turret: Math.round(self.turret * 1000) / 1000 }));
      }
    }

    for (const tank of roster) {
      tank.flash = Math.max(0, tank.flash - dt);
      tank.recoil = Math.max(0, tank.recoil - 0.45 * dt);
      if (tank === self) continue;
      const lerp = Math.min(1, 0.22 * dt);
      const moved = Math.hypot(tank.tx - tank.x, tank.ty - tank.y);
      tank.x += (tank.tx - tank.x) * lerp;
      tank.y += (tank.ty - tank.y) * lerp;
      tank.hull += wrapAngle(tank.thull - tank.hull) * lerp;
      tank.turret += wrapAngle(tank.tturret - tank.turret) * lerp;
      if (moved > 1.5 && tank.alive) {
        tank.trail += moved * lerp;
        if (Math.random() < 0.12 * dt) addPuff(tank.x - Math.cos(tank.hull) * 28, tank.y - Math.sin(tank.hull) * 28, 'smoke', 1, 0.5);
      }
      if (!tank.alive && Math.random() < 0.06 * dt) addPuff(tank.x, tank.y, 'smoke', 1, 0.4);
    }
    if (self && !self.alive && Math.random() < 0.06 * dt) addPuff(self.x, self.y, 'smoke', 1, 0.4);
    for (const castle of castles) if (castle.hp <= 0 && Math.random() < 0.15 * dt) addPuff(castle.x + (Math.random() - 0.5) * 140, castle.y + (Math.random() - 0.5) * 140, 'smoke', 1, 0.5);
    for (const castle of castles) if (castle.hp > 0 && castle.hp < castle.max * 0.5 && Math.random() < 0.08 * dt) addPuff(castle.x + (Math.random() - 0.5) * 120, castle.y + (Math.random() - 0.5) * 120, 'smoke', 1, 0.4);

    for (let index = shells.length - 1; index >= 0; index -= 1) {
      const shell = shells[index];
      if (!shell) continue;
      let gone = false;
      const steps = 3;
      for (let step = 0; step < steps && !gone; step += 1) {
        shell.x += (shell.vx * dt) / steps;
        shell.y += (shell.vy * dt) / steps;
        if (shell.x < 0 || shell.y < 0 || shell.x > map.w || shell.y > map.h) { gone = true; break; }
        if (solidAt(shell.x, shell.y, false)) { explode(shell.x, shell.y, false); gone = true; break; }
        const shooter = tanks.get(shell.owner);
        for (const castle of castles) {
          if (castle.hp <= 0 || Math.hypot(shell.x - castle.x, shell.y - castle.y) > 100) continue;
          gone = true;
          if (shell.mine && shooter && castle.team !== shooter.team && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ t: 'hit', id: shell.id, target: `castle:${castle.team}` }));
          } else {
            explode(shell.x, shell.y, false);
          }
          break;
        }
        if (gone) break;
        for (const tank of roster) {
          if (!tank.alive || tank.pid === shell.owner) continue;
          if (init.room.mode !== 'solo' && shooter && tank.team === shooter.team) continue;
          if (Math.hypot(tank.x - shell.x, tank.y - shell.y) > TANK_R) continue;
          gone = true;
          if (shell.mine && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: 'hit', id: shell.id, target: tank.pid }));
          else explode(shell.x, shell.y, false);
          break;
        }
      }
      shell.life -= dt;
      if (gone || shell.life <= 0) {
        if (!gone) addPuff(shell.x, shell.y, 'dust', 4, 0.6);
      else if (city) addPuff(shell.x, shell.y, 'fire', 3, 0.7);
        shells.splice(index, 1);
      }
    }
    for (let index = puffs.length - 1; index >= 0; index -= 1) {
      const bit = puffs[index];
      if (!bit) continue;
      bit.x += bit.vx * dt;
      bit.y += bit.vy * dt;
      bit.vx *= 0.985;
      bit.vy *= 0.985;
      bit.life -= dt;
      if (bit.life <= 0) puffs.splice(index, 1);
    }

    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const viewW = canvas.width / scale;
    const viewH = canvas.height / scale;
    let focus = self ?? roster[0];
    if (self && !self.alive) {
      const alive = roster.filter(tank => tank.alive && (init!.room.mode === 'solo' || tank.team === self.team));
      if (tdm) focus = self;
      if (self.respawnAt === 0 && alive.length) focus = alive[0];
    }
    const fx = focus?.x ?? map.w / 2;
    const fy = focus?.y ?? map.h / 2;
    const targetX = map.w <= viewW ? (map.w - viewW) / 2 : Math.max(0, Math.min(map.w - viewW, fx - viewW / 2));
    const targetY = map.h <= viewH ? (map.h - viewH) / 2 : Math.max(0, Math.min(map.h - viewH, fy - viewH / 2));
    if (!camera.ready) { camera.x = targetX; camera.y = targetY; camera.ready = true; }
    else { camera.x += (targetX - camera.x) * Math.min(1, 0.18 * dt); camera.y += (targetY - camera.y) * Math.min(1, 0.18 * dt); }

    ctx.setTransform(scale, 0, 0, scale, -camera.x * scale, -camera.y * scale);
    const sx = Math.max(0, camera.x);
    const sy = Math.max(0, camera.y);
    const sw = Math.min(map.w - sx, viewW);
    const sh = Math.min(map.h - sy, viewH);
    if (sw > 0 && sh > 0) ctx.drawImage(terrain, sx * TERRAIN_SCALE, sy * TERRAIN_SCALE, sw * TERRAIN_SCALE, sh * TERRAIN_SCALE, sx, sy, sw, sh);
    for (const mark of scorches) {
      const gradient = ctx.createRadialGradient(mark.x, mark.y, 0, mark.x, mark.y, mark.r);
      gradient.addColorStop(0, city ? 'rgba(0, 0, 0, .6)' : 'rgba(20, 16, 10, .55)');
      gradient.addColorStop(1, city ? 'rgba(0, 0, 0, 0)' : 'rgba(20, 16, 10, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(mark.x, mark.y, mark.r, 0, Math.PI * 2);
      ctx.fill();
    }
    const inView = (x: number, y: number, r: number) => x + r > camera.x && x - r < camera.x + viewW && y + r > camera.y && y - r < camera.y + viewH;
    for (const rect of map.rects) {
      if (!inView(rect.x + rect.w / 2, rect.y + rect.h / 2, Math.max(rect.w, rect.h))) continue;
      if (city) {
        if (rect.kind === 'wall') drawCityWall(ctx, rect);
        else drawCityBuilding(ctx, rect, time);
      } else if (rect.kind === 'wall') drawWall(ctx, rect);
      else drawBuilding(ctx, rect);
    }
    for (const circle of map.circles) if (circle.kind === 'rock' && inView(circle.x, circle.y, circle.r + 10)) (city ? drawBollard : drawRock)(ctx, circle);
    for (const castle of castles) if (inView(castle.x, castle.y, 200)) drawCastle(ctx, castle, time);
    for (const tank of roster) if (!tank.alive && inView(tank.x, tank.y, 60)) drawTank(ctx, tank, init.room.mode, tank === self, time);
    for (const tank of roster) if (tank.alive && inView(tank.x, tank.y, 80)) drawTank(ctx, tank, init.room.mode, tank === self, time);
    for (const shell of shells) {
      if (!inView(shell.x, shell.y, 20)) continue;
      const angle = Math.atan2(shell.vy, shell.vx);
      if (tdm && shell.team) {
        const neon = CITY_COLORS[shell.team];
        const trail = ctx.createLinearGradient(shell.x - Math.cos(angle) * 44, shell.y - Math.sin(angle) * 44, shell.x, shell.y);
        trail.addColorStop(0, 'rgba(0, 0, 0, 0)');
        trail.addColorStop(1, neon.neon);
        ctx.save();
        ctx.shadowColor = neon.neon;
        ctx.shadowBlur = 12;
        ctx.strokeStyle = trail;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(shell.x - Math.cos(angle) * 44, shell.y - Math.sin(angle) * 44);
        ctx.lineTo(shell.x, shell.y);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(shell.x, shell.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        continue;
      }
      const tail = ctx.createLinearGradient(shell.x - Math.cos(angle) * 26, shell.y - Math.sin(angle) * 26, shell.x, shell.y);
      tail.addColorStop(0, 'rgba(255, 220, 140, 0)');
      tail.addColorStop(1, 'rgba(255, 230, 160, .9)');
      ctx.strokeStyle = tail;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(shell.x - Math.cos(angle) * 26, shell.y - Math.sin(angle) * 26);
      ctx.lineTo(shell.x, shell.y);
      ctx.stroke();
      ctx.fillStyle = '#fff7d6';
      ctx.beginPath();
      ctx.arc(shell.x, shell.y, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const bit of puffs) {
      if (!inView(bit.x, bit.y, 30)) continue;
      const fade = Math.max(0, bit.life / bit.max);
      if (bit.kind === 'fire') {
        ctx.globalAlpha = fade;
        ctx.fillStyle = fade > 0.5 ? '#ffd27a' : '#f0743a';
      } else if (bit.kind === 'dust') {
        ctx.globalAlpha = fade * 0.45;
        ctx.fillStyle = city ? '#94a3b8' : '#b9a47c';
      } else {
        ctx.globalAlpha = fade * (city ? 0.32 : 0.42);
        ctx.fillStyle = city ? '#9aa6b8' : '#d6d2c8';
      }
      ctx.beginPath();
      ctx.arc(bit.x, bit.y, bit.radius * (bit.kind === 'smoke' ? 1.8 - fade : 1), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (const circle of map.circles) if (circle.kind === 'tree' && inView(circle.x, circle.y, circle.r + 12)) (city ? drawPlanter : drawTree)(ctx, circle, time);
    const clock = performance.now();
    for (let index = ripples.length - 1; index >= 0; index -= 1) {
      const ripple = ripples[index]!;
      const age = (clock - ripple.at) / 400;
      if (age >= 1) { ripples.splice(index, 1); continue; }
      ctx.strokeStyle = `rgba(186, 230, 253, ${1 - age})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, 40 + age * 22, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let index = markers.length - 1; index >= 0; index -= 1) {
      const marker = markers[index]!;
      const age = (clock - marker.at) / (marker.kill ? 650 : 320);
      if (age >= 1) { markers.splice(index, 1); continue; }
      const size = (marker.kill ? 16 : 10) + age * 6;
      ctx.strokeStyle = marker.kill ? `rgba(248, 113, 113, ${1 - age})` : `rgba(255, 255, 255, ${1 - age})`;
      ctx.lineWidth = marker.kill ? 3.5 : 2.5;
      ctx.beginPath();
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        ctx.moveTo(marker.x + dx * size * 0.45, marker.y + dy * size * 0.45);
        ctx.lineTo(marker.x + dx * size, marker.y + dy * size);
      }
      ctx.stroke();
    }
    if (self?.alive && started && screen.inside) {
      ctx.strokeStyle = 'rgba(255, 255, 255, .9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, 11, 0, Math.PI * 2);
      ctx.moveTo(pointer.x - 18, pointer.y); ctx.lineTo(pointer.x - 6, pointer.y);
      ctx.moveTo(pointer.x + 6, pointer.y); ctx.lineTo(pointer.x + 18, pointer.y);
      ctx.moveTo(pointer.x, pointer.y - 18); ctx.lineTo(pointer.x, pointer.y - 6);
      ctx.moveTo(pointer.x, pointer.y + 6); ctx.lineTo(pointer.x, pointer.y + 18);
      ctx.stroke();
      const reload = Math.min(1, (performance.now() - lastFire) / FIRE_COOLDOWN_MS);
      if (reload < 1) {
        ctx.strokeStyle = 'rgba(134, 239, 172, .9)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(pointer.x, pointer.y, 15, -Math.PI / 2, -Math.PI / 2 + reload * Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (minimap) {
      const mw = minimap.width * scale * 0.9;
      const mh = minimap.height * scale * 0.9;
      const mx = canvas.width - mw - 12 * scale;
      const my = 12 * scale;
      ctx.fillStyle = 'rgba(11, 18, 32, .75)';
      ctx.fillRect(mx - 4 * scale, my - 4 * scale, mw + 8 * scale, mh + 8 * scale);
      ctx.globalAlpha = 0.92;
      ctx.drawImage(minimap, mx, my, mw, mh);
      ctx.globalAlpha = 1;
      const ms = mw / map.w;
      for (const castle of castles) {
        ctx.fillStyle = castle.hp > 0 ? TEAM_COLORS[castle.team].tag : '#6b7280';
        ctx.fillRect(mx + castle.x * ms - 4 * scale, my + castle.y * ms - 4 * scale, 8 * scale, 8 * scale);
      }
      for (const tank of roster) {
        if (!tank.alive) continue;
        const color = tank === self ? '#ffffff' : tank.team ? TEAM_COLORS[tank.team].tag : '#fcd34d';
        const size = (tank === self ? 4 : 2.6) * scale;
        ctx.fillStyle = color;
        ctx.fillRect(mx + tank.x * ms - size / 2, my + tank.y * ms - size / 2, size, size);
      }
      ctx.strokeStyle = 'rgba(255, 255, 255, .6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(mx + camera.x * ms, my + camera.y * ms, viewW * ms, viewH * ms);
    }
    ctx.textAlign = 'left';
    ctx.font = `600 ${12 * scale}px Inter, sans-serif`;
    const nowLocal = performance.now();
    let row = 0;
    for (const line of feed) {
      const age = nowLocal - line.at;
      if (age > 7000) continue;
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, age - 5500) / 1500);
      const text = line.text;
      const width = ctx.measureText(text).width + 16 * scale;
      ctx.fillStyle = 'rgba(11, 18, 32, .72)';
      ctx.fillRect(12 * scale, (12 + row * 24) * scale, width, 20 * scale);
      ctx.fillStyle = line.tone === 'good' ? '#86efac' : line.tone === 'bad' ? '#fca5a5' : '#f1f5f9';
      ctx.fillText(text, 20 * scale, (26 + row * 24) * scale);
      row += 1;
    }
    ctx.globalAlpha = 1;
    if (tdm) {
      const myTeam = self?.team ?? 'red';
      const cx = canvas.width / 2;
      const top = 12 * scale;
      const half = 132 * scale;
      const barH = 40 * scale;
      ctx.fillStyle = 'rgba(11, 18, 32, .82)';
      ctx.beginPath();
      ctx.roundRect(cx - half - 50 * scale, top, (half + 50 * scale) * 2, barH, 12 * scale);
      ctx.fill();
      const left = timeText(Math.max(0, Math.ceil((init.endsAt - Math.max(now, init.startsAt)) / 1000)));
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.roundRect(cx - 38 * scale, top + 5 * scale, 76 * scale, barH - 10 * scale, 8 * scale);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#e2e8f0';
      ctx.font = `600 ${13 * scale}px "IBM Plex Mono", monospace`;
      ctx.fillText(left, cx, top + 20 * scale);
      ctx.fillStyle = '#94a3b8';
      ctx.font = `600 ${8.5 * scale}px Inter, sans-serif`;
      ctx.fillText(`FIRST TO ${target}`, cx, top + 31 * scale);
      for (const side of ['red', 'blue'] as const) {
        const neon = CITY_COLORS[side];
        const dir = side === 'red' ? -1 : 1;
        const value = score[side];
        const share = target ? Math.min(1, value / target) : 0;
        const trackX = side === 'red' ? cx - 46 * scale - 120 * scale : cx + 46 * scale;
        ctx.fillStyle = 'rgba(148, 163, 184, .18)';
        ctx.fillRect(trackX, top + barH - 11 * scale, 120 * scale, 4 * scale);
        ctx.save();
        ctx.shadowColor = neon.neon;
        ctx.shadowBlur = 10 * scale;
        ctx.fillStyle = neon.neon;
        if (side === 'red') ctx.fillRect(trackX + 120 * scale * (1 - share), top + barH - 11 * scale, 120 * scale * share, 4 * scale);
        else ctx.fillRect(trackX, top + barH - 11 * scale, 120 * scale * share, 4 * scale);
        ctx.restore();
        ctx.font = `700 ${20 * scale}px Outfit, Inter, sans-serif`;
        ctx.fillStyle = neon.tag;
        ctx.textAlign = side === 'red' ? 'right' : 'left';
        ctx.fillText(String(value), cx + dir * 54 * scale, top + 24 * scale);
        ctx.font = `700 ${9 * scale}px Inter, sans-serif`;
        ctx.fillStyle = side === myTeam ? '#ffffff' : '#94a3b8';
        ctx.textAlign = side === 'red' ? 'left' : 'right';
        ctx.fillText(side === myTeam ? `${side.toUpperCase()} · YOU` : side.toUpperCase(), cx + dir * (half + 38 * scale), top + 18 * scale);
      }
      if (announce) {
        const age = (performance.now() - announce.at) / 2200;
        if (age >= 1) announce = null;
        else {
          const pop = Math.min(1, age * 8);
          ctx.globalAlpha = Math.min(1, (1 - age) * 3);
          ctx.textAlign = 'center';
          ctx.font = `800 ${(26 + (1 - pop) * 14) * scale}px Outfit, Inter, sans-serif`;
          ctx.save();
          ctx.shadowColor = announce.tone === 'good' ? '#22c55e' : announce.tone === 'bad' ? '#ef4444' : '#38bdf8';
          ctx.shadowBlur = 18 * scale;
          ctx.fillStyle = '#ffffff';
          ctx.fillText(announce.text.toUpperCase(), cx, top + barH + 46 * scale);
          ctx.restore();
          ctx.font = `600 ${12 * scale}px Inter, sans-serif`;
          ctx.fillStyle = '#cbd5e1';
          ctx.fillText(announce.sub, cx, top + barH + 66 * scale);
          ctx.globalAlpha = 1;
        }
      }
    }
    const countdown = Math.ceil((init.startsAt - now) / 1000);
    if (countdown > 0 && !finished) {
      ctx.fillStyle = 'rgba(11, 18, 32, .45)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${72 * scale}px Outfit, Inter, sans-serif`;
      ctx.fillText(String(countdown), canvas.width / 2, canvas.height / 2);
      ctx.font = `600 ${14 * scale}px Inter, sans-serif`;
      ctx.fillText(tdm ? `Team deathmatch. First side to ${target} breaks wins.` : init.room.mode === 'team' ? 'Break the enemy castle. Guard your own.' : 'Last tank running wins. Each break pays the entry.', canvas.width / 2, canvas.height / 2 + 34 * scale);
    }
    if (self && !self.alive && !finished) {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(11, 18, 32, .6)';
      ctx.fillRect(canvas.width / 2 - 170 * scale, canvas.height - 70 * scale, 340 * scale, 44 * scale);
      ctx.fillStyle = '#fff';
      ctx.font = `600 ${14 * scale}px Inter, sans-serif`;
      const wait = self.respawnAt ? Math.max(0, Math.ceil((self.respawnAt - now) / 1000)) : 0;
      ctx.fillText(self.respawnAt ? `Your tank broke. Back ${tdm ? 'at base' : 'at the castle'} in ${wait}s` : 'Your tank broke. Watching the field.', canvas.width / 2, canvas.height - 43 * scale);
    }

    if (time - hudAt > 200) {
      hudAt = time;
      const myTeam = self?.team ?? null;
      callbacks.onHud({
        hp: Math.max(0, self?.hp ?? 0),
        alive: Boolean(self?.alive),
        kills: self?.kills ?? 0,
        taken: self?.taken ?? 0,
        enemies: roster.filter(tank => tank.alive && tank !== self && (init!.room.mode === 'solo' || tank.team !== myTeam)).length,
        allies: roster.filter(tank => tank.alive && tank !== self && init!.room.mode !== 'solo' && tank.team === myTeam).length,
        timeLeft: Math.max(0, Math.ceil((init.endsAt - now) / 1000)),
        countdown: Math.max(0, countdown),
        respawnIn: self?.respawnAt ? Math.max(0, Math.ceil((self.respawnAt - now) / 1000)) : 0,
        castles: castles.map(castle => ({ team: castle.team, hp: castle.hp, max: castle.max })),
        mode: init.room.mode,
        team: myTeam,
        connected: socket.readyState === WebSocket.OPEN,
        score: tdm ? { ...score } : null,
        target,
        streak: self?.streak ?? 0,
      });
    }
  };
  frame = window.requestAnimationFrame(loop);

  return () => {
    disposed = true;
    window.cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointerup', onUp);
    socket.close();
  };
}
