// Neon Nova v1.0.0 — headless browser render check.
// Serves the game dir over local HTTP, loads it in a headless browser, and
// asserts the M1 core, by hook and by eye:
//   - the menu renders over a LIVE 3D scene (the attract flight actually
//     flies — the demo ship moves), with no version/engine text anywhere
//     the player can see, one clear primary Play action, and 12 wave-set cards
//   - M4 gates on a fresh save: sets 2-12 locked, Survival locked; the
//     Campaign and Survival buttons are present and labelled
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
//   - M4 campaign: the autopilot clears set 1 in campaign mode, the
//     upgrade screen opens, buying a card spends energy and applies
//     the upgrade, and continuing starts set 2 with the loadout —
//     then the menu shows set 2 and Survival unlocked
//   - M4 survival: the Survival button starts an endless run (mode
//     survival, wave 1, no set end)
//   - M5 accessibility: text size + high contrast apply and persist
//     across reload; a toast hides when a screen opens; touch input
//     (stick drag moves, aim drag fires, DASH button appears); the
//     FPS guard's level actually changes the renderer pixel ratio
//     and quitting to the menu restores full resolution
//   - zero console errors and zero page errors, and a WebGL context exists
//
// Run: node tests/render-check.js (Chromium) or
//      xvfb-run -a env PW_BROWSER=firefox node tests/render-check.js
//      (Firefox — the M5 cross-browser check; headless Firefox on
//      this VM has no WebGL at all, so it runs headed under Xvfb
//      with software GL, which does give a WebGL2 context).
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
const { chromium, firefox } = require(playwrightPath);
const PW_BROWSER = (process.env.PW_BROWSER || 'chromium').toLowerCase();
const pw = PW_BROWSER === 'firefox' ? firefox : chromium;
const executablePath = PW_BROWSER === 'firefox' ? null : findHeadlessShell();
console.log(`render-check: ${PW_BROWSER} executable:`, executablePath || '(playwright default)');
const launchArgs = PW_BROWSER === 'firefox' ? []
  : ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'];

const errors = [];
const T0 = Date.now();
const stamp = () => ((Date.now() - T0) / 1000).toFixed(1) + 's';
// Playwright's Firefox driver emits "Navigated away from page" console
// errors when a page/context is torn down (proven by probe: 2 per
// reload, a burst of 22 at ctx.close(), all at one timestamp, none
// during gameplay — the game's own JS throws nothing). They are a
// driver artifact, not game errors, so the Firefox run filters them
// out and counts them separately instead of failing the check.
let navAwayArtifacts = 0;
function noteConsole(msg) {
  if (msg.type() !== 'error') return;
  if (PW_BROWSER === 'firefox' && msg.text().includes('Navigated away from page')) {
    navAwayArtifacts++;
    return;
  }
  errors.push(stamp() + ' console: ' + msg.text());
}
let browser;
try {
  browser = await pw.launch({
    ...(executablePath ? { executablePath } : {}),
    args: launchArgs,
    // Firefox: headless has no WebGL on this VM (no GL at all, even
    // with webgl.force-enabled). Headed under Xvfb with software GL
    // gives a WebGL2 context via llvmpipe — see the header note.
    ...(PW_BROWSER === 'firefox'
      ? { headless: false, env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: '1' } }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    timezoneId: 'Asia/Bangkok',
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on('console', noteConsole);
  page.on('pageerror', (err) => errors.push(stamp() + ' pageerror: ' + String(err)));

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
  if (version !== '1.0.0') throw new Error(`expected version 1.0.0, got ${version}`);
  console.log('render-check: game module initialised, version 1.0.0');

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
  if (menuText.includes('v1.0.0') || menuText.includes('Three.js') || menuText.includes('0.160.0')) {
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

  // M4: the Campaign and Survival buttons exist; on a fresh save the
  // gates are closed — sets 2-12 locked, Survival locked — and the
  // lock states are visible on the cards, not just in the save.
  if (!await page.isVisible('#btn-campaign')) throw new Error('Campaign button missing from the menu');
  if (!await page.isVisible('#btn-survival')) throw new Error('Survival button missing from the menu');
  const unlocks0 = await page.evaluate(() => window.__nova.unlocks());
  if (unlocks0.sets[1] !== true || unlocks0.sets[2] !== false || unlocks0.sets[12] !== false) {
    throw new Error(`fresh save should unlock only set 1: ${JSON.stringify(unlocks0.sets)}`);
  }
  if (unlocks0.survival !== false) throw new Error('Survival should be locked on a fresh save');
  const lockedCards = await page.locator('#set-select .set-card.locked').count();
  if (lockedCards !== 11) throw new Error(`expected 11 locked set cards on a fresh save, got ${lockedCards}`);
  const survDisabled = await page.isDisabled('#btn-survival');
  if (!survDisabled) throw new Error('Survival button should be disabled while locked');
  const survLabel = await page.textContent('#btn-survival');
  if (!survLabel.includes('clear Set 1')) throw new Error(`locked Survival button should state its requirement, got: ${survLabel}`);
  console.log('render-check: M4 gates closed on a fresh save — sets 2-12 locked (11 locked cards), Survival locked with its requirement stated');

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
  // (If the AudioContext is suspended — this VM's Firefox has no
  // audio device at all, no /dev/snd and no PulseAudio, so resume()
  // cannot un-suspend it — the sequencer is armed and the clock is
  // frozen, so the advance check is skipped: the sequencer advances
  // whenever the clock runs, which the Chromium run proves on the
  // same code. A real Firefox with a sound card runs it.)
  const audio0 = await page.evaluate(() => window.__nova.info().audio);
  if (!audio0) throw new Error('no AudioContext after the Play gesture');
  if (!audio0.music) throw new Error('music sequencer is not running');
  await page.waitForTimeout(2500);
  const audio1 = await page.evaluate(() => window.__nova.info().audio);
  if (audio1.musicStep <= audio0.musicStep) {
    if (audio1.state === 'suspended') {
      console.log('render-check: audio suspended (no audio device in this environment) — sequencer armed, advance check skipped');
    } else {
      throw new Error(`music sequencer did not advance (step ${audio0.musicStep} -> ${audio1.musicStep})`);
    }
  } else {
    console.log(`render-check: music sequencer running (state ${audio1.state}, step ${audio0.musicStep} -> ${audio1.musicStep})`);
  }

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
  // These legs are slow under swiftshader (~0.3x game time), and the
  // swarm closes in while the ship barely moves — the run can end
  // mid-leg. A leg that fails because the run ended restarts fresh
  // and retries once; a leg that fails with the run alive is a real
  // failure.
  async function moveScreen(key, dir) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ph = await page.evaluate(() => window.__nova.state.phase);
      if (ph !== 'run') {
        await page.keyboard.press('r');
        await page.waitForFunction(() => window.__nova.state.phase === 'run', null, { timeout: 5000 });
      }
      const x0 = (await page.evaluate(() => window.__nova.info().screen)).x;
      await page.keyboard.down(key);
      let ok = false;
      try {
        // waitForFunction passes ONE arg: destructure the pair.
        await page.waitForFunction(([x, d]) => {
          const i = window.__nova.info();
          return d > 0 ? i.screen.x > x + 20 : i.screen.x < x - 20;
        }, [x0, dir], { timeout: 20000 });
        ok = true;
      } catch { /* run may have ended mid-leg — retry fresh below */ }
      await page.keyboard.up(key);
      const x1 = (await page.evaluate(() => window.__nova.info().screen)).x;
      if (ok && ((dir > 0 && x1 > x0 + 20) || (dir < 0 && x1 < x0 - 20))) return { x0, x1 };
      if (attempt === 0) console.log(`render-check: ${key} leg interrupted (run ended?) — restarting fresh and retrying`);
    }
    throw new Error(`${key} did not move the ship on screen after a fresh retry`);
  }
  const left = await moveScreen('ArrowLeft', -1);
  console.log(`render-check: ArrowLeft moves the ship left on screen (${left.x0.toFixed(0)} -> ${left.x1.toFixed(0)})`);
  const right = await moveScreen('ArrowRight', 1);
  console.log(`render-check: ArrowRight moves the ship right on screen (${right.x0.toFixed(0)} -> ${right.x1.toFixed(0)})`);

  // M3: speed FOV kick — flying fast widens the view, and it settles
  // back to exactly 55 when the ship slows. Same swarm hazard as the
  // movement legs: restart fresh and retry once if the run ends.
  let fastFov = null;
  for (let attempt = 0; attempt < 2 && fastFov === null; attempt++) {
    const ph = await page.evaluate(() => window.__nova.state.phase);
    if (ph !== 'run') {
      await page.keyboard.press('r');
      await page.waitForFunction(() => window.__nova.state.phase === 'run', null, { timeout: 5000 });
    }
    await page.keyboard.down('ArrowRight');
    try {
      await page.waitForFunction(() => window.__nova.info().ship.speed > 10, null, { timeout: 20000 });
      fastFov = await page.evaluate(() => window.__nova.info().fov);
    } catch { /* run may have ended — retry fresh */ }
    await page.keyboard.up('ArrowRight');
  }
  if (fastFov === null) throw new Error('could not get the ship fast (run kept ending)');
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

  // M4: the canvas must actually update during a run. A frozen
  // render (e.g. an exception in the frame loop skipping
  // renderer.render) still leaves the sim state looking alive — the
  // ship moves, kills land, the HUD updates — so assert the pixels
  // change while the ship flies. (This caught a real M4 bug: a
  // missing import made updateHUD throw every frame, freezing the
  // canvas from the first run frame on.)
  const shotA = await page.screenshot();
  await page.waitForTimeout(1000);
  const shotB = await page.screenshot();
  if (shotA.equals(shotB)) throw new Error('canvas did not change between two screenshots during a run — the render loop may be frozen');
  console.log('render-check: canvas updates during a run (two screenshots differ)');

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
  if (!fbWave.audio || !fbWave.audio.lead) {
    // The lead joins on the sequencer's next step after wave 2 starts
    // (90ms interval, slower under swiftshader load) — wait for it
    // rather than asserting on the instant the wave flips.
    await page.waitForFunction(() => {
      const i = window.__nova.info();
      return i.audio && i.audio.lead;
    }, null, { timeout: 15000 });
  }
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
    // Arm an in-page observer before the hit: the flash lasts only
    // 120ms and the main thread can be busy rendering for longer
    // under swiftshader, so polling the class from outside can miss
    // it entirely. The observer records the class change as a
    // microtask and never misses it. (The game behaviour is unchanged
    // since M3 — this is the test's observation method, not the flash.)
    await page.evaluate(() => {
      window.__flashSeen = false;
      if (!window.__flashObserver) {
        const el = document.getElementById('hit-flash');
        window.__flashObserver = new MutationObserver(() => {
          if (el.classList.contains('show')) window.__flashSeen = true;
        });
        window.__flashObserver.observe(el, { attributes: true, attributeFilter: ['class'] });
      }
    });
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
      await h.jsonValue();
      const seen = await page.evaluate(() => window.__flashSeen);
      if (flashOff === null) {
        flashOff = seen;
        await page.evaluate(() => window.__nova.setReduceFlashing(false));
      } else if (flashOn === null) {
        flashOn = seen;
      }
    }
    // No passive wait between hits: a ship sitting still in the
    // middle of the swarm takes the next hits during the wait (and
    // can die before the second seek even starts). Seek immediately —
    // the 1.5s of game-time invulnerability from the last hit covers
    // the start of the seek, and the ship takes the next hit while
    // moving, one invulnerability window at a time.
    await page.waitForTimeout(300); // let the hit-stop settle
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

  // M4 campaign: the autopilot clears set 1 in campaign mode. The
  // upgrade screen must open (not the set-complete screen), buying a
  // card must spend energy and apply the upgrade, and continuing
  // must start set 2 with the loadout carried in. Under swiftshader
  // a full set-1 clear takes minutes of real time, so the waits are
  // long polls, not fixed windows.
  await page.evaluate(() => window.__nova.startCampaign());
  await page.waitForFunction(() => window.__nova.state.phase === 'run' && window.__nova.state.mode === 'campaign', null, { timeout: 5000 });
  console.log('render-check: campaign started (mode campaign, set 1)');
  await page.evaluate(() => window.__nova.autopilot(true));
  await page.waitForFunction(() => window.__nova.state.phase === 'upgrade', null, { timeout: 420000 });
  await page.evaluate(() => window.__nova.autopilot(false));
  const upgTitle = await page.textContent('#upgrade-title');
  if (!upgTitle.includes('cleared')) throw new Error(`upgrade screen title wrong: ${upgTitle}`);
  const upgCards = await page.locator('#upgrade-cards .upgrade-card').count();
  if (upgCards !== 3) throw new Error(`expected 3 upgrade cards, got ${upgCards}`);
  const upgEnergy = await page.textContent('#upgrade-energy');
  console.log(`render-check: upgrade screen opened after campaign set 1 (${upgTitle}; ${upgEnergy})`);
  // Buy the first affordable card and prove the purchase landed:
  // energy drops by the card's cost and the campaign loadout gains
  // the upgrade. If nothing is affordable, continue unupgraded.
  const cardStates = await page.evaluate(() => [...document.querySelectorAll('#upgrade-cards .upgrade-card')].map((c) => ({
    name: c.querySelector('.upgrade-name').textContent,
    cost: c.querySelector('.upgrade-cost').textContent,
    affordable: !c.classList.contains('unaffordable') && !c.classList.contains('maxed'),
  })));
  const buyIdx = cardStates.findIndex((c) => c.affordable);
  // Draft guarantee: with at least the cheapest upgrade's cost in
  // energy (Magnet Core 5), some offered card must be affordable.
  const campEnergy = (await page.evaluate(() => window.__nova.campaign())).energy;
  if (campEnergy >= 5 && buyIdx < 0) throw new Error(`draft guarantee broken: energy ${campEnergy} but no affordable card (${JSON.stringify(cardStates.map((c) => c.cost))})`);
  let boughtName = null;
  if (buyIdx >= 0) {
    const before = await page.evaluate(() => window.__nova.campaign());
    const energyBefore = before.energy;
    await page.locator('#upgrade-cards .upgrade-card').nth(buyIdx).click();
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.__nova.campaign());
    boughtName = cardStates[buyIdx].name;
    const boughtId = Object.keys(after.upgrades).find((id) => !(before.upgrades[id] || 0) || after.upgrades[id] > before.upgrades[id]);
    if (!boughtId) throw new Error(`buying ${boughtName} did not change the campaign loadout`);
    if (!(after.energy < energyBefore)) throw new Error(`buying ${boughtName} did not spend energy (${energyBefore} -> ${after.energy})`);
    console.log(`render-check: bought ${boughtName} (energy ${energyBefore} -> ${after.energy}, loadout ${JSON.stringify(after.upgrades)})`);
    // Regression: the energy line must show the post-purchase balance,
    // and a card that is no longer affordable must not spend anything
    // (the screen used to read the finished run's stale energy, so a
    // second buy could double-spend it).
    const upgEnergyAfter = await page.textContent('#upgrade-energy');
    if (!upgEnergyAfter.includes(`Energy: ${after.energy}`)) throw new Error(`upgrade energy line stale after buy: ${upgEnergyAfter} (expected Energy: ${after.energy})`);
    const staleStates = await page.evaluate(() => [...document.querySelectorAll('#upgrade-cards .upgrade-card')].map((c) => c.classList.contains('unaffordable')));
    const staleIdx = staleStates.findIndex(Boolean);
    if (staleIdx >= 0) {
      await page.locator('#upgrade-cards .upgrade-card').nth(staleIdx).click();
      await page.waitForTimeout(300);
      const afterStale = await page.evaluate(() => window.__nova.campaign());
      if (afterStale.energy !== after.energy || JSON.stringify(afterStale.upgrades) !== JSON.stringify(after.upgrades)) {
        throw new Error(`unaffordable card click spent energy or changed loadout (${after.energy} -> ${afterStale.energy})`);
      }
      console.log(`render-check: unaffordable card click spent nothing (energy stays ${after.energy})`);
    }
  } else {
    console.log(`render-check: no affordable upgrade card (${JSON.stringify(cardStates.map((c) => c.cost))}) — continuing unupgraded`);
  }
  await page.screenshot({ path: path.join(SHOTS_DIR, 'upgrade-1280x720.png') });
  console.log('render-check: upgrade screenshot saved — INSPECT BY EYE (3 cards, energy, owned line)');
  await page.click('#btn-upgrade-continue');
  await page.waitForFunction(() => {
    const i = window.__nova.info();
    return window.__nova.state.phase === 'run' && i.setId === 2 && i.mode === 'campaign';
  }, null, { timeout: 10000 });
  const camp2 = await page.evaluate(() => window.__nova.info());
  if (boughtName && Object.keys(camp2.upgrades).length === 0) {
    throw new Error('campaign set 2 started without the bought upgrade');
  }
  console.log(`render-check: campaign continued into set 2 (mode ${camp2.mode}, upgrades ${JSON.stringify(camp2.upgrades)}, energy ${camp2.energy})`);

  // Back to the menu: the gates must now be open — set 2 unlocked
  // by the campaign clear, and Survival unlocked by clearing set 1.
  await page.keyboard.press('p');
  await page.waitForFunction(() => window.__nova.state.phase === 'paused', null, { timeout: 5000 });
  await page.click('#btn-quit');
  await page.waitForFunction(() => window.__nova.state.phase === 'menu', null, { timeout: 5000 });
  const unlocks1 = await page.evaluate(() => window.__nova.unlocks());
  if (!unlocks1.sets[2] || !unlocks1.survival) {
    throw new Error(`clearing set 1 should unlock set 2 and Survival: ${JSON.stringify(unlocks1)}`);
  }
  if (await page.isDisabled('#btn-survival')) throw new Error('Survival button should be enabled after clearing set 1');
  const campLabel = await page.textContent('#btn-campaign');
  if (!campLabel.includes('Set 2')) throw new Error(`campaign button should show the next set, got: ${campLabel}`);
  console.log(`render-check: gates opened — set 2 unlocked, Survival unlocked, campaign button reads "${campLabel.trim()}"`);

  // M4 survival: the Survival button starts an endless run — mode
  // survival, wave 1, and the run does not end when wave 1 clears.
  await page.click('#btn-survival');
  await page.waitForFunction(() => window.__nova.state.phase === 'run' && window.__nova.state.mode === 'survival', null, { timeout: 5000 });
  const surv = await page.evaluate(() => window.__nova.info());
  if (surv.setId !== 0 || surv.waves !== 0) throw new Error(`survival run should be set 0 with no wave list, got setId ${surv.setId}, waves ${surv.waves}`);
  // The HUD updates on the next frame after the run starts — wait
  // for it rather than reading the stale label of the previous run.
  await page.waitForFunction(() => document.getElementById('hud-wave').textContent === 'Wave 1', null, { timeout: 5000 });
  const hudWave = await page.textContent('#hud-wave');
  if (hudWave !== 'Wave 1') throw new Error(`survival HUD should show just the wave number, got: ${hudWave}`);
  await page.evaluate(() => window.__nova.autopilot(true));
  await page.waitForFunction(() => window.__nova.info().waveIndex >= 1, null, { timeout: 240000 });
  const surv2 = await page.evaluate(() => window.__nova.info());
  await page.evaluate(() => window.__nova.autopilot(false));
  if (surv2.done) throw new Error('survival must not end when a wave clears');
  console.log(`render-check: survival runs — wave 1 cleared, now wave ${surv2.waveIndex + 1}, score ${surv2.score}, still going`);
  await page.keyboard.press('p');
  await page.waitForFunction(() => window.__nova.state.phase === 'paused', null, { timeout: 5000 });
  await page.click('#btn-quit');
  await page.waitForFunction(() => window.__nova.state.phase === 'menu', null, { timeout: 5000 });
  const survBest = await page.evaluate(() => window.__nova.save().best.survival);
  if (!survBest || survBest.score <= 0) throw new Error(`survival best should be saved: ${JSON.stringify(survBest)}`);
  console.log(`render-check: survival best saved (${survBest.score.toLocaleString()}, ${survBest.waves} waves)`);

  // --- M5: accessibility settings, toast hygiene, touch input, FPS guard ---
  // Text size Large applies a 120% root font size; high contrast puts
  // the class on the body; both persist across a reload (localStorage).
  await page.click('#btn-settings');
  await page.waitForFunction(() => !document.getElementById('settings').classList.contains('hidden'), null, { timeout: 5000 });
  await page.selectOption('#text-size-select', '1.2');
  const rootFont = await page.evaluate(() => document.documentElement.style.fontSize);
  if (rootFont !== '120%') throw new Error(`text size Large should set root font-size to 120%, got ${rootFont}`);
  await page.check('#high-contrast-toggle');
  if (!await page.evaluate(() => document.body.classList.contains('high-contrast'))) {
    throw new Error('high contrast toggle did not apply the body class');
  }
  await page.click('#btn-settings-close');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__nova, null, { timeout: 30000 });
  const savedM5 = await page.evaluate(() => window.__nova.save());
  if (savedM5.textSize !== 1.2 || savedM5.highContrast !== true) {
    throw new Error(`accessibility settings did not persist: ${JSON.stringify({ textSize: savedM5.textSize, highContrast: savedM5.highContrast })}`);
  }
  if (await page.evaluate(() => document.documentElement.style.fontSize) !== '120%') {
    throw new Error('text size did not re-apply after reload');
  }
  if (!await page.evaluate(() => document.body.classList.contains('high-contrast'))) {
    throw new Error('high contrast did not re-apply after reload');
  }
  console.log('render-check: M5 accessibility — Large text (120%) + high contrast apply and persist across reload');
  // Reset to defaults so later sections (and the next run) start clean.
  await page.evaluate(() => { window.__nova.setTextSize(1); window.__nova.setHighContrast(false); });

  // Toast hygiene (M4 cosmetic): a locked-set toast must hide when a
  // screen opens instead of showing through the overlay.
  await page.locator('#set-select .set-card').nth(11).click(); // set 12, locked
  await page.waitForFunction(() => document.getElementById('hud-toast').classList.contains('show'), null, { timeout: 5000 });
  await page.click('#btn-settings');
  await page.waitForFunction(() => !document.getElementById('settings').classList.contains('hidden'), null, { timeout: 5000 });
  if (await page.evaluate(() => document.getElementById('hud-toast').classList.contains('show'))) {
    throw new Error('toast stayed visible after opening a screen — it shows through the overlay');
  }
  await page.click('#btn-settings-close');
  console.log('render-check: M5 toast hides when a screen opens');

  // Touch input: synthetic touch pointer events drive the real handlers
  // (left half = move stick, right half = aim + fire, DASH appears).
  // Swiftshader runs the game far slower than real time, so the stick
  // hold polls for the ship to move instead of using a fixed window.
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__nova.state.phase === 'run', null, { timeout: 5000 });
  const touch0 = await page.evaluate(() => {
    const c = document.getElementById('game-container');
    const mk = (type, id, x, y) => new PointerEvent(type, {
      pointerType: 'touch', pointerId: id, clientX: x, clientY: y, bubbles: true, isPrimary: true,
    });
    const before = window.__nova.info();
    c.dispatchEvent(mk('pointerdown', 1, 200, 500)); // left half: stick
    const stickShown = !document.getElementById('touch-stick').classList.contains('hidden');
    c.dispatchEvent(mk('pointermove', 1, 260, 500)); // drag right, stick held
    return {
      before, stickShown,
      dashVisible: !document.getElementById('btn-dash').classList.contains('hidden'),
    };
  });
  if (!touch0.stickShown) throw new Error('touch stick did not appear on a left-half touch');
  if (!touch0.dashVisible) throw new Error('DASH button did not appear on first touch');
  await page.waitForFunction(() => {
    const i = window.__nova.info();
    return i && i.ship.x > 1;
  }, null, { timeout: 20000 });
  const touchMid = await page.evaluate(() => window.__nova.info());
  const stickHidden = await page.evaluate(() => {
    const c = document.getElementById('game-container');
    const mk = (type, id, x, y) => new PointerEvent(type, {
      pointerType: 'touch', pointerId: id, clientX: x, clientY: y, bubbles: true, isPrimary: true,
    });
    c.dispatchEvent(mk('pointerup', 1, 260, 500));
    return document.getElementById('touch-stick').classList.contains('hidden');
  });
  if (!stickHidden) throw new Error('touch stick stayed visible after the touch ended');
  // Aim side: right-half touch aims and fires while held.
  await page.evaluate(() => {
    const c = document.getElementById('game-container');
    const mk = (type, id, x, y) => new PointerEvent(type, {
      pointerType: 'touch', pointerId: id, clientX: x, clientY: y, bubbles: true, isPrimary: true,
    });
    c.dispatchEvent(mk('pointerdown', 2, 1000, 300));
  });
  await page.waitForFunction((s0) => window.__nova.info().shotsFired > s0, touchMid.shotsFired, { timeout: 20000 });
  const touchAfter = await page.evaluate(() => window.__nova.info());
  await page.evaluate(() => {
    const c = document.getElementById('game-container');
    const mk = (type, id, x, y) => new PointerEvent(type, {
      pointerType: 'touch', pointerId: id, clientX: x, clientY: y, bubbles: true, isPrimary: true,
    });
    c.dispatchEvent(mk('pointerup', 2, 1000, 300));
  });
  console.log(`render-check: M5 touch — stick moves the ship (x ${touch0.before.ship.x.toFixed(1)} -> ${touchMid.ship.x.toFixed(1)}), aim touch fires (${touchMid.shotsFired} -> ${touchAfter.shotsFired} shots), DASH appears`);
  await page.evaluate(() => window.__nova.quitToMenu());
  await page.waitForFunction(() => window.__nova.state.phase === 'menu', null, { timeout: 5000 });

  // FPS guard wiring: at deviceScaleFactor 2 the renderer starts at
  // pixel ratio 2; the debug hook steps it down the ladder through
  // the same path the guard uses, and quitting restores full ratio.
  const ctx2 = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    timezoneId: 'Asia/Bangkok',
    deviceScaleFactor: 2,
    hasTouch: true,
  });
  const page2 = await ctx2.newPage();
  page2.on('console', noteConsole);
  page2.on('pageerror', (err) => errors.push(stamp() + ' pageerror: ' + String(err)));
  if (!process.env.NO_THREE_CACHE) {
    const cached = await fetchThreeModule();
    await page2.route(THREE_URL, (route) => route.fulfill({ path: cached }));
  }
  await page2.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page2.waitForFunction(() => window.__nova, null, { timeout: 30000 });
  const pr0 = await page2.evaluate(() => window.__nova.state.perf.pixelRatio);
  if (pr0 !== 2) throw new Error(`at deviceScaleFactor 2 the renderer should start at pixel ratio 2, got ${pr0}`);
  await page2.click('#btn-play');
  await page2.waitForFunction(() => window.__nova.state.phase === 'run', null, { timeout: 5000 });
  const pr1 = await page2.evaluate(() => window.__nova.debugPerfSetLevel(2));
  if (pr1 !== 1.25) throw new Error(`perf level 2 should set pixel ratio 1.25, got ${pr1}`);
  if (await page2.evaluate(() => window.__nova.state.perf.level) !== 2) {
    throw new Error('perf level did not stick after the debug step');
  }
  await page2.evaluate(() => window.__nova.quitToMenu());
  await page2.waitForFunction(() => window.__nova.state.phase === 'menu', null, { timeout: 5000 });
  const pr2 = await page2.evaluate(() => window.__nova.state.perf.pixelRatio);
  if (pr2 !== 2) throw new Error(`quitting to menu should restore pixel ratio 2, got ${pr2}`);
  await ctx2.close();
  console.log('render-check: M5 FPS guard — pixel ratio 2 -> 1.25 at level 2, restored to 2 on menu');

  if (navAwayArtifacts) console.log(`render-check: note — filtered ${navAwayArtifacts} Playwright-Firefox "Navigated away from page" teardown artifacts (not game errors)`);
  if (errors.length) {
    console.error('render-check: console/page errors:');
    for (const e of errors) console.error('  ' + e);
    throw new Error(`${errors.length} console/page error(s)`);
  }
  console.log('render-check: PASS — menu, M4 gates, movement, screen-space aim, firing, dash, kill, wave clear, shield loss, run-over, campaign upgrade flow, survival, M5 accessibility + toast + touch + FPS guard, zero console errors');
} finally {
  if (browser) await browser.close();
  server.close();
}
