# Neon Nova — devlog

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
