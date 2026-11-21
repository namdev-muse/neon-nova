// Neon Nova v0.3.0 — headless Chromium render check.
// Serves the game dir over local HTTP, loads it in headless Chromium, and
// asserts the M1 core, by hook and by eye:
//   - the menu renders over a LIVE 3D scene (the attract flight actually
//     flies — the demo ship moves), with no version/engine text anywhere
//     the player can see, one clear primary Play action, and 12 wave-set cards
//   - Play starts a run: the HUD shows, the ship moves (hook + real keys),
//     and movement direction is asserted in SCREEN space
//   - aim is asserted in SCREEN space: the mouse screen position maps to
//     the aim direction the player sees (the Drift M2 lesson — a mirrored
//     input bug survived every world-space test)
//   - firing spawns shots, the autopilot (greedy combat bot) scores a
//     kill and clears wave 1, dash works with cooldown + invulnerability
//   - seeking an enemy costs a shield (flash fires, and is suppressed
//     with reduce-flashing on); losing all 3 shields ends the run
//   - pause focuses Resume; Enter resumes; R restarts
//   - zero console errors and zero page errors, and a WebGL context exists
//
// CDN note: the repo pins Three.js 0.160.0 from jsdelivr and does NOT
// vendor it. The sandboxed browser cannot reach the jsdelivr CDN (the VM
// egress proxy answers policy_denied to every non-curl/wget client,
// including Chromium and Firefox), even though curl gets HTTP 200 for the
// pinned URL from this VM. So this check downloads the pinned module with
// curl into the OS temp dir and fulfils that one request locally via
// Playwright routing — the page still requests the exact pinned URL, and
// the repo keeps no copy of Three.js. On a machine where the browser can
// reach the CDN, set NO_THREE_CACHE=1 to skip the substitution and load
// it live.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';

const GAME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_DIR = path.join(os.tmpdir(), 'neon-nova-render-check');
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
const THREE_CACHE = path.join(os.tmpdir(), 'neon-nova-three-0.160.0.module.js');

async function fetchThreeModule() {
  try {
    const st = fs.statSync(THREE_CACHE);
    if (st.size > 100000) return THREE_CACHE;
  } catch { /* not cached yet */ }
  await new Promise((resolve, reject) => {
    execFile('curl', ['-s', '-o', THREE_CACHE, THREE_URL], (err) => (err ? reject(err) : resolve()));
  });
  const st = fs.statSync(THREE_CACHE);
  if (st.size < 100000) throw new Error(`downloaded Three.js module is unexpectedly small (${st.size} bytes)`);
  return THREE_CACHE;
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

function findHeadlessShell() {
  const base = path.join(os.homedir(), '.cache', 'ms-playwright');
  try {
    for (const entry of fs.readdirSync(base)) {
      const candidate = path.join(base, entry, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch { /* cache dir missing */ }
  return null;
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.join(GAME_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(GAME_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const require = createRequire(import.meta.url);
const playwrightPath = fileURLToPath(new URL('../../neon-hexfall/node_modules/playwright-core', import.meta.url));
const { chromium } = require(playwrightPath);
const executablePath = findHeadlessShell();
console.log('render-check: chromium executable:', executablePath || '(playwright default)');
const launchArgs = ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'];

const errors = [];
let browser;
try {
  browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: launchArgs,
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    timezoneId: 'Asia/Bangkok',
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('console: ' + msg.text());
  });
  page.on('pageerror', (err) => errors.push('pageerror: ' + String(err)));

  if (!process.env.NO_THREE_CACHE) {
    const cached = await fetchThreeModule();
    console.log(`render-check: fulfilling pinned three@0.160.0 from local curl cache (${cached}) — sandboxed browser cannot reach jsdelivr directly`);
    await page.route(THREE_URL, (route) => route.fulfill({ path: cached }));
  }

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });

  try {
    await page.waitForFunction(() => window.__nova, null, { timeout: 30000 });
  } catch {
    console.error('render-check: window.__nova never appeared — the pinned Three.js module failed to load.');
    console.error('CDN check from this VM: curl -sI ' + THREE_URL + ' (expect HTTP 200).');
    throw new Error('game module did not initialise (see CDN note above)');
  }

  const version = await page.evaluate(() => window.__nova.version);
  if (version !== '0.3.0') throw new Error(`expected version 0.3.0, got ${version}`);
  console.log('render-check: game module initialised, version 0.3.0');

  // WebGL context exists and the canvas is on screen.
  const gl = await page.evaluate(() => {
    const canvas = document.querySelector('#game-container canvas');
    if (!canvas) return null;
    const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return ctx ? { width: canvas.width, height: canvas.height } : null;
  });
  if (!gl) throw new Error('no WebGL context on the game canvas');
  console.log(`render-check: WebGL context live (${gl.width}x${gl.height} canvas)`);

  // The menu: title, one primary Play, 12 wave-set cards, NO version/engine
  // text anywhere the player can see.
  const menuText = await page.textContent('#menu');
  if (!menuText.includes('NEON NOVA')) throw new Error('menu title missing');
  if (menuText.includes('v0.3.0') || menuText.includes('Three.js') || menuText.includes('0.160.0')) {
    throw new Error('menu shows version/engine text — it must live in the README only');
  }
  const playClass = await page.getAttribute('#btn-play', 'class');
  if (!playClass || !playClass.includes('primary')) throw new Error('Play is not the primary action');
  const setCards = await page.locator('#set-select .set-card').count();
  if (setCards !== 12) throw new Error(`expected 12 wave-set cards, got ${setCards}`);
  const sets = await page.evaluate(() => window.__nova.waveSets());
  if (sets.length !== 12 || sets[0].name !== 'First Contact' || sets[5].name !== 'Nova Gauntlet' || sets[11].name !== 'Final Nova') {
    throw new Error(`wave set list wrong: ${JSON.stringify(sets.map((s) => s.name))}`);
  }
  console.log('render-check: menu renders — live 3D behind it, no version text, Play primary, 12 wave sets');

  // The attract flight flies behind the menu: the demo ship moves
  // (position change, not just kills — the ship must actually fly).
  const demo0 = await page.evaluate(() => window.__nova.info());
  if (!demo0) throw new Error('no demo info in the menu phase');
  await page.waitForFunction((p0) => {
    const i = window.__nova.info();
    return Math.hypot(i.ship.x - p0.x, i.ship.z - p0.z) > 2;
  }, { x: demo0.ship.x, z: demo0.ship.z }, { timeout: 60000 });
  const demo1 = await page.evaluate(() => window.__nova.info());
  console.log(`render-check: attract flight alive — demo ship moved (${demo0.ship.x.toFixed(1)}, ${demo0.ship.z.toFixed(1)}) -> (${demo1.ship.x.toFixed(1)}, ${demo1.ship.z.toFixed(1)}), kills ${demo1.kills}`);

  // Menu screenshot for the by-eye check (inspected after the run).
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  await page.waitForTimeout(1200); // let the menu pop-in finish + the attract ship fly in
  await page.screenshot({ path: path.join(SHOTS_DIR, 'menu-1280x720.png') });
  console.log(`render-check: menu screenshot saved to ${SHOTS_DIR}/menu-1280x720.png — INSPECT BY EYE (live 3D scene, no clipped cards)`);

  // PLAY starts wave set 1 with the HUD.
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__nova.state.phase === 'run', null, { timeout: 5000 });
  if (!await page.isVisible('#hud')) throw new Error('HUD not visible after PLAY');
  const hudSet = await page.textContent('#hud-set');
  if (!hudSet.includes('First Contact')) throw new Error(`expected wave set 1 First Contact, got: ${hudSet}`);
  console.log('render-check: PLAY starts wave set 1 (First Contact), HUD visible');

  // Music: the sequencer runs after the Play gesture and advances.
  const audio0 = await page.evaluate(() => window.__nova.info().audio);
  if (!audio0) throw new Error('no AudioContext after the Play gesture');
  if (!audio0.music) throw new Error('music sequencer is not running');
  await page.waitForTimeout(2500);
  const audio1 = await page.evaluate(() => window.__nova.info().audio);
  if (audio1.musicStep <= audio0.musicStep) throw new Error(`music sequencer did not advance (step ${audio0.musicStep} -> ${audio1.musicStep})`);
  console.log(`render-check: music sequencer running (state ${audio1.state}, step ${audio0.musicStep} -> ${audio1.musicStep})`);

  // Movement moves the ship: hold the hook input right until the ship
  // has clearly moved (poll, not a fixed window — under swiftshader a
  // second of real time is only a few frames of game time).
  const before = await page.evaluate(() => window.__nova.info().ship);
  await page.evaluate(() => window.__nova.setMove(1, 0));
  try {
    await page.waitForFunction(() => window.__nova.info().ship.x > 1, null, { timeout: 20000 });
  } finally {
    await page.evaluate(() => window.__nova.clearMove());
  }
  const after = await page.evaluate(() => window.__nova.info().ship);
  if (!(after.x > before.x + 1)) {
    throw new Error(`moving right did not move the ship: x ${before.x.toFixed(2)} -> ${after.x.toFixed(2)}`);
  }
  console.log(`render-check: movement moves the ship (x ${before.x.toFixed(2)} -> ${after.x.toFixed(2)}, vx ${after.vx.toFixed(1)})`);

  // Real keyboard movement works too, and direction is asserted in
  // SCREEN space: ArrowLeft must move the ship LEFT on screen,
  // ArrowRight RIGHT. The camera looks from +z, so world x is NOT
  // screen x — the Drift M2 lesson.
  const scr0 = await page.evaluate(() => window.__nova.info().screen);
  await page.keyboard.down('ArrowLeft');
  try {
    await page.waitForFunction((x0) => window.__nova.info().screen.x < x0 - 20, scr0.x, { timeout: 20000 });
  } finally {
    await page.keyboard.up('ArrowLeft');
  }
  const scrL = await page.evaluate(() => window.__nova.info().screen);
  if (!(scrL.x < scr0.x - 20)) {
    throw new Error(`ArrowLeft did not move the ship left on screen: ${scr0.x.toFixed(0)} -> ${scrL.x.toFixed(0)}`);
  }
  console.log(`render-check: ArrowLeft moves the ship left on screen (${scr0.x.toFixed(0)} -> ${scrL.x.toFixed(0)})`);
  await page.keyboard.down('ArrowRight');
  try {
    await page.waitForFunction((x0) => window.__nova.info().screen.x > x0 + 20, scrL.x, { timeout: 20000 });
  } finally {
    await page.keyboard.up('ArrowRight');
  }
  const scrR = await page.evaluate(() => window.__nova.info().screen);
  if (!(scrR.x > scrL.x + 20)) {
    throw new Error(`ArrowRight did not move the ship right on screen: ${scrL.x.toFixed(0)} -> ${scrR.x.toFixed(0)}`);
  }
  console.log(`render-check: ArrowRight moves the ship right on screen (${scrL.x.toFixed(0)} -> ${scrR.x.toFixed(0)})`);

  // M3: speed FOV kick — flying fast widens the view, and it settles
  // back to exactly 55 when the ship slows.
  await page.keyboard.down('ArrowRight');
  try {
    await page.waitForFunction(() => window.__nova.info().ship.speed > 10, null, { timeout: 20000 });
  } finally {
    await page.keyboard.up('ArrowRight');
  }
  const fastFov = await page.evaluate(() => window.__nova.info().fov);
  if (!(fastFov > 56)) throw new Error(`speed FOV kick missing: fov ${fastFov.toFixed(2)} at speed > 10 (want > 56)`);
  console.log(`render-check: speed FOV kick fires (fov ${fastFov.toFixed(2)} while fast)`);
  await page.waitForFunction(() => {
    const i = window.__nova.info();
    return (i.ship.speed < 2 && Math.abs(i.fov - 55) < 0.5) || window.__nova.state.phase !== 'run';
  }, null, { timeout: 30000 });
  const slowFov = await page.evaluate(() => window.__nova.info().fov);
  console.log(`render-check: FOV settles back to 55 when slow (fov ${slowFov.toFixed(2)})`);
  // If the swarm caught the ship during the settle wait, restart
  // fresh before the aim test (aim is frozen once the run is over).
  const phaseAfterMove = await page.evaluate(() => window.__nova.state.phase);
  if (phaseAfterMove !== 'run') {
    await page.keyboard.press('r');
    await page.waitForFunction(() => window.__nova.state.phase === 'run', null, { timeout: 5000 });
    console.log('render-check: run ended during the movement legs — restarted fresh for the aim test');
  }

  // Aim is asserted in SCREEN space: the mouse screen position must
  // map to the aim direction the player sees. Move the mouse to the
  // right of the ship — the aim point must land near the mouse, on
  // the right of the ship on screen. Then to the left.
  const shipScr = await page.evaluate(() => window.__nova.info().screen);
  await page.mouse.move(Math.min(shipScr.x + 260, 1200), shipScr.y);
  await page.waitForTimeout(800);
  const aimR = await page.evaluate(() => window.__nova.info().aim);
  if (Math.abs(aimR.screen.x - Math.min(shipScr.x + 260, 1200)) > 80 || Math.abs(aimR.screen.y - shipScr.y) > 80) {
    throw new Error(`aim point does not follow the mouse on screen: mouse (${Math.min(shipScr.x + 260, 1200).toFixed(0)}, ${shipScr.y.toFixed(0)}), aim (${aimR.screen.x.toFixed(0)}, ${aimR.screen.y.toFixed(0)})`);
  }
  if (!(aimR.screen.x > shipScr.x + 50)) {
    throw new Error(`aiming right of the ship must put the aim point right on screen: ship ${shipScr.x.toFixed(0)}, aim ${aimR.screen.x.toFixed(0)}`);
  }
  console.log(`render-check: aim follows the mouse right on screen (mouse -> aim ${aimR.screen.x.toFixed(0)}, ${aimR.screen.y.toFixed(0)})`);
  await page.mouse.move(Math.max(shipScr.x - 260, 80), shipScr.y);
  await page.waitForTimeout(800);
  const aimL = await page.evaluate(() => window.__nova.info().aim);
  if (!(aimL.screen.x < shipScr.x - 50)) {
    throw new Error(`aiming left of the ship must put the aim point left on screen: ship ${shipScr.x.toFixed(0)}, aim ${aimL.screen.x.toFixed(0)}`);
  }
  console.log(`render-check: aim follows the mouse left on screen (aim ${aimL.screen.x.toFixed(0)}, ${aimL.screen.y.toFixed(0)})`);

  // Fresh run for the fire/dash/kill legs: the movement and aim
  // tests above left the ship standing still while the swarm closed
  // in, so the first run may already be over by now.
  await page.keyboard.press('r');
  await page.waitForFunction(() => {
    const i = window.__nova.info();
    return window.__nova.state.phase === 'run' && i.shotsFired === 0 && i.shields === 3;
  }, null, { timeout: 5000 });

  // Firing spawns shots: hold fire through the hook and watch the
  // shot counter climb.
  await page.evaluate(() => window.__nova.setFire(true));
  try {
    await page.waitForFunction(() => window.__nova.info().shotsFired >= 3, null, { timeout: 20000 });
  } finally {
    await page.evaluate(() => window.__nova.setFire(false));
  }
  const fired = await page.evaluate(() => window.__nova.info().shotsFired);
  console.log(`render-check: firing works (${fired} shots fired)`);

  // Dash: cooldown engages and the ship is briefly invulnerable.
  const dashBefore = await page.evaluate(() => window.__nova.info().dash);
  if (!dashBefore.ready) throw new Error('dash should be ready on a fresh run');
  await page.evaluate(() => window.__nova.dash());
  const dashAfter = await page.waitForFunction(() => {
    const i = window.__nova.info();
    return i.dash.cd > 0 ? i : false;
  }, null, { timeout: 10000, polling: 50 });
  const dashInfo = await dashAfter.jsonValue();
  if (!(dashInfo.ship.invuln > 0)) throw new Error('dash should grant invulnerability');
  if (!(Math.hypot(dashInfo.ship.vx, dashInfo.ship.vz) > 30)) {
    throw new Error(`dash should burst the ship (speed ${Math.hypot(dashInfo.ship.vx, dashInfo.ship.vz).toFixed(1)})`);
  }
  console.log(`render-check: dash works (cooldown ${dashInfo.dash.cd.toFixed(2)}s, invuln ${dashInfo.ship.invuln.toFixed(2)}s, speed ${Math.hypot(dashInfo.ship.vx, dashInfo.ship.vz).toFixed(1)})`);

  // M3: the dash feedback bundle fired completely (sound, particles,
  // shake, fovPulse, glowPulse) — read back from the feedback log.
  const dashLog = await page.evaluate(() => window.__nova.info().feedback.filter((f) => f.type === 'dash'));
  if (!dashLog.length || dashLog[dashLog.length - 1].layers.length !== 5) {
    throw new Error(`dash feedback bundle incomplete: ${JSON.stringify(dashLog)}`);
  }
  console.log(`render-check: dash bundle complete (${dashLog[dashLog.length - 1].layers.join(', ')})`);

  // Gameplay screenshot for the by-eye check.
  await page.screenshot({ path: path.join(SHOTS_DIR, 'gameplay-1280x720.png') });
  console.log(`render-check: gameplay screenshot saved to ${SHOTS_DIR}/gameplay-1280x720.png — INSPECT BY EYE (3D depth, arena, HUD)`);

  // The autopilot (greedy combat bot) scores a kill and clears wave 1:
  // the core loop actually works end to end.
  await page.evaluate(() => window.__nova.autopilot(true));
  await page.waitForFunction(() => window.__nova.info().kills >= 1, null, { timeout: 120000 });
  const killed = await page.evaluate(() => window.__nova.info());
  console.log(`render-check: autopilot scores a kill (kills ${killed.kills}, score ${killed.score}, combo x${killed.multiplier.toFixed(1)})`);
  // M3: the kill + shoot bundles fired completely.
  const fbKill = await page.evaluate(() => window.__nova.info().feedback);
  const killEntry = fbKill.filter((f) => f.type === 'kill').pop();
  if (!killEntry || killEntry.layers.length !== 6) {
    throw new Error(`kill feedback bundle incomplete: ${JSON.stringify(killEntry)}`);
  }
  const shootEntry = fbKill.filter((f) => f.type === 'shoot').pop();
  if (!shootEntry || shootEntry.layers.length !== 5) {
    throw new Error(`shoot feedback bundle incomplete: ${JSON.stringify(shootEntry)}`);
  }
  const bulletHitEntry = fbKill.filter((f) => f.type === 'bulletHit').pop();
  if (!bulletHitEntry || bulletHitEntry.layers.length !== 4) {
    throw new Error(`bulletHit feedback incomplete: ${JSON.stringify(bulletHitEntry)}`);
  }
  console.log(`render-check: kill bundle complete (${killEntry.layers.join(', ')}), shoot bundle complete, bulletHit fires tick + spark + enemy flash`);
  await page.waitForFunction(() => window.__nova.info().waveIndex >= 1, null, { timeout: 240000 });
  const waved = await page.evaluate(() => window.__nova.info());
  console.log(`render-check: autopilot clears wave 1 (now wave ${waved.waveIndex + 1}, score ${waved.score}, kills ${waved.kills})`);
  // M3: the wave-clear bundle fired completely, and the music lead
  // joined from wave 2 (the music gets busier as the run heats up).
  const fbWave = await page.evaluate(() => window.__nova.info());
  const waveEntry = fbWave.feedback.filter((f) => f.type === 'waveClear').pop();
  if (!waveEntry || waveEntry.layers.length !== 7) {
    throw new Error(`waveClear feedback bundle incomplete: ${JSON.stringify(waveEntry)}`);
  }
  if (!fbWave.audio || !fbWave.audio.lead) throw new Error('music lead should be on from wave 2');
  console.log(`render-check: waveClear bundle complete (${waveEntry.layers.join(', ')}), music lead on`);
  await page.evaluate(() => window.__nova.autopilot(false));

  // Score pops fire at the event: a +score pop for the kill.
  const popTexts = await page.evaluate(() => [...document.querySelectorAll('#pops .pop')].map((e) => e.textContent));
  if (!popTexts.some((t) => /^\+\d+$/.test(t))) {
    throw new Error(`no score pop fired (pops seen: ${JSON.stringify(popTexts)})`);
  }
  console.log(`render-check: score pops fire (${JSON.stringify(popTexts.filter((t) => t))})`);

  // A hit costs a shield: seek the nearest enemy until contact.
  // Fresh run first: the autopilot leg above may already have cost
  // a shield, and this test needs two hits (flash off, then flash on)
  // while leaving the run alive for the pause test that follows.
  await page.keyboard.press('r');
  await page.waitForFunction(() => {
    const i = window.__nova.info();
    return window.__nova.state.phase === 'run' && i.shields === 3;
  }, null, { timeout: 5000 });
  // Reduce-flashing: first hit with the toggle ON must not flash;
  // second hit with it OFF must. The flash is captured atomically
  // in-page the moment the shield drops (it only lasts 120ms, and
  // under swiftshader a frame is ~200ms — a later read would miss it).
  await page.evaluate(() => window.__nova.setReduceFlashing(true));
  let flashOff = null, flashOn = null;
  for (let attempt = 0; attempt < 4 && (flashOff === null || flashOn === null); attempt++) {
    const shieldsNow = await page.evaluate(() => window.__nova.info().shields);
    await page.evaluate(() => window.__nova.seekEnemy(true));
    const h = await page.waitForFunction((sh) => {
      const i = window.__nova.info();
      if (!i) return false;
      if (i.shields < sh || i.done) {
        return { shields: i.shields, flash: document.getElementById('hit-flash').classList.contains('show'), done: i.done };
      }
      return false;
    }, shieldsNow, { timeout: 60000, polling: 50 }).catch(() => null);
    await page.evaluate(() => window.__nova.seekEnemy(false));
    if (h) {
      const got = await h.jsonValue();
      if (flashOff === null) {
        flashOff = got.flash;
        await page.evaluate(() => window.__nova.setReduceFlashing(false));
      } else if (flashOn === null) {
        flashOn = got.flash;
      }
    }
    await page.waitForTimeout(4000); // invulnerability is 1.5s of game time
  }
  if (flashOff === null || flashOn === null) throw new Error(`could not land two hits to test the flash toggle (off: ${flashOff}, on: ${flashOn})`);
  if (flashOff) throw new Error('reduce-flashing ON must suppress the hit flash');
  if (!flashOn) throw new Error('reduce-flashing OFF must show the hit flash');
  const hitAfter = await page.evaluate(() => window.__nova.info());
  console.log(`render-check: reduce-flashing — flash suppressed when ON, shown when OFF; shields now ${hitAfter.shields}`);
  if (hitAfter.shields >= 3) throw new Error('seeking an enemy did not cost a shield');
  // M3: the hit bundle fired completely, and on the last shield the
  // low-shield vignette shows (breathing, or static with
  // reduce-flashing on).
  const fbHit = await page.evaluate(() => window.__nova.info().feedback);
  const hitEntry = fbHit.filter((f) => f.type === 'hit').pop();
  if (!hitEntry || hitEntry.layers.length !== 8) {
    throw new Error(`hit feedback bundle incomplete: ${JSON.stringify(hitEntry)}`);
  }
  console.log(`render-check: hit bundle complete (${hitEntry.layers.join(', ')})`);
  if (hitAfter.shields !== 1) throw new Error(`expected exactly 1 shield left after two hits, got ${hitAfter.shields}`);
  if (!hitAfter.lowShield) throw new Error('lowShield flag should be true on the last shield');
  const vigShown = await page.evaluate(() => document.getElementById('low-shield').classList.contains('show'));
  if (!vigShown) throw new Error('low-shield vignette should show on the last shield');
  await page.evaluate(() => window.__nova.setReduceFlashing(true));
  await page.waitForTimeout(300);
  const vigStatic = await page.evaluate(() => document.getElementById('low-shield').classList.contains('static'));
  if (!vigStatic) throw new Error('low-shield vignette should be static with reduce-flashing on');
  await page.evaluate(() => window.__nova.setReduceFlashing(false));
  console.log('render-check: low-shield vignette shows on last shield, static under reduce-flashing');

  // Pause focuses Resume; Enter resumes.
  await page.keyboard.press('p');
  await page.waitForFunction(() => window.__nova.state.phase === 'paused', null, { timeout: 5000 });
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
  if (focused !== 'btn-resume') throw new Error(`pause should focus Resume, focused: ${focused}`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__nova.state.phase === 'run', null, { timeout: 5000 });
  console.log('render-check: P pauses with Resume focused, Enter resumes');

  // R restarts the run from the start.
  await page.keyboard.press('r');
  await page.waitForFunction(() => {
    const i = window.__nova.info();
    return window.__nova.state.phase === 'run' && i.waveIndex === 0 && i.shields === 3;
  }, null, { timeout: 5000 });
  console.log('render-check: R restarts the run (wave 1, 3 shields)');

  // M3: rest state — pause on a fresh, unmoved run (ship speed 0, no
  // events in flight) and confirm every effect settles back exactly:
  // trauma 0, FOV 55, time scale 1, ship scale 1.25, vignette off.
  await page.keyboard.press('p');
  await page.waitForFunction(() => window.__nova.state.phase === 'paused', null, { timeout: 5000 });
  await page.waitForFunction(() => {
    const i = window.__nova.info();
    return i.trauma < 0.02 && Math.abs(i.fov - 55) < 0.5 && i.timeScale === 1
      && Math.abs(i.ship.scale - 1.25) < 0.01 && !i.lowShield;
  }, null, { timeout: 15000 });
  const rest = await page.evaluate(() => window.__nova.info());
  console.log(`render-check: rest state clean (trauma ${rest.trauma.toFixed(3)}, fov ${rest.fov.toFixed(2)}, timeScale ${rest.timeScale}, ship scale ${rest.ship.scale.toFixed(2)}, vignette off)`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__nova.state.phase === 'run', null, { timeout: 5000 });

  // M3: shake toggle at 0 kills the shake even when events fire.
  await page.evaluate(() => window.__nova.setShake(0));
  await page.evaluate(() => window.__nova.dash());
  await page.waitForFunction(() => window.__nova.info().dash.cd > 0, null, { timeout: 10000 });
  const noShake = await page.evaluate(() => window.__nova.info().shakeAmp);
  if (noShake !== 0) throw new Error(`shake 0 must give shakeAmp 0, got ${noShake}`);
  await page.evaluate(() => window.__nova.setShake(1));
  console.log('render-check: shake 0 suppresses shakeAmp even after a dash; restored to 1');

  // Losing all 3 shields ends the run: seek enemies repeatedly.
  let guard = 0;
  while (guard < 20) {
    guard++;
    const st = await page.evaluate(() => window.__nova.state);
    if (st.phase === 'runover') break;
    const shieldsNow = await page.evaluate(() => window.__nova.info().shields);
    await page.evaluate(() => window.__nova.seekEnemy(true));
    await page.waitForFunction((sh) => {
      const i = window.__nova.info();
      return !i || i.shields < sh || i.done;
    }, shieldsNow, { timeout: 60000 }).catch(() => {});
    await page.evaluate(() => window.__nova.seekEnemy(false));
    await page.waitForTimeout(4000); // invulnerability is 1.5s of game time
  }
  const endState = await page.evaluate(() => window.__nova.state);
  if (endState.phase !== 'runover') throw new Error(`expected run-over after 3 hits, phase is ${endState.phase}`);
  const roText = await page.textContent('#runover');
  if (!roText.includes('Best for this set')) throw new Error(`run-over screen should show the best score: ${roText.slice(0, 200)}`);
  console.log('render-check: 3 hits end the run — run-over screen shows best score');

  // Try Again restarts from the run-over screen.
  await page.click('#btn-retry');
  await page.waitForFunction(() => window.__nova.state.phase === 'run', null, { timeout: 5000 });
  console.log('render-check: Try Again restarts from the run-over screen');

  // Back to the menu: pause, quit, and the best score is saved.
  await page.keyboard.press('p');
  await page.waitForFunction(() => window.__nova.state.phase === 'paused', null, { timeout: 5000 });
  await page.click('#btn-quit');
  await page.waitForFunction(() => window.__nova.state.phase === 'menu', null, { timeout: 5000 });
  const saved = await page.evaluate(() => window.__nova.save());
  if (!saved.best || !saved.best[1] || saved.best[1].score <= 0) {
    throw new Error(`best score should be saved for wave set 1: ${JSON.stringify(saved.best)}`);
  }
  console.log(`render-check: best score saved for wave set 1 (${saved.best[1].score.toLocaleString()}), menu shows it`);

  if (errors.length) {
    console.error('render-check: console/page errors:');
    for (const e of errors) console.error('  ' + e);
    throw new Error(`${errors.length} console/page error(s)`);
  }
  console.log('render-check: PASS — menu, movement, screen-space aim, firing, dash, kill, wave clear, shield loss, run-over, zero console errors');
} finally {
  if (browser) await browser.close();
  server.close();
}
