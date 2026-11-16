// Deterministic screenshot setups. Each shot stages a real game state through
// the same code paths a player uses — same spawns, same weapons, same damage —
// then main.js renders twice, freezes, and sets window.__shotReady. The seed
// comes from ?seed= and flows through G.rng, so the same URL always stages
// the same frame. No shot invents a scene the game cannot reach.
import { G, announce } from './state.js';

export function setupShot(name, ctx) {
  const { player, bots, loadout, hud, rounds, world } = ctx;
  hud.hideOverlay();
  if (name === 'start') {
    player.reset(0.5, 21, 0);
    ctx.settle(12);
    ctx.aimAt(0, 1.4, -10);
    hud.showOverlay('start');
    hud.setAmmo(12, 48, 'P9 Sidearm', false);
    hud.setHealth(100);
    hud.setMoney(800);
    hud.setScore(0, 0, 1);
    hud.setTimer('1:40', false);
    hud.setCarry(true);
    return;
  }
  if (name === 'play') {
    rounds.startMatch();
    G.phase = 'live';
    G.timer = 62;
    G.round = 4;
    G.scoreV = 2;
    G.scoreS = 1;
    G.money = 2400;
    G.kills = 1;
    loadout.buyWeapon('vk7');
    loadout.ammo.vk7.mag = 24;
    player.reset(2, 8, 0);
    const foe = bots.bots[3];
    foe.group.position.set(0.5, 0, -3.5);
    foe.yaw = Math.PI;
    foe.hp = 62;
    const mate = bots.mate();
    mate.group.position.set(-4, 0, 6);
    mate.yaw = 0.4;
    ctx.settle(8);
    ctx.aimAt(0.5, 1.3, -3.5);
    ctx.playerShoot(0);
    hud.hitMarker(false, 4000);
    announce('You eliminated Ondo', true);
    announce('Rook is pushing Stacks', true);
    // Let the 0.055s muzzle flash decay (5 fixed steps) so the frozen frame
    // shows the firefight, not the flash quad. Tracers fade per rendered
    // frame, not per step, so the tracer survives.
    ctx.settle(5);
    return;
  }
  if (name === 'site') {
    rounds.startMatch();
    G.phase = 'live';
    G.timer = 48;
    G.round = 3;
    G.scoreV = 1;
    G.scoreS = 1;
    G.money = 1750;
    loadout.buyWeapon('vk7');
    player.reset(-22, -13.5, 0.5);
    G.bomb.plant = 1.6;
    const mate = bots.mate();
    mate.group.position.set(-19, 0, -12);
    mate.yaw = 2.4;
    const guard = bots.bots[1];
    guard.group.position.set(-27, 0, -18.5);
    guard.yaw = 0.8;
    ctx.settle(8);
    ctx.aimAt(-24, 1.2, -17);
    hud.setPrompt('HOLD E — PLANT CHARGE AT DEPOT');
    hud.setBomb('plant', 1.6 / 3.5, 'PLANTING — SITE A DEPOT');
    hud.setCarry(true);
    return;
  }
  // end: match won, overlay up, the yard and a fallen defender behind it.
  rounds.startMatch();
  G.scoreV = 5;
  G.scoreS = 3;
  G.round = 8;
  G.kills = 7;
  G.phase = 'match';
  G.winner = 'van';
  loadout.buyWeapon('vk7');
  player.reset(19, -9, -0.4);
  const fallen = bots.bots[2];
  fallen.group.position.set(22, 0, -13);
  fallen.alive = false;
  fallen.fall = 1;
  fallen.group.rotation.x = -1.45;
  ctx.settle(8);
  ctx.aimAt(24, 2.5, -16);
  hud.setScore(5, 3, 8);
  hud.setMoney(3200);
  hud.showOverlay('match', { winner: 'van', v: 5, s: 3, kills: 7 });
}
