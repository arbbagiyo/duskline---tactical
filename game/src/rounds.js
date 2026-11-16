// Rounds and economy: buy phase, round timer, plant/defuse progress, the
// bomb prop and its beeps, win/loss money, and the first-to-five match. It
// owns no actors; main.js resets them through onReset and reports who is
// planting or defusing each frame. Money and score live on G, as always.
import * as THREE from 'three';
import { G, announce, resetBomb, BUY_TIME, ROUND_TIME, PLANT_TIME, DEFUSE_TIME, BOMB_FUSE, START_MONEY, WIN_REWARD, LOSS_REWARD, MAX_MONEY, MATCH_WINS } from './state.js';
import { WEAPONS, GRENADE_PRICE } from './weapons.js';
import { PALETTE } from './palette.js';

export const BUY_MENU = [
  { id: 'vk7', label: 'VK-7 Rifle', price: WEAPONS.vk7.price, hint: 'Auto rifle, heavy headshots' },
  { id: 'smg', label: 'K-9 SMG', price: WEAPONS.smg.price, hint: 'Fast, close range' },
  { id: 'frag', label: 'Frag Grenade', price: GRENADE_PRICE, hint: 'Radius damage' },
  { id: 'smoke', label: 'Smoke Grenade', price: GRENADE_PRICE, hint: 'Blocks sight' },
];

export function createRounds(scene, audio, onReset) {
  const prop = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.22, 0.3),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#1c1c20'), roughness: 0.6, metalness: 0.3 }),
  );
  box.position.y = 0.11;
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.enemy) });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), lampMat);
  lamp.position.set(0.14, 0.26, 0);
  prop.add(box, lamp);
  prop.visible = false;
  scene.add(prop);
  let beepT = 0;
  let blinkT = 0;

  function startRound() {
    resetBomb();
    G.phase = 'buy';
    G.buyLeft = BUY_TIME;
    G.timer = ROUND_TIME;
    G.endLeft = 0;
    prop.visible = false;
    onReset();
    announce(`Round ${G.round} — buy phase, press B`, true);
  }

  function startMatch() {
    G.round = 1;
    G.scoreV = 0;
    G.scoreS = 0;
    G.money = START_MONEY;
    G.kills = 0;
    G.deaths = 0;
    G.feed.length = 0;
    G.winner = null;
    startRound();
  }

  function endRound(winner, reason) {
    if (G.phase === 'ended' || G.phase === 'match') return;
    if (winner === 'van') G.scoreV += 1;
    else G.scoreS += 1;
    const gain = winner === 'van' ? WIN_REWARD : LOSS_REWARD;
    G.money = Math.min(MAX_MONEY, G.money + gain);
    G.endText = `${winner === 'van' ? 'Vanguard' : 'Sentinels'} win the round — ${reason}. +$${gain}`;
    G.phase = 'ended';
    G.endLeft = 3.5;
    G.bomb.state = 'gone';
    prop.visible = false;
    announce(G.endText, winner === 'van');
    if (winner === 'van') audio.roundWin();
    else audio.roundLose();
  }

  function plantBomb(site, x, z) {
    G.bomb.state = 'planted';
    G.bomb.site = site;
    G.bomb.carrier = null;
    G.bomb.fuse = BOMB_FUSE;
    G.bomb.plant = 0;
    G.bomb.defuse = 0;
    G.bomb.pos.x = x;
    G.bomb.pos.y = 0;
    G.bomb.pos.z = z;
    prop.position.set(x, 0, z);
    prop.visible = true;
    announce(`Charge planted at site ${site} — defend it`, true);
    audio.plant();
  }

  function buy(loadout, id) {
    if (G.phase !== 'buy') return { ok: false, msg: 'Buy time is over' };
    const item = BUY_MENU.find((b) => b.id === id);
    if (!item) return { ok: false, msg: 'Unknown item' };
    if (G.money < item.price) return { ok: false, msg: 'Not enough money' };
    if ((id === 'vk7' || id === 'smg') && loadout.state.primary === id) return { ok: false, msg: 'Already owned' };
    if (id === 'frag' || id === 'smoke') {
      if (!loadout.buyGrenade(id)) return { ok: false, msg: 'Already carrying one' };
    } else {
      loadout.buyWeapon(id);
    }
    G.money -= item.price;
    audio.click();
    return { ok: true, msg: `${item.label} bought` };
  }

  // info: {planting: null | {site, x, z}, defusing: boolean}
  function update(dt, info) {
    if (G.phase === 'buy') {
      G.buyLeft -= dt;
      if (G.buyLeft <= 0) {
        G.phase = 'live';
        announce('Round live — take a site', true);
      }
      return;
    }
    if (G.phase === 'ended') {
      G.endLeft -= dt;
      if (G.endLeft <= 0) {
        if (G.scoreV >= MATCH_WINS || G.scoreS >= MATCH_WINS) {
          G.phase = 'match';
          G.winner = G.scoreV > G.scoreS ? 'van' : 'sent';
        } else {
          G.round += 1;
          startRound();
        }
      }
      return;
    }
    if (G.phase !== 'live') return;
    G.timer -= dt;
    const bomb = G.bomb;
    if (bomb.state === 'carried' || bomb.state === 'dropped') {
      if (info.planting && bomb.state === 'carried') {
        bomb.plant += dt;
        if (bomb.plant >= PLANT_TIME) plantBomb(info.planting.site, info.planting.x, info.planting.z);
      } else {
        bomb.plant = Math.max(0, bomb.plant - dt * 2);
      }
      if (G.timer <= 0) endRound('sent', 'time expired');
      return;
    }
    if (bomb.state === 'planted') {
      bomb.fuse -= dt;
      beepT -= dt;
      blinkT += dt;
      const interval = bomb.fuse > 20 ? 1.0 : bomb.fuse > 10 ? 0.5 : 0.25;
      if (beepT <= 0) { beepT = interval; audio.beep(bomb.fuse < 10); }
      lampMat.color.setHex(blinkT % (interval * 2) < interval ? 0xe2543e : 0x43100a);
      if (info.defusing) {
        bomb.defuse += dt;
        if (bomb.defuse >= DEFUSE_TIME) {
          announce('Charge defused', false);
          endRound('sent', 'charge defused');
          return;
        }
      } else {
        bomb.defuse = Math.max(0, bomb.defuse - dt * 2);
      }
      if (bomb.fuse <= 0) endRound('van', 'charge detonated');
    }
  }

  function syncProp() {
    if (G.bomb.state === 'dropped') {
      prop.position.set(G.bomb.pos.x, 0, G.bomb.pos.z);
      prop.visible = true;
    } else if (G.bomb.state === 'planted') {
      prop.visible = true;
    } else {
      prop.visible = false;
    }
  }

  return { startMatch, startRound, endRound, plantBomb, buy, update, syncProp };
}
