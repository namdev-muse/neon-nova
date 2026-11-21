# Neon Nova — devlog

## M3 — Feel & juice (v0.3.0, 2026-11-21)

Every combat event now fires its full layered bundle in one frame:
kills burst into particles, a shockwave ring and a score pop; taking a
hit shakes the camera, flashes the screen, squashes the ship, knocks it
back and freezes time for a beat, with slow-mo on the last shield. The
camera leans toward your aim and widens its field of view as you fly
faster. The soundtrack layers a bass line, a bar pad and — from wave 2
— a lead arpeggio; on the last shield a red vignette breathes at the
edges and a soft heartbeat thumps. The audit that started this
milestone found 5 of 9 bundles incomplete and one dead feature (the
enemy hit-flash, never wired up since M1) — all fixed, and the render
check now reads the bundles back from the live game's feedback log.
One real bug surfaced along the way: ram knockback was inverted,
shoving the ship into the rammer; it now pushes away from the source
and was softened from 14 to 9 u/s after the correct direction killed
the bot on sets 9 and 12. Result: smoke 208/208, bot completes all 12
sets, render check clean, and a real-browser probe cleared set 1 (51
kills, 18,130, combo x4.0) and fought set 7 to wave 2.

### Known issues (M3)

- Set 1 is still easy for a good player (clean clear, combo never
  breaks) — the ramp lives in sets 2–12.
- Combo window (3.5s) may be too forgiving — the multiplier sits at
  x4.0 from wave 2 on. M4 economy tuning.

## M2 — Wave craft (v0.2.0, 2026-11-21)

Twelve campaign wave sets, each with its own identity. The six new sets
are shooter-heavy (Bolt Storm), splitter-heavy (Split Flood), staggered
rhythm (Rolling Thunder), chaser floods in rolling waves (Floodgate),
mixed siege (Nova Siege) and the hardest gauntlet (Final Nova). Threat
rises smoothly across all 12 sets (53.5 → 189.5, no adjacent jump above
1.33x, and the new sets sit at 1.05–1.15x each) and every set carries a
distinct ring/disc palette. The save schema now keeps bests for sets
1–12. Two tuning rounds were needed: the first Floodgate and Final Nova
crushed the greedy bot at their last waves (3 hits, run over), so the
big groups were split into three staggered arrivals 1.5s apart — same
headcount, survivable arrivals. Result: the greedy bot completes all 12
sets (0–2 hits taken, Floodgate the hardest at 2 hits / 1 shield left),
sitting still fails all 12. Real-browser playtests of sets 7, 9 and 12
all GO — see the M2 run report for the per-set verdicts.

### Known issues (M2)

- Set 1 is still easy for a good player (clean clear, combo never
  breaks) — the ramp lives in sets 2–12.
- Combo window (3.5s) may be too forgiving — the multiplier sits at
  x4.0 from wave 2 on. M4 economy tuning.

## M1 — Core (v0.1.0, 2026-11-21)

The fifth game in the rotation, and the third 3D game of the loop:
a 3D neon arena shooter. The ship flies freely in a bounded arena;
the player moves with WASD/arrows (momentum + banking), aims with the
mouse, fires with click/Space, and dashes with Shift (cooldown + brief
invulnerability). Chasers, shooters and splitters attack in 6 dense
hand-crafted wave sets. Kills chain a combo multiplier (up to x4);
3 shields; score from kills + wave bonuses; best score saved per set.

### What was built

- **physics.js** — pure simulation core (no DOM, no Three.js):
  arena flight with momentum, mouse aim, firing, dash, three enemy
  types + minis, wave system with spawn groups on a 13-unit ring,
  energy pickups, combo scoring, 3-shield lives, save schema.
- **game.js** — Three.js 0.160.0 scene: angled top-down camera with
  trauma shake, FOV pulse, hit-stop, near-death slow-mo, pooled
  particles/bullets/rings, Web Audio synth SFX + generative bass
  sequencer, live-3D menu with attract flight, screen-stack UI
  (menu / how-to / settings / pause / set-clear / run-over), touch
  controls (stick + aim-drag + dash button).
- **Tests** — smoke (183 checks), bot harness, headless-Chromium
  render check (menu, movement, screen-space aim, firing, dash, kill,
  wave clear, shield loss, run-over, zero console errors), screenshot
  capture + 3-resolution size sweep.

### The anti-slop fight (worth recording)

The first version of the wave sets let the stationary bot — sit still,
hold fire — clear 5 of 6 sets. The bot's kill rate at close range
(~1 kill per 0.3s, perfect aim) beat the chasers' arrival rate because
spawns at the far arena edge took ~3s to arrive. Three fixes, in order:

1. Spawn on a **ring 12–13.5 units from the ship** instead of the arena
   edge, so enemies arrive on a consistent ~1s clock in a tight window.
2. **Faster chasers** (13.5 u/s) and a **quicker first shooter bolt**
   (first shot ~0.7s after spawn instead of ~1.5s).
3. **Bigger simultaneous groups** (6–7 chasers at once, staggered
   1.5s apart so the second group arrives after invulnerability
   expires).

Result: the greedy combat bot still completes all 6 sets (0–1 hits
taken), while sitting still fails all 6 — wave 1 of set 1 is the last
one to fall, and it now fails at wave 3. The lesson, again: the
stationary bot is the honest playtester. If it can clear a set, the
set is not done.

### Known issues (M1)

- The greedy bot takes 1 hit on wave set 6 (2 shields left) — the
  gauntlet is meant to be hard, but M2 should check whether a human
  finds it fair.
- Swiftshader (headless) runs the game at ~0.33x real time; all
  browser checks poll rather than using fixed windows.
