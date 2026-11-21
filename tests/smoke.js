// Neon Nova v0.5.0 — Node smoke tests for physics.js (no DOM, no Three.js).
import {
  VERSION, WAVE_SETS, waveSetById, totalEnemiesInSet, setThreat, comboMultiplier,
  createRun, startRun, stepRun, simulateRun, stationaryPolicy, greedyPolicy,
  nearestEnemy, ARENA_HALF_X, ARENA_HALF_Z, SHIP_RADIUS, SHIELDS,
  FIRE_INTERVAL, BULLET_SPEED, DASH_COOLDOWN, DASH_DURATION, DASH_SPEED,
  STUN_SECONDS, INVULN_SECONDS, COMBO_WINDOW, WAVE_CLEAR_SCORE, SET_CLEAR_SCORE,
  PICKUP_SCORE, ENEMY_DEFS, FEEDBACK, FEEDBACK_TIERS, FEEDBACK_LAYERS,
  UPGRADES, UPGRADE_ORDER, upgradeStats, upgradeLevel, upgradeCost, applyUpgrade,
  makeSurvivalSet, generateSurvivalWave, survivalWaveThreat,
  isSetUnlocked, isSurvivalUnlocked, defaultCampaign,
  PERF_LEVELS, PERF_FPS_THRESHOLD, PERF_LOW_MS, perfGuardStep,
  mulberry32, clamp, defaultSave, serializeSave, parseSave, recordBest, SAVE_VERSION,
} from '../physics.js';

let passed = 0, failed = 0;
const failures = [];
function check(name, cond) {
  if (cond) passed++;
  else { failed++; failures.push(name); console.error('FAIL:', name); }
}
function approx(a, b, eps = 1e-9) { return Math.abs(a - b) <= eps; }

check('physics version is 0.5.0', VERSION === '0.5.0');
check('12 wave sets defined', WAVE_SETS.length === 12);
check('wave set ids are 1..12 in order', WAVE_SETS.every((s, i) => s.id === i + 1));
check('every wave set has a name and a hint', WAVE_SETS.every((s) => s.name && s.hint));
check('every wave set has a distinct theme disc', new Set(WAVE_SETS.map((s) => s.theme.disc)).size === 12);
check('every wave set has a distinct theme ring', new Set(WAVE_SETS.map((s) => s.theme.ring)).size === 12);
check('waveSetById finds set 3', waveSetById(3) && waveSetById(3).name === 'Split Decision');
check('waveSetById finds set 6', waveSetById(6) && waveSetById(6).name === 'Nova Gauntlet');
check('waveSetById finds set 12', waveSetById(12) && waveSetById(12).name === 'Final Nova');
check('waveSetById returns null for unknown id', waveSetById(99) === null);
check('every wave set has 4-5 waves', WAVE_SETS.every((s) => s.waves.length >= 4 && s.waves.length <= 5));
check('every wave set is dense (15+ enemies)', WAVE_SETS.every((s) => totalEnemiesInSet(s) >= 15));
check('threat grows with difficulty (headcount + deadlier mixes)', WAVE_SETS.every((s, i) => i === 0 || setThreat(s) > setThreat(WAVE_SETS[i - 1])));
check('no difficulty cliff: each set is within 1.6x of the previous set\'s threat',
  WAVE_SETS.every((s, i) => i === 0 || setThreat(s) <= setThreat(WAVE_SETS[i - 1]) * 1.6));
check('every wave set has chasers', WAVE_SETS.every((s) => s.waves.some((w) => w.groups.some((g) => g.type === 'chaser'))));
check('sets 2+ introduce shooters', WAVE_SETS.slice(1).every((s) => s.waves.some((w) => w.groups.some((g) => g.type === 'shooter'))));
check('sets 3+ introduce splitters', WAVE_SETS.slice(2).every((s) => s.waves.some((w) => w.groups.some((g) => g.type === 'splitter'))));
check('set 1 teaches: no shooters or splitters in wave 1', !WAVE_SETS[0].waves[0].groups.some((g) => g.type !== 'chaser'));
check('every wave has at least one spawn group', WAVE_SETS.every((s) => s.waves.every((w) => w.groups.length >= 1)));
check('every wave spawns enemies simultaneously (groups of 3+ exist)',
  WAVE_SETS.every((s) => s.waves.some((w) => w.groups.some((g) => g.count >= 3))));

// --- enemy defs ---
check('four enemy types defined', Object.keys(ENEMY_DEFS).length === 4);
for (const [type, def] of Object.entries(ENEMY_DEFS)) {
  check(`${type} has hp, speed, radius and score`, def.hp >= 1 && def.speed > 0 && def.r > 0 && def.score > 0);
}
check('chaser is 1 hp (one bullet kills it)', ENEMY_DEFS.chaser.hp === 1);
check('shooter is 2 hp', ENEMY_DEFS.shooter.hp === 2);
check('splitter is 2 hp', ENEMY_DEFS.splitter.hp === 2);
check('mini is faster than the chaser it comes from', ENEMY_DEFS.mini.speed > ENEMY_DEFS.chaser.speed);

// --- run state ---
{
  const run = startRun(WAVE_SETS[0]);
  check('run starts centred', run.x === 0 && run.z === 0);
  check('run starts with 3 shields', run.shields === SHIELDS);
  check('run starts on wave 1', run.waveIndex === 0);
  check('run is not done at start', !run.done);
  check('run score starts at 0', run.score === 0);
  check('run combo starts at 0', run.combo === 0);
  check('first wave has a spawn queue', run.spawnQueue.length > 0);
  check('first wave spawns chasers only', run.spawnQueue.every((s) => s.type === 'chaser'));
}

// --- movement with momentum ---
{
  const run = startRun(WAVE_SETS[0]);
  stepRun(run, { mx: 1, mz: 0, aimX: 10, aimZ: 0, fire: false, dash: false }, 1 / 60);
  check('moving right accelerates the ship right', run.vx > 0 && run.x > 0);
  const vx1 = run.vx;
  stepRun(run, { mx: 0, mz: 0, aimX: 10, aimZ: 0, fire: false, dash: false }, 1 / 60);
  check('momentum carries the ship after input stops', run.vx > 0);
  check('damping bleeds velocity without input', run.vx < vx1);
  const run2 = startRun(WAVE_SETS[0]);
  for (let i = 0; i < 180; i++) stepRun(run2, { mx: 1, mz: 1, aimX: 10, aimZ: 10, fire: false, dash: false }, 1 / 60);
  check('speed is capped', Math.hypot(run2.vx, run2.vz) <= 23.001);
  check('ship never leaves the arena', Math.abs(run2.x) <= ARENA_HALF_X - SHIP_RADIUS + 1e-6 && Math.abs(run2.z) <= ARENA_HALF_Z - SHIP_RADIUS + 1e-6);
  const run3 = startRun(WAVE_SETS[0]);
  run3.stun = 1;
  stepRun(run3, { mx: 1, mz: 1, aimX: 10, aimZ: 10, fire: false, dash: false }, 1 / 60);
  check('stun locks movement out', run3.vx === 0 && run3.vz === 0);
}

// --- aim ---
{
  const run = startRun(WAVE_SETS[0]);
  stepRun(run, { mx: 0, mz: 0, aimX: 10, aimZ: 0, fire: false, dash: false }, 1 / 60);
  check('aiming right points the ship right (angle 0)', approx(run.angle, 0));
  stepRun(run, { mx: 0, mz: 0, aimX: 0, aimZ: -10, fire: false, dash: false }, 1 / 60);
  check('aiming up-screen points the ship up-screen (angle -PI/2)', approx(run.angle, -Math.PI / 2));
  // A bullet fired after aiming right travels right.
  stepRun(run, { mx: 0, mz: 0, aimX: 10, aimZ: 0, fire: true, dash: false }, 1 / 60);
  check('firing spawns a bullet', run.bullets.length === 1);
  check('bullet travels in the aim direction', run.bullets[0].vx > 0 && Math.abs(run.bullets[0].vz) < 1e-9);
  check('bullet speed is the tuned value', approx(Math.hypot(run.bullets[0].vx, run.bullets[0].vz), BULLET_SPEED));
}

// --- fire rate ---
{
  const run = startRun(WAVE_SETS[0]);
  for (let i = 0; i < 60; i++) stepRun(run, { mx: 0, mz: 0, aimX: 10, aimZ: 0, fire: true, dash: false }, 1 / 60);
  check('holding fire fires about once per interval (5-8 shots in 1s)',
    run.shotsFired >= 5 && run.shotsFired <= 8);
  const run2 = startRun(WAVE_SETS[0]);
  stepRun(run2, { mx: 0, mz: 0, aimX: 10, aimZ: 0, fire: false, dash: false }, 1 / 60);
  check('no fire input means no shots', run2.shotsFired === 0);
}

// --- dash ---
{
  const run = startRun(WAVE_SETS[0]);
  const evs = stepRun(run, { mx: 1, mz: 0, aimX: 10, aimZ: 0, fire: false, dash: true }, 1 / 60);
  check('dash fires a dash event', evs.some((e) => e.type === 'dash'));
  check('dash sets a cooldown', run.dashCd > 0 && run.dashCd <= DASH_COOLDOWN + 1e-9);
  check('dash grants invulnerability', run.invuln > 0);
  check('dash moves the ship at dash speed', Math.hypot(run.vx, run.vz) > 40);
  const run2 = startRun(WAVE_SETS[0]);
  stepRun(run2, { mx: 1, mz: 0, aimX: 10, aimZ: 0, fire: false, dash: true }, 1 / 60);
  const cd = run2.dashCd;
  stepRun(run2, { mx: 1, mz: 0, aimX: 10, aimZ: 0, fire: false, dash: true }, 1 / 60);
  check('dash cannot re-trigger during cooldown', run2.dashCd <= cd && run2.dashes === 1);
  const run3 = startRun(WAVE_SETS[0]);
  run3.stun = 1;
  stepRun(run3, { mx: 1, mz: 0, aimX: 10, aimZ: 0, fire: false, dash: true }, 1 / 60);
  check('stun blocks the dash', run3.dashes === 0);
  // Dash with no move input dashes in the aim direction.
  const run4 = startRun(WAVE_SETS[0]);
  stepRun(run4, { mx: 0, mz: 0, aimX: -10, aimZ: 0, fire: false, dash: true }, 1 / 60);
  check('dash with no move input goes in the aim direction', run4.vx < -40);
}

// --- killing, combo, score ---
{
  // A chaser spawned ahead of the ship, aimed at directly: one bullet kills it.
  const run = startRun(WAVE_SETS[0]);
  // Force-spawn a chaser right in front of the ship.
  run.enemies.push({
    id: 99, type: 'chaser', x: 8, z: 0, vx: 0, vz: 0,
    hp: 1, maxHp: 1, r: 1, speed: 10.5, fireCd: 0, telegraph: false, spawnT: 0,
  });
  let evs = [];
  for (let i = 0; i < 120 && run.kills === 0; i++) {
    evs.push(...stepRun(run, { mx: 0, mz: 0, aimX: 8, aimZ: 0, fire: true, dash: false }, 1 / 60));
  }
  check('aimed fire kills the chaser', run.kills === 1);
  check('kill fires a kill event with the combo', evs.some((e) => e.type === 'kill' && e.kind === 'chaser' && e.combo === 1));
  check('kill scores 100 x combo multiplier', run.score >= 100);
  check('kill starts the combo', run.combo === 1 && run.comboTimer > 0);
  // Combo multiplier: 10 kills in a row reach x2.
  check('combo multiplier is 1 at combo 0', comboMultiplier(0) === 1);
  check('combo multiplier is 2 at combo 10', approx(comboMultiplier(10), 2));
  check('combo multiplier caps at 4', approx(comboMultiplier(30), 4) && approx(comboMultiplier(99), 4));
  // Combo resets after the window without a kill.
  const run2 = startRun(WAVE_SETS[0]);
  run2.combo = 5; run2.comboTimer = COMBO_WINDOW;
  for (let i = 0; i < Math.ceil((COMBO_WINDOW + 0.5) * 60); i++) {
    stepRun(run2, { mx: 0, mz: 0, aimX: 10, aimZ: 0, fire: false, dash: false }, 1 / 60);
  }
  check('combo resets after the window with no kill', run2.combo === 0);
}
// Combo window tightened in M4 (3.5 -> 2.5): the multiplier sat at x4
// from wave 2 on for a decent player, so kills must come closer
// together to hold it.
check('combo window is 2.5s (M4 economy tuning)', COMBO_WINDOW === 2.5);

// --- upgrades (M4) ---
{
  check('six upgrades defined', Object.keys(UPGRADES).length === 6);
  check('upgrade order covers every upgrade', UPGRADE_ORDER.length === 6
    && UPGRADE_ORDER.every((id) => UPGRADES[id]));
  for (const [id, u] of Object.entries(UPGRADES)) {
    check(`${id} has a name, a description and a cost per level`,
      u.name && u.desc && Array.isArray(u.cost) && u.cost.length === u.max);
    check(`${id} costs rise with level`, u.cost.every((c, i) => i === 0 || c > u.cost[i - 1]));
    check(`${id} costs are all positive`, u.cost.every((c) => c > 0));
  }
  check('total cost of everything is 163 (a campaign cannot max it all)',
    Object.values(UPGRADES).reduce((n, u) => n + u.cost.reduce((a, b) => a + b, 0), 0) === 163);
  const stock = upgradeStats({});
  check('stock ship has the base fire interval', approx(stock.fireInterval, FIRE_INTERVAL));
  check('stock ship fires one bullet', stock.bullets === 1);
  check('stock ship deals 1 damage', stock.damage === 1);
  check('stock ship has the base dash cooldown', approx(stock.dashCooldown, DASH_COOLDOWN));
  check('stock ship magnet radius is 5', stock.magnetRadius === 5);
  check('stock ship has 3 shields', stock.maxShields === SHIELDS);
  const maxed = upgradeStats({ rapid: 3, twin: 2, heavy: 1, hull: 2, dash: 2, magnet: 2 });
  check('max rapid fire is ~39% faster', approx(maxed.fireInterval, FIRE_INTERVAL * Math.pow(0.85, 3)));
  check('max twin shot fires 3 bullets', maxed.bullets === 3);
  check('heavy rounds deal 2 damage', maxed.damage === 2);
  check('max dash recharge is ~44% faster', approx(maxed.dashCooldown, DASH_COOLDOWN * Math.pow(0.75, 2)));
  check('max magnet radius is 13', maxed.magnetRadius === 13);
  check('max hull gives 5 shields', maxed.maxShields === 5);
  check('upgradeLevel clamps to the max', upgradeLevel({ rapid: 9 }, 'rapid') === 3);
  check('upgradeLevel of an unknown id is 0', upgradeLevel({}, 'nope') === 0);
  check('upgradeCost is null at max level', upgradeCost('heavy', 1) === null);
  check('upgradeCost is the next level price', upgradeCost('rapid', 0) === 8 && upgradeCost('rapid', 2) === 16);
  const bought = applyUpgrade({}, 'rapid', 10);
  check('buying rapid fire spends 8 energy and leaves 2', bought && bought.energy === 2 && bought.cost === 8 && bought.level === 1);
  check('buying does not mutate the input loadout', JSON.stringify({}) === '{}');
  check('cannot buy without enough energy', applyUpgrade({}, 'rapid', 5) === null);
  check('cannot buy past the max', applyUpgrade({ heavy: 1 }, 'heavy', 99) === null);
  check('cannot buy an unknown upgrade', applyUpgrade({}, 'nope', 99) === null);
}

// --- upgrades change the run ---
{
  const run = startRun(WAVE_SETS[0], { upgrades: { twin: 1, heavy: 1, hull: 1, dash: 1 } });
  check('upgraded run starts with 4 shields', run.shields === 4 && run.maxShields === 4);
  check('upgraded run fires faster on dash cooldown', approx(run.dashCooldown, DASH_COOLDOWN * 0.75));
  check('upgraded run deals 2 damage', run.bulletDamage === 2);
  stepRun(run, { mx: 0, mz: 0, aimX: 10, aimZ: 0, fire: true, dash: false }, 1 / 60);
  check('twin shot spawns two bullets', run.bullets.length === 2);
  check('twin shot bullets spread slightly', Math.abs(run.bullets[0].vz - run.bullets[1].vz) > 0.001);
  // A shooter (2 hp) dies to one heavy round.
  const run2 = startRun(WAVE_SETS[0], { upgrades: { heavy: 1 } });
  run2.enemies.push({
    id: 99, type: 'shooter', x: 8, z: 0, vx: 0, vz: 0,
    hp: 2, maxHp: 2, r: 1.1, speed: 6, fireCd: 99, telegraph: false, spawnT: 0,
  });
  for (let i = 0; i < 60 && run2.kills === 0; i++) {
    stepRun(run2, { mx: 0, mz: 0, aimX: 8, aimZ: 0, fire: true, dash: false }, 1 / 60);
  }
  check('heavy rounds kill a 2-hp shooter in one hit', run2.kills === 1);
  // Campaign carry-in: score and energy start where the campaign left off.
  const run3 = startRun(WAVE_SETS[0], { mode: 'campaign', score: 5000, energy: 12, upgrades: { magnet: 1 } });
  check('campaign run carries score in', run3.score === 5000 && run3.scoreAtStart === 5000);
  check('campaign run carries energy in', run3.energy === 12);
  check('campaign run magnet radius is 9', run3.magnetRadius === 9);
  check('campaign run mode is campaign', run3.mode === 'campaign');
}

// --- survival mode (M4) ---
{
  const s = makeSurvivalSet(42);
  check('survival set is flagged survival with id 0', s.survival === true && s.id === 0);
  check('survival wave 1 is chasers only', generateSurvivalWave(0).groups.every((g) => g.type === 'chaser'));
  check('survival wave 1 is two staggered groups (no single unfair wall)',
    generateSurvivalWave(0).groups.length === 2 && generateSurvivalWave(0).groups[1].delay === 1.5);
  check('survival wave 2 introduces shooters', generateSurvivalWave(1).groups.some((g) => g.type === 'shooter'));
  check('survival wave 3 introduces splitters', generateSurvivalWave(2).groups.some((g) => g.type === 'splitter'));
  check('survival threat strictly increases over the first 12 waves',
    Array.from({ length: 12 }, (_, n) => survivalWaveThreat(n)).every((t, i, a) => i === 0 || t > a[i - 1]));
  check('survival wave 10 is about as threatening as a set-12 wave',
    survivalWaveThreat(9) >= 30 && survivalWaveThreat(9) <= 45);
  check('survival waves are deterministic for the same wave number',
    JSON.stringify(generateSurvivalWave(7)) === JSON.stringify(generateSurvivalWave(7)));
  const run = startRun(s, { mode: 'survival' });
  check('survival run never completes a set (endless)', run.set.survival === true);
  // Wave-clear bonus grows with the wave number in survival.
  const r2 = startRun(s, { mode: 'survival' });
  r2.waveIndex = 4;
  r2.spawnQueue = [];
  r2.enemies = [];
  stepRun(r2, { mx: 0, mz: 0, aimX: 10, aimZ: 0, fire: false, dash: false }, 1 / 60);
  check('survival wave 5 clear pays 250 + 50*4', r2.score === WAVE_CLEAR_SCORE + 50 * 4);
  check('survival keeps going after a wave clear (breather, not done)', r2.waveState === 'breather' && !r2.done);
}

// --- unlock gates (M4) ---
{
  check('set 1 is always unlocked', isSetUnlocked({}, 1));
  check('set 2 is locked on a fresh save', !isSetUnlocked({}, 2));
  check('set 2 unlocks when set 1 is cleared', isSetUnlocked({ 1: { score: 100, waves: 4 } }, 2));
  check('set 2 stays locked when set 1 is only partly cleared', !isSetUnlocked({ 1: { score: 100, waves: 3 } }, 2));
  check('set 12 unlocks only when set 11 is cleared', !isSetUnlocked({ 11: { score: 1, waves: 4 } }, 12)
    && isSetUnlocked({ 11: { score: 1, waves: 5 } }, 12));
  check('survival is locked on a fresh save', !isSurvivalUnlocked({}));
  check('survival unlocks when set 1 is cleared', isSurvivalUnlocked({ 1: { score: 100, waves: 4 } }));
}

// --- splitter bursts into minis ---
{
  const run = startRun(WAVE_SETS[0]);
  run.enemies.push({
    id: 98, type: 'splitter', x: 8, z: 0, vx: 0, vz: 0,
    hp: 1, maxHp: 2, r: 1.5, speed: 6.5, fireCd: 0, telegraph: false, spawnT: 0,
  });
  let evs = [];
  for (let i = 0; i < 120 && run.kills === 0; i++) {
    evs.push(...stepRun(run, { mx: 0, mz: 0, aimX: 8, aimZ: 0, fire: true, dash: false }, 1 / 60));
  }
  check('splitter dies to fire', run.kills === 1);
  check('splitter bursts into two minis', run.enemies.filter((e) => e.type === 'mini').length === 2);
  check('split fires a split event', evs.some((e) => e.type === 'split'));
}

// --- shooter fires aimed bolts ---
{
  const run = startRun(WAVE_SETS[0]);
  run.enemies.push({
    id: 97, type: 'shooter', x: 14, z: 0, vx: 0, vz: 0,
    hp: 2, maxHp: 2, r: 1.1, speed: 6, fireCd: 0.1, telegraph: false, spawnT: 0,
  });
  let evs = [];
  for (let i = 0; i < 60; i++) evs.push(...stepRun(run, { mx: 0, mz: 0, aimX: 14, aimZ: 0, fire: false, dash: false }, 1 / 60));
  check('shooter fires a bolt at the ship', evs.some((e) => e.type === 'enemyShoot'));
  check('enemy bolt travels toward the ship', run.enemyBullets.length >= 0);
}

// --- hits cost shields, stun, invulnerability, run over ---
{
  const run = startRun(WAVE_SETS[0]);
  // A chaser on top of the ship: contact costs a shield.
  run.enemies.push({
    id: 96, type: 'chaser', x: 0.5, z: 0, vx: 0, vz: 0,
    hp: 1, maxHp: 1, r: 1, speed: 10.5, fireCd: 0, telegraph: false, spawnT: 0,
  });
  const evs = stepRun(run, { mx: 0, mz: 0, aimX: 10, aimZ: 0, fire: false, dash: false }, 1 / 60);
  check('contact costs a shield', run.shields === SHIELDS - 1);
  check('hit stuns the ship', run.stun > 0);
  check('hit grants invulnerability', run.invuln > 0);
  check('hit fires a hit event', evs.some((e) => e.type === 'hit'));
  check('hit resets the combo', run.combo === 0);
  // The rammer sits to the RIGHT of the ship: knockback must push the
  // ship LEFT, away from the source (M3: the ram call used to pass the
  // ship-to-enemy vector, shoving the ship into the rammer).
  check('ram knockback pushes the ship away from the rammer', run.vx < -8);
  check('the ramming enemy dies with the hit (no double shield loss)',
    !run.enemies.some((e) => e.id === 96));
  // Invulnerability: a second chaser on top of the ship cannot hit again yet.
  run.enemies.push({
    id: 95, type: 'chaser', x: 0.5, z: 0, vx: 0, vz: 0,
    hp: 1, maxHp: 1, r: 1, speed: 10.5, fireCd: 0, telegraph: false, spawnT: 0,
  });
  stepRun(run, { mx: 0, mz: 0, aimX: 10, aimZ: 0, fire: false, dash: false }, 1 / 60);
  check('invulnerability blocks the next hit', run.shields === SHIELDS - 1);

  // Three hits, spaced so invulnerability expires between them: run over.
  const run3 = startRun(WAVE_SETS[0]);
  for (let h = 0; h < 3; h++) {
    run3.enemies.push({
      id: 90 + h, type: 'chaser', x: run3.x + 0.5, z: run3.z, vx: 0, vz: 0,
      hp: 1, maxHp: 1, r: 1, speed: 10.5, fireCd: 0, telegraph: false, spawnT: 0,
    });
    stepRun(run3, { mx: 0, mz: 0, aimX: 10, aimZ: 0, fire: false, dash: false }, 1 / 60);
    run3.invuln = 0; // expire invulnerability between hits
  }
  check('three hits end the run', run3.done && run3.reason === 'runOver' && run3.shields === 0);
}

// --- wave flow: clear a wave, breather, next wave, set complete ---
{
  const tiny = {
    id: 1, name: 't', seed: 1, theme: WAVE_SETS[0].theme,
    waves: [
      { groups: [{ type: 'chaser', count: 1, delay: 0 }] },
      { groups: [{ type: 'chaser', count: 1, delay: 0 }] },
    ],
  };
  const run = startRun(tiny);
  // Kill the single chaser of wave 1 with aimed fire.
  let evs = [];
  for (let i = 0; i < 600 && run.wavesCleared === 0; i++) {
    const t = nearestEnemy(run);
    const aim = t ? { aimX: t.x, aimZ: t.z } : { aimX: 10, aimZ: 0 };
    evs.push(...stepRun(run, { mx: 0, mz: 0, ...aim, fire: true, dash: false }, 1 / 60));
  }
  check('clearing a wave fires waveClear', evs.some((e) => e.type === 'waveClear'));
  check('wave clear awards the wave bonus', run.score >= WAVE_CLEAR_SCORE);
  check('wave clear advances the wave count', run.wavesCleared === 1);
  check('breather follows a cleared wave', run.waveState === 'breather');
  // Wait out the breather: wave 2 starts.
  for (let i = 0; i < 200 && run.waveIndex === 0; i++) {
    stepRun(run, { mx: 0, mz: 0, aimX: 10, aimZ: 0, fire: false, dash: false }, 1 / 60);
  }
  check('breather ends with the next wave', run.waveIndex === 1 && run.waveState === 'fight');
  // Clear wave 2: the set completes.
  evs = [];
  for (let i = 0; i < 600 && !run.done; i++) {
    const t = nearestEnemy(run);
    const aim = t ? { aimX: t.x, aimZ: t.z } : { aimX: 10, aimZ: 0 };
    evs.push(...stepRun(run, { mx: 0, mz: 0, ...aim, fire: true, dash: false }, 1 / 60));
  }
  check('clearing the last wave completes the set', run.done && run.reason === 'complete');
  check('set complete fires setComplete', evs.some((e) => e.type === 'setComplete'));
  check('set complete awards the set bonus', run.score >= WAVE_CLEAR_SCORE * 2 + SET_CLEAR_SCORE);
}

// --- determinism ---
{
  const a = simulateRun(WAVE_SETS[2], greedyPolicy);
  const b = simulateRun(WAVE_SETS[2], greedyPolicy);
  check('same policy gives the same result', JSON.stringify(a) === JSON.stringify(b));
  check('stationary policy is deterministic too',
    JSON.stringify(simulateRun(WAVE_SETS[2], stationaryPolicy)) === JSON.stringify(simulateRun(WAVE_SETS[2], stationaryPolicy)));
}

// --- anti-slop gate: sitting still and holding fire fails every wave set ---
for (const set of WAVE_SETS) {
  const res = simulateRun(set, stationaryPolicy);
  check(`stationary FAILS set ${set.id} "${set.name}" (waves ${res.waves}/${set.waves.length}, ${res.hitsTaken} hits, ${res.kills} kills)`,
    !res.completed);
}

// --- greedy bot completes every wave set ---
for (const set of WAVE_SETS) {
  const res = simulateRun(set, greedyPolicy);
  check(`greedy bot COMPLETES set ${set.id} "${set.name}" (${res.kills} kills, ${res.waves} waves, ${res.shields} shields left, score ${res.score}, max combo ${res.maxCombo})`,
    res.completed && res.shields > 0);
  check(`greedy bot scores on set ${set.id} (score ${res.score})`, res.score > 1000);
}

// --- feedback tiers ---
for (const [kind, f] of Object.entries(FEEDBACK)) {
  const tier = FEEDBACK_TIERS[f.tier];
  check(`feedback ${kind} trauma ${f.trauma} is inside its ${f.tier} tier`,
    f.trauma >= tier.traumaMin && f.trauma <= tier.traumaMax);
  check(`feedback ${kind} hit-stop ${f.hitStop}s is inside its ${f.tier} tier`,
    f.hitStop >= tier.stopMin && f.hitStop <= tier.stopMax);
}
check('runOver is the large tier', FEEDBACK.runOver.tier === 'large');
check('hit is the medium tier', FEEDBACK.hit.tier === 'medium');
check('shoot, kill and pickup are small with no hit-stop',
  FEEDBACK.shoot.tier === 'small' && FEEDBACK.shoot.hitStop === 0
  && FEEDBACK.kill.tier === 'small' && FEEDBACK.pickup.tier === 'small');

// --- feedback layers (5-8 layered responses per event) ---
{
  const KNOWN_LAYERS = new Set(['sound', 'particles', 'shake', 'hitStop', 'flash',
    'knockback', 'squash', 'slowMo', 'fovPulse', 'pop', 'ringPulse', 'glowPulse', 'toast']);
  for (const [kind, layers] of Object.entries(FEEDBACK_LAYERS)) {
    check(`feedback layers defined for ${kind}`, Array.isArray(layers));
    check(`feedback ${kind} carries 5-8 layers (${layers.length}: ${layers.join(', ')})`,
      layers.length >= 5 && layers.length <= 8);
    check(`feedback ${kind} layers are all known channels`,
      layers.every((l) => KNOWN_LAYERS.has(l)));
    check(`feedback ${kind} has no duplicate layers`, new Set(layers).size === layers.length);
  }
  check('every FEEDBACK event has a layer bundle',
    Object.keys(FEEDBACK).every((k) => k in FEEDBACK_LAYERS));
  check('every layer bundle maps to a FEEDBACK event',
    Object.keys(FEEDBACK_LAYERS).every((k) => k in FEEDBACK));
  check('small events have no hit-stop layer',
    ['launch', 'shoot', 'kill', 'pickup', 'dash'].every((k) => !FEEDBACK_LAYERS[k].includes('hitStop')));
  check('large event has hit-stop + flash + knockback',
    FEEDBACK_LAYERS.runOver.includes('hitStop')
    && FEEDBACK_LAYERS.runOver.includes('flash')
    && FEEDBACK_LAYERS.runOver.includes('knockback'));
  check('hit carries knockback too (the sim impulses velocity away from the source)',
    FEEDBACK_LAYERS.hit.includes('knockback'));
  check('hit and runOver carry squash + toast',
    FEEDBACK_LAYERS.hit.includes('squash') && FEEDBACK_LAYERS.hit.includes('toast')
    && FEEDBACK_LAYERS.runOver.includes('squash') && FEEDBACK_LAYERS.runOver.includes('toast'));
  check('score events pop a number (kill/pickup/waveClear/setComplete)',
    ['kill', 'pickup', 'waveClear', 'setComplete'].every((k) => FEEDBACK_LAYERS[k].includes('pop')));
}

// --- seeded determinism helpers ---
{
  const a = mulberry32(42), b = mulberry32(42);
  check('same seed gives same sequence', a() === b() && a() === b());
  check('different seed gives different sequence', mulberry32(7)() !== mulberry32(42)());
  check('clamp passes values through', clamp(5, 0, 10) === 5);
  check('clamp floors and caps', clamp(-3, 0, 10) === 0 && clamp(99, 0, 10) === 10);
}

// --- save round-trip ---
{
  const save = defaultSave();
  check('default save has schema version 2', save.version === SAVE_VERSION);
  check('default save has no bests', Object.keys(save.best).length === 0);
  check('default save has a fresh campaign', JSON.stringify(save.campaign) === JSON.stringify(defaultCampaign()));
  check('default campaign starts at set 1 with nothing banked',
    save.campaign.nextSet === 1 && save.campaign.score === 0 && save.campaign.energy === 0
    && Object.keys(save.campaign.upgrades).length === 0 && save.campaign.best === 0);
  recordBest(save, 1, 1234, 3);
  check('recordBest stores score and waves', save.best[1].score === 1234 && save.best[1].waves === 3);
  recordBest(save, 1, 900, 4);
  check('recordBest keeps the better of each', save.best[1].score === 1234 && save.best[1].waves === 4);
  recordBest(save, 6, 99999, 5);
  check('recordBest stores bests for set 6', save.best[6].score === 99999 && save.best[6].waves === 5);
  recordBest(save, 12, 72745, 5);
  check('recordBest stores bests for set 12', save.best[12].score === 72745 && save.best[12].waves === 5);
  recordBest(save, 'survival', 54321, 9);
  check('recordBest stores a survival best (score + waves survived)', save.best.survival.score === 54321 && save.best.survival.waves === 9);
  const back = parseSave(serializeSave(save));
  check('save round-trips bests', back.best[1].score === 1234 && back.best[1].waves === 4);
  check('save round-trips set 6 bests', back.best[6].score === 99999 && back.best[6].waves === 5);
  check('save round-trips set 12 bests', back.best[12].score === 72745 && back.best[12].waves === 5);
  check('save round-trips the survival best', back.best.survival.score === 54321 && back.best.survival.waves === 9);
  check('garbage save text falls back to defaults', parseSave('not json').version === SAVE_VERSION);
  check('save drops bests for unknown sets', Object.keys(parseSave('{"best":{"99":{"score":1,"waves":1}}}').best).length === 0);
  check('save clamps absurd scores', parseSave('{"best":{"1":{"score":99999999,"waves":9}}}').best[1].score === 10000000);
  check('save round-trips mute and shake', parseSave('{"muted":true,"shake":0.5}').muted === true
    && parseSave('{"muted":true,"shake":0.5}').shake === 0.5);
  check('default save follows the OS for flashing (null = unset)', defaultSave().reduceFlashing === null);
  check('save round-trips audio settings',
    parseSave('{"music":false,"sfx":false,"volume":0.3}').music === false
    && parseSave('{"music":false,"sfx":false,"volume":0.3}').sfx === false
    && parseSave('{"music":false,"sfx":false,"volume":0.3}').volume === 0.3);
  // Campaign save validation.
  const camp = parseSave('{"campaign":{"nextSet":5,"score":12345,"energy":37,"upgrades":{"rapid":2,"twin":1,"nope":3},"best":99999}}');
  check('save round-trips campaign progress', camp.campaign.nextSet === 5 && camp.campaign.score === 12345
    && camp.campaign.energy === 37 && camp.campaign.best === 99999);
  check('save round-trips campaign upgrades', camp.campaign.upgrades.rapid === 2 && camp.campaign.upgrades.twin === 1);
  check('save drops unknown campaign upgrades', !('nope' in camp.campaign.upgrades));
  check('save clamps campaign upgrades to the max', parseSave('{"campaign":{"upgrades":{"rapid":9}}}').campaign.upgrades.rapid === 3);
  check('save clamps campaign nextSet', parseSave('{"campaign":{"nextSet":99}}').campaign.nextSet === 13);
  check('save without a campaign field gets a fresh one', parseSave('{"best":{}}').campaign.nextSet === 1);
}

// --- M5: FPS guard + accessibility save fields ---
{
  check('perf ladder starts at full resolution and steps down to 1', PERF_LEVELS[0] === 2 && PERF_LEVELS[PERF_LEVELS.length - 1] === 1);
  check('perf ladder is strictly decreasing', PERF_LEVELS.every((v, i) => i === 0 || v < PERF_LEVELS[i - 1]));
  check('guard steps down when fps is low for the full window', perfGuardStep(0, 30, 3000) === 1);
  check('guard steps down from any rung below the max', perfGuardStep(1, 20, 5000) === 2);
  check('guard does not step down when fps is fine', perfGuardStep(0, 55, 10000) === 0);
  check('guard does not step down before the window elapses', perfGuardStep(0, 30, 2999) === 0);
  check('guard does not step down at exactly the threshold fps', perfGuardStep(0, 45, 3000) === 0);
  check('guard never steps past the last rung', perfGuardStep(PERF_LEVELS.length - 1, 10, 99999) === PERF_LEVELS.length - 1);
  check('guard clamps an out-of-range level', perfGuardStep(99, 10, 99999) === PERF_LEVELS.length - 1);
  check('default save has Normal text size and no high contrast', defaultSave().textSize === 1 && defaultSave().highContrast === false);
  check('save round-trips Large text + high contrast',
    parseSave('{"textSize":1.2,"highContrast":true}').textSize === 1.2
    && parseSave('{"textSize":1.2,"highContrast":true}').highContrast === true);
  check('save round-trips Extra large text', parseSave('{"textSize":1.4}').textSize === 1.4);
  check('save rejects an invalid text size', parseSave('{"textSize":9}').textSize === 1);
  check('save rejects a non-boolean high contrast', parseSave('{"highContrast":"yes"}').highContrast === false);
  check('old save without the M5 fields gets the defaults',
    parseSave('{"muted":true}').textSize === 1 && parseSave('{"muted":true}').highContrast === false);
}

console.log(`\nsmoke: ${passed} passed, ${failed} failed`);
if (failed) { console.error('smoke: FAILURES:', failures.join('; ')); process.exit(1); }
console.log('smoke: PASS');
