# Neon Nova — devlog

## M6 — Release (v1.0.0, 2026-11-21)

No new gameplay — this milestone is the release. Version bumped to
v1.0.0 across the code, tests and docs; README refreshed (smoke count
304, Firefox render check, known-issues section carried over from the
M5 log so the release is honest about what it is); screenshots
regenerated from the final build; full test suite green, a final
real-browser playthrough in a real browser, and the release tagged
v1.0.0 on GitHub. Neon Nova ships as: 12 hand-crafted wave sets,
Campaign, endless Survival, 6 ship upgrades, generative music,
accessibility settings (text size, high contrast, shake, flashing),
touch controls, and the FPS guard.

Result: smoke 304/304, bot completes all 12 sets, render check PASS
in Chromium and Firefox (zero console errors), size sweep inspected
by eye at 1280x720, 2560x1080 and 1080x2340 (menu, gameplay,
settings, upgrade at 2560 — all clean). Final playthrough (real
mouse + held WASD, campaign): **GO** — cleared set 1 (48 kills,
14,220, max combo chain 36, finished on 1 shield — it fought),
bought Magnet Core on the draft screen, carried the loadout into set
2 and fought to wave 4 (39 kills, 23,550) before dying to the
Crossfire shooters — an honest death, not a systematic one. FOV
kicked 55 → 63.7, trauma peaked 0.84, every feedback bundle fired,
zero console errors. Push: 4 commits (039751c/57a56b1/85a6a44/
f5ea8ae) — live site verified serving v1.0.0 by curl + connector
read-back; release tag v1.0.0 created.

### Known issues (v1.0.0)

- Survival wave 1 is clearable by a perfect-aim stationary turret (M4)
  — the run-level gate holds (dies in wave 2 at 7.6s).
- Set 1 is still easy for a good player (M4) — the ramp lives in
  sets 2–12.
- Campaign progress is kept in the local save only — no cloud sync.
- The FPS guard is one-way during a run: it never steps back up
  mid-run, only on returning to the menu. Deliberate — stepping up
  again would thrash on a marginal device.

## M5 — Polish & robustness (v0.5.0, 2026-11-21)

No new modes, no new enemies — this milestone is the game growing up.
**Accessibility** is now real instead of half-wired: the high-contrast
palette already existed in the CSS but nothing ever turned it on, so
there is now a High contrast toggle in Settings, plus a Text size
setting (Normal / Large / Extra large, 100/120/140% root font size).
Both persist in the save and re-apply on boot. **Performance:** an FPS
guard watches the frame rate during a run — sustained sub-45fps steps
the render resolution down a ladder (pixel ratio 2 → 1.5 → 1.25 → 1,
one step per 3s low window, no thrash), tells the player once per step,
and restores full resolution when they return to the menu. The guard's
decision is a pure function, unit-tested; the live wiring (level →
renderer pixel ratio → restore on menu) is asserted in the render
check. **Touch** got its first real verification: the stick drag moves
the ship, the aim-side drag fires, the DASH button appears on first
touch — all through the real pointer handlers. **Bugs fixed:** the
set-clear toast no longer shows through the upgrade overlay (it is
hidden whenever any screen opens — the M4 cosmetic where it overlapped
the combo line at 2560 and in portrait), and "9. Rolling Thunder" no
longer wraps to two lines in its menu card. **Cross-browser:** the
render check now runs under Firefox as well as Chromium
(`PW_BROWSER=firefox`).

Result: smoke 304/304, bot completes all 12 sets, render check clean
in Chromium and Firefox, size sweep inspected by eye at 1280x720,
2560x1080 and 1080x2340 (menu, gameplay, settings, upgrade at 2560),
real-browser probe cleared set 1 again — no M5 regression.

### Known issues (M5)

- Survival wave 1 is clearable by a perfect-aim stationary turret (M4)
  — the run-level gate holds (dies in wave 2 at 7.6s).
- Set 1 is still easy for a good player (M4) — the ramp lives in sets
  2–12.
- Campaign progress is kept in the local save only — no cloud sync.
- The FPS guard is one-way during a run: it never steps back up
  mid-run, only on returning to the menu. Deliberate — stepping up
  again would thrash on a marginal device.

## M4 — Progression & depth (v0.4.0, 2026-11-21)

The game now has a reason to come back. **Campaign** plays all 12 sets
in a row: score, energy and upgrades carry across sets, shields refill
between sets, and death ends the campaign (best total kept, progress
resets — a roguelite run, not a grind). **Survival** is endless
escalating waves, chosen over Time Attack because the core is
aim-and-move under pressure and a clock would reward rushing rather
than the careful flying the game is built on. **Upgrades** are bought
with energy — six of them, each with levels that genuinely change the
ship (Rapid Fire, Twin Shot, Heavy Rounds, Reinforced Hull, Dash
Recharge, Magnet Core) — and everything costs 163 energy while one
campaign earns roughly 150–200, so a build is a choice. **Gates:**
clearing a set unlocks the next; clearing Set 1 unlocks Survival. The
combo window tightened 3.5s → 2.5s (it sat at x4 from wave 2 on).

The numbers say the progression works: a stock bot survives 9 survival
waves, a mid-campaign loadout 17, a maxed one 30 — and the upgraded bot
clears set 12 with 4 shields and 0 hits, where the stock bot took 2
hits and finished on 1 shield. A stationary ship dies in survival wave
2 at 7.6s, so the endless mode punishes standing still fast. One honest
caveat: the perfect-aim stationary turret *does* clear survival wave 1
(the teaching wave, 10 chasers in two staggered groups) — the gate for
an endless mode is the run, not the first wave, and the run ends 7.6
seconds in. Result: smoke 289/289, bot completes all 12 sets,
render check clean including the full campaign upgrade flow (buy,
carry-over, gates) and a survival run. Real-browser probes: the
first two died in set 1 (waves 3 and 4 — the shooter introduction
was too hot for a cold player), so set 1 was retuned (wave-3
shooters 2→1, wave-4 3→2, 51→49 enemies) and the next two probes
cleared it; the last one bought Magnet Core on the first draft,
fought set 2 with the loadout, and fought survival to wave 5 alive.
Two bugs found by the probes and fixed along the way: the upgrade
screen read the finished run's stale energy (display and
affordability stayed pre-purchase, and a second buy could
double-spend — it now reads the banked campaign energy), and drafts
could roll nothing affordable at 5–8 energy (the roll now
guarantees an affordable offer when one exists, and Magnet Core
costs 5 instead of 6).

### Known issues (M4)

- Survival wave 1 is clearable by a perfect-aim stationary turret (see
  above) — the run-level gate holds, but the first wave is the gentlest
  in the mode by design.
- Set 1 is still easy for a good player (clean clear, combo never
  breaks) — the ramp lives in sets 2–12.
- Campaign progress is kept in the local save only — no cloud sync.

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
