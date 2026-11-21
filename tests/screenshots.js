// Neon Nova v0.4.0 — real gameplay screenshot capture + size sweep.
// Serves the game dir over local HTTP, loads it in headless Chromium, and
// captures three PNGs into docs/screenshots/ for the README:
//   menu.png      — the main menu over the live 3D attract scene
//   gameplay.png  — wave set 1 mid-run, ship firing at the swarm
//   runover.png   — the run-over screen after the ship is down
// Then runs the game-ui-ux size sweep (1280x720, 2560x1080, 1080x2340):
// menu + gameplay screenshots at each size go to /tmp/neon-nova-size-sweep/
// for the by-eye check — no clipped or overlapping elements at any size.
// Reuses the render-check's Three.js CDN workaround (the sandboxed browser
// cannot reach jsdelivr; the pinned module is fulfilled from a curl cache
// in the OS temp dir — nothing is vendored into the repo).
// Run: node tests/screenshots.js
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';

const GAME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_DIR = path.join(GAME_DIR, 'docs', 'screenshots');
const SWEEP_DIR = path.join(os.tmpdir(), 'neon-nova-size-sweep');
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
console.log('screenshots: chromium executable:', executablePath || '(playwright default)');

const errors = [];
let browser;
try {
  browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });

  async function newPageWithThree(viewport) {
    const context = await browser.newContext({ viewport, timezoneId: 'Asia/Bangkok', hasTouch: true });
    const page = await context.newPage();
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
    page.on('pageerror', (err) => errors.push('pageerror: ' + String(err)));
    if (!process.env.NO_THREE_CACHE) {
      const cached = await fetchThreeModule();
      await page.route(THREE_URL, (route) => route.fulfill({ path: cached }));
    }
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.__nova, null, { timeout: 30000 });
    return { context, page };
  }

  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  fs.mkdirSync(SWEEP_DIR, { recursive: true });

  // --- README captures at 1280x720 ---
  {
    const { context, page } = await newPageWithThree({ width: 1280, height: 720 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(SHOTS_DIR, 'menu.png') });
    console.log('screenshots: menu.png captured');

    await page.click('#btn-play');
    await page.waitForFunction(() => window.__nova.state.phase === 'run', null, { timeout: 5000 });
    await page.evaluate(() => window.__nova.autopilot(true));
    // Swiftshader game time runs far slower than real time, so poll
    // with a long window: wait for a kill and a few seconds of flight.
    await page.waitForFunction(() => window.__nova.info().kills >= 2, null, { timeout: 180000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS_DIR, 'gameplay.png') });
    console.log('screenshots: gameplay.png captured (autopilot mid-run)');

    // Run-over capture: seek enemies until the ship is down.
    await page.evaluate(() => window.__nova.autopilot(false));
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
    const st = await page.evaluate(() => window.__nova.state);
    if (st.phase === 'runover') {
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(SHOTS_DIR, 'runover.png') });
      console.log('screenshots: runover.png captured');
    } else {
      console.log('screenshots: WARNING — run-over screen did not appear, skipping runover.png');
    }
    await context.close();
  }

  // --- size sweep: menu + gameplay at 1280x720, 2560x1080, 1080x2340 ---
  for (const [name, viewport] of [
    ['menu-1280x720', { width: 1280, height: 720 }],
    ['menu-2560x1080', { width: 2560, height: 1080 }],
    ['menu-1080x2340', { width: 1080, height: 2340 }],
  ]) {
    const { context, page } = await newPageWithThree(viewport);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(SWEEP_DIR, `${name}.png`) });
    console.log(`screenshots: size sweep ${name}.png captured`);
    await page.click('#btn-play');
    await page.waitForFunction(() => window.__nova.state.phase === 'run', null, { timeout: 5000 });
    await page.evaluate(() => window.__nova.autopilot(true));
    // At 2560x1080 swiftshader renders far slower than real time, so
    // the kill target needs a long poll, not a 60s window.
    await page.waitForFunction(() => window.__nova.info().kills >= 1, null, { timeout: 180000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SWEEP_DIR, `${name.replace('menu', 'gameplay')}.png`) });
    console.log(`screenshots: size sweep ${name.replace('menu', 'gameplay')}.png captured`);
    await context.close();
  }

  if (errors.length) {
    console.error('screenshots: console/page errors:');
    for (const e of errors) console.error('  ' + e);
    throw new Error(`${errors.length} console/page error(s)`);
  }
  console.log(`screenshots: DONE — README captures in ${SHOTS_DIR}, size sweep in ${SWEEP_DIR} — INSPECT BY EYE`);
} finally {
  if (browser) await browser.close();
  server.close();
}
