// Neon Nova v0.1.0 — bot harness: the greedy combat bot plays every
// wave set to completion through the public stepRun + policy hooks, and
// the anti-slop gate asserts sitting still and holding fire CANNOT
// finish any wave set — if the bot could clear a set without moving,
// the set would not be done.
import { WAVE_SETS, simulateRun, stationaryPolicy, greedyPolicy } from '../physics.js';

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

if (failures) { console.error(`bot: ${failures} failure(s)`); process.exit(1); }
console.log('bot: PASS — combat bot completes all 6 wave sets, sitting still fails all 6');
