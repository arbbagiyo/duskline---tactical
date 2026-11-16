// Boot and the one loop. A fixed 60 Hz simulation (movement, bots, rounds,
// grenades) runs apart from rendering, fed by an accumulator; the renderer
// draws whatever state the simulation last produced. Combat lives here and
// nowhere else: the player's ray against body/head hitboxes, bot fire against
// sphere hitboxes with wall occlusion, radius damage from grenades. All hot
// paths reuse the module-level temps below and allocate nothing per frame.
// ?shot=start|play|site|end&seed=N stages a deterministic frame, renders it
// twice, freezes, and sets window.__shotReady.
import * as THREE from 'three';
import { G, mulberry32, announce, hear, PLANT_TIME, DEFUSE_TIME, BOMB_FUSE, KILL_REWARD, MAX_MONEY } from './state.js';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createPlayer } from './player.js';
import { createLoadout } from './weapons.js';
import { createBots } from './bots.js';
import { createGrenades } from './grenades.js';
import { createRounds } from './rounds.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { setupShot } from './shots.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
G.seed = seed;
G.rng = mulberry32(seed);
G.shot = shot;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.sky), 30, 85);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const player = createPlayer(world.colliders);
const loadout = createLoadout(camera);
const botsObj = createBots(scene, world);
const bots = botsObj.bots;
const audio = createAudio();
const hud = createHud(onPlayClick, onBuyClick);
const input = createInput(renderer.domElement, onLockChange);

const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const shootables = world.shootables.concat(botsObj.hitMeshes);
// Reused temps: no allocation in step(), shoot() or the sight checks.
const _dir = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _oc = new THREE.Vector3();
const _muzzle = new THREE.Vector3();

let buyOpen = false;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let lastDry = 0;
let shake = 0;
let lastPhase = G.phase;
let lastEndText = '';
let lastAnnouncedFeed = 0;

// --- Tracers: a fixed pool of fading lines, one per shot. ---
const tracers = [];
for (let i = 0; i < 10; i += 1) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xf2a93b, transparent: true, opacity: 0 }));
  line.visible = false;
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, life: 0 });
}
let tracerIdx = 0;
function spawnTracer(a, b, color) {
  const t = tracers[tracerIdx];
  tracerIdx = (tracerIdx + 1) % tracers.length;
  const pos = t.line.geometry.getAttribute('position');
  pos.setXYZ(0, a.x, a.y, a.z);
  pos.setXYZ(1, b.x, b.y, b.z);
  pos.needsUpdate = true;
  t.line.material.color.setHex(color);
  t.line.material.opacity = 0.85;
  t.line.visible = true;
  t.life = 0.07;
}

// --- Sight: wall occlusion for bot perception and blast damage. ---
function lineClear(a, b) {
  _dir.subVectors(b, a);
  const dist = _dir.length();
  if (dist < 0.001) return true;
  _dir.multiplyScalar(1 / dist);
  raycaster.set(a, _dir);
  raycaster.far = dist;
  return raycaster.intersectObjects(world.shootables, false).length === 0;
}

function siteAt(x, z) {
  for (const key of ['A', 'B']) {
    const s = world.sites[key];
    if (Math.abs(x - s.cx) < s.hw && Math.abs(z - s.cz) < s.hd) return key;
  }
  return null;
}

function dropBomb(x, z) {
  G.bomb.state = 'dropped';
  G.bomb.carrier = null;
  G.bomb.pos.x = x;
  G.bomb.pos.y = 0;
  G.bomb.pos.z = z;
  G.bomb.plant = 0;
  announce('The charge was dropped', false);
}

function checkElimination() {
  if (G.phase !== 'live') return;
  const sentAlive = botsObj.aliveCount('sent');
  const vanAlive = (player.body.alive ? 1 : 0) + botsObj.aliveCount('van');
  if (sentAlive === 0) rounds.endRound('van', G.bomb.state === 'planted' ? 'site secured' : 'all Sentinels eliminated');
  else if (vanAlive === 0 && G.bomb.state !== 'planted') rounds.endRound('sent', 'Vanguard eliminated');
}

function damageBot(bot, dmg, part, attacker) {
  if (!bot.alive) return false;
  bot.hp -= dmg;
  if (bot.hp > 0) return false;
  bot.alive = false;
  bot.hp = 0;
  bot.planting = false;
  bot.defusing = false;
  if (G.bomb.carrier === 'mate' && bot.role === 'mate') dropBomb(bot.group.position.x, bot.group.position.z);
  if (attacker === 'player') {
    G.kills += 1;
    G.money = Math.min(MAX_MONEY, G.money + KILL_REWARD);
    announce(`You eliminated ${bot.name} (+$${KILL_REWARD})`, true);
  } else {
    announce(`${attacker === 'blast' ? 'Blast' : attacker} eliminated ${bot.name}`, bot.team === 'sent');
  }
  checkElimination();
  return true;
}

function damagePlayer(dmg, attackerName) {
  if (!player.body.alive) return;
  hud.damageFlash();
  audio.hurt();
  const killed = player.damage(dmg);
  if (!killed) return;
  G.deaths += 1;
  announce(`${attackerName} eliminated you`, false);
  hud.setDead(true);
  if (G.bomb.carrier === 'player') dropBomb(player.body.pos.x, player.body.pos.z);
  checkElimination();
}

// Radius damage from a frag: falloff with distance, blocked by walls.
function damageRadius(pos, radius, team, maxDmg) {
  const distToPlayer = pos.distanceTo(player.body.pos);
  audio.explode(distToPlayer);
  hear(pos.x, pos.z, 1);
  if (distToPlayer < radius * 1.6) shake = Math.min(0.5, shake + (1 - distToPlayer / (radius * 1.6)) * 0.4);
  if (player.body.alive) {
    _to.set(player.body.pos.x, player.body.pos.y + 1, player.body.pos.z);
    const d = pos.distanceTo(_to);
    if (d < radius && lineClear(pos, _to)) {
      if (d < radius * 0.6) hud.blastFlash();
      damagePlayer(maxDmg * (1 - (d / radius) * 0.7), 'Frag grenade');
    }
  }
  for (const bot of bots) {
    if (!bot.alive) continue;
    _to.set(bot.group.position.x, 1, bot.group.position.z);
    const d = pos.distanceTo(_to);
    if (d < radius && lineClear(pos, _to)) damageBot(bot, maxDmg * (1 - (d / radius) * 0.7), 'torso', 'blast');
  }
}

const grenades = createGrenades(scene, world, audio, damageRadius);

function resetActors() {
  player.reset(world.spawns.van[0][0], world.spawns.van[0][1], 0);
  botsObj.reset();
  loadout.refillRound();
  grenades.reset();
  hud.setDead(false);
  hud.setPrompt(null);
}

const rounds = createRounds(scene, audio, resetActors);

function muzzleWorld(out) {
  out.set(0.24, -0.17, -0.95);
  return camera.localToWorld(out);
}

function playerShoot(spreadOverride) {
  const def = loadout.fire();
  if (!def) {
    const current = loadout.currentDef();
    if (current && loadout.ammo[current.id].mag === 0 && G.time - lastDry > 0.3) {
      lastDry = G.time;
      audio.dryFire();
    }
    return false;
  }
  const spread = spreadOverride ?? loadout.spread(player.groundSpeed(), player.body.crouching, !player.body.onGround);
  camera.getWorldDirection(_dir);
  _dir.x += (G.rng() * 2 - 1) * spread;
  _dir.y += (G.rng() * 2 - 1) * spread;
  _dir.z += (G.rng() * 2 - 1) * spread;
  _dir.normalize();
  player.eyePos(_eye);
  scene.updateMatrixWorld(true);
  raycaster.set(_eye, _dir);
  raycaster.far = 90;
  const hit = raycaster.intersectObjects(shootables, false)[0];
  let endDist = 60;
  if (hit) {
    endDist = hit.distance;
    const bot = hit.object.userData.bot;
    if (bot && bot.alive) {
      const part = hit.object.userData.part;
      const dmg = loadout.damageAt(def, hit.distance) * (part === 'head' ? def.headMult : 1);
      const killed = damageBot(bot, dmg, part, 'player');
      hud.hitMarker(killed);
      if (killed) audio.kill();
      else audio.hit();
    }
  }
  _hit.copy(_eye).addScaledVector(_dir, endDist);
  spawnTracer(muzzleWorld(_muzzle), _hit, 0xf2a93b);
  player.recoil(def.kick * (0.8 + G.rng() * 0.4), (G.rng() * 2 - 1) * def.kick * 0.35);
  audio.shot(def.kind, 0);
  hear(player.body.pos.x, player.body.pos.z, 1);
  return true;
}

// Ray-sphere test for bot fire: returns t along the ray, or -1 on a miss.
function raySphere(origin, dir, cx, cy, cz, r) {
  _oc.set(cx - origin.x, cy - origin.y, cz - origin.z);
  const tca = _oc.dot(dir);
  if (tca < 0) return -1;
  const d2 = _oc.lengthSq() - tca * tca;
  if (d2 > r * r) return -1;
  const thc = Math.sqrt(r * r - d2);
  const t = tca - thc;
  return t < 0 ? tca + thc : t;
}

function botShoot(bot, from, aim, spread) {
  _dir.subVectors(aim, from).normalize();
  _dir.x += (G.rng() * 2 - 1) * spread;
  _dir.y += (G.rng() * 2 - 1) * spread;
  _dir.z += (G.rng() * 2 - 1) * spread;
  _dir.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(from, _dir);
  raycaster.far = 90;
  const wall = raycaster.intersectObjects(world.shootables, false)[0];
  const wallDist = wall ? wall.distance : 90;
  let bestT = wallDist;
  let bestKind = null;
  let bestBot = null;
  let bestHead = false;
  const spheres = [[0.35, 0.42, false], [1.0, 0.45, false], [1.55, 0.3, true]];
  function testActor(px, py, pz, kind, target) {
    for (const [h, r, head] of spheres) {
      const t = raySphere(from, _dir, px, py + h, pz, r);
      if (t > 0 && t < bestT) {
        bestT = t;
        bestKind = kind;
        bestBot = target;
        bestHead = head;
      }
    }
  }
  if (bot.team === 'sent' && player.body.alive) testActor(player.body.pos.x, player.body.pos.y, player.body.pos.z, 'player', null);
  for (const other of bots) {
    if (other === bot || !other.alive || other.team === bot.team) continue;
    testActor(other.group.position.x, 0, other.group.position.z, 'bot', other);
  }
  _hit.copy(from).addScaledVector(_dir, bestT);
  spawnTracer(from, _hit, bot.team === 'van' ? 0x57c7d4 : 0xe2543e);
  const distToPlayer = from.distanceTo(player.body.pos);
  audio.shot('rifle', distToPlayer);
  hear(from.x, from.z, 0.8);
  if (bestKind === 'player') {
    const fall = bestT <= 12 ? 1 : Math.max(0.6, 1 - (bestT - 12) * 0.014);
    damagePlayer(26 * fall * (bestHead ? 2 : 1), bot.name);
  } else if (bestKind === 'bot') {
    const fall = bestT <= 12 ? 1 : Math.max(0.6, 1 - (bestT - 12) * 0.014);
    damageBot(bestBot, 26 * fall * (bestHead ? 2 : 1), bestHead ? 'head' : 'torso', bot.name);
  }
}

const botEnv = {
  get player() {
    return { pos: player.body.pos, eye: player.body.eye, alive: player.body.alive };
  },
  get playerSpeed() {
    return player.groundSpeed();
  },
  lineClear,
  shoot(bot, from, aim, spread) {
    botShoot(bot, from, aim, spread);
  },
};

function syncCamera() {
  player.eyePos(_eye);
  camera.position.copy(_eye);
  const sx = shake > 0 ? (G.rng() * 2 - 1) * shake * 0.02 : 0;
  const sy = shake > 0 ? (G.rng() * 2 - 1) * shake * 0.02 : 0;
  camera.rotation.set(player.body.pitch + sx, player.body.yaw + sy, 0, 'YXZ');
}

function aimAt(x, y, z) {
  const dx = x - player.body.pos.x;
  const dy = y - (player.body.pos.y + player.body.eye);
  const dz = z - player.body.pos.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  player.body.yaw = Math.atan2(-dx, -dz);
  player.body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function fmtTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function syncHud() {
  hud.setHealth(player.body.hp);
  const def = loadout.currentDef();
  if (def) hud.setAmmo(loadout.ammo[def.id].mag, loadout.ammo[def.id].reserve, def.name.toUpperCase(), false);
  else hud.setAmmo(1, 0, loadout.state.slot === 'frag' ? 'FRAG GRENADE' : 'SMOKE GRENADE', true);
  hud.setNades(loadout.state.frags, loadout.state.smokes);
  hud.setMoney(G.money);
  hud.setScore(G.scoreV, G.scoreS, G.round);
  hud.setCarry(G.bomb.carrier === 'player');
  hud.setFeed(G.feed);
  if (G.phase === 'buy') hud.setTimer(`BUY ${fmtTime(G.buyLeft)}`, false);
  else if (G.bomb.state === 'planted') hud.setTimer(fmtTime(G.bomb.fuse), true);
  else hud.setTimer(fmtTime(G.timer), G.timer < 15 && G.phase === 'live');
  if (G.bomb.state === 'planted') hud.setBomb('fuse', G.bomb.fuse / BOMB_FUSE, `CHARGE LIVE — SITE ${G.bomb.site}`);
  else if (G.bomb.plant > 0) hud.setBomb('plant', G.bomb.plant / PLANT_TIME, 'PLANTING CHARGE');
  else if (G.bomb.defuse > 0) hud.setBomb('defuse', G.bomb.defuse / DEFUSE_TIME, 'DEFUSING CHARGE');
  else hud.setBomb('none', 0, '');
  hud.setGap(4 + loadout.spread(player.groundSpeed(), player.body.crouching, !player.body.onGround) * 700);
  if (buyOpen) {
    const owned = [];
    if (loadout.state.primary) owned.push(loadout.state.primary);
    if (loadout.state.frags > 0) owned.push('frag');
    if (loadout.state.smokes > 0) owned.push('smoke');
    hud.showBuy(true, G.money, owned);
  }
}

function onBuyClick(id) {
  const res = rounds.buy(loadout, id);
  hud.setBuyMsg(res.msg);
  syncHud();
}

function onPlayClick() {
  if (shot) return;
  audio.unlock();
  if (G.phase === 'menu' || G.phase === 'match') {
    if (G.phase === 'match') loadout.resetMatch();
    rounds.startMatch();
  }
  input.requestLock();
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    G.started = true;
    hud.hideOverlay();
    return;
  }
  if (buyOpen) return;
  if (G.phase === 'match') hud.showOverlay('match', { winner: G.winner, v: G.scoreV, s: G.scoreS, kills: G.kills });
  else if (G.phase === 'ended') hud.showOverlay('round', { text: G.endText, v: G.scoreV, s: G.scoreS });
  else if (G.started) hud.showOverlay('paused');
  else hud.showOverlay('start');
}

function throwHeldGrenade() {
  const kind = loadout.throwHeld();
  if (!kind) return;
  camera.getWorldDirection(_dir);
  player.eyePos(_eye);
  _from.copy(_eye).addScaledVector(_dir, 0.5);
  grenades.throwGrenade(_from, _dir, kind, 'van');
  loadout.switchTo(loadout.fallbackSlot());
  hear(player.body.pos.x, player.body.pos.z, 0.6);
}

function handleInputEdges() {
  if (input.consume('KeyB')) {
    if (buyOpen) {
      buyOpen = false;
      hud.showBuy(false, 0, []);
      if (!shot) input.requestLock();
    } else if (G.phase === 'buy') {
      buyOpen = true;
      hud.setBuyMsg('');
      hud.showBuy(true, G.money, []);
      if (document.pointerLockElement) document.exitPointerLock();
    }
  }
  const digit = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].find((d) => input.state.pressed.has(d));
  if (digit) {
    input.consume(digit);
    if (buyOpen) {
      onBuyClick(['vk7', 'smg', 'frag', 'smoke'][Number(digit.slice(-1)) - 1]);
    } else if (G.phase === 'live' || G.phase === 'buy') {
      loadout.switchTo(['primary', 'pistol', 'frag', 'smoke'][Number(digit.slice(-1)) - 1]);
    }
  }
  if (input.consume('KeyR') && loadout.reload()) audio.reload();
  // Capture the slot before throwing: a grenade throw switches back to a gun,
  // and the same click must not also fire that gun.
  const threwGrenade = input.state.mouseEdge && loadout.isGrenadeSlot() && G.phase === 'live';
  if (threwGrenade) throwHeldGrenade();
  if (input.state.mouseEdge && !threwGrenade && !loadout.currentDef()?.auto && G.phase === 'live' && player.body.alive && input.state.locked) {
    playerShoot();
  }
  input.consumeAll();
}

function plantingInfo() {
  let planting = null;
  if (G.bomb.state === 'carried' && G.phase === 'live') {
    if (G.bomb.carrier === 'player' && player.body.alive && input.state.keys.has('KeyE')) {
      const site = siteAt(player.body.pos.x, player.body.pos.z);
      if (site) planting = { site, x: player.body.pos.x, z: player.body.pos.z };
    } else if (G.bomb.carrier === 'mate') {
      const mate = botsObj.mate();
      if (mate.planting) {
        const site = siteAt(mate.group.position.x, mate.group.position.z);
        if (site) planting = { site, x: mate.group.position.x, z: mate.group.position.z };
      }
    }
  }
  let defusing = false;
  if (G.bomb.state === 'planted') {
    for (const bot of bots) if (bot.alive && bot.team === 'sent' && bot.defusing) defusing = true;
  }
  return { planting, defusing };
}

function updatePrompt() {
  if (G.phase === 'buy') {
    hud.setPrompt('BUY PHASE — PRESS B FOR WEAPONS');
    return;
  }
  if (G.phase !== 'live' || !player.body.alive) {
    hud.setPrompt(null);
    return;
  }
  const site = siteAt(player.body.pos.x, player.body.pos.z);
  if (G.bomb.carrier === 'player' && site) hud.setPrompt(`HOLD E — PLANT CHARGE AT ${site === 'A' ? 'DEPOT' : 'CRANE'}`);
  else if (G.bomb.state === 'dropped' && Math.hypot(player.body.pos.x - G.bomb.pos.x, player.body.pos.z - G.bomb.pos.z) < 3) hud.setPrompt('CHARGE DROPPED NEARBY — WALK OVER IT TO PICK UP');
  else if (G.bomb.state === 'planted') hud.setPrompt(`CHARGE PLANTED AT SITE ${G.bomb.site} — DEFEND IT`);
  else hud.setPrompt(null);
}

function step(dt) {
  G.time += dt;
  const live = G.phase === 'live';
  const canMove = live && player.body.alive;
  player.step(dt, input.state.keys, canMove);
  loadout.step(dt, player.groundSpeed());
  if (live) botsObj.step(dt, botEnv);
  if (live || G.phase === 'ended') grenades.step(dt);
  if (G.phase === 'buy' || live || G.phase === 'ended') rounds.update(dt, plantingInfo());
  rounds.syncProp();
  // Picking up a dropped charge is automatic on contact.
  if (G.bomb.state === 'dropped' && player.body.alive && Math.hypot(player.body.pos.x - G.bomb.pos.x, player.body.pos.z - G.bomb.pos.z) < 1.5) {
    G.bomb.state = 'carried';
    G.bomb.carrier = 'player';
    announce('You picked up the charge', true);
  }
  updatePrompt();
  if (G.phase === 'ended' && G.endText !== lastEndText) {
    lastEndText = G.endText;
    hud.announce(G.endText);
  }
  if (G.phase === 'match' && lastPhase !== 'match' && !shot) {
    hud.showOverlay('match', { winner: G.winner, v: G.scoreV, s: G.scoreS, kills: G.kills });
    if (document.pointerLockElement) document.exitPointerLock();
  }
  lastPhase = G.phase;
  if (G.feed.length !== lastAnnouncedFeed) {
    lastAnnouncedFeed = G.feed.length;
    const latest = G.feed[G.feed.length - 1];
    if (latest && (latest.text.includes('Round live') || latest.text.includes('planted'))) hud.announce(latest.text);
  }
  if (buyOpen && G.phase !== 'buy') {
    buyOpen = false;
    hud.showBuy(false, 0, []);
    if (!input.state.locked && !shot) hud.showOverlay('paused');
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  shake = Math.max(0, shake - dt * 1.4);
  if (!frozen) {
    const look = input.takeLook();
    if (input.state.locked || shot) player.look(look.x, look.y);
    handleInputEdges();
    if (input.state.firing && loadout.currentDef()?.auto && G.phase === 'live' && player.body.alive && input.state.locked && loadout.ready()) {
      playerShoot();
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    for (const t of tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.85;
        if (t.life <= 0) t.line.visible = false;
      }
    }
    syncCamera();
    syncHud();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function runShot(name) {
  setupShot(name, {
    player,
    bots: botsObj,
    loadout,
    hud,
    rounds,
    world,
    settle,
    aimAt: (x, y, z) => aimAt(x, y, z),
    playerShoot: (spread) => playerShoot(spread),
  });
  syncHud();
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    syncHud();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Staging for the menu backdrop: actors at their spawns, yard in view.
player.reset(world.spawns.van[0][0], world.spawns.van[0][1], 0);
botsObj.reset();
syncCamera();
syncHud();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
