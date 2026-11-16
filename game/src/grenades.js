// Grenades: a fixed pool, no allocation after creation. A thrown grenade
// flies a gravity arc, bounces off colliders with damped reflection, then a
// frag explodes (radius damage with falloff, handled by main's callback) while
// a smoke deploys a cloud that blocks line of sight for bots and the player
// alike. Smoke clouds are registered on G so the sight check stays honest.
import * as THREE from 'three';
import { G } from './state.js';
import { PALETTE } from './palette.js';

const POOL = 6;
const GRAVITY = 18;
const FRAG_FUSE = 2.0;
const FRAG_RADIUS = 6.5;
const FRAG_DAMAGE = 110;
const SMOKE_TIME = 14;

export function createGrenades(scene, world, audio, damageRadius) {
  const items = [];
  const probe = new THREE.Box3();
  const fragMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.enemy), roughness: 0.5, metalness: 0.4 });
  const smokeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.muted), roughness: 0.6, metalness: 0.3 });
  const sphere = new THREE.SphereGeometry(0.09, 10, 8);
  for (let i = 0; i < POOL; i += 1) {
    const mesh = new THREE.Mesh(sphere, fragMat);
    mesh.visible = false;
    scene.add(mesh);
    items.push({ mesh, active: false, kind: 'frag', team: 'van', pos: new THREE.Vector3(), vel: new THREE.Vector3(), fuse: 0, rest: 0 });
  }
  // One shared explosion flash + light, reused by every blast.
  const blast = new THREE.Mesh(
    new THREE.SphereGeometry(1, 14, 10),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false }),
  );
  blast.visible = false;
  scene.add(blast);
  const blastLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 14, 1.6);
  scene.add(blastLight);
  let blastT = 0;
  // Smoke puffs: 10 spheres shared by at most two clouds.
  const puffs = [];
  const puffMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.muted), transparent: true, opacity: 0.5, depthWrite: false });
  for (let i = 0; i < 10; i += 1) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(1.5, 10, 8), puffMat.clone());
    puff.visible = false;
    scene.add(puff);
    puffs.push(puff);
  }
  const clouds = []; // {x, z, left, puffIdx[]}

  function pointHits(x, y, z) {
    probe.min.set(x - 0.09, y - 0.09, z - 0.09);
    probe.max.set(x + 0.09, y + 0.09, z + 0.09);
    for (const c of world.colliders) if (probe.intersectsBox(c)) return true;
    return false;
  }

  function deploySmoke(x, z) {
    const free = puffs.map((p, i) => (p.visible ? -1 : i)).filter((i) => i >= 0).slice(0, 5);
    if (free.length < 5) return;
    const idxs = [];
    for (let k = 0; k < free.length; k += 1) {
      const puff = puffs[free[k]];
      const a = (k / 5) * Math.PI * 2;
      puff.position.set(x + Math.cos(a) * 1.4, 1.1 + (k % 2) * 0.5, z + Math.sin(a) * 1.4);
      puff.material.opacity = 0.55;
      puff.visible = true;
      idxs.push(free[k]);
    }
    clouds.push({ x, z, left: SMOKE_TIME, idxs });
    G.smokes.push({ x, z, radius: 3.4, left: SMOKE_TIME });
  }

  function explode(item) {
    item.active = false;
    item.mesh.visible = false;
    blast.position.copy(item.pos);
    blast.visible = true;
    blastT = 0.35;
    blastLight.position.copy(item.pos);
    damageRadius(item.pos, FRAG_RADIUS, item.team, FRAG_DAMAGE);
  }

  return {
    throwGrenade(from, dir, kind, team) {
      const item = items.find((g) => !g.active);
      if (!item) return false;
      item.active = true;
      item.kind = kind;
      item.team = team;
      item.pos.copy(from);
      item.vel.copy(dir).multiplyScalar(13);
      item.vel.y += 3.6;
      item.fuse = kind === 'frag' ? FRAG_FUSE : 99;
      item.rest = 0;
      item.mesh.material = kind === 'frag' ? fragMat : smokeMat;
      item.mesh.visible = true;
      item.mesh.position.copy(from);
      return true;
    },
    step(dt) {
      if (blastT > 0) {
        blastT = Math.max(0, blastT - dt);
        const k = blastT / 0.35;
        blast.scale.setScalar(1 + (1 - k) * 4);
        blast.material.opacity = k * 0.7;
        blastLight.intensity = k * 60;
        if (blastT === 0) blast.visible = false;
      }
      for (let i = clouds.length - 1; i >= 0; i -= 1) {
        const cloud = clouds[i];
        cloud.left -= dt;
        const fade = Math.min(1, cloud.left / 3);
        for (const idx of cloud.idxs) puffs[idx].material.opacity = 0.55 * fade;
        if (cloud.left <= 0) {
          for (const idx of cloud.idxs) puffs[idx].visible = false;
          clouds.splice(i, 1);
        }
      }
      for (let i = G.smokes.length - 1; i >= 0; i -= 1) {
        G.smokes[i].left -= dt;
        if (G.smokes[i].left <= 0) G.smokes.splice(i, 1);
      }
      for (const item of items) {
        if (!item.active) continue;
        item.vel.y -= GRAVITY * dt;
        const stepLen = item.vel.length() * dt;
        const sub = Math.max(1, Math.ceil(stepLen / 0.15));
        let bounced = false;
        for (let s = 0; s < sub; s += 1) {
          const nx = item.pos.x + (item.vel.x * dt) / sub;
          if (!pointHits(nx, item.pos.y, item.pos.z)) item.pos.x = nx;
          else { item.vel.x *= -0.45; bounced = true; }
          const nz = item.pos.z + (item.vel.z * dt) / sub;
          if (!pointHits(item.pos.x, item.pos.y, nz)) item.pos.z = nz;
          else { item.vel.z *= -0.45; bounced = true; }
          const ny = item.pos.y + (item.vel.y * dt) / sub;
          if (ny <= 0.09) {
            item.pos.y = 0.09;
            if (Math.abs(item.vel.y) > 1.5) bounced = true;
            item.vel.y = Math.abs(item.vel.y) > 1.5 ? -item.vel.y * 0.42 : 0;
            item.vel.x *= 0.72;
            item.vel.z *= 0.72;
          } else if (!pointHits(item.pos.x, ny, item.pos.z)) {
            item.pos.y = ny;
          } else {
            item.vel.y *= -0.42;
            bounced = true;
          }
        }
        if (bounced) audio.bounce();
        item.mesh.position.copy(item.pos);
        if (item.kind === 'frag') {
          item.fuse -= dt;
          if (item.fuse <= 0) explode(item);
        } else {
          if (item.vel.lengthSq() < 0.25) item.rest += dt;
          else item.rest = 0;
          if (item.rest > 0.5) {
            item.active = false;
            item.mesh.visible = false;
            deploySmoke(item.pos.x, item.pos.z);
          }
        }
      }
    },
    reset() {
      for (const item of items) { item.active = false; item.mesh.visible = false; }
      for (const puff of puffs) puff.visible = false;
      clouds.length = 0;
      G.smokes.length = 0;
      blastT = 0;
      blast.visible = false;
      blastLight.intensity = 0;
    },
  };
}

// True when segment a->b passes through any live smoke cloud. Reuses the
// module-level temps; called from sight checks, never allocates.
const _ab = new THREE.Vector3();
const _ap = new THREE.Vector3();
export function smokeBlocks(a, b) {
  for (const s of G.smokes) {
    _ab.subVectors(b, a);
    _ap.set(s.x - a.x, 1.2 - a.y, s.z - a.z);
    const lenSq = _ab.lengthSq() || 1;
    const t = Math.max(0, Math.min(1, _ap.dot(_ab) / lenSq));
    const dx = a.x + _ab.x * t - s.x;
    const dy = a.y + _ab.y * t - 1.2;
    const dz = a.z + _ab.z * t - s.z;
    if (dx * dx + dy * dy + dz * dz < s.radius * s.radius) return true;
  }
  return false;
}
