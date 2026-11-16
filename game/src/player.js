// Player body: acceleration toward a wish velocity, friction on the ground,
// gravity and jump, crouch with a headroom check, and AABB collision resolved
// one axis at a time against the world's colliders. The probe box is reused;
// step() allocates nothing. Damage and death live here too, so main.js only
// asks "did that hit kill?" and reacts.
import * as THREE from 'three';

const RADIUS = 0.34;
const STAND_H = 1.72;
const CROUCH_H = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK = 5.4;
const CROUCH_SPEED = 2.5;
const GROUND_ACCEL = 46;
const AIR_ACCEL = 10;
const FRICTION = 10;
const GRAVITY = 21;
const JUMP = 7;

export function createPlayer(colliders) {
  const body = {
    pos: new THREE.Vector3(0, 0, 21),
    vel: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    height: STAND_H,
    onGround: true,
    crouching: false,
    hp: 100,
    alive: true,
  };
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (const c of colliders) if (probe.intersectsBox(c)) return c;
    return null;
  }

  function look(dx, dy, sens = 0.0022) {
    body.yaw -= dx * sens;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * sens));
  }

  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.45, body.pitch + pitchKick);
    body.yaw += yawKick;
  }

  // canMove false during buy freeze and after death: gravity still settles.
  function step(dt, keys, canMove) {
    const wantCrouch = canMove && (keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC'));
    if (wantCrouch && !body.crouching) {
      body.crouching = true;
      body.height = CROUCH_H;
    } else if (!wantCrouch && body.crouching && !overlaps(body.pos.x, body.pos.y, body.pos.z, STAND_H, 0.02)) {
      body.crouching = false;
      body.height = STAND_H;
    }
    const eyeTarget = body.crouching ? CROUCH_EYE : STAND_EYE;
    body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);

    wish.set(0, 0, 0);
    if (canMove) {
      const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
      const str = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      if (fwd || str) {
        const s = Math.sin(body.yaw);
        const c = Math.cos(body.yaw);
        wish.set(-s * fwd + c * str, 0, -c * fwd - s * str).normalize();
      }
    }
    const speed = body.crouching ? CROUCH_SPEED : WALK;
    const blend = Math.min(1, ((body.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt) / speed);
    body.vel.x += (wish.x * speed - body.vel.x) * blend;
    body.vel.z += (wish.z * speed - body.vel.z) * blend;
    if (body.onGround && wish.lengthSq() === 0) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      body.vel.x *= damp;
      body.vel.z *= damp;
    }
    if (canMove && keys.has('Space') && body.onGround) {
      body.vel.y = JUMP;
      body.onGround = false;
    }
    body.vel.y = Math.max(-30, body.vel.y - GRAVITY * dt);

    const nx = body.pos.x + body.vel.x * dt;
    if (!overlaps(nx, body.pos.y, body.pos.z, body.height, 0.05)) body.pos.x = nx;
    else body.vel.x = 0;
    const nz = body.pos.z + body.vel.z * dt;
    if (!overlaps(body.pos.x, body.pos.y, nz, body.height, 0.05)) body.pos.z = nz;
    else body.vel.z = 0;

    body.pos.y += body.vel.y * dt;
    body.onGround = false;
    const hit = overlaps(body.pos.x, body.pos.y, body.pos.z, body.height, 0);
    if (hit && body.vel.y <= 0) {
      body.pos.y = hit.max.y;
      body.vel.y = 0;
      body.onGround = true;
    } else if (hit) {
      body.pos.y = hit.min.y - body.height;
      body.vel.y = 0;
    }
    if (body.pos.y < 0) {
      body.pos.y = 0;
      body.vel.y = 0;
      body.onGround = true;
    }
  }

  return {
    body,
    look,
    recoil,
    step,
    groundSpeed() {
      return Math.hypot(body.vel.x, body.vel.z);
    },
    eyePos(out) {
      out.set(body.pos.x, body.pos.y + body.eye, body.pos.z);
      return out;
    },
    // Returns true when the hit killed the player.
    damage(amount) {
      if (!body.alive) return false;
      body.hp = Math.max(0, body.hp - amount);
      if (body.hp === 0) {
        body.alive = false;
        return true;
      }
      return false;
    },
    reset(x, z, yaw) {
      body.pos.set(x, 0, z);
      body.vel.set(0, 0, 0);
      body.yaw = yaw;
      body.pitch = 0;
      body.eye = STAND_EYE;
      body.height = STAND_H;
      body.crouching = false;
      body.hp = 100;
      body.alive = true;
      body.onGround = true;
    },
  };
}
