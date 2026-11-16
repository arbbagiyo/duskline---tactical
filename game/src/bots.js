// Bots: one teammate and three defenders. Each bot runs the same loop —
// perceive (field of view + raycast line of sight + smoke), decide (routes,
// holds, investigation, objective), move (waypoint BFS paths, AABB slide),
// shoot (burst fire through main's raycast). Hearing is shared: gunshots write
// G.heard and every bot in earshot investigates. The BFS reuses fixed scratch
// arrays; the per-frame step allocates nothing.
import * as THREE from 'three';
import { G, announce } from './state.js';
import { PALETTE } from './palette.js';
import { smokeBlocks } from './grenades.js';

const BOT_SPEED = 4.2;
const RADIUS = 0.35;
const SIGHT_RANGE = 45;
const FOV_COS = 0.45; // ~63 degrees half-angle
const HEAR_RANGE = 26;

// BFS scratch, sized to the waypoint graph, reused on every retarget.
const _prev = new Int32Array(32);
const _queue = new Int32Array(32);
const _seen = new Uint8Array(32);

function nearestNode(wps, x, z) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < wps.length; i += 1) {
    const dx = wps[i][0] - x;
    const dz = wps[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function findPath(wps, fx, fz, tx, tz, out) {
  out.length = 0;
  const start = nearestNode(wps, fx, fz);
  const goal = nearestNode(wps, tx, tz);
  _seen.fill(0);
  _prev.fill(-1);
  let head = 0;
  let tail = 0;
  _queue[tail++] = start;
  _seen[start] = 1;
  while (head < tail) {
    const n = _queue[head++];
    if (n === goal) break;
    for (const m of wps[n][2]) {
      if (!_seen[m]) { _seen[m] = 1; _prev[m] = n; _queue[tail++] = m; }
    }
  }
  const chain = [];
  let n = goal;
  while (n !== -1) { chain.push(n); n = _prev[n]; }
  chain.reverse();
  for (const idx of chain) out.push([wps[idx][0], wps[idx][1]]);
  out.push([tx, tz]);
  return out;
}

export function createBots(scene, world) {
  const geoLeg = new THREE.BoxGeometry(0.16, 0.75, 0.16);
  const geoTorso = new THREE.BoxGeometry(0.5, 0.7, 0.28);
  const geoHead = new THREE.BoxGeometry(0.28, 0.3, 0.28);
  const geoGun = new THREE.BoxGeometry(0.07, 0.09, 0.55);
  const geoBand = new THREE.BoxGeometry(0.52, 0.1, 0.3);
  const matDark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.steel), roughness: 0.8 });
  const matHead = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.sand), roughness: 0.7 });
  const matAlly = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ally), roughness: 0.6 });
  const matEnemy = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.enemy), roughness: 0.6 });
  const matGun = new THREE.MeshStandardMaterial({ color: new THREE.Color('#222222'), roughness: 0.5, metalness: 0.4 });

  const bots = [];
  const hitMeshes = [];
  const probe = new THREE.Box3();
  const _from = new THREE.Vector3();
  const _to = new THREE.Vector3();
  const _dir = new THREE.Vector3();

  function buildBot(name, team, role) {
    const group = new THREE.Group();
    const chestMat = team === 'van' ? matAlly : matEnemy;
    const legL = new THREE.Mesh(geoLeg, matDark);
    legL.position.set(-0.11, 0.37, 0);
    const legR = new THREE.Mesh(geoLeg, matDark);
    legR.position.set(0.11, 0.37, 0);
    const torso = new THREE.Mesh(geoTorso, chestMat);
    torso.position.y = 1.12;
    const band = new THREE.Mesh(geoBand, matDark);
    band.position.y = 1.32;
    const head = new THREE.Mesh(geoHead, matHead);
    head.position.y = 1.62;
    const gun = new THREE.Mesh(geoGun, matGun);
    gun.position.set(0.22, 1.18, -0.25);
    group.add(legL, legR, torso, band, head, gun);
    group.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    scene.add(group);
    const bot = {
      name, team, role, group, torso, head,
      yaw: 0, hp: 100, alive: true, fall: 0,
      state: 'route', path: [], pathIdx: 0, goalX: 0, goalZ: 0, goalKey: '',
      holdYaw: 0, scanT: 0, perceiveT: Math.random() * 0.15,
      enemy: null, firstSeen: -99, lastSeen: -99, lastKnownX: 0, lastKnownZ: 0,
      burstLeft: 0, shootT: 0, react: 0.35 + Math.random() * 0.25,
      strafeDir: 1, strafeT: 0, stuckT: 0, lastX: 0, lastZ: 0,
      planting: false, defusing: false, roamIdx: 0,
    };
    torso.userData.bot = bot;
    torso.userData.part = 'torso';
    head.userData.bot = bot;
    head.userData.part = 'head';
    hitMeshes.push(torso, head);
    bots.push(bot);
    return bot;
  }

  buildBot('Rook', 'van', 'mate');
  buildBot('Bram', 'sent', 'holdA');
  buildBot('Kessler', 'sent', 'holdB');
  buildBot('Ondo', 'sent', 'roam');

  function setGoal(bot, x, z, key) {
    if (bot.goalKey === key && Math.abs(bot.goalX - x) < 0.5 && Math.abs(bot.goalZ - z) < 0.5) return;
    bot.goalKey = key;
    bot.goalX = x;
    bot.goalZ = z;
    findPath(world.waypoints, bot.group.position.x, bot.group.position.z, x, z, bot.path);
    bot.pathIdx = 0;
  }

  function blocked(x, z) {
    probe.min.set(x - RADIUS, 0.05, z - RADIUS);
    probe.max.set(x + RADIUS, 1.6, z + RADIUS);
    for (const c of world.colliders) if (probe.intersectsBox(c)) return true;
    return false;
  }

  function moveToward(bot, tx, tz, dt, speed, turn = true) {
    const p = bot.group.position;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return true;
    const stepX = (dx / d) * speed * dt;
    const stepZ = (dz / d) * speed * dt;
    if (!blocked(p.x + stepX, p.z)) p.x += stepX;
    if (!blocked(p.x, p.z + stepZ)) p.z += stepZ;
    if (turn) {
      const targetYaw = Math.atan2(-dx, -dz);
      let dy = targetYaw - bot.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      bot.yaw += dy * Math.min(1, dt * 8);
    }
    if (Math.hypot(p.x - bot.lastX, p.z - bot.lastZ) < speed * dt * 0.25) bot.stuckT += dt;
    else bot.stuckT = 0;
    bot.lastX = p.x;
    bot.lastZ = p.z;
    return d < 1.1;
  }

  function followPath(bot, dt, speed) {
    if (bot.pathIdx >= bot.path.length) return true;
    const [tx, tz] = bot.path[bot.pathIdx];
    if (moveToward(bot, tx, tz, dt, speed)) bot.pathIdx += 1;
    if (bot.stuckT > 1.2) {
      bot.stuckT = 0;
      bot.pathIdx = Math.min(bot.pathIdx + 1, bot.path.length);
      bot.goalKey = '';
    }
    return bot.pathIdx >= bot.path.length;
  }

  function eyeOf(bot, out) {
    out.set(bot.group.position.x, 1.55, bot.group.position.z);
    return out;
  }

  function canSeeTarget(bot, tx, ty, tz, env) {
    _from.set(bot.group.position.x, 1.55, bot.group.position.z);
    _to.set(tx, ty, tz);
    _dir.subVectors(_to, _from);
    const dist = _dir.length();
    if (dist > SIGHT_RANGE) return 0;
    _dir.multiplyScalar(1 / (dist || 1));
    const facing = Math.sin(bot.yaw) * -_dir.x + Math.cos(bot.yaw) * -_dir.z;
    if (dist > 6 && facing < FOV_COS) return 0;
    if (smokeBlocks(_from, _to)) return 0;
    return env.lineClear(_from, _to) ? dist : 0;
  }

  function perceive(bot, env) {
    let best = null;
    let bestDist = Infinity;
    const p = env.player;
    if (p.alive && bot.team === 'sent') {
      const d = canSeeTarget(bot, p.pos.x, p.pos.y + p.eye * 0.85, p.pos.z, env);
      if (d > 0 && d < bestDist) { bestDist = d; best = 'player'; }
    }
    for (const other of bots) {
      if (other === bot || !other.alive || other.team === bot.team) continue;
      const d = canSeeTarget(bot, other.group.position.x, 1.3, other.group.position.z, env);
      if (d > 0 && d < bestDist) { bestDist = d; best = other; }
    }
    if (best) {
      if (bot.enemy !== best) {
        bot.enemy = best;
        bot.firstSeen = G.time;
      }
      bot.lastSeen = G.time;
      if (best === 'player') { bot.lastKnownX = p.pos.x; bot.lastKnownZ = p.pos.z; }
      else { bot.lastKnownX = best.group.position.x; bot.lastKnownZ = best.group.position.z; }
      if (bot.state !== 'engage') bot.state = 'engage';
    } else if (bot.enemy && G.time - bot.lastSeen > 3) {
      bot.enemy = null;
      if (bot.state === 'engage') { bot.state = 'investigate'; setGoal(bot, bot.lastKnownX, bot.lastKnownZ, 'lastknown'); }
    }
    return bestDist;
  }

  function decide(bot, env) {
    bot.planting = false;
    bot.defusing = false;
    const bomb = G.bomb;
    if (bot.state === 'engage' && bot.enemy) return;
    if (bot.team === 'van') {
      if (bomb.state === 'carried' && bomb.carrier === 'mate') {
        const site = nearestSite(bot.group.position.x, bot.group.position.z);
        const s = world.sites[site];
        if (Math.abs(bot.group.position.x - s.cx) < s.hw && Math.abs(bot.group.position.z - s.cz) < s.hd) {
          bot.state = 'plant';
          bot.planting = true;
          return;
        }
        bot.state = 'route';
        setGoal(bot, s.cx, s.cz, `plant${site}`);
        return;
      }
      if (bomb.state === 'dropped') {
        if (Math.hypot(bot.group.position.x - bomb.pos.x, bot.group.position.z - bomb.pos.z) < 1.4) {
          bomb.state = 'carried';
          bomb.carrier = 'mate';
          announce('Rook picked up the charge', true);
          return;
        }
        bot.state = 'route';
        setGoal(bot, bomb.pos.x, bomb.pos.z, 'fetch');
        return;
      }
      if (bomb.state === 'planted') {
        bot.state = 'hold';
        const s = world.sites[bomb.site];
        setGoal(bot, s.cx + 4, s.cz + 4, 'guard');
        return;
      }
      // Cover the other site from the player's lane.
      const site = env.player.pos.x < 0 ? 'B' : 'A';
      const s = world.sites[site];
      bot.state = 'route';
      setGoal(bot, s.cx, s.cz + 5, `cover${site}`);
      return;
    }
    // Sentinels.
    if (bomb.state === 'planted') {
      const s = world.sites[bomb.site];
      const inSite = Math.abs(bot.group.position.x - s.cx) < s.hw && Math.abs(bot.group.position.z - s.cz) < s.hd;
      if (inSite && (!bot.enemy || bomb.fuse < 8)) {
        bot.state = 'defuse';
        bot.defusing = true;
        return;
      }
      bot.state = 'route';
      setGoal(bot, s.cx, s.cz, `retake${bomb.site}`);
      return;
    }
    if (bot.state === 'investigate') return; // keep current goal until arrival
    if (G.time - G.heard.t < 1.2) {
      const d = Math.hypot(G.heard.x - bot.group.position.x, G.heard.z - bot.group.position.z);
      if (d < HEAR_RANGE && d > 4) {
        bot.state = 'investigate';
        setGoal(bot, G.heard.x, G.heard.z, `noise${Math.round(G.heard.t * 4)}`);
        return;
      }
    }
    if (bot.role === 'holdA' || bot.role === 'holdB') {
      const s = world.sites[bot.role === 'holdA' ? 'A' : 'B'];
      const hx = s.cx + (bot.role === 'holdA' ? 3.5 : -3.5);
      const hz = s.cz - 2.5;
      if (Math.hypot(bot.group.position.x - hx, bot.group.position.z - hz) > 1.5) {
        bot.state = 'route';
        setGoal(bot, hx, hz, `hold${s.key}`);
      } else {
        bot.state = 'hold';
        bot.holdYaw = Math.atan2(-(0 - hx), -(-2 - hz));
      }
      return;
    }
    // Roamer patrols mid waypoints.
    const patrol = [[0, 4], [-8, 0], [8, 0], [0, -6]];
    const [px, pz] = patrol[bot.roamIdx % patrol.length];
    if (Math.hypot(bot.group.position.x - px, bot.group.position.z - pz) < 1.5) bot.roamIdx += 1;
    bot.state = 'route';
    setGoal(bot, px, pz, `patrol${bot.roamIdx}`);
  }

  function nearestSite(x, z) {
    const da = Math.hypot(x - world.sites.A.cx, z - world.sites.A.cz);
    const db = Math.hypot(x - world.sites.B.cx, z - world.sites.B.cz);
    return da <= db ? 'A' : 'B';
  }

  function shootAt(bot, env, dist) {
    if (G.time - bot.firstSeen < bot.react) return;
    bot.shootT -= 1 / 60;
    if (bot.shootT > 0) return;
    if (bot.burstLeft <= 0) {
      bot.burstLeft = 3 + Math.floor(G.rng() * 3);
      bot.shootT = 0.45 + G.rng() * 0.35;
      return;
    }
    bot.burstLeft -= 1;
    bot.shootT = 0.11;
    const targetSpeed = bot.enemy === 'player' ? env.playerSpeed : 2.5;
    const spread = 0.012 + dist * 0.0009 + targetSpeed * 0.004;
    eyeOf(bot, _from);
    _to.set(bot.lastKnownX, 1.3, bot.lastKnownZ);
    env.shoot(bot, _from, _to, spread);
  }

  function step(dt, env) {
    for (const bot of bots) {
      const p = bot.group.position;
      if (!bot.alive) {
        if (bot.fall < 1) {
          bot.fall = Math.min(1, bot.fall + dt / 0.35);
          bot.group.rotation.x = -bot.fall * 1.45;
          bot.group.position.y = -bot.fall * 0.1;
        }
        continue;
      }
      bot.group.rotation.y = bot.yaw;
      bot.perceiveT -= dt;
      let dist = Infinity;
      if (bot.perceiveT <= 0) {
        bot.perceiveT = 0.15;
        dist = perceive(bot, env);
      } else if (bot.enemy) {
        dist = Math.hypot(bot.lastKnownX - p.x, bot.lastKnownZ - p.z);
      }
      decide(bot, env);

      if (bot.state === 'engage' && bot.enemy) {
        // Face the last known position, strafe, and fire in bursts.
        const dx = bot.lastKnownX - p.x;
        const dz = bot.lastKnownZ - p.z;
        const targetYaw = Math.atan2(-dx, -dz);
        let dy = targetYaw - bot.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        bot.yaw += dy * Math.min(1, dt * 10);
        bot.strafeT -= dt;
        if (bot.strafeT <= 0) { bot.strafeDir *= -1; bot.strafeT = 0.7 + G.rng() * 0.7; }
        const side = bot.strafeDir;
        const sx = p.x + Math.cos(bot.yaw) * side * 2;
        const sz = p.z - Math.sin(bot.yaw) * side * 2;
        moveToward(bot, sx, sz, dt, 2.6, false); // strafe without turning: keep aiming at the enemy
        shootAt(bot, env, dist === Infinity ? 20 : dist);
      } else if (bot.state === 'hold') {
        bot.scanT += dt;
        bot.yaw = bot.holdYaw + Math.sin(bot.scanT * 0.6) * 0.55;
      } else if (bot.state === 'plant' || bot.state === 'defuse') {
        // Stand still and channel; rounds.js advances the progress.
      } else {
        const arrived = followPath(bot, dt, BOT_SPEED);
        if (arrived && bot.state === 'investigate') {
          bot.state = 'hold';
          bot.holdYaw = bot.yaw;
          bot.scanT = 0;
        }
      }
      bot.group.rotation.y = bot.yaw;
    }
  }

  return {
    bots,
    hitMeshes,
    step,
    eyeOf,
    aliveCount(team) {
      let n = 0;
      for (const b of bots) if (b.alive && b.team === team) n += 1;
      return n;
    },
    mate() {
      return bots[0];
    },
    reset() {
      const sentSpawns = world.spawns.sent;
      const mateSpawn = world.spawns.van[2];
      for (let i = 0; i < bots.length; i += 1) {
        const bot = bots[i];
        const [x, z] = bot.team === 'van' ? mateSpawn : sentSpawns[i - 1];
        bot.group.position.set(x, 0, z);
        bot.group.rotation.set(0, 0, 0);
        bot.yaw = bot.team === 'van' ? Math.PI : 0;
        bot.hp = 100;
        bot.alive = true;
        bot.fall = 0;
        bot.state = 'route';
        bot.path.length = 0;
        bot.goalKey = '';
        bot.enemy = null;
        bot.burstLeft = 0;
        bot.shootT = 0;
        bot.planting = false;
        bot.defusing = false;
        bot.roamIdx = i;
        bot.stuckT = 0;
      }
    },
  };
}
