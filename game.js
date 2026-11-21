// Neon Nova v0.3.0 — 3D neon arena shooter (Three.js 0.160.0).
// Move with WASD/arrows, aim with the mouse, fire with click/Space,
// dash with Shift. Chasers, shooters and splitters attack in dense
// hand-crafted wave sets; kills chain a combo, hits cost shields.
// No auto-aim, no auto-fire, no assist of any kind.
import * as THREE from 'three';
import {
  VERSION, WAVE_SETS, waveSetById, comboMultiplier, startRun as physicsStartRun, stepRun,
  greedyPolicy, nearestEnemy, ARENA_HALF_X, ARENA_HALF_Z, SHIP_RADIUS, MAX_SPEED,
  SHIELDS, DT, DASH_COOLDOWN, SET_CLEAR_SCORE, FEEDBACK, FEEDBACK_LAYERS,
  defaultSave, serializeSave, parseSave, recordBest, clamp,
} from './physics.js';

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'neon-nova-save-v1';

// ---------- save ----------
let save = parseSave(localStorage.getItem(SAVE_KEY));
function persistSave() {
  try { localStorage.setItem(SAVE_KEY, serializeSave(save)); } catch { /* storage unavailable */ }
}
function reduceFlashingOn() {
  if (save.reduceFlashing !== null) return save.reduceFlashing;
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---------- audio (Web Audio synth SFX + generative music) ----------
let audioCtx = null, masterGain = null, sfxGain = null, musicGain = null;
let noiseBuf = null;
let musicTimer = null, musicStep = 0, nextStepTime = 0;
const MUSIC_BPM = 116;
const BASS_LINE = [55, 0, 55, 65.41, 0, 55, 0, 49, 55, 0, 55, 65.41, 73.42, 0, 65.41, 49];
function ensureAudio() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return;
  }
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = save.muted ? 0 : save.volume;
    masterGain.connect(audioCtx.destination);
    sfxGain = audioCtx.createGain(); sfxGain.gain.value = 1; sfxGain.connect(masterGain);
    musicGain = audioCtx.createGain(); musicGain.gain.value = 0.35; musicGain.connect(masterGain);
    noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.5, audioCtx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  } catch { audioCtx = null; }
}
function tone({ freq = 440, freqEnd = null, dur = 0.1, type = 'square', vol = 0.2, when = 0, slide = null }) {
  if (!audioCtx || !save.sfx) return;
  const t0 = audioCtx.currentTime + when;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
  else if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freq * slide), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g); g.connect(sfxGain);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}
function noise({ dur = 0.1, vol = 0.2, freq = 1000, when = 0, type = 'bandpass' }) {
  if (!audioCtx || !save.sfx) return;
  const t0 = audioCtx.currentTime + when;
  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuf;
  const filter = audioCtx.createBiquadFilter();
  filter.type = type; filter.frequency.value = freq;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filter); filter.connect(g); g.connect(sfxGain);
  src.start(t0); src.stop(t0 + dur + 0.02);
}
function sfx(name) {
  if (!audioCtx || !save.sfx) return;
  switch (name) {
    case 'tick': tone({ freq: 1200, dur: 0.03, type: 'sine', vol: 0.08 }); break;
    case 'shoot': tone({ freq: 880, freqEnd: 440, dur: 0.07, type: 'square', vol: 0.10 }); break;
    case 'enemyShoot': tone({ freq: 220, freqEnd: 160, dur: 0.09, type: 'sawtooth', vol: 0.08 }); break;
    case 'kill': noise({ dur: 0.12, vol: 0.22, freq: 1800 }); tone({ freq: 520, freqEnd: 130, dur: 0.16, type: 'square', vol: 0.14 }); break;
    case 'hit': tone({ freq: 140, freqEnd: 60, dur: 0.25, type: 'sine', vol: 0.35 }); noise({ dur: 0.2, vol: 0.25, freq: 500 }); break;
    case 'tick': tone({ freq: 2400, dur: 0.03, type: 'sine', vol: 0.05 }); break; // bullet connects — quiet, high-frequency event
    case 'split': tone({ freq: 900, freqEnd: 240, dur: 0.14, type: 'triangle', vol: 0.16 }); noise({ dur: 0.1, vol: 0.12, freq: 2400 }); break;
    case 'waveStart': tone({ freq: 392, dur: 0.12, type: 'triangle', vol: 0.16 }); tone({ freq: 587, dur: 0.18, type: 'triangle', vol: 0.16, when: 0.1 }); break;
    case 'heartbeat': tone({ freq: 70, freqEnd: 45, dur: 0.14, type: 'sine', vol: 0.28 }); tone({ freq: 65, freqEnd: 40, dur: 0.12, type: 'sine', vol: 0.2, when: 0.18 }); break;
    case 'pickup': tone({ freq: 1320, dur: 0.06, type: 'sine', vol: 0.14 }); tone({ freq: 1760, dur: 0.09, type: 'sine', vol: 0.14, when: 0.05 }); break;
    case 'dash': noise({ dur: 0.22, vol: 0.18, freq: 900 }); tone({ freq: 300, freqEnd: 900, dur: 0.18, type: 'sine', vol: 0.08 }); break;
    case 'waveClear': [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.14, type: 'triangle', vol: 0.16, when: i * 0.07 })); break;
    case 'setComplete': [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ freq: f, dur: 0.2, type: 'triangle', vol: 0.18, when: i * 0.09 })); break;
    case 'runOver': [392, 330, 262, 196].forEach((f, i) => tone({ freq: f, dur: 0.3, type: 'sawtooth', vol: 0.14, when: i * 0.14 })); break;
    case 'launch': tone({ freq: 220, freqEnd: 660, dur: 0.3, type: 'sawtooth', vol: 0.12 }); break;
    default: break;
  }
}
function musicNote(freq, t0, dur, vol = 0.22, type = 'triangle') {
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g); g.connect(musicGain);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}
// Lead arp: A minor pentatonic, quiet, on the off-eighths. It joins
// from wave 2 onward — the music gets busier as the run heats up —
// and stays out of the menu attract flight (wave 1 bass only).
const LEAD_ARP = [440, 523.25, 659.25, 783.99, 659.25, 523.25, 587.33, 880];
let musicLeadOn = false;
function musicStepFn() {
  if (!audioCtx || !save.music) return;
  const stepDur = 60 / MUSIC_BPM / 2; // eighth notes
  const waveIdx = phase === 'run' && run ? run.waveIndex : 0;
  musicLeadOn = waveIdx >= 1;
  while (nextStepTime < audioCtx.currentTime + 0.15) {
    const step = musicStep % 16;
    const f = BASS_LINE[step];
    if (f) musicNote(f, nextStepTime, stepDur * 0.9);
    if (step === 0) { // bar pad: root + fifth, soft, one bar long
      musicNote(110, nextStepTime, stepDur * 15, 0.05, 'sine');
      musicNote(164.81, nextStepTime, stepDur * 15, 0.04, 'sine');
    }
    if (musicLeadOn && step % 2 === 1) {
      const lf = LEAD_ARP[(musicStep >> 1) % LEAD_ARP.length];
      musicNote(lf, nextStepTime, stepDur * 0.8, 0.07, 'sine');
    }
    if (step % 4 === 2) { // soft hat tick on the off-beat
      const t0 = nextStepTime;
      const src = audioCtx.createBufferSource(); src.buffer = noiseBuf;
      const hp = audioCtx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
      const g = audioCtx.createGain();
      g.gain.setValueAtTime(0.05, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.04);
      src.connect(hp); hp.connect(g); g.connect(musicGain);
      src.start(t0); src.stop(t0 + 0.05);
    }
    musicStep++;
    nextStepTime += stepDur;
  }
}
function startMusic() {
  ensureAudio();
  if (!audioCtx || musicTimer) return;
  musicStep = 0;
  nextStepTime = audioCtx.currentTime + 0.1;
  musicTimer = setInterval(musicStepFn, 90);
}
function stopMusic() {
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
}

// ---------- three.js setup ----------
let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  $('webgl-error').classList.remove('hidden');
}
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070818);
scene.fog = new THREE.Fog(0x070818, 90, 200);
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 400);
// More oblique than a straight top-down (48° below horizontal) so
// enemies read as 3D shapes with relief, not flat diamonds.
const CAM_OFFSET = new THREE.Vector3(0, 36, 30);
const CAM_LOOK = new THREE.Vector3(0, 0, -3);
let fovCurrent = 55, fovPulse = 0;

if (renderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  $('game-container').appendChild(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    if (phase === 'run') pauseGame();
    toast('Graphics paused — the tab lost its 3D context. Resume when ready.');
  });
  renderer.domElement.addEventListener('webglcontextrestored', () => { toast('Graphics restored.'); });
}

scene.add(new THREE.HemisphereLight(0x8b5cf6, 0x1e1b4b, 0.95));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.3);
dirLight.position.set(20, 40, 10);
scene.add(dirLight);
const shipLight = new THREE.PointLight(0x22d3ee, 1.4, 30, 1.2);
scene.add(shipLight);

// Arena floor + grid + border.
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(240, 240),
  new THREE.MeshStandardMaterial({ color: 0x12153d, roughness: 0.85, metalness: 0.15 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.05;
scene.add(floor);
const grid = new THREE.GridHelper(ARENA_HALF_X * 2, ARENA_HALF_X, 0xa78bfa, 0x6d28d9);
grid.position.y = 0.02;
grid.material.transparent = true;
grid.material.opacity = 0.6;
scene.add(grid);
// Outer grid: the floor beyond the arena fades into fog, so give it a
// faint grid too — otherwise the top of the frame is empty dark floor.
const outerGrid = new THREE.GridHelper(240, 48, 0x4c1d95, 0x2e1065);
outerGrid.position.y = 0.01;
outerGrid.material.transparent = true;
outerGrid.material.opacity = 0.3;
scene.add(outerGrid);
// Centre pad: a glowing ring + soft radial glow so the arena has a
// focal point and the floor reads as a place, not a void.
const padRing = new THREE.Mesh(
  new THREE.RingGeometry(3.0, 3.6, 48),
  new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
);
padRing.rotation.x = -Math.PI / 2;
padRing.position.y = 0.03;
scene.add(padRing);
const borderMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x22d3ee, emissiveIntensity: 2.2, roughness: 0.4 });
function borderBox(w, d, x, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), borderMat);
  m.position.set(x, 0.25, z);
  scene.add(m);
  return m;
}
borderBox(ARENA_HALF_X * 2 + 1, 0.5, 0, -ARENA_HALF_Z);
borderBox(ARENA_HALF_X * 2 + 1, 0.5, 0, ARENA_HALF_Z);
borderBox(0.5, ARENA_HALF_Z * 2 + 1, -ARENA_HALF_X, 0);
borderBox(0.5, ARENA_HALF_Z * 2 + 1, ARENA_HALF_X, 0);
for (const [cx, cz] of [[-ARENA_HALF_X, -ARENA_HALF_Z], [ARENA_HALF_X, -ARENA_HALF_Z], [-ARENA_HALF_X, ARENA_HALF_Z], [ARENA_HALF_X, ARENA_HALF_Z]]) {
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.9, 4.5, 0.9), borderMat);
  post.position.set(cx, 2.25, cz);
  scene.add(post);
}

// Starfield + nebula glow sprites.
{
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(900 * 3);
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 90 + Math.random() * 60;
    starPos[i * 3] = Math.cos(a) * r;
    starPos[i * 3 + 1] = 5 + Math.random() * 75;
    starPos[i * 3 + 2] = Math.sin(a) * r - 20;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xe0f2fe, size: 2.4, sizeAttenuation: false }));
  scene.add(stars);
}
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const glowTex = glowTexture();
const nebulae = [];
for (const [color, x, y, z, s] of [
  [0x7c3aed, -50, 16, -60, 90],
  [0x0e7490, 55, 20, -65, 110],
  [0xbe185d, 0, 12, -75, 80],
]) {
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity: 0.4, depthWrite: false }));
  spr.position.set(x, y, z);
  spr.scale.set(s, s * 0.6, 1);
  scene.add(spr);
  nebulae.push(spr);
}
// Soft centre glow on the floor, under the spawn pad.
const centreGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x22d3ee, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending }));
centreGlow.position.set(0, 1.5, 0);
centreGlow.scale.set(34, 20, 1);
scene.add(centreGlow);

// ---------- meshes ----------
const MATS = {
  ship: new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x0891b2, emissiveIntensity: 0.9, roughness: 0.35, metalness: 0.6 }),
  shipWing: new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x0e7490, emissiveIntensity: 0.7, roughness: 0.4, metalness: 0.5 }),
  chaser: new THREE.MeshStandardMaterial({ color: 0xf472b6, emissive: 0xbe185d, emissiveIntensity: 1.3, roughness: 0.35, metalness: 0.4 }),
  shooter: new THREE.MeshStandardMaterial({ color: 0xa78bfa, emissive: 0x6d28d9, emissiveIntensity: 1.3, roughness: 0.35, metalness: 0.4 }),
  splitter: new THREE.MeshStandardMaterial({ color: 0xfb7185, emissive: 0xbe123c, emissiveIntensity: 1.3, roughness: 0.35, metalness: 0.4 }),
  mini: new THREE.MeshStandardMaterial({ color: 0xf472b6, emissive: 0xbe185d, emissiveIntensity: 1.5, roughness: 0.35, metalness: 0.4 }),
  bullet: new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x22d3ee, emissiveIntensity: 2.2, roughness: 0.3 }),
  enemyBullet: new THREE.MeshStandardMaterial({ color: 0xf472b6, emissive: 0xdb2777, emissiveIntensity: 2.2, roughness: 0.3 }),
  pickup: new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xb45309, emissiveIntensity: 1.4, roughness: 0.3, metalness: 0.5 }),
  particleCyan: new THREE.MeshBasicMaterial({ color: 0x67e8f9 }),
  particleMagenta: new THREE.MeshBasicMaterial({ color: 0xf472b6 }),
  particleGold: new THREE.MeshBasicMaterial({ color: 0xfbbf24 }),
  particleWhite: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  particleViolet: new THREE.MeshBasicMaterial({ color: 0xa78bfa }),
};
const GEOS = {
  chaser: new THREE.OctahedronGeometry(1.15),
  shooter: new THREE.IcosahedronGeometry(1.25, 0),
  splitter: new THREE.DodecahedronGeometry(1.7, 0),
  mini: new THREE.OctahedronGeometry(0.7),
  bullet: new THREE.SphereGeometry(0.42, 8, 6),
  pickup: new THREE.OctahedronGeometry(0.8),
  particle: new THREE.BoxGeometry(0.28, 0.28, 0.28),
  ring: new THREE.RingGeometry(0.5, 0.72, 32),
};

function makeShip() {
  const g = new THREE.Group();
  const bodyGeo = new THREE.ConeGeometry(0.7, 2.2, 4);
  bodyGeo.rotateZ(-Math.PI / 2); // tip points +x
  bodyGeo.rotateX(Math.PI / 4); // diamond cross-section, flat-ish
  const body = new THREE.Mesh(bodyGeo, MATS.ship);
  g.add(body);
  const wingGeo = new THREE.BoxGeometry(0.9, 0.08, 0.5);
  const wl = new THREE.Mesh(wingGeo, MATS.shipWing);
  wl.position.set(-0.6, 0, 0.75);
  wl.rotation.y = 0.5;
  g.add(wl);
  const wr = new THREE.Mesh(wingGeo, MATS.shipWing);
  wr.position.set(-0.6, 0, -0.75);
  wr.rotation.y = -0.5;
  g.add(wr);
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xf59e0b, emissiveIntensity: 1.2 }));
  cockpit.position.set(0.3, 0.25, 0);
  g.add(cockpit);
  const engine = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x67e8f9, emissiveIntensity: 2.5 }));
  engine.position.set(-1.05, 0, 0);
  g.add(engine);
  g.traverse((o) => { o.castShadow = false; });
  return g;
}
const shipMesh = makeShip();
shipMesh.rotation.order = 'YXZ';
// Hover glow under the ship so it pops off the floor.
const shipGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x22d3ee, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
shipGlow.scale.set(5, 5, 1);
shipMesh.add(shipGlow);
scene.add(shipMesh);

// Crosshair ring at the aim point (the player's own cursor — not an assist).
const crosshair = new THREE.Mesh(GEOS.ring, new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
crosshair.rotation.x = -Math.PI / 2;
crosshair.position.y = 0.06;
scene.add(crosshair);
const crossDot = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
crossDot.position.y = 0.06;
scene.add(crossDot);

// Enemy meshes: one per live enemy, keyed by run id.
const enemyMeshes = new Map();
function syncEnemies(run) {
  const seen = new Set();
  for (const e of run.enemies) {
    seen.add(e.id);
    let m = enemyMeshes.get(e.id);
    if (!m) {
      m = new THREE.Mesh(GEOS[e.type], MATS[e.type]);
      m.userData.type = e.type;
      m.userData.flashT = 0;
      if (e.type === 'shooter') {
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 6), MATS.shooter);
        barrel.rotation.z = Math.PI / 2;
        barrel.position.x = 1.0;
        m.add(barrel);
        m.userData.barrel = barrel;
      }
      scene.add(m);
      enemyMeshes.set(e.id, m);
    }
    const spawnScale = e.spawnT > 0 ? 1 - (e.spawnT / 0.4) * 0.9 : 1;
    let s = spawnScale;
    if (m.userData.flashT > 0) { m.userData.flashT -= 1 / 60; s *= 1.25; }
    m.scale.setScalar(Math.max(0.1, s));
    m.position.set(e.x, 0.6, e.z);
    m.rotation.y += 0.03;
    m.rotation.x = Math.sin(performance.now() * 0.002 + e.id) * 0.15;
    // Shooter telegraph: pulse bright before firing.
    if (e.type === 'shooter' && e.telegraph) {
      m.scale.setScalar(Math.max(0.1, s * (1 + 0.12 * Math.sin(performance.now() * 0.04))));
    }
    if (e.type === 'shooter' && run) {
      const a = Math.atan2(run.z - e.z, run.x - e.x);
      m.rotation.y = -a;
    }
  }
  for (const [id, m] of enemyMeshes) {
    if (!seen.has(id)) {
      scene.remove(m);
      enemyMeshes.delete(id);
    }
  }
}

// Pooled bullets (player + enemy) and pickups.
function makePool(geo, mat, n) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.visible = false;
    scene.add(m);
    arr.push(m);
  }
  return arr;
}
const bulletPool = makePool(GEOS.bullet, MATS.bullet, 64);
const enemyBulletPool = makePool(GEOS.bullet, MATS.enemyBullet, 48);
const pickupPool = makePool(GEOS.pickup, MATS.pickup, 24);
function syncPool(pool, items, elongate) {
  for (let i = 0; i < pool.length; i++) {
    const m = pool[i];
    const it = items[i];
    if (!it) { m.visible = false; continue; }
    m.visible = true;
    m.position.set(it.x, 0.6, it.z);
    if (elongate) {
      const a = Math.atan2(it.vz, it.vx);
      m.rotation.y = -a;
      m.scale.set(2.2, 0.8, 0.8);
    } else {
      m.scale.setScalar(1);
    }
  }
}

// Pooled particles.
const particles = [];
for (let i = 0; i < 160; i++) {
  const m = new THREE.Mesh(GEOS.particle, MATS.particleWhite);
  m.visible = false;
  scene.add(m);
  particles.push({ mesh: m, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, spin: 0 });
}
function spawnParticles(x, z, y, mat, count, speed, life = 0.6) {
  let spawned = 0;
  for (const p of particles) {
    if (spawned >= count) break;
    if (p.life > 0) continue;
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.4 + Math.random() * 0.8);
    p.vx = Math.cos(a) * s;
    p.vz = Math.sin(a) * s;
    p.vy = (Math.random() * 0.9 + 0.3) * speed * 0.5;
    p.mesh.position.set(x, y, z);
    p.mesh.material = mat;
    p.life = p.maxLife = life * (0.7 + Math.random() * 0.6);
    p.spin = (Math.random() - 0.5) * 12;
    p.mesh.visible = true;
    p.mesh.scale.setScalar(1);
    spawned++;
  }
}
function updateParticles(dt) {
  for (const p of particles) {
    if (p.life <= 0) continue;
    p.life -= dt;
    if (p.life <= 0) { p.mesh.visible = false; continue; }
    p.vy -= 6 * dt;
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y = Math.max(0.1, p.mesh.position.y + p.vy * dt);
    p.mesh.position.z += p.vz * dt;
    p.vx *= Math.exp(-2 * dt); p.vz *= Math.exp(-2 * dt);
    p.mesh.rotation.x += p.spin * dt;
    p.mesh.rotation.y += p.spin * 0.7 * dt;
    p.mesh.scale.setScalar(Math.max(0.05, p.life / p.maxLife));
  }
}

// Expanding shockwave rings (kill / wave clear).
const rings = [];
for (let i = 0; i < 6; i++) {
  const m = new THREE.Mesh(GEOS.ring, new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.08;
  m.visible = false;
  scene.add(m);
  rings.push({ mesh: m, life: 0, maxLife: 1, maxR: 6 });
}
function spawnRing(x, z, color, maxR = 6, life = 0.5) {
  for (const r of rings) {
    if (r.life > 0) continue;
    r.mesh.material.color.set(color);
    r.mesh.position.set(x, 0.08, z);
    r.life = r.maxLife = life;
    r.maxR = maxR;
    r.mesh.visible = true;
    return;
  }
}
function updateRings(dt) {
  for (const r of rings) {
    if (r.life <= 0) continue;
    r.life -= dt;
    if (r.life <= 0) { r.mesh.visible = false; continue; }
    const f = 1 - r.life / r.maxLife;
    r.mesh.scale.setScalar(0.5 + f * r.maxR);
    r.mesh.material.opacity = 0.9 * (1 - f);
  }
}

// ---------- game state ----------
let phase = 'menu'; // 'menu' | 'run' | 'paused' | 'complete' | 'runover'
let selectedSetId = 1;
let set = WAVE_SETS[0];
let run = null;
let demoRun = physicsStartRun(WAVE_SETS[0]);
let renderRun = demoRun; // what the scene renders: demo in menu, run in play
let trauma = 0;
let hitStopUntil = 0; // real-time clock: hit-stop ends here
let slowMoUntil = 0, slowMoScale = 1;
let timeScale = 1;
let shakeStrength = save.shake;
let shipSquashT = 0;
let glowPulse = 0;
let crossPulse = 0; // crosshair pop on each shot — decays back to 0
let lastHeartbeat = 0;
// Feedback log: the last 20 handled events with the layers that fired,
// so the render check can assert every event's full bundle fired in
// one synchronous call (all layers within the same frame, ~100ms is
// the game-feel bar; the bundle is atomic by construction).
const feedbackLog = [];
function logFeedback(type, layers) {
  feedbackLog.push({ type, layers: [...layers], at: performance.now() });
  if (feedbackLog.length > 20) feedbackLog.shift();
}
let fpsEma = 60;
let lastFrameT = performance.now();
let accumulator = 0;
let elapsed = 0;

// Input state.
const keys = {};
let mouseX = window.innerWidth / 2, mouseY = window.innerHeight / 2;
let mouseDown = false;
let mouseSeen = false;
let dashQueued = false;
let touchMode = false;
let stickId = null, stickOrigin = null, stickVec = { x: 0, y: 0 };
let aimTouchId = null, aimTouchPos = null;
let touchFiring = false;
// Test hooks (public input hooks — the bot + render check drive these).
let hookMove = null, hookAimWorld = null, hookFire = null, hookDash = false;
let autoPilot = false, seekEnemy = false;

// ---------- feedback ----------
function addTrauma(amount) { trauma = Math.min(1, trauma + amount); }
function doHitStop(seconds) {
  const until = performance.now() / 1000 + seconds;
  if (until > hitStopUntil) hitStopUntil = until; // newest hit-stop owns the restore
}
function doSlowMo(seconds, scale) {
  slowMoUntil = performance.now() / 1000 + seconds;
  slowMoScale = scale;
}
function showPop(worldX, worldZ, text, cls = '') {
  const layer = $('pops');
  const divs = layer.querySelectorAll('.pop');
  let div = null;
  for (const d of divs) {
    if (d.dataset.busy !== '1') { div = d; break; }
  }
  if (!div) {
    if (divs.length >= 10) return;
    div = document.createElement('div');
    div.className = 'pop';
    layer.appendChild(div);
  }
  const sp = projectToScreen(worldX, 0, worldZ);
  div.textContent = text;
  div.className = 'pop ' + cls;
  div.style.left = sp.x + 'px';
  div.style.top = sp.y + 'px';
  div.dataset.busy = '1';
  div.style.animation = 'none';
  void div.offsetWidth;
  div.style.animation = '';
  setTimeout(() => { div.dataset.busy = ''; }, 900);
}
let toastTimer = null;
function toast(text, ms = 2500) {
  const el = $('hud-toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
function flashHit() {
  if (reduceFlashingOn()) return;
  const el = $('hit-flash');
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 120);
}
function projectToScreen(x, y, z) {
  const v = new THREE.Vector3(x, y, z).project(camera);
  return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - v.y) / 2 * window.innerHeight };
}
function screenToWorld(sx, sy) {
  const ndc = new THREE.Vector2((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  if (ray.ray.intersectPlane(plane, hit)) return { x: hit.x, z: hit.z };
  return { x: 0, z: 0 };
}

// Feedback layers per event (the contract in physics.js — every
// primary event fires its full bundle in one synchronous call, so all
// layers land within the same frame. Secondary events get deliberate
// light feedback: bulletHit/enemyShoot/split/waveStart fire at high
// frequency or ride on a primary bundle, so a full 5-8 layer bundle
// on each would be noise.)
function handleEvents(events) {
  for (const e of events) {
    const fb = FEEDBACK[e.type];
    switch (e.type) {
      case 'shoot':
        sfx('shoot');
        addTrauma(fb.trauma);
        spawnParticles(e.x, e.z, 0.6, MATS.particleCyan, 3, 3, 0.25); // muzzle flash
        glowPulse = Math.max(glowPulse, 0.5);
        crossPulse = 1; // crosshair pops on every shot
        logFeedback('shoot', FEEDBACK_LAYERS.shoot);
        break;
      case 'kill': {
        sfx('kill');
        addTrauma(fb.trauma);
        const col = e.kind === 'shooter' ? MATS.particleViolet : e.kind === 'splitter' ? MATS.particleGold : MATS.particleMagenta;
        spawnParticles(e.x, e.z, 0.6, col, 12, 9, 0.7);
        spawnRing(e.x, e.z, 0xf472b6, 4, 0.4);
        glowPulse = 1;
        showPop(e.x, e.z, '+' + e.score, e.combo >= 10 ? 'magenta' : 'cyan');
        logFeedback('kill', FEEDBACK_LAYERS.kill);
        break;
      }
      case 'bulletHit': {
        // Light by design: this fires on every connecting bullet.
        // Tick + spark + a white flash-pop on the enemy mesh (flashT
        // is consumed by syncEnemies) + a tiny impact ring.
        sfx('tick');
        spawnParticles(e.x, e.z, 0.6, MATS.particleWhite, 3, 5, 0.3);
        spawnRing(e.x, e.z, 0xffffff, 1.5, 0.25);
        const hitMesh = enemyMeshes.get(e.id);
        if (hitMesh) hitMesh.userData.flashT = 0.12;
        logFeedback('bulletHit', ['sound', 'particles', 'flash', 'ringPulse']);
        break;
      }
      case 'enemyShoot': {
        // Muzzle spark at the shooter + a flash-pop on its mesh.
        sfx('enemyShoot');
        spawnParticles(e.x, e.z, 0.6, MATS.particleMagenta, 2, 4, 0.3);
        const shooterMesh = enemyMeshes.get(e.id);
        if (shooterMesh) shooterMesh.userData.flashT = 0.12;
        logFeedback('enemyShoot', ['sound', 'particles', 'flash']);
        break;
      }
      case 'split':
        sfx('split');
        spawnParticles(e.x, e.z, 0.6, MATS.particleGold, 10, 8, 0.6);
        spawnRing(e.x, e.z, 0xfbbf24, 5, 0.45);
        logFeedback('split', ['sound', 'particles', 'ringPulse']);
        break;
      case 'drop':
        spawnParticles(e.x, e.z, 0.6, MATS.particleGold, 2, 3, 0.4);
        logFeedback('drop', ['particles']);
        break;
      case 'pickup':
        sfx('pickup');
        addTrauma(fb.trauma);
        spawnParticles(e.x, e.z, 0.6, MATS.particleGold, 6, 6, 0.5);
        showPop(e.x, e.z, '+25', '');
        glowPulse = 1;
        logFeedback('pickup', FEEDBACK_LAYERS.pickup);
        break;
      case 'dash':
        sfx('dash');
        addTrauma(fb.trauma);
        fovPulse = Math.max(fovPulse, 0.7);
        spawnParticles(e.x, e.z, 0.6, MATS.particleCyan, 10, 6, 0.5);
        glowPulse = 1;
        logFeedback('dash', FEEDBACK_LAYERS.dash);
        break;
      case 'waveClear':
        sfx('waveClear');
        addTrauma(fb.trauma);
        doHitStop(fb.hitStop);
        fovPulse = 1;
        spawnParticles(run.x, run.z, 0.6, MATS.particleGold, 20, 10, 0.9);
        spawnRing(run.x, run.z, 0xfbbf24, 8, 0.6);
        showPop(run.x, run.z, 'WAVE CLEAR +' + e.score, 'magenta');
        // On the last wave the set-complete screen follows immediately;
        // don't promise another wave that isn't coming.
        if (run.waveIndex + 1 < set.waves.length) toast(`Wave ${e.wave} clear — next wave incoming`);
        logFeedback('waveClear', FEEDBACK_LAYERS.waveClear);
        break;
      case 'waveStart':
        sfx('waveStart');
        fovPulse = Math.max(fovPulse, 0.5);
        spawnRing(run.x, run.z, 0x67e8f9, 6, 0.5);
        toast(`Wave ${e.wave} of ${set.waves.length}`);
        logFeedback('waveStart', ['sound', 'fovPulse', 'ringPulse', 'toast']);
        break;
      case 'hit':
        sfx('hit');
        addTrauma(fb.trauma);
        doHitStop(fb.hitStop);
        flashHit();
        shipSquashT = 0.25;
        spawnParticles(e.x, e.z, 0.6, MATS.particleMagenta, 16, 11, 0.8);
        spawnRing(e.x, e.z, 0xf87171, 5, 0.5);
        if (e.shields === 1) doSlowMo(0.7, 0.35); // near-death slow-mo
        toast(e.shields > 0 ? `Shield down — ${e.shields} left` : 'Ship down');
        logFeedback('hit', FEEDBACK_LAYERS.hit);
        break;
      case 'setComplete':
        sfx('setComplete');
        addTrauma(fb.trauma);
        doHitStop(fb.hitStop);
        fovPulse = 1;
        spawnRing(run.x, run.z, 0xfbbf24, 12, 0.9);
        spawnParticles(run.x, run.z, 0.6, MATS.particleGold, 30, 12, 1.1);
        showPop(run.x, run.z, '+' + SET_CLEAR_SCORE, 'magenta');
        toast(`${set.name} cleared — ${run.kills} kills, score ${run.score.toLocaleString()}`);
        logFeedback('setComplete', FEEDBACK_LAYERS.setComplete);
        break;
      case 'runOver':
        sfx('runOver');
        addTrauma(fb.trauma);
        doHitStop(fb.hitStop);
        flashHit();
        shipSquashT = 0.4;
        spawnParticles(run.x, run.z, 0.6, MATS.particleMagenta, 40, 14, 1.2);
        spawnRing(run.x, run.z, 0xf87171, 14, 1);
        toast('Ship down — the swarm wins this time');
        logFeedback('runOver', FEEDBACK_LAYERS.runOver);
        break;
      case 'launch':
        sfx('launch');
        addTrauma(fb.trauma);
        fovPulse = 1;
        spawnParticles(run.x, run.z, 0.6, MATS.particleCyan, 12, 8, 0.7);
        glowPulse = 1;
        logFeedback('launch', FEEDBACK_LAYERS.launch);
        break;
      default: break;
    }
  }
}

// ---------- screens (stack) ----------
const screenStack = [];
function showScreen(id) {
  for (const s of ['menu', 'howto', 'settings', 'complete', 'runover', 'pause']) {
    if (s !== id) $(s).classList.add('hidden');
  }
  $(id).classList.remove('hidden');
  const panel = $(id).querySelector('.panel');
  if (panel) { panel.style.animation = 'none'; void panel.offsetWidth; panel.style.animation = ''; }
  const focusTarget = $(id).querySelector('.btn.primary') || $(id).querySelector('.btn') || $(id).querySelector('input, button');
  if (focusTarget) focusTarget.focus();
}
function pushScreen(id) {
  const top = screenStack[screenStack.length - 1];
  if (top === id) return;
  if (top) $(top).classList.add('hidden');
  screenStack.push(id);
  showScreen(id);
}
function popScreen() {
  const id = screenStack.pop();
  if (id) $(id).classList.add('hidden');
  const top = screenStack[screenStack.length - 1];
  if (top) showScreen(top);
  return id;
}
function clearScreens() {
  while (screenStack.length) popScreen();
  for (const s of ['menu', 'howto', 'settings', 'complete', 'runover', 'pause']) $(s).classList.add('hidden');
}

// ---------- UI wiring ----------
function refreshSetSelect() {
  const el = $('set-select');
  el.innerHTML = '';
  for (const s of WAVE_SETS) {
    const best = save.best[s.id];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'set-card' + (s.id === selectedSetId ? ' selected' : '');
    card.style.setProperty('--card-accent', s.theme.ring);
    card.innerHTML = `<span class="set-name">${s.id}. ${s.name}</span>`
      + `<div class="set-meta">${s.waves.length} waves &middot; ${s.waves.reduce((n, w) => n + w.groups.reduce((m, g) => m + g.count, 0), 0)} enemies</div>`
      + (best ? `<div class="set-best">Best ${best.score.toLocaleString()} &middot; ${best.waves}/${s.waves.length} waves</div>` : '<div class="set-best">Not cleared yet</div>');
    card.addEventListener('click', () => {
      ensureAudio(); sfx('tick');
      selectedSetId = s.id;
      refreshSetSelect();
      $('set-hint').textContent = s.hint;
    });
    el.appendChild(card);
  }
  const s = waveSetById(selectedSetId);
  $('set-hint').textContent = s ? s.hint : '';
  const bests = Object.values(save.best);
  $('menu-best').textContent = bests.length
    ? `Best score: ${Math.max(...bests.map((b) => b.score)).toLocaleString()}`
    : 'No runs yet — the arena is waiting.';
}
function updateMuteLabels() {
  const label = save.muted ? 'Sound: Off' : 'Sound: On';
  for (const id of ['btn-mute-hud', 'btn-mute-menu', 'btn-mute-pause']) $(id).textContent = label;
}
function applySettingsToUI() {
  $('volume-range').value = Math.round(save.volume * 100);
  $('volume-value').textContent = Math.round(save.volume * 100) + '%';
  $('shake-range').value = Math.round(save.shake * 100);
  $('shake-value').textContent = Math.round(save.shake * 100) + '%';
  $('shake-range-pause').value = Math.round(save.shake * 100);
  $('shake-value-pause').textContent = Math.round(save.shake * 100) + '%';
  $('music-toggle').checked = save.music;
  $('sfx-toggle').checked = save.sfx;
  $('reduce-flashing').checked = reduceFlashingOn();
  shakeStrength = save.shake;
  updateMuteLabels();
}
function setMuted(m) {
  save.muted = m;
  if (masterGain) masterGain.gain.value = m ? 0 : save.volume;
  persistSave();
  updateMuteLabels();
}
// Hover tick + scale pop on every button (CSS handles the pop).
for (const b of document.querySelectorAll('.btn, .icon-btn, .set-card')) {
  b.addEventListener('mouseenter', () => { if (audioCtx) sfx('tick'); });
}
$('btn-play').addEventListener('click', () => { ensureAudio(); sfx('launch'); startRun(selectedSetId); });
$('btn-howto').addEventListener('click', () => { ensureAudio(); sfx('tick'); pushScreen('howto'); });
$('btn-howto-close').addEventListener('click', () => { sfx('tick'); popScreen(); });
$('btn-settings').addEventListener('click', () => { ensureAudio(); sfx('tick'); applySettingsToUI(); pushScreen('settings'); });
$('btn-settings-close').addEventListener('click', () => { sfx('tick'); popScreen(); });
$('btn-mute-menu').addEventListener('click', () => { ensureAudio(); setMuted(!save.muted); });
$('btn-mute-hud').addEventListener('click', () => { ensureAudio(); setMuted(!save.muted); });
$('btn-mute-pause').addEventListener('click', () => { ensureAudio(); setMuted(!save.muted); });
$('btn-pause').addEventListener('click', () => { if (phase === 'run') pauseGame(); });
$('btn-resume').addEventListener('click', () => resumeGame());
$('btn-restart').addEventListener('click', () => { sfx('launch'); startRun(selectedSetId); });
$('btn-quit').addEventListener('click', () => quitToMenu());
$('btn-retry').addEventListener('click', () => { sfx('launch'); startRun(selectedSetId); });
$('btn-replay').addEventListener('click', () => { sfx('launch'); startRun(selectedSetId); });
$('btn-next').addEventListener('click', () => {
  sfx('launch');
  startRun(Math.min(selectedSetId + 1, WAVE_SETS.length));
});
$('btn-menu-complete').addEventListener('click', () => quitToMenu());
$('btn-menu-runover').addEventListener('click', () => quitToMenu());
$('volume-range').addEventListener('input', (e) => {
  save.volume = clamp(e.target.value / 100, 0, 1);
  if (masterGain) masterGain.gain.value = save.muted ? 0 : save.volume;
  $('volume-value').textContent = e.target.value + '%';
  persistSave();
});
function bindShake(inputId, valueId) {
  $(inputId).addEventListener('input', (e) => {
    save.shake = clamp(e.target.value / 100, 0, 1);
    shakeStrength = save.shake;
    $(valueId).textContent = e.target.value + '%';
    const other = inputId === 'shake-range' ? 'shake-range-pause' : 'shake-range';
    const otherVal = inputId === 'shake-range' ? 'shake-value-pause' : 'shake-value';
    $(other).value = e.target.value;
    $(otherVal).textContent = e.target.value + '%';
    persistSave();
  });
}
bindShake('shake-range', 'shake-value');
bindShake('shake-range-pause', 'shake-value-pause');
$('music-toggle').addEventListener('change', (e) => { save.music = e.target.checked; persistSave(); if (!save.music) stopMusic(); else if (phase === 'run') startMusic(); });
$('sfx-toggle').addEventListener('change', (e) => { save.sfx = e.target.checked; persistSave(); });
$('reduce-flashing').addEventListener('change', (e) => { save.reduceFlashing = e.target.checked; persistSave(); });

// ---------- flow ----------
function applySetTheme(s) {
  borderMat.color.set(s.theme.ring);
  borderMat.emissive.set(s.theme.ring);
  grid.material.color.set(s.theme.ring);
  document.documentElement.style.setProperty('--cyan', s.theme.ring);
}
// Bank the current run's best score. Called whenever a run ends
// (complete / run over) AND whenever a run is abandoned (restart,
// quit to menu) — a good run that is quit mid-flight still counts.
function bankBest() {
  if (!run || run.score <= 0) return;
  recordBest(save, set.id, run.score, run.wavesCleared);
  persistSave();
}
function startRun(setId) {
  bankBest();
  set = waveSetById(setId) || WAVE_SETS[0];
  selectedSetId = set.id;
  run = physicsStartRun(set);
  renderRun = run;
  applySetTheme(set);
  phase = 'run';
  clearScreens();
  $('hud').classList.remove('hidden');
  trauma = 0; hitStopUntil = 0; slowMoUntil = 0; timeScale = 1; fovPulse = 0;
  accumulator = 0;
  autoPilot = false; seekEnemy = false; hookMove = null; hookFire = null; hookDash = false;
  save.totalRuns++;
  persistSave();
  ensureAudio();
  startMusic();
  handleEvents([{ type: 'launch' }]);
  $('hud-set').textContent = `Wave Set ${set.id} — ${set.name}`;
  toast(`Wave 1 of ${set.waves.length} — ${set.hint}`, 3500);
  $('sr-status').textContent = `Wave set ${set.name} started. Wave 1 of ${set.waves.length}.`;
  refreshSetSelect();
}
function pauseGame() {
  if (phase !== 'run') return;
  phase = 'paused';
  applySettingsToUI();
  pushScreen('pause');
}
function resumeGame() {
  if (phase !== 'paused') return;
  popScreen();
  phase = 'run';
  ensureAudio();
}
function quitToMenu() {
  bankBest();
  phase = 'menu';
  stopMusic();
  $('hud').classList.add('hidden');
  demoRun = physicsStartRun(WAVE_SETS[0]);
  renderRun = demoRun;
  applySetTheme(WAVE_SETS[0]);
  clearScreens();
  pushScreen('menu');
  refreshSetSelect();
  applySettingsToUI();
}
function endRun() {
  if (!run) return;
  bankBest();
  const best = save.best[set.id] || { score: run.score, waves: run.wavesCleared };
  refreshSetSelect();
  if (run.reason === 'complete') {
    phase = 'complete';
    $('complete-score').textContent = `Score ${run.score.toLocaleString()}`;
    $('complete-detail').textContent = `${set.name} cleared — ${run.kills} kills, max combo x${comboMultiplier(run.maxCombo).toFixed(1)}, ${run.dashes} ${run.dashes === 1 ? 'dash' : 'dashes'}.`;
    $('complete-best').textContent = `Best for this set: ${best.score.toLocaleString()} (${best.waves}/${set.waves.length} waves)`;
    $('complete-energy').textContent = `Energy collected: ${run.energy}`;
    const nextBtn = $('btn-next');
    if (set.id < WAVE_SETS.length) {
      nextBtn.classList.remove('hidden');
      nextBtn.textContent = `Next Wave Set — ${WAVE_SETS[set.id].name}`;
    } else {
      nextBtn.classList.add('hidden');
    }
    pushScreen('complete');
    $('sr-status').textContent = `Wave set ${set.name} clear. Score ${run.score}.`;
  } else {
    phase = 'runover';
    $('runover-stats').innerHTML = `Score <strong>${run.score.toLocaleString()}</strong> &middot; Waves ${run.wavesCleared}/${set.waves.length} &middot; Kills ${run.kills} &middot; Max combo x${comboMultiplier(run.maxCombo).toFixed(1)}`;
    $('runover-best').textContent = `Best for this set: ${best.score.toLocaleString()} (${best.waves}/${set.waves.length} waves)`;
    pushScreen('runover');
    $('sr-status').textContent = `Ship down. Score ${run.score}.`;
  }
}

// ---------- input ----------
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys[e.code] = true;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') dashQueued = true;
  if (e.code === 'KeyP') {
    if (phase === 'run') pauseGame();
    else if (phase === 'paused') resumeGame();
  }
  if (e.code === 'KeyM') { ensureAudio(); setMuted(!save.muted); }
  if (e.code === 'KeyR' && (phase === 'run' || phase === 'paused' || phase === 'runover' || phase === 'complete')) {
    sfx('launch'); startRun(selectedSetId);
  }
  if (e.code === 'Escape') {
    if (phase === 'run') pauseGame();
    else if (screenStack.length > 1) popScreen();
  }
  if (e.code === 'Enter') {
    if (phase === 'menu' && screenStack[screenStack.length - 1] === 'menu') { ensureAudio(); sfx('launch'); startRun(selectedSetId); }
    else if (phase === 'paused') resumeGame();
    else if (phase === 'runover') { sfx('launch'); startRun(selectedSetId); }
    else if (phase === 'complete') { sfx('launch'); startRun(Math.min(selectedSetId + 1, WAVE_SETS.length)); }
  }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k of Object.keys(keys)) keys[k] = false; mouseDown = false; });

function updateMouseAim(sx, sy) {
  mouseX = sx; mouseY = sy; mouseSeen = true;
}
window.addEventListener('mousemove', (e) => updateMouseAim(e.clientX, e.clientY));
window.addEventListener('mousedown', (e) => {
  if (e.target.closest('button, .panel, input')) return;
  ensureAudio();
  mouseDown = true;
  updateMouseAim(e.clientX, e.clientY);
});
window.addEventListener('mouseup', () => { mouseDown = false; });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && phase === 'run') pauseGame();
});

// Touch: left half = move stick, right half = aim + fire, DASH button dashes.
const container = $('game-container');
container.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  ensureAudio();
  touchMode = true;
  $('btn-dash').classList.remove('hidden');
  if (e.clientX < window.innerWidth / 2 && stickId === null) {
    stickId = e.pointerId;
    stickOrigin = { x: e.clientX, y: e.clientY };
    stickVec = { x: 0, y: 0 };
    const st = $('touch-stick');
    st.style.left = e.clientX + 'px';
    st.style.top = e.clientY + 'px';
    st.classList.remove('hidden');
  } else if (aimTouchId === null) {
    aimTouchId = e.pointerId;
    aimTouchPos = { x: e.clientX, y: e.clientY };
    touchFiring = true;
    updateMouseAim(e.clientX, e.clientY);
  }
});
container.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'touch') return;
  if (e.pointerId === stickId && stickOrigin) {
    const dx = e.clientX - stickOrigin.x, dy = e.clientY - stickOrigin.y;
    const len = Math.hypot(dx, dy) || 1;
    const cl = Math.min(len, 55);
    stickVec = { x: (dx / len) * (cl / 55), y: (dy / len) * (cl / 55) };
    $('touch-stick-nub').style.transform = `translate(calc(-50% + ${dx / len * cl}px), calc(-50% + ${dy / len * cl}px))`;
  } else if (e.pointerId === aimTouchId && aimTouchPos) {
    aimTouchPos = { x: e.clientX, y: e.clientY };
    updateMouseAim(e.clientX, e.clientY);
  }
});
function endTouch(e) {
  if (e.pointerId === stickId) {
    stickId = null; stickOrigin = null; stickVec = { x: 0, y: 0 };
    $('touch-stick').classList.add('hidden');
    $('touch-stick-nub').style.transform = 'translate(-50%, -50%)';
  }
  if (e.pointerId === aimTouchId) { aimTouchId = null; touchFiring = false; }
}
container.addEventListener('pointerup', endTouch);
container.addEventListener('pointercancel', endTouch);
$('btn-dash').addEventListener('pointerdown', (e) => { e.preventDefault(); dashQueued = true; });

function computeInput() {
  if (autoPilot && run) return greedyPolicy(run);
  const input = { mx: 0, mz: 0, aimX: run.aimX, aimZ: run.aimZ, fire: false, dash: false };
  if (seekEnemy && run) {
    const t = nearestEnemy(run);
    if (t) {
      const dx = t.x - run.x, dz = t.z - run.z;
      const d = Math.hypot(dx, dz) || 1;
      input.mx = clamp(dx / d, -1, 1);
      input.mz = clamp(dz / d, -1, 1);
    }
    input.aimX = run.aimX; input.aimZ = run.aimZ;
    input.fire = false;
    input.dash = false;
    return input;
  }
  // Keyboard move (screen-relative: W = up-screen = -z, A = -x).
  let mx = 0, mz = 0;
  if (keys.KeyA || keys.ArrowLeft) mx -= 1;
  if (keys.KeyD || keys.ArrowRight) mx += 1;
  if (keys.KeyW || keys.ArrowUp) mz -= 1;
  if (keys.KeyS || keys.ArrowDown) mz += 1;
  if (touchMode && stickId !== null) { mx = stickVec.x; mz = stickVec.y; }
  if (hookMove) { mx = hookMove.mx; mz = hookMove.mz; }
  input.mx = clamp(mx, -1, 1);
  input.mz = clamp(mz, -1, 1);
  // Aim: mouse screen position -> world point on the arena plane.
  if (hookAimWorld) {
    input.aimX = hookAimWorld.x; input.aimZ = hookAimWorld.z;
  } else if (mouseSeen) {
    const w = screenToWorld(mouseX, mouseY);
    input.aimX = w.x; input.aimZ = w.z;
  }
  input.fire = mouseDown || !!keys.Space || touchFiring || !!hookFire;
  input.dash = dashQueued || hookDash;
  dashQueued = false;
  hookDash = false;
  return input;
}

// ---------- HUD ----------
const hudCache = {};
function setText(id, value) {
  if (hudCache[id] !== value) { hudCache[id] = value; $(id).textContent = value; }
}
function updateHUD() {
  if (!run || phase === 'menu') return;
  setText('hud-score', `Score ${run.score.toLocaleString()}`);
  const mult = comboMultiplier(run.combo);
  setText('hud-combo', run.combo >= 2 ? `Combo x${mult.toFixed(1)} (${run.combo})` : 'Combo x1.0');
  $('hud-combo').classList.toggle('hot', run.combo >= 10);
  setText('hud-wave', `Wave ${run.waveIndex + 1}/${set.waves.length}`);
  setText('hud-energy', `Energy ${run.energy}`);
  const shields = $('hud-shields');
  let html = '';
  for (let i = 0; i < run.maxShields; i++) {
    html += i < run.shields ? '◆' : '<span class="lost">◆</span>';
  }
  if (hudCache.shields !== html) { hudCache.shields = html; shields.innerHTML = html; }
  const frac = run.dashCd > 0 ? 1 - run.dashCd / DASH_COOLDOWN : 1;
  $('dash-fill').style.transform = `scaleX(${frac})`;
  $('dash-label').textContent = frac >= 1 ? 'DASH READY' : 'DASH';
  // Low-shield vignette: on while flying on the last shield, off
  // everywhere else (menu / pause / more shields). Static, not
  // breathing, when reduce-flashing is on.
  const lowShield = phase === 'run' && run.shields === 1;
  if (hudCache.lowShield !== lowShield) {
    hudCache.lowShield = lowShield;
    $('low-shield').classList.toggle('show', lowShield);
  }
  $('low-shield').classList.toggle('static', reduceFlashingOn());
}

// ---------- render sync ----------
function syncScene(dt) {
  const r = renderRun;
  if (!r) return;
  // Ship.
  shipMesh.position.set(r.x, 0.6, r.z);
  shipMesh.rotation.y = -r.angle;
  // Banking: tilt into the strafe (perpendicular velocity) and pitch with forward speed.
  const fwdX = Math.cos(r.angle), fwdZ = Math.sin(r.angle);
  const fwdV = r.vx * fwdX + r.vz * fwdZ;
  const perpV = -r.vx * fwdZ + r.vz * fwdX;
  const bank = clamp(-perpV * 0.03, -0.5, 0.5);
  const pitch = clamp(fwdV * 0.008, -0.2, 0.2);
  shipMesh.rotation.z = bank;
  shipMesh.rotation.x = -pitch;
  if (shipSquashT > 0) {
    shipSquashT -= dt;
    const s = 1 + 0.25 * Math.sin((shipSquashT / 0.25) * Math.PI);
    shipMesh.scale.set(1.25 * s, 1.25 / s, 1.25 * s);
  } else {
    shipMesh.scale.set(1.25, 1.25, 1.25);
  }
  // Invulnerability blink.
  shipMesh.visible = !(phase === 'run' && r.invuln > 0 && Math.floor(elapsed * 14) % 2 === 0 && r.dashTime <= 0);
  // Dash trail + engine trail.
  if (phase === 'run' && (r.dashTime > 0 || Math.hypot(r.vx, r.vz) > 6)) {
    spawnParticles(r.x - Math.cos(r.angle) * 1.2, r.z - Math.sin(r.angle) * 1.2, 0.6,
      r.dashTime > 0 ? MATS.particleWhite : MATS.particleCyan, r.dashTime > 0 ? 3 : 1, 3, 0.4);
  }
  shipLight.position.set(r.x, 4, r.z);
  shipLight.intensity = 1.2 + glowPulse * 1.5;
  glowPulse = Math.max(0, glowPulse - dt * 3);
  // Crosshair follows the aim point while running.
  if (phase === 'run') {
    crosshair.visible = true;
    crossDot.visible = true;
    crosshair.position.set(r.aimX, 0.06, r.aimZ);
    crossDot.position.set(r.aimX, 0.06, r.aimZ);
    const pulse = 1 + 0.08 * Math.sin(elapsed * 6);
    crossPulse = Math.max(0, crossPulse - dt * 4); // shot pop decays to rest
    crosshair.scale.setScalar(pulse * (1 + 0.35 * crossPulse));
  } else {
    crosshair.visible = false;
    crossDot.visible = false;
  }
  syncEnemies(r);
  syncPool(bulletPool, r.bullets, true);
  syncPool(enemyBulletPool, r.enemyBullets, false);
  syncPool(pickupPool, r.pickups, false);
  for (let i = 0; i < pickupPool.length; i++) {
    const m = pickupPool[i];
    if (m.visible) {
      m.rotation.y += dt * 3;
      m.position.y = 0.6 + Math.sin(elapsed * 3 + i) * 0.15;
    }
  }
  updateParticles(dt);
  updateRings(dt);
  // Nebula drift.
  for (let i = 0; i < nebulae.length; i++) {
    nebulae[i].position.x += Math.sin(elapsed * 0.05 + i * 2) * dt * 0.4;
  }
}

// ---------- camera ----------
function updateCamera(dt) {
  const r = renderRun;
  // On portrait screens the arena is wider than the view, so the
  // camera follows the ship more closely (0.55 vs 0.25) — the player
  // sees their neighbourhood instead of a thin slice of arena.
  const aspect = window.innerWidth / window.innerHeight;
  const follow = aspect < 1 ? 0.55 : 0.25;
  const cx = r ? r.x * follow : 0;
  const cz = r ? r.z * follow : 0;
  // Aim lead: the look target leans a little toward the aim point, so
  // the player sees slightly more of where they are shooting. Small
  // (6%) — the aim mapping stays exact because screenToWorld uses
  // this same camera.
  const leadX = r ? (r.aimX - r.x) * 0.06 : 0;
  const leadZ = r ? (r.aimZ - r.z) * 0.06 : 0;
  const lookX = r ? r.x * (follow + 0.1) + leadX : 0;
  const lookZ = r ? r.z * (follow + 0.1) - 3 + leadZ : -3;
  // Trauma shake: shake = trauma^2, decays in real time.
  trauma = Math.max(0, trauma - dt * 1.6);
  const amp = trauma * trauma * shakeStrength * 1.6;
  const t = elapsed * 31;
  const shX = amp * (Math.sin(t * 1.1) + Math.sin(t * 2.3) * 0.5);
  const shY = amp * (Math.cos(t * 1.7) + Math.sin(t * 2.9) * 0.5);
  const shZ = amp * (Math.sin(t * 1.3) + Math.cos(t * 2.1) * 0.5);
  camera.position.set(cx + CAM_OFFSET.x + shX, CAM_OFFSET.y + shY, cz + CAM_OFFSET.z + shZ);
  camera.lookAt(lookX + shX * 0.5, 0, lookZ + shZ * 0.5);
  // FOV: base 55, event pulse on dash/kill/wave clear, PLUS a speed
  // kick — flying fast widens the view a little, and it settles back
  // to exactly 55 when the ship slows (fovPulse decays to 0 and the
  // speed term to 0, so the rest state is exact).
  fovPulse = Math.max(0, fovPulse - dt * 2.2);
  const speed = r ? Math.hypot(r.vx, r.vz) : 0;
  const speedKick = clamp(speed / MAX_SPEED, 0, 1) * 3.5;
  const targetFov = 55 + fovPulse * 9 + speedKick;
  if (Math.abs(fovCurrent - targetFov) > 0.01) {
    fovCurrent += (targetFov - fovCurrent) * Math.min(1, 10 * dt);
    camera.fov = fovCurrent;
    camera.updateProjectionMatrix();
  }
}

// ---------- main loop ----------
function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = Math.min(0.1, (now - lastFrameT) / 1000);
  lastFrameT = now;
  elapsed += rawDt;
  fpsEma = fpsEma * 0.95 + (1 / Math.max(1e-6, rawDt)) * 0.05;

  // Hit-stop (real-time) and slow-mo own the time scale; only the
  // newest hit-stop owns the restore.
  const nowS = now / 1000;
  if (nowS < hitStopUntil) timeScale = 0;
  else if (nowS < slowMoUntil) timeScale = slowMoScale;
  else timeScale = 1;

  const simDt = rawDt * timeScale;
  if (phase === 'run' && run && !run.done) {
    // Low-shield heartbeat: a soft double-thump about once a second
    // while on the last shield — audio twin of the vignette.
    if (run.shields === 1 && nowS - lastHeartbeat > 1.0) {
      lastHeartbeat = nowS;
      sfx('heartbeat');
    }
    accumulator += simDt;
    let steps = 0;
    while (accumulator >= DT && steps < 4) {
      const events = stepRun(run, computeInput(), DT);
      handleEvents(events);
      accumulator -= DT;
      steps++;
    }
    if (steps === 4) accumulator = 0; // drop backlog under slow rendering
    if (run.done) endRun();
  } else if (phase === 'menu' && demoRun) {
    // Attract flight: the demo ship plays wave set 1 behind the menu.
    accumulator += simDt;
    let steps = 0;
    while (accumulator >= DT && steps < 4) {
      stepRun(demoRun, greedyPolicy(demoRun), DT);
      accumulator -= DT;
      steps++;
    }
    if (steps === 4) accumulator = 0;
    if (demoRun.done) demoRun = physicsStartRun(WAVE_SETS[0]);
    renderRun = demoRun;
  }
  if (renderer) {
    syncScene(rawDt);
    updateCamera(rawDt);
    updateHUD();
    renderer.render(scene, camera);
  }
}

// ---------- boot ----------
window.addEventListener('resize', () => {
  if (!renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
refreshSetSelect();
applySettingsToUI();
updateMuteLabels();
if (renderer) {
  pushScreen('menu');
  requestAnimationFrame((t) => { lastFrameT = t; requestAnimationFrame(frame); });
} else {
  $('menu').classList.remove('hidden');
}

// ---------- public hooks (bot + render check drive the game through these) ----------
window.__nova = {
  get version() { return VERSION; },
  get state() {
    return {
      phase,
      setId: set ? set.id : null,
      selectedSetId,
      shields: run ? run.shields : null,
      score: run ? run.score : null,
      done: run ? run.done : null,
      reason: run ? run.reason : null,
      perf: { fps: Math.round(fpsEma) },
    };
  },
  waveSets() {
    return WAVE_SETS.map((s) => ({
      id: s.id, name: s.name, waves: s.waves.length,
      best: save.best[s.id] || null,
    }));
  },
  info() {
    // In the menu phase there is no run yet — report the attract
    // flight instead, so the render check can prove the menu scene
    // is alive (the demo ship actually flies).
    const r = run || (phase === 'menu' ? demoRun : null);
    if (!r) return null;
    const enemies = r.enemies.map((e) => {
      const sp = projectToScreen(e.x, 0.6, e.z);
      return { id: e.id, type: e.type, x: e.x, z: e.z, hp: e.hp, telegraph: e.telegraph, screen: sp };
    });
    const aimSp = projectToScreen(r.aimX, 0, r.aimZ);
    return {
      setId: set.id, setName: set.name, waves: set.waves.length,
      waveIndex: r.waveIndex, waveState: r.waveState,
      shields: r.shields, maxShields: r.maxShields,
      score: r.score, energy: r.energy,
      combo: r.combo, maxCombo: r.maxCombo,
      multiplier: comboMultiplier(r.combo),
      kills: r.kills, hitsTaken: r.hitsTaken, dashes: r.dashes,
      shotsFired: r.shotsFired, pickupsCollected: r.pickupsCollected,
      time: r.time,
      ship: { x: r.x, z: r.z, vx: r.vx, vz: r.vz, angle: r.angle, invuln: r.invuln, stun: r.stun, speed: Math.hypot(r.vx, r.vz), scale: shipMesh.scale.x },
      aim: { x: r.aimX, z: r.aimZ, screen: aimSp },
      lowShield: phase === 'run' && r.shields === 1,
      // Screen position of the ship — the camera looks from +z, so
      // tests assert movement direction in screen space, not world
      // space (the Drift M2 lesson: a mirrored-input bug survived
      // every world-space test).
      screen: projectToScreen(r.x, 0.6, r.z),
      dash: { cd: r.dashCd, ready: r.dashCd <= 0, time: r.dashTime },
      bullets: r.bullets.length,
      enemyBullets: r.enemyBullets.length,
      enemies,
      pickups: r.pickups.length,
      done: r.done, reason: r.reason,
      trauma, timeScale, fov: fovCurrent, fovPulse, crossPulse,
      shakeAmp: trauma * trauma * shakeStrength,
      // Feedback log: the last handled events with the layers that
      // fired, so tests can assert every bundle fired completely.
      feedback: feedbackLog.map((f) => ({ type: f.type, layers: [...f.layers] })),
      audio: audioCtx
        ? { state: audioCtx.state, music: !!musicTimer, musicStep, lead: musicLeadOn, sfxOn: save.sfx, musicOn: save.music }
        : null,
      perf: { fps: Math.round(fpsEma) },
    };
  },
  start(setId) { startRun(setId ?? selectedSetId); },
  restart() { startRun(selectedSetId); },
  pause() { pauseGame(); },
  resume() { resumeGame(); },
  quitToMenu() { quitToMenu(); },
  selectSet(id) { selectedSetId = id; refreshSetSelect(); },
  setMove(mx, mz) { hookMove = { mx, mz }; },
  clearMove() { hookMove = null; },
  setAimWorld(x, z) { hookAimWorld = { x, z }; },
  setAimScreen(sx, sy) {
    const w = screenToWorld(sx, sy);
    hookAimWorld = w;
    mouseX = sx; mouseY = sy; mouseSeen = true;
  },
  clearAim() { hookAimWorld = null; },
  setFire(b) { hookFire = !!b; },
  dash() { hookDash = true; },
  seekEnemy(on) { seekEnemy = !!on; },
  autopilot(on) { autoPilot = !!on; },
  setShake(v) { save.shake = clamp(v, 0, 1); shakeStrength = save.shake; persistSave(); applySettingsToUI(); },
  setReduceFlashing(b) { save.reduceFlashing = !!b; persistSave(); applySettingsToUI(); },
  get shake() { return shakeStrength; },
  get reduceFlashing() { return reduceFlashingOn(); },
  save() { return JSON.parse(JSON.stringify(save)); },
};
