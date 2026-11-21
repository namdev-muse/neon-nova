// Neon Nova v0.1.0 — pure simulation core (no DOM, no Three.js).
// The ship flies freely in a bounded neon arena (angled top-down view);
// the player moves with WASD/arrows (momentum), aims with the mouse,
// fires to destroy waves of enemies, and dashes (Shift) through danger
// with a cooldown + brief invulnerability. Enemies: chasers, shooters,
// splitters (which burst into two minis). The run ends when the wave
// set is cleared (all waves) or the ship loses all 3 shields.
// Deterministic: every wave set is built from a fixed seed, and the
// fixed-step simulation gives identical results for identical inputs.
//
// Anti-slop: no auto-aim, no auto-fire, no assist of any kind. The
// bot plays through the same stepRun + public input hooks, and must
// move AND aim with real decisions; sitting still and holding fire
// fails every wave set (see simulateRun + the bot harness).

export const VERSION = '0.1.0';
export const ARENA_HALF_X = 34;
export const ARENA_HALF_Z = 20;
export const SHIP_RADIUS = 0.9;
export const SHIELDS = 3;
export const DT = 1 / 60;
export const MOVE_ACCEL = 46; // lateral accel at full input
export const MOVE_DAMPING = 2.6; // velocity damping /s
export const MAX_SPEED = 23;
export const FIRE_INTERVAL = 0.20; // seconds between shots
export const BULLET_SPEED = 38;
export const BULLET_RADIUS = 0.35;
export const BULLET_LIFE = 1.4;
export const ENEMY_BULLET_SPEED = 15;
export const ENEMY_BULLET_RADIUS = 0.35;
export const DASH_COOLDOWN = 2.2;
export const DASH_DURATION = 0.18;
export const DASH_SPEED = 55;
export const DASH_INVULN = 0.4;
export const STUN_SECONDS = 0.6;
export const INVULN_SECONDS = 1.5;
export const COMBO_WINDOW = 3.5; // seconds without a kill before the combo resets
export const COMBO_STEP = 0.1; // +10% score per combo kill, capped
export const COMBO_CAP = 30; // combo count at which the multiplier caps (x4)
export const WAVE_BREATHER = 1.5; // seconds between waves
export const WAVE_CLEAR_SCORE = 250;
export const SET_CLEAR_SCORE = 1000;
export const PICKUP_SCORE = 25;
export const SPAWN_IN_SECONDS = 0.4; // enemies materialise (harmless) before they can fight
export const SAVE_VERSION = 1;

// --- seeded RNG (mulberry32) ---
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// --- feedback tiers (game-feel skill: small 0.10-0.20 / no stop,
// medium 0.30-0.50 / 0.04-0.06s, large 0.70-1.00 / 0.10-0.15s) ---
export const FEEDBACK_TIERS = {
  small: { traumaMin: 0.10, traumaMax: 0.20, stopMin: 0, stopMax: 0 },
  medium: { traumaMin: 0.30, traumaMax: 0.50, stopMin: 0.04, stopMax: 0.06 },
  large: { traumaMin: 0.70, traumaMax: 1.00, stopMin: 0.10, stopMax: 0.15 },
};
export const FEEDBACK = {
  launch: { tier: 'small', trauma: 0.12, hitStop: 0 },
  shoot: { tier: 'small', trauma: 0.10, hitStop: 0 },
  kill: { tier: 'small', trauma: 0.15, hitStop: 0 },
  pickup: { tier: 'small', trauma: 0.12, hitStop: 0 },
  dash: { tier: 'small', trauma: 0.12, hitStop: 0 },
  waveClear: { tier: 'medium', trauma: 0.40, hitStop: 0.05 },
  hit: { tier: 'medium', trauma: 0.45, hitStop: 0.05 },
  setComplete: { tier: 'medium', trauma: 0.40, hitStop: 0.05 },
  runOver: { tier: 'large', trauma: 0.90, hitStop: 0.12 },
};

// --- feedback layers (game-feel skill: one satisfying event is 5-8
// tiny responses firing together within ~100ms: sound, particles,
// shake, flash, knockback, hit-stop, slow-mo, FOV pulse, number pop.
// This is the contract game.js implements per event; the smoke test
// asserts every event carries at least 5 layers, and the render check
// asserts the layers actually fire in the browser. ---
export const FEEDBACK_LAYERS = {
  launch: ['sound', 'shake', 'fovPulse', 'particles', 'glowPulse'],
  shoot: ['sound', 'particles', 'shake', 'glowPulse', 'pop'],
  kill: ['sound', 'particles', 'shake', 'pop', 'glowPulse', 'ringPulse'],
  pickup: ['sound', 'particles', 'shake', 'pop', 'glowPulse'],
  dash: ['sound', 'particles', 'shake', 'fovPulse', 'glowPulse'],
  waveClear: ['sound', 'particles', 'shake', 'hitStop', 'pop', 'toast', 'fovPulse'],
  hit: ['sound', 'particles', 'shake', 'hitStop', 'flash', 'knockback', 'squash', 'toast'],
  setComplete: ['sound', 'particles', 'shake', 'hitStop', 'fovPulse', 'pop', 'toast'],
  runOver: ['sound', 'particles', 'shake', 'hitStop', 'flash', 'knockback', 'squash', 'toast'],
};

// --- enemies ---
// chaser  — flies straight at the ship, 1 hp, fast.
// shooter — keeps its distance, fires aimed bolts, 2 hp.
// splitter— chases slowly, 2 hp, bursts into two minis on death.
// mini    — fast little chaser, 1 hp, spawned by splitters only.
export const ENEMY_DEFS = {
  chaser: { hp: 1, speed: 13.5, accel: 38, r: 1.0, score: 100, dropChance: 0.3 },
  shooter: { hp: 2, speed: 6, accel: 22, r: 1.1, score: 150, dropChance: 0.5, fireInterval: 1.9, keepRange: 14 },
  splitter: { hp: 2, speed: 6.5, accel: 24, r: 1.5, score: 200, dropChance: 0.5 },
  mini: { hp: 1, speed: 14.5, accel: 40, r: 0.6, score: 50, dropChance: 0.15 },
};

// --- wave sets ---
// A wave set is a hand-authored list of waves. Each wave is a list of
// spawn groups: { type, count, delay } — the group spawns `count`
// enemies at once, `delay` seconds after the wave starts, on a ring
// 14-18 units from the ship (never on top of the player).
// Groups that arrive together from different directions are what make
// a wave un-clearable by sitting still: the ship's fire can only point
// one way, and chasers close from every side at once.
export const WAVE_SETS = [
  {
    id: 1, name: 'First Contact', seed: 101,
    hint: 'Move, aim, fire. The chasers come from every side — never stand still.',
    theme: { ring: '#22d3ee', glow: '#0e7490', accent: '#f472b6', disc: '#0b1030', tint: '#67e8f9' },
    waves: [
      { groups: [{ type: 'chaser', count: 6, delay: 0 }, { type: 'chaser', count: 5, delay: 1.5 }] },
      { groups: [{ type: 'chaser', count: 6, delay: 0 }, { type: 'chaser', count: 6, delay: 1.5 }] },
      { groups: [{ type: 'chaser', count: 6, delay: 0 }, { type: 'shooter', count: 2, delay: 1 }, { type: 'chaser', count: 5, delay: 2 }] },
      { groups: [{ type: 'chaser', count: 7, delay: 0 }, { type: 'shooter', count: 3, delay: 1.5 }, { type: 'chaser', count: 5, delay: 2.5 }] },
    ],
  },
  {
    id: 2, name: 'Crossfire', seed: 202,
    hint: 'Shooters hold their distance and fire bolts. Close the gap — or dash through it.',
    theme: { ring: '#f472b6', glow: '#9d174d', accent: '#22d3ee', disc: '#1c0616', tint: '#f9a8d4' },
    waves: [
      { groups: [{ type: 'shooter', count: 2, delay: 0 }, { type: 'chaser', count: 4, delay: 1 }] },
      { groups: [{ type: 'shooter', count: 3, delay: 0 }, { type: 'chaser', count: 5, delay: 1.5 }] },
      { groups: [{ type: 'chaser', count: 5, delay: 0 }, { type: 'shooter', count: 3, delay: 1.5 }, { type: 'chaser', count: 5, delay: 3 }] },
      { groups: [{ type: 'shooter', count: 6, delay: 0 }, { type: 'chaser', count: 6, delay: 2 }, { type: 'chaser', count: 8, delay: 3.5 }] },
    ],
  },
  {
    id: 3, name: 'Split Decision', seed: 303,
    hint: 'Splitters burst into minis when they die. Kill them where you have room to run.',
    theme: { ring: '#fbbf24', glow: '#b45309', accent: '#22d3ee', disc: '#1c1206', tint: '#fde68a' },
    waves: [
      { groups: [{ type: 'splitter', count: 1, delay: 0 }, { type: 'chaser', count: 6, delay: 1 }] },
      { groups: [{ type: 'splitter', count: 2, delay: 0 }, { type: 'chaser', count: 8, delay: 1.5 }] },
      { groups: [{ type: 'splitter', count: 2, delay: 0 }, { type: 'shooter', count: 4, delay: 1.5 }, { type: 'chaser', count: 7, delay: 3 }] },
      { groups: [{ type: 'splitter', count: 3, delay: 0 }, { type: 'chaser', count: 11, delay: 2 }, { type: 'shooter', count: 6, delay: 3.5 }] },
    ],
  },
  {
    id: 4, name: 'Pincer', seed: 404,
    hint: 'Everything at once, from both flanks. Keep moving — the arena is yours to use.',
    theme: { ring: '#a78bfa', glow: '#6d28d9', accent: '#f472b6', disc: '#150b30', tint: '#c4b5fd' },
    waves: [
      { groups: [{ type: 'chaser', count: 4, delay: 0 }, { type: 'shooter', count: 3, delay: 1 }] },
      { groups: [{ type: 'splitter', count: 2, delay: 0 }, { type: 'chaser', count: 6, delay: 1.5 }, { type: 'shooter', count: 4, delay: 3 }] },
      { groups: [{ type: 'chaser', count: 6, delay: 0 }, { type: 'shooter', count: 5, delay: 1.5 }, { type: 'chaser', count: 6, delay: 3 }] },
      { groups: [{ type: 'splitter', count: 3, delay: 0 }, { type: 'chaser', count: 10, delay: 2 }, { type: 'shooter', count: 7, delay: 3.5 }] },
    ],
  },
  {
    id: 5, name: 'Swarm Tide', seed: 505,
    hint: 'The tide does not stop. Thin the swarm, chain the combo, dash out of the crush.',
    theme: { ring: '#2dd4bf', glow: '#0f766e', accent: '#a78bfa', disc: '#06231f', tint: '#99f6e4' },
    waves: [
      { groups: [{ type: 'chaser', count: 10, delay: 0 }] },
      { groups: [{ type: 'chaser', count: 8, delay: 0 }, { type: 'splitter', count: 2, delay: 1.5 }] },
      { groups: [{ type: 'chaser', count: 9, delay: 0 }, { type: 'shooter', count: 5, delay: 2 }] },
      { groups: [{ type: 'chaser', count: 10, delay: 0 }, { type: 'splitter', count: 3, delay: 1.5 }, { type: 'shooter', count: 4, delay: 3 }] },
      { groups: [{ type: 'chaser', count: 9, delay: 0 }, { type: 'splitter', count: 2, delay: 2 }] },
    ],
  },
  {
    id: 6, name: 'Nova Gauntlet', seed: 606,
    hint: 'Everything you learned, all at once. Earn the nova.',
    theme: { ring: '#f8fafc', glow: '#7c3aed', accent: '#fbbf24', disc: '#12081f', tint: '#e9d5ff' },
    waves: [
      { groups: [{ type: 'chaser', count: 5, delay: 0 }, { type: 'shooter', count: 3, delay: 1 }, { type: 'splitter', count: 1, delay: 2 }] },
      { groups: [{ type: 'chaser', count: 6, delay: 0 }, { type: 'splitter', count: 3, delay: 1.5 }, { type: 'shooter', count: 4, delay: 3 }] },
      { groups: [{ type: 'chaser', count: 7, delay: 0 }, { type: 'shooter', count: 4, delay: 2 }, { type: 'splitter', count: 3, delay: 3.5 }] },
      { groups: [{ type: 'chaser', count: 8, delay: 0 }, { type: 'splitter', count: 4, delay: 1.5 }, { type: 'shooter', count: 5, delay: 3 }] },
      { groups: [{ type: 'chaser', count: 9, delay: 0 }, { type: 'splitter', count: 4, delay: 2 }, { type: 'shooter', count: 4, delay: 3.5 }] },
    ],
  },
];

export function waveSetById(id) {
  return WAVE_SETS.find((s) => s.id === id) || null;
}

export function totalEnemiesInSet(set) {
  let n = 0;
  for (const w of set.waves) for (const g of w.groups) n += g.count;
  return n;
}

// Threat weight: a shooter pressures from range, a splitter is three
// enemies in one (itself + two minis). The campaign curve is judged
// on threat, not raw headcount — set 1 is all chasers, later sets
// trade headcount for deadlier mixes.
export function setThreat(set) {
  let t = 0;
  for (const w of set.waves) for (const g of w.groups) {
    t += g.count * (g.type === 'shooter' ? 1.5 : g.type === 'splitter' ? 2.5 : 1);
  }
  return t;
}

// Combo multiplier: +10% per combo kill, capped at x4 (combo 30).
export function comboMultiplier(combo) {
  return 1 + Math.min(combo, COMBO_CAP) * COMBO_STEP;
}

// --- run state ---
export function createRun(set) {
  return {
    set,
    rng: mulberry32(set.seed),
    x: 0, z: 0, vx: 0, vz: 0,
    aimX: 0, aimZ: -10, angle: -Math.PI / 2,
    fireCd: 0, dashCd: 0, dashTime: 0, dashDx: 0, dashDz: 0,
    stun: 0, invuln: 0,
    shields: SHIELDS, maxShields: SHIELDS,
    score: 0, energy: 0, combo: 0, comboTimer: 0, maxCombo: 0,
    kills: 0, shotsFired: 0, hitsTaken: 0, dashes: 0,
    waveIndex: 0, waveTime: 0, waveState: 'fight', // 'fight' | 'breather' | 'done'
    breatherT: 0, spawnQueue: [], nextEnemyId: 1,
    enemies: [], bullets: [], enemyBullets: [], pickups: [],
    wavesCleared: 0, pickupsCollected: 0,
    time: 0, done: false, reason: null, // 'complete' | 'runOver'
  };
}

// Pick a spawn point on a ring 12-13.5 units from the ship (clamped
// inside the arena), so enemies always arrive on a consistent clock
// (~1s at chaser speed, after a 0.4s materialise) and in a tight
// window — a spawn at the far arena edge would take 3s to arrive and
// let a stationary ship kill the whole group for free. Tries several
// angles and keeps the farthest valid one, so a spawn never lands on
// top of the player.
function spawnPoint(run) {
  const rng = run.rng;
  let best = null, bestD = -1;
  for (let i = 0; i < 10; i++) {
    const a = rng() * Math.PI * 2;
    const r = 12 + rng() * 1.5;
    let x = clamp(run.x + Math.cos(a) * r, -ARENA_HALF_X + 1.5, ARENA_HALF_X - 1.5);
    let z = clamp(run.z + Math.sin(a) * r, -ARENA_HALF_Z + 1.5, ARENA_HALF_Z - 1.5);
    const d = Math.hypot(x - run.x, z - run.z);
    if (d >= 12 && d > bestD) { bestD = d; best = { x, z }; }
    if (d >= 16) break;
  }
  if (best) return best;
  // Fallback (ship pinned in a corner): farthest arena edge point.
  const corners = [
    { x: -ARENA_HALF_X + 2.5, z: -ARENA_HALF_Z + 2.5 },
    { x: ARENA_HALF_X - 2.5, z: -ARENA_HALF_Z + 2.5 },
    { x: -ARENA_HALF_X + 2.5, z: ARENA_HALF_Z - 2.5 },
    { x: ARENA_HALF_X - 2.5, z: ARENA_HALF_Z - 2.5 },
  ];
  let far = corners[0], farD = -1;
  for (const c of corners) {
    const d = Math.hypot(c.x - run.x, c.z - run.z);
    if (d > farD) { farD = d; far = c; }
  }
  return far;
}

function spawnEnemy(run, type) {
  const def = ENEMY_DEFS[type];
  const p = spawnPoint(run);
  const e = {
    id: run.nextEnemyId++, type,
    x: p.x, z: p.z, vx: 0, vz: 0,
    hp: def.hp, maxHp: def.hp, r: def.r, speed: def.speed,
    fireCd: def.fireInterval ? def.fireInterval * (0.35 + run.rng() * 0.3) : 0,
    telegraph: false, spawnT: SPAWN_IN_SECONDS,
  };
  run.enemies.push(e);
  return e;
}

function startWave(run) {
  const wave = run.set.waves[run.waveIndex];
  run.spawnQueue = [];
  for (const g of wave.groups) {
    for (let i = 0; i < g.count; i++) run.spawnQueue.push({ t: g.delay, type: g.type });
  }
  run.spawnQueue.sort((a, b) => a.t - b.t);
  run.waveTime = 0;
  run.waveState = 'fight';
}

export function startRun(set) {
  const run = createRun(set);
  startWave(run);
  return run;
}

function applyHit(run, sx, sz, events) {
  run.shields--;
  run.hitsTaken++;
  run.stun = STUN_SECONDS;
  run.invuln = INVULN_SECONDS;
  run.combo = 0;
  run.comboTimer = 0;
  // Knockback away from the source.
  const d = Math.hypot(sx, sz) || 1;
  run.vx += (sx / d) * 14;
  run.vz += (sz / d) * 14;
  events.push({ type: 'hit', x: run.x, z: run.z, shields: run.shields });
  if (run.shields <= 0) {
    run.done = true;
    run.reason = 'runOver';
    events.push({ type: 'runOver', score: run.score, waves: run.wavesCleared });
  }
}

function killEnemy(run, e, events) {
  const idx = run.enemies.indexOf(e);
  if (idx < 0) return;
  run.enemies.splice(idx, 1);
  run.kills++;
  run.combo++;
  run.comboTimer = COMBO_WINDOW;
  run.maxCombo = Math.max(run.maxCombo, run.combo);
  const gained = Math.round(ENEMY_DEFS[e.type].score * comboMultiplier(run.combo));
  run.score += gained;
  events.push({ type: 'kill', kind: e.type, x: e.x, z: e.z, score: gained, combo: run.combo });
  // Energy pickup drop.
  if (run.rng() < ENEMY_DEFS[e.type].dropChance) {
    run.pickups.push({ x: e.x, z: e.z, vx: (run.rng() - 0.5) * 4, vz: (run.rng() - 0.5) * 4, life: 12, r: 0.8 });
    events.push({ type: 'drop', x: e.x, z: e.z });
  }
  // Splitters burst into two minis.
  if (e.type === 'splitter') {
    for (let i = 0; i < 2; i++) {
      const def = ENEMY_DEFS.mini;
      const a = run.rng() * Math.PI * 2;
      run.enemies.push({
        id: run.nextEnemyId++, type: 'mini',
        x: clamp(e.x + Math.cos(a) * 1.6, -ARENA_HALF_X + 1, ARENA_HALF_X - 1),
        z: clamp(e.z + Math.sin(a) * 1.6, -ARENA_HALF_Z + 1, ARENA_HALF_Z - 1),
        vx: Math.cos(a) * 6, vz: Math.sin(a) * 6,
        hp: def.hp, maxHp: def.hp, r: def.r, speed: def.speed,
        fireCd: 0, telegraph: false, spawnT: 0.25,
      });
    }
    events.push({ type: 'split', x: e.x, z: e.z });
  }
}

// One fixed step. input: { mx, mz } move in [-1, 1] (screen-relative:
// mx right, mz down-screen), { aimX, aimZ } world aim point,
// { fire } boolean, { dash } boolean.
// Returns the events fired this step (for juice / audio / particles).
export function stepRun(run, input, dt = DT) {
  const events = [];
  if (run.done) return events;
  run.time += dt;
  run.waveTime += dt;

  // Combo decay.
  if (run.comboTimer > 0) {
    run.comboTimer -= dt;
    if (run.comboTimer <= 0) run.combo = 0;
  }
  if (run.fireCd > 0) run.fireCd -= dt;
  if (run.dashCd > 0) run.dashCd -= dt;
  if (run.stun > 0) run.stun -= dt;
  if (run.invuln > 0) run.invuln -= dt;

  // Aim follows the mouse (world point). The ship's nose points there.
  const ax = (input.aimX ?? run.aimX) - run.x;
  const az = (input.aimZ ?? run.aimZ) - run.z;
  if (Math.hypot(ax, az) > 0.5) {
    run.aimX = input.aimX ?? run.aimX;
    run.aimZ = input.aimZ ?? run.aimZ;
    run.angle = Math.atan2(az, ax);
  }

  // Dash: a burst in the current move direction (or the aim direction
  // when standing still), with brief invulnerability.
  if (input.dash && run.dashCd <= 0 && run.dashTime <= 0 && run.stun <= 0) {
    let dx = clamp(input.mx || 0, -1, 1), dz = clamp(input.mz || 0, -1, 1);
    if (Math.hypot(dx, dz) < 0.2) { dx = Math.cos(run.angle); dz = Math.sin(run.angle); }
    const d = Math.hypot(dx, dz) || 1;
    run.dashDx = dx / d; run.dashDz = dz / d;
    run.dashTime = DASH_DURATION;
    run.dashCd = DASH_COOLDOWN;
    run.invuln = Math.max(run.invuln, DASH_INVULN);
    run.dashes++;
    events.push({ type: 'dash', x: run.x, z: run.z });
  }

  // Movement with momentum; stun locks the controls out.
  if (run.dashTime > 0) {
    run.dashTime -= dt;
    run.vx = run.dashDx * DASH_SPEED;
    run.vz = run.dashDz * DASH_SPEED;
  } else {
    const mx = run.stun > 0 ? 0 : clamp(input.mx || 0, -1, 1);
    const mz = run.stun > 0 ? 0 : clamp(input.mz || 0, -1, 1);
    run.vx += mx * MOVE_ACCEL * dt;
    run.vz += mz * MOVE_ACCEL * dt;
    const damp = Math.exp(-MOVE_DAMPING * dt);
    run.vx *= damp; run.vz *= damp;
    const lv = Math.hypot(run.vx, run.vz);
    if (lv > MAX_SPEED) { run.vx *= MAX_SPEED / lv; run.vz *= MAX_SPEED / lv; }
  }
  run.x += run.vx * dt;
  run.z += run.vz * dt;
  // Arena walls: hard clamp, the ship slides along the wall.
  if (run.x < -ARENA_HALF_X + SHIP_RADIUS) { run.x = -ARENA_HALF_X + SHIP_RADIUS; run.vx = Math.max(0, run.vx); }
  if (run.x > ARENA_HALF_X - SHIP_RADIUS) { run.x = ARENA_HALF_X - SHIP_RADIUS; run.vx = Math.min(0, run.vx); }
  if (run.z < -ARENA_HALF_Z + SHIP_RADIUS) { run.z = -ARENA_HALF_Z + SHIP_RADIUS; run.vz = Math.max(0, run.vz); }
  if (run.z > ARENA_HALF_Z - SHIP_RADIUS) { run.z = ARENA_HALF_Z - SHIP_RADIUS; run.vz = Math.min(0, run.vz); }

  // Fire.
  if (input.fire && run.fireCd <= 0 && run.stun <= 0) {
    run.fireCd = FIRE_INTERVAL;
    run.shotsFired++;
    const bx = run.x + Math.cos(run.angle) * 1.4;
    const bz = run.z + Math.sin(run.angle) * 1.4;
    run.bullets.push({
      x: bx, z: bz,
      vx: Math.cos(run.angle) * BULLET_SPEED,
      vz: Math.sin(run.angle) * BULLET_SPEED,
      life: BULLET_LIFE, r: BULLET_RADIUS,
    });
    events.push({ type: 'shoot', x: bx, z: bz });
  }

  // Spawn the wave's groups on schedule.
  if (run.waveState === 'fight') {
    while (run.spawnQueue.length && run.spawnQueue[0].t <= run.waveTime) {
      const s = run.spawnQueue.shift();
      const e = spawnEnemy(run, s.type);
      events.push({ type: 'spawn', kind: s.type, x: e.x, z: e.z });
    }
  }

  // Enemies.
  for (const e of [...run.enemies]) {
    if (e.spawnT > 0) { e.spawnT -= dt; continue; }
    const dx = run.x - e.x, dz = run.z - e.z;
    const d = Math.hypot(dx, dz) || 1;
    if (e.type === 'chaser' || e.type === 'splitter' || e.type === 'mini') {
      e.vx += (dx / d) * ENEMY_DEFS[e.type].accel * dt;
      e.vz += (dz / d) * ENEMY_DEFS[e.type].accel * dt;
      const ev = Math.hypot(e.vx, e.vz);
      if (ev > e.speed) { e.vx *= e.speed / ev; e.vz *= e.speed / ev; }
    } else if (e.type === 'shooter') {
      // Keep its distance: close in when too far, back off when too near.
      const want = d > ENEMY_DEFS.shooter.keepRange + 3 ? 1 : (d < ENEMY_DEFS.shooter.keepRange - 3 ? -1 : 0);
      e.vx += (dx / d) * want * ENEMY_DEFS.shooter.accel * dt;
      e.vz += (dz / d) * want * ENEMY_DEFS.shooter.accel * dt;
      // Strafe so it never sits on one line.
      const strafe = Math.sin(run.time * 1.3 + e.id * 1.7) * 0.6;
      e.vx += (-dz / d) * strafe * ENEMY_DEFS.shooter.accel * 0.4 * dt;
      e.vz += (dx / d) * strafe * ENEMY_DEFS.shooter.accel * 0.4 * dt;
      const ev = Math.hypot(e.vx, e.vz);
      if (ev > e.speed) { e.vx *= e.speed / ev; e.vz *= e.speed / ev; }
      // Fire an aimed bolt, telegraphed 0.35s ahead.
      e.fireCd -= dt;
      e.telegraph = e.fireCd < 0.35 && e.fireCd > 0;
      if (e.fireCd <= 0 && !run.done) {
        e.fireCd = ENEMY_DEFS.shooter.fireInterval * (0.85 + run.rng() * 0.3);
        e.telegraph = false;
        run.enemyBullets.push({
          x: e.x + (dx / d) * 1.4, z: e.z + (dz / d) * 1.4,
          vx: (dx / d) * ENEMY_BULLET_SPEED, vz: (dz / d) * ENEMY_BULLET_SPEED,
          life: 6, r: ENEMY_BULLET_RADIUS,
        });
        events.push({ type: 'enemyShoot', x: e.x, z: e.z });
      }
    }
    e.x += e.vx * dt;
    e.z += e.vz * dt;
    e.x = clamp(e.x, -ARENA_HALF_X + e.r, ARENA_HALF_X - e.r);
    e.z = clamp(e.z, -ARENA_HALF_Z + e.r, ARENA_HALF_Z - e.r);
  }

  // Player bullets: move, expire, hit enemies.
  for (const b of [...run.bullets]) {
    b.x += b.vx * dt;
    b.z += b.vz * dt;
    b.life -= dt;
    if (b.life <= 0 || Math.abs(b.x) > ARENA_HALF_X + 2 || Math.abs(b.z) > ARENA_HALF_Z + 2) {
      run.bullets.splice(run.bullets.indexOf(b), 1);
      continue;
    }
    for (const e of [...run.enemies]) {
      if (e.spawnT > 0) continue;
      if (Math.hypot(b.x - e.x, b.z - e.z) < b.r + e.r) {
        run.bullets.splice(run.bullets.indexOf(b), 1);
        e.hp -= 1;
        events.push({ type: 'bulletHit', x: b.x, z: b.z, kind: e.type });
        if (e.hp <= 0) killEnemy(run, e, events);
        break;
      }
    }
  }

  // Enemy bullets: move, expire, hit the ship.
  for (const b of [...run.enemyBullets]) {
    b.x += b.vx * dt;
    b.z += b.vz * dt;
    b.life -= dt;
    if (b.life <= 0 || Math.abs(b.x) > ARENA_HALF_X + 2 || Math.abs(b.z) > ARENA_HALF_Z + 2) {
      run.enemyBullets.splice(run.enemyBullets.indexOf(b), 1);
      continue;
    }
    if (run.invuln <= 0 && Math.hypot(b.x - run.x, b.z - run.z) < b.r + SHIP_RADIUS) {
      run.enemyBullets.splice(run.enemyBullets.indexOf(b), 1);
      applyHit(run, b.vx, b.vz, events);
      if (run.done) return events;
    }
  }

  // Contact: enemies touching the ship cost a shield.
  if (run.invuln <= 0) {
    for (const e of [...run.enemies]) {
      if (e.spawnT > 0) continue;
      if (Math.hypot(e.x - run.x, e.z - run.z) < e.r + SHIP_RADIUS) {
        // The enemy dies with the hit — a kamikaze trade, so one
        // chaser can never take two shields.
        run.enemies.splice(run.enemies.indexOf(e), 1);
        events.push({ type: 'enemyRam', kind: e.type, x: e.x, z: e.z });
        applyHit(run, e.x - run.x, e.z - run.z, events);
        break;
      }
    }
    if (run.done) return events;
  }

  // Pickups: drift, magnet toward the ship when close, collect.
  for (const p of [...run.pickups]) {
    p.life -= dt;
    if (p.life <= 0) { run.pickups.splice(run.pickups.indexOf(p), 1); continue; }
    const dx = run.x - p.x, dz = run.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d < 5) { p.vx += (dx / d) * 26 * dt; p.vz += (dz / d) * 26 * dt; }
    p.vx *= Math.exp(-2 * dt); p.vz *= Math.exp(-2 * dt);
    p.x += p.vx * dt; p.z += p.vz * dt;
    if (d < p.r + SHIP_RADIUS + 0.4) {
      run.pickups.splice(run.pickups.indexOf(p), 1);
      run.pickupsCollected++;
      run.energy++;
      run.score += PICKUP_SCORE;
      events.push({ type: 'pickup', x: p.x, z: p.z });
    }
  }

  // Wave cleared: the queue is empty and the arena is clear.
  if (run.waveState === 'fight' && run.spawnQueue.length === 0 && run.enemies.length === 0) {
    run.wavesCleared++;
    run.score += WAVE_CLEAR_SCORE;
    events.push({ type: 'waveClear', wave: run.waveIndex + 1, score: WAVE_CLEAR_SCORE });
    if (run.waveIndex + 1 >= run.set.waves.length) {
      run.waveState = 'done';
      run.done = true;
      run.reason = 'complete';
      run.score += SET_CLEAR_SCORE;
      events.push({ type: 'setComplete', score: run.score, waves: run.wavesCleared });
    } else {
      run.waveState = 'breather';
      run.breatherT = WAVE_BREATHER;
    }
  } else if (run.waveState === 'breather') {
    run.breatherT -= dt;
    if (run.breatherT <= 0) {
      run.waveIndex++;
      startWave(run);
      events.push({ type: 'waveStart', wave: run.waveIndex + 1 });
    }
  }

  return events;
}

// --- policies (the bot plays through the same stepRun + inputs) ---
export function nearestEnemy(run) {
  let best = null, bestD = Infinity;
  for (const e of run.enemies) {
    if (e.spawnT > 0) continue;
    const d = Math.hypot(e.x - run.x, e.z - run.z);
    if (d < bestD) { bestD = d; best = e; }
  }
  return best;
}

// Sitting still and holding fire: aim at the nearest enemy and shoot,
// never move, never dash. This must FAIL every wave set — if it does
// not, the wave set is not done (the chasers close from every side
// faster than one aim line can kill them, and shooter bolts punish a
// ship that never dodges).
export function stationaryPolicy(run) {
  const target = nearestEnemy(run);
  if (!target) return { mx: 0, mz: 0, aimX: run.x, aimZ: run.z - 10, fire: true, dash: false };
  return { mx: 0, mz: 0, aimX: target.x, aimZ: target.z, fire: true, dash: false };
}

// Greedy combat bot: kites away from chasers, keeps a firing range,
// dodges enemy bolts, aims with a lead on the nearest enemy, fires
// when the aim line is true, and dashes out when something closes in.
// It reads the same public state the player sees — no cheating — and
// it still has to make a real move + aim decision every step.
export function greedyPolicy(run) {
  const target = nearestEnemy(run);
  let aimX = run.x, aimZ = run.z - 10;
  let fire = false;
  if (target) {
    const d = Math.hypot(target.x - run.x, target.z - run.z) || 1;
    const lead = d / BULLET_SPEED;
    aimX = target.x + target.vx * lead;
    aimZ = target.z + target.vz * lead;
    const wantAngle = Math.atan2(aimZ - run.z, aimX - run.x);
    let diff = wantAngle - run.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    fire = Math.abs(diff) < 0.25;
  }

  // Movement: flee the nearest threats, keep a firing range on the
  // target, stay inside the arena, dodge incoming bolts.
  let fx = 0, fz = 0;
  if (target) {
    const dx = run.x - target.x, dz = run.z - target.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d < 9) { fx += (dx / d) * 1.2; fz += (dz / d) * 1.2; } // too close: back off
    else if (d > 17) { fx -= (dx / d) * 0.7; fz -= (dz / d) * 0.7; } // too far: close in
  }
  for (const e of run.enemies) {
    if (e.spawnT > 0) continue;
    const dx = run.x - e.x, dz = run.z - e.z;
    const d = Math.hypot(dx, dz) || 1;
    if ((e.type === 'chaser' || e.type === 'mini' || e.type === 'splitter') && d < 11) {
      const w = (11 - d) / 11;
      fx += (dx / d) * w * 1.6; fz += (dz / d) * w * 1.6;
    }
  }
  // Dodge enemy bolts: step sideways from any bolt heading at us.
  for (const b of run.enemyBullets) {
    const dx = b.x - run.x, dz = b.z - run.z;
    const d = Math.hypot(dx, dz);
    if (d < 7) {
      const closing = (dx * b.vx + dz * b.vz) / (d || 1);
      if (closing < 0) {
        // Step perpendicular to the bolt's path.
        const px = -b.vz, pz = b.vx;
        const pl = Math.hypot(px, pz) || 1;
        const side = ((run.x - b.x) * px + (run.z - b.z) * pz) >= 0 ? 1 : -1;
        fx += (px / pl) * side * 1.4; fz += (pz / pl) * side * 1.4;
      }
    }
  }
  // Pickups are worth a detour when the arena is quiet.
  if (!target && run.pickups.length) {
    const p = run.pickups[0];
    fx += clamp((p.x - run.x) / 6, -1, 1) * 0.8;
    fz += clamp((p.z - run.z) / 6, -1, 1) * 0.8;
  }
  // Arena walls: steer back inside.
  const margin = 5;
  if (run.x < -ARENA_HALF_X + margin) fx += 1;
  if (run.x > ARENA_HALF_X - margin) fx -= 1;
  if (run.z < -ARENA_HALF_Z + margin) fz += 1;
  if (run.z > ARENA_HALF_Z - margin) fz -= 1;
  const fl = Math.hypot(fx, fz);
  const mx = fl > 0.01 ? clamp(fx / Math.max(1, fl), -1, 1) : 0;
  const mz = fl > 0.01 ? clamp(fz / Math.max(1, fl), -1, 1) : 0;

  // Dash out when a chaser is about to touch us, or a bolt is about
  // to land and we cannot step aside in time.
  let dash = false;
  if (run.dashCd <= 0) {
    for (const e of run.enemies) {
      if (e.spawnT > 0) continue;
      if ((e.type === 'chaser' || e.type === 'mini') && Math.hypot(e.x - run.x, e.z - run.z) < 3.6) { dash = true; break; }
    }
    if (!dash) {
      for (const b of run.enemyBullets) {
        if (Math.hypot(b.x - run.x, b.z - run.z) < 2.6) { dash = true; break; }
      }
    }
  }
  return { mx, mz, aimX, aimZ, fire, dash };
}

// Simulate a whole wave set with a policy function. Returns the outcome.
export function simulateRun(set, policy) {
  const run = startRun(set);
  const maxSteps = Math.ceil(600 / DT); // 10 minutes of game time
  let steps = 0;
  const events = [];
  while (!run.done && steps < maxSteps) {
    const input = policy(run);
    const evs = stepRun(run, input, DT);
    events.push(...evs);
    steps++;
  }
  return {
    completed: run.done && run.reason === 'complete',
    reason: run.reason || (steps >= maxSteps ? 'timeout' : 'running'),
    score: run.score, waves: run.wavesCleared,
    kills: run.kills, hitsTaken: run.hitsTaken,
    shields: run.shields, time: run.time, steps,
    maxCombo: run.maxCombo, energy: run.energy,
    dashes: run.dashes, shotsFired: run.shotsFired,
  };
}

// --- save (localStorage) ---
export function defaultSave() {
  return {
    version: SAVE_VERSION, best: {},
    totalRuns: 0, muted: false, shake: 1,
    reduceFlashing: null, music: true, sfx: true, volume: 0.6,
  };
}
export function serializeSave(save) { return JSON.stringify(save); }
export function parseSave(text) {
  const d = defaultSave();
  try {
    const s = JSON.parse(text);
    if (!s || typeof s !== 'object') return d;
    if (s.best && typeof s.best === 'object') {
      for (const [k, v] of Object.entries(s.best)) {
        if (/^(?:[1-6])$/.test(k) && v && typeof v === 'object'
          && Number.isFinite(v.score) && Number.isFinite(v.waves)) {
          d.best[k] = {
            score: clamp(Math.floor(v.score), 0, 10000000),
            waves: clamp(Math.floor(v.waves), 0, 6),
          };
        }
      }
    }
    if (Number.isInteger(s.totalRuns)) d.totalRuns = clamp(s.totalRuns, 0, 100000);
    if (typeof s.muted === 'boolean') d.muted = s.muted;
    if (typeof s.shake === 'number' && Number.isFinite(s.shake)) d.shake = clamp(s.shake, 0, 1);
    if (s.reduceFlashing === null || typeof s.reduceFlashing === 'boolean') d.reduceFlashing = s.reduceFlashing;
    if (typeof s.music === 'boolean') d.music = s.music;
    if (typeof s.sfx === 'boolean') d.sfx = s.sfx;
    if (typeof s.volume === 'number' && Number.isFinite(s.volume)) d.volume = clamp(s.volume, 0, 1);
    return d;
  } catch { return d; }
}
export function recordBest(save, setId, score, waves) {
  const prev = save.best[setId];
  const best = {
    score: Math.max(prev ? prev.score : 0, score),
    waves: Math.max(prev ? prev.waves : 0, waves),
  };
  save.best[setId] = best;
  return best;
}
