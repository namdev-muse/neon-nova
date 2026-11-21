// Neon Nova v1.0.0 — bot harness: the greedy combat bot plays every
// wave set to completion through the public stepRun + policy hooks, and
// the anti-slop gate asserts sitting still and holding fire CANNOT
// finish any wave set — if the bot could clear a set without moving,
// the set would not be done. M4 adds the survival gate (a stationary
// ship dies within the first two waves) and the upgraded-bot gate
// (a mid-campaign loadout goes deeper in survival and clears set 12
// with shields to spare).
import { WAVE_SETS, makeSurvivalSet, simulateRun, stationaryPolicy, greedyPolicy } from '../physics.js';

let failures = 0;
for (const set of WAVE_SETS) {
  const bot = simulateRun(set, greedyPolicy);
  const still = simulateRun(set, stationaryPolicy);
  console.log(`Set ${set.id} "${set.name}": bot ${bot.completed ? 'COMPLETE' : 'FAILED'}`
    + ` in ${bot.time.toFixed(1)}s, score ${bot.score}`
    + ` (${bot.kills} kills, ${bot.waves}/${set.waves.length} waves, max combo ${bot.maxCombo},`
    + ` ${bot.hitsTaken} hits, ${bot.shields} shields left, ${bot.dashes} dashes)`
    + ` | stationary: ${still.completed ? 'CLEARED (SLOP!)' : `failed at wave ${still.waves + 1}`}`);
  if (!bot.completed) { failures++; console.error(`  BOT FAIL: set ${set.id} not completed by the combat bot`); }
  if (bot.shields <= 0) { failures++; console.error(`  BOT FAIL: set ${set.id} bot finished with no shields`); }
  if (still.completed) { failures++; console.error(`  BOT FAIL: set ${set.id} is clearable by sitting still and holding fire — tighten the set`); }
  if (bot.kills === 0) { failures++; console.error(`  BOT FAIL: set ${set.id} bot killed nothing`); }
}

// Upgraded bot: a mid-campaign loadout (rapid 2, twin 1, heavy 1,
// hull 1, dash 1) clears the hardest set with shields to spare —
// upgrades must feel earned AND meaningful.
{
  const loadout = { rapid: 2, twin: 1, heavy: 1, hull: 1, dash: 1 };
  const up = simulateRun(WAVE_SETS[11], greedyPolicy, { mode: 'campaign', upgrades: loadout });
  console.log(`Upgraded bot set 12: ${up.completed ? 'COMPLETE' : 'FAILED'}, ${up.shields} shields left, ${up.kills} kills, score ${up.score}, ${up.hitsTaken} hits`);
  if (!up.completed) { failures++; console.error('  BOT FAIL: upgraded bot did not complete set 12'); }
  if (up.shields < 2) { failures++; console.error(`  BOT FAIL: upgraded bot finished set 12 with only ${up.shields} shield(s) — upgrades should buy real safety`); }
}

// Survival: the greedy bot survives deep, a mid loadout goes deeper,
// and a stationary ship dies in the first two waves — survival is an
// endless mode, so the gate is the run, not a single wave: the
// teaching wave 1 is clearable by a perfect-aim turret, but the run
// ends in wave 2 because the ship never dodges bolts or the second
// staggered group.
{
  const survival = makeSurvivalSet(42);
  const stock = simulateRun(survival, greedyPolicy, { mode: 'survival' });
  console.log(`Survival (stock): bot survives ${stock.waves} waves in ${stock.time.toFixed(1)}s, score ${stock.score}, ${stock.kills} kills`);
  if (stock.waves < 6) { failures++; console.error(`  BOT FAIL: greedy bot survived only ${stock.waves} survival waves (want 6+)`); }
  const mid = simulateRun(survival, greedyPolicy, { mode: 'survival', upgrades: { rapid: 2, twin: 1, hull: 1 } });
  console.log(`Survival (mid loadout): bot survives ${mid.waves} waves, score ${mid.score}`);
  if (mid.waves <= stock.waves) { failures++; console.error(`  BOT FAIL: mid loadout survived ${mid.waves} waves, no deeper than stock ${stock.waves} — upgrades must matter`); }
  const still = simulateRun(survival, stationaryPolicy, { mode: 'survival' });
  console.log(`Survival (stationary): died in wave ${still.waves + 1} after ${still.time.toFixed(1)}s, ${still.kills} kills`);
  if (still.waves > 1 || still.time > 15) { failures++; console.error(`  BOT FAIL: stationary ship survived ${still.waves} survival waves / ${still.time.toFixed(1)}s — survival must punish standing still fast`); }
}

if (failures) { console.error(`bot: ${failures} failure(s)`); process.exit(1); }
console.log(`bot: PASS — combat bot completes all ${WAVE_SETS.length} wave sets, sitting still fails all ${WAVE_SETS.length}, survival gates hold`);
