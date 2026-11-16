// Weapons: three guns and two grenades. Each gun definition carries its
// damage, headshot multiplier, fire gap, magazine, reload and spread numbers;
// the loadout owns one magazine state per gun, the view models, muzzle flash,
// heat bloom and the spread formula. Stopping to aim pays: spread grows with
// movement speed and with heat from fast firing, and crouching shrinks it.
// Damage falls off with range. Grenades are slots too; throwing is main.js's
// job, this module only tracks counts and shows the held grenade.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  vk7: { id: 'vk7', name: 'VK-7 Rifle', kind: 'rifle', price: 2700, damage: 33, headMult: 3.2, gap: 0.1, mag: 30, reserve: 90, reload: 2.2, spread: 0.004, kick: 0.011, auto: true },
  smg: { id: 'smg', name: 'K-9 SMG', kind: 'smg', price: 1500, damage: 24, headMult: 2.8, gap: 0.075, mag: 32, reserve: 96, reload: 1.9, spread: 0.008, kick: 0.007, auto: true },
  pistol: { id: 'pistol', name: 'P9 Sidearm', kind: 'pistol', price: 0, damage: 30, headMult: 2.6, gap: 0.17, mag: 12, reserve: 48, reload: 1.5, spread: 0.003, kick: 0.014, auto: false },
};
export const GRENADE_PRICE = 300;

function gunModel(kind, mats) {
  const g = new THREE.Group();
  const dark = mats.steel;
  const grip = mats.rust;
  if (kind === 'pistol') {
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.2), dark);
    slide.position.set(0, 0.02, -0.08);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.12, 0.06), grip);
    handle.position.set(0, -0.05, 0.02);
    handle.rotation.x = 0.25;
    g.add(slide, handle);
  } else {
    const long = kind === 'rifle';
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, long ? 0.44 : 0.34), dark);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, long ? 0.4 : 0.26), grip);
    barrel.position.set(0, 0.03, long ? -0.38 : -0.28);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.2), grip);
    stock.position.set(0, -0.02, long ? 0.3 : 0.26);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.07), grip);
    mag.position.set(0, -0.1, -0.02);
    mag.rotation.x = 0.15;
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.06), dark);
    sight.position.set(0, 0.07, -0.1);
    g.add(receiver, barrel, stock, mag, sight);
  }
  g.position.set(0.24, -0.2, -0.42);
  return g;
}

export function createLoadout(camera) {
  const mats = {
    steel: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.steel), roughness: 0.5, metalness: 0.4 }),
    rust: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rust), roughness: 0.7, metalness: 0.2 }),
  };
  const models = {
    vk7: gunModel('rifle', mats),
    smg: gunModel('smg', mats),
    pistol: gunModel('pistol', mats),
  };
  const fragModel = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 10, 8),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.enemy), roughness: 0.5, metalness: 0.4 }),
  );
  fragModel.position.set(0.24, -0.2, -0.42);
  const smokeModel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.11, 10),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.muted), roughness: 0.6, metalness: 0.3 }),
  );
  smokeModel.position.set(0.24, -0.2, -0.42);
  for (const m of Object.values(models)) camera.add(m);
  camera.add(fragModel, smokeModel);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.17, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const ammo = {
    vk7: { mag: 30, reserve: 90 },
    smg: { mag: 32, reserve: 96 },
    pistol: { mag: 12, reserve: 48 },
  };
  const state = {
    primary: null, // 'vk7' | 'smg' | null (pistol round)
    slot: 'pistol', // 'primary' | 'pistol' | 'frag' | 'smoke'
    frags: 0,
    smokes: 0,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    heat: 0,
    bob: 0,
  };

  function currentDef() {
    if (state.slot === 'primary') return state.primary ? WEAPONS[state.primary] : null;
    if (state.slot === 'pistol') return WEAPONS.pistol;
    return null;
  }
  function currentModel() {
    if (state.slot === 'primary') return state.primary ? models[state.primary] : null;
    if (state.slot === 'pistol') return models.pistol;
    return state.slot === 'frag' ? fragModel : smokeModel;
  }
  function showCurrent() {
    for (const m of Object.values(models)) m.visible = false;
    fragModel.visible = false;
    smokeModel.visible = false;
    const m = currentModel();
    if (m) m.visible = true;
  }
  showCurrent();

  function step(dt, speed) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.heat = Math.max(0, state.heat - dt * 1.5);
    state.kick += (0 - state.kick) * Math.min(1, dt * 13);
    state.bob += dt * (2 + speed * 1.4);
    const model = currentModel();
    if (model) {
      const sway = Math.min(1, speed / 5.4) * 0.012;
      model.position.z = -0.42 + state.kick;
      model.position.y = -0.2 + Math.sin(state.bob * 2) * sway;
      model.position.x = 0.24 + Math.cos(state.bob) * sway * 0.6;
      model.rotation.x = state.kick * 2.4;
    }
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 34;
    flashLight.intensity = state.flash > 0 ? 16 : 0;
    const def = currentDef();
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      if (model) model.rotation.x = -0.5 * Math.sin(Math.min(1, 1 - state.reloadLeft / (def ? def.reload : 1)) * Math.PI);
      if (state.reloadLeft === 0 && def) {
        const a = ammo[def.id];
        const take = Math.min(def.mag - a.mag, a.reserve);
        a.mag += take;
        a.reserve -= take;
      }
    }
  }

  return {
    state,
    ammo,
    step,
    currentDef,
    isGrenadeSlot() {
      return state.slot === 'frag' || state.slot === 'smoke';
    },
    ready() {
      const def = currentDef();
      return !!def && ammo[def.id].mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    // Consumes one round and starts cooldown/flash/kick. Returns the def or null.
    fire() {
      const def = currentDef();
      if (!def || ammo[def.id].mag <= 0) return null;
      ammo[def.id].mag -= 1;
      state.cooldown = def.gap;
      state.flash = 0.055;
      state.kick = 0.05;
      state.heat = Math.min(1, state.heat + (def.kind === 'rifle' ? 0.14 : 0.1));
      return def;
    },
    reload() {
      const def = currentDef();
      if (!def || state.reloadLeft > 0) return false;
      const a = ammo[def.id];
      if (a.mag === def.mag || a.reserve === 0) return false;
      state.reloadLeft = def.reload;
      return true;
    },
    // Spread in radians: base + movement + heat, crouch and stillness shrink it.
    spread(speed, crouching, airborne) {
      const def = currentDef();
      if (!def) return 0;
      let s = def.spread + Math.min(1, speed / 5.4) * 0.03 + state.heat * 0.022;
      if (crouching) s *= 0.7;
      if (airborne) s *= 1.8;
      return s;
    },
    damageAt(def, dist) {
      const fall = dist <= 12 ? 1 : Math.max(0.6, 1 - (dist - 12) * 0.014);
      return def.damage * fall;
    },
    switchTo(slot) {
      if (slot === 'primary' && !state.primary) return false;
      if (slot === 'frag' && state.frags <= 0) return false;
      if (slot === 'smoke' && state.smokes <= 0) return false;
      if (state.slot === slot) return false;
      state.slot = slot;
      state.reloadLeft = 0;
      state.cooldown = Math.max(state.cooldown, 0.18);
      showCurrent();
      return true;
    },
    fallbackSlot() {
      return state.primary ? 'primary' : 'pistol';
    },
    throwHeld() {
      if (state.slot === 'frag' && state.frags > 0) { state.frags -= 1; return 'frag'; }
      if (state.slot === 'smoke' && state.smokes > 0) { state.smokes -= 1; return 'smoke'; }
      return null;
    },
    buyWeapon(id) {
      state.primary = id;
      ammo[id].mag = WEAPONS[id].mag;
      ammo[id].reserve = WEAPONS[id].reserve;
      state.slot = 'primary';
      showCurrent();
    },
    buyGrenade(kind) {
      if (kind === 'frag' && state.frags < 1) { state.frags = 1; return true; }
      if (kind === 'smoke' && state.smokes < 1) { state.smokes = 1; return true; }
      return false;
    },
    refillRound() {
      for (const id of Object.keys(ammo)) {
        ammo[id].mag = WEAPONS[id].mag;
        ammo[id].reserve = WEAPONS[id].reserve;
      }
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.heat = 0;
      if (!currentDef()) state.slot = state.primary ? 'primary' : 'pistol';
      showCurrent();
    },
    resetMatch() {
      state.primary = null;
      state.slot = 'pistol';
      state.frags = 0;
      state.smokes = 0;
      this.refillRound();
    },
  };
}
